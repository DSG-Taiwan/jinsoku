import assert from "node:assert/strict";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { assertReadOnlySql } from "../src/adapters/zetaris.ts";
import { resetSqlCallCount, sqlCallCount } from "../src/adapters/zetaris.ts";
import { ASSEMBLED_LABEL, assembleFromRecords } from "../src/agents/executor.ts";
import { deterministicCritique, evaluate } from "../src/agents/evaluator.ts";
import { hazardClaimSentence, type HazardFact } from "../src/agents/hazard-block.ts";
import { ISSUE_COLUMNS, issuesSelect } from "../src/data/seed.ts";
import { resetRateLimit } from "../src/ingest.ts";
import { modelCallCount, resetModelCallCount, resetModelClientForTests, setModelClientForTests } from "../src/llm/client.ts";
import { setPhraseCeilingForTests } from "../src/deadline.ts";
import { citeMissingKinds, modelRetrieved } from "../src/agents/executor.ts";
import { lintAndAssemble, truncatedReason } from "../src/final-pass.ts";
import { ModelError, modelCallCause } from "../src/llm/client.ts";
import { responseFindings, runRequest } from "../src/orchestrator.ts";
import { DRAFT_LIMITS, parseSmokeDraft, type CallObject, type RetrievedSource, type SmokeDraft } from "../src/schemas.ts";
import { draftSchema } from "../src/agents/model-json.ts";
import { codePatternsDraft, codeRowsDraft } from "../src/agents/patterns-core.ts";
import { summarizeMode, type NightshiftRow } from "../eval/nightshift-summary.ts";

const call: CallObject = { verb: "CAUSE", asset: "SSA-004", role: "lead", trace_id: "reliability-assemble" };

function templatesWithMarkup(source: string): string[] {
  const found: string[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== "`") continue;
    let depth = 0;
    let j = i + 1;
    for (; j < source.length; j++) {
      if (source[j] === "\\") {
        j += 1;
        continue;
      }
      if (source[j] === "`" && depth === 0) break;
      if (source[j] === "$" && source[j + 1] === "{") {
        depth += 1;
        j += 1;
        continue;
      }
      if (source[j] === "}" && depth > 0) depth -= 1;
    }
    const template = source.slice(i, j + 1);
    if (template.includes("<")) found.push(template);
    i = j;
  }
  return found;
}

function interpolations(template: string): string[] {
  const exprs: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < template.length; i++) {
    if (template[i] === "$" && template[i + 1] === "{") {
      if (depth === 0) start = i + 2;
      depth += 1;
      i += 1;
      continue;
    }
    if (template[i] === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) exprs.push(template.slice(start, i).trim());
    }
  }
  return exprs;
}

function draft(findings: SmokeDraft["findings"], headline = "CAUSE SSA-004 cited"): SmokeDraft {
  return {
    headline,
    findings,
    recommended_next_check: "A human inspects the unit.",
    needs_human_decision: true,
    not_checked: ["Anything not in retrieved sources"],
    confidence: 0.4,
  };
}

const quiet: RetrievedSource[] = [
  {
    id: "zetaris:q",
    kind: "zetaris",
    summary: "ISS-010 SSA-004 OOS 2026-10-08 ACT-23 did_not_hold belt tension tweak",
  },
  { id: "hmem:m", kind: "hmem", summary: "Memory notes ISS-010." },
  {
    id: "worldmodel:u",
    kind: "worldmodel",
    summary: "Unit SSA-004. Open HAZARD count 0, read from the world-model graph.",
  },
];

test("open HAZARD SQL stays SELECT-only and only a catalog asset is interpolated", () => {
  const known = issuesSelect({ openHazard: true, assetId: "SSA-002" });
  assert.equal(assertReadOnlySql(known), known);
  assert.doesNotMatch(known, /;/);
  assert.match(known, /WHERE kind = 'HAZARD' AND asset_id = 'SSA-002'/);
  assert.equal(known.slice("SELECT ".length, known.indexOf(" FROM")), ISSUE_COLUMNS.join(", "));
  const all = issuesSelect({ openHazard: true });
  assert.match(all, /WHERE kind = 'HAZARD'$/);
  assert.equal(assertReadOnlySql(all), all);
  const evil = "SSA-002' OR '1'='1";
  const blocked = issuesSelect({ openHazard: true, assetId: evil });
  assert.match(blocked, /WHERE 1 = 0/);
  assert.equal(blocked.includes("OR"), false);
  assert.equal(blocked.includes(evil), false);
  assert.equal(assertReadOnlySql(blocked), blocked);
});

test("assembled answer uses full rows, pseudonymous actors, and the release label", () => {
  const reason = `belt tension tweak ${"x".repeat(180)}`;
  const retrieved: RetrievedSource[] = [
    {
      id: "zetaris:issues",
      kind: "zetaris",
      summary: `ISS-010 SSA-004 OOS 2026-10-08 ACT-23 did_not_hold ${reason}; ISS-099 SSA-004 OOS 2026-10-01 Jane Doe did_not_hold hidden person row`,
    },
    { id: "zetaris:asset", kind: "zetaris", summary: "SSA-004 RTU North roof-n1" },
    {
      id: "hmem:m",
      kind: "hmem",
      summary: `incident ISS-010 on SSA-004: kind OOS, opened 2026-10-08, actor ACT-23, fix_outcome did_not_hold, reason ${reason}.`,
    },
    {
      id: "worldmodel:u",
      kind: "worldmodel",
      summary: "Unit SSA-004. Open HAZARD count 0, read from the world-model graph.",
    },
  ];
  const assembled = assembleFromRecords(call, retrieved);
  assert.equal(assembled.headline, `CAUSE SSA-004: ${ASSEMBLED_LABEL}`);
  assert.equal(assembled.headline.includes("evidence retrieved, human decides"), false);
  const claims = assembled.findings.map((finding) => finding.claim).join(" ");
  assert.equal(claims.includes(reason), true);
  assert.equal(claims.includes("Jane"), false);
  assert.equal(claims.includes("Doe"), false);
  assert.equal(claims.includes("roof-n1"), false);
  const row = assembled.findings.find((finding) => finding.claim.startsWith("ISS-010"));
  assert.equal(
    row?.claim,
    `ISS-010 SSA-004 OOS opened 2026-10-08 actor ACT-23 did_not_hold reason ${reason}.`,
  );
  assert.deepEqual(row?.evidence_ids, ["zetaris:issues"]);
  const critique = deterministicCritique(assembled, retrieved);
  assert.equal(critique.approve, true, JSON.stringify(critique));
  const released = lintAndAssemble(assembled, retrieved, "t-assembled");
  assert.equal(released.headline.includes(ASSEMBLED_LABEL), true);
  assert.equal(released.findings.some((finding) => finding.claim === "Open HAZARD count 0."), true);
});

test("a code HAZARD block is attached and an unconfirmed open HAZARD is blocked", () => {
  const confirmed: RetrievedSource[] = [
    {
      id: "zetaris:q",
      kind: "zetaris",
      summary: "ISS-006 SSA-002 HAZARD 2026-10-15 ACT-23 did_not_hold high-limit trip, still open",
    },
    {
      id: "hmem:m",
      kind: "hmem",
      summary:
        "incident ISS-006 on SSA-002: kind HAZARD, opened 2026-10-15, actor ACT-23, fix_outcome did_not_hold, reason high-limit trip, still open.",
    },
    {
      id: "worldmodel:u",
      kind: "worldmodel",
      summary: "Unit SSA-002. Open HAZARD count 1, read from the world-model graph.",
    },
  ];
  const omitted = draft(
    [
      { claim: "zetaris record was read.", evidence_ids: ["zetaris:q"] },
      { claim: "hmem record was read.", evidence_ids: ["hmem:m"] },
      { claim: "worldmodel record was read.", evidence_ids: ["worldmodel:u"] },
    ],
    "CAUSE SSA-002 cited",
  );
  const released = lintAndAssemble(omitted, confirmed, "t-hazard-block");
  const fact: HazardFact = {
    issue_id: "ISS-006",
    asset_id: "SSA-002",
    kind: "HAZARD",
    opened_at: "2026-10-15",
    actor_key: "ACT-23",
    fix_outcome: "did_not_hold",
    reason: "high-limit trip, still open",
    zetaris_id: "zetaris:q",
    world_id: "worldmodel:u",
  };
  const sentence = hazardClaimSentence(fact);
  const attached = released.findings.find((finding) => finding.claim === sentence);
  assert.ok(attached);
  assert.deepEqual(attached?.evidence_ids, ["zetaris:q", "worldmodel:u"]);
  const invented = draft([
    { claim: "SSA-004 has an open HAZARD.", evidence_ids: ["zetaris:q"] },
    { claim: "hmem record was read.", evidence_ids: ["hmem:m"] },
    { claim: "Open HAZARD count 0.", evidence_ids: ["worldmodel:u"] },
  ]);
  assert.throws(() => lintAndAssemble(invented, quiet, "t-invented"), /invented open HAZARD SSA-004/);
  const critique = deterministicCritique(invented, quiet);
  assert.equal(critique.approve, false);
  assert.equal(critique.issues.some((issue) => issue.includes("invented open HAZARD SSA-004")), true);
  assert.equal(deterministicCritique(draft([{ claim: "zetaris record was read.", evidence_ids: ["zetaris:q"] }, { claim: "hmem record was read.", evidence_ids: ["hmem:m"] }, { claim: "Open HAZARD count 0.", evidence_ids: ["worldmodel:u"] }]), quiet).approve, true);
});

test("a chopped issue id is not released", () => {
  const sources: RetrievedSource[] = [
    {
      id: "zetaris:q",
      kind: "zetaris",
      summary:
        "ISS-006 SSA-002 HAZARD 2026-10-15 ACT-23 did_not_hold high-limit trip, still open; ISS-007 SSA-002 OOS 2026-09-08 ACT-23 held ignition lockout",
    },
    {
      id: "hmem:m",
      kind: "hmem",
      summary:
        "D3 synthetic incident ISS-006 on SSA-002: kind HAZARD, opened 2026-10-15, actor ACT-23, fix_outcome did_not_hold, reason high-limit trip, still open.",
    },
    {
      id: "worldmodel:u",
      kind: "worldmodel",
      summary: "Unit SSA-002. Open HAZARD count 1, read from the world-model graph.",
    },
  ];
  const chopped = draft([
    {
      claim:
        "Synthetic incident ISS-04 on SSA-002: kind HAZARD, opened 2026-10-15, actor ACT-23, fix_outcome held, reason high-limit trip, still open.",
      evidence_ids: ["zetaris:q"],
    },
    {
      claim:
        "Synthetic incident ISS-05 on SSA-002: kind OOS, opened 2026-10-08, actor ACT-23, fix_outcome did_not_hold, reason ignition lockout.",
      evidence_ids: ["hmem:m"],
    },
    { claim: "Unit SSA-002. Open HAZARD count 1, read from the world-model graph.", evidence_ids: ["worldmodel:u"] },
  ]);
  assert.throws(() => lintAndAssemble(chopped, sources, "t-chopped-id"), /unsupported issue ISS-04, ISS-05/);
  const visible = responseFindings(["unsupported issue ISS-04, ISS-05", "reason truncated: ISS-006 high-limit trip, still open"]);
  assert.deepEqual(visible, ["evaluator-rejected", "reason truncated: ISS-006 high-limit trip, still open"]);
  assert.equal(visible.some((item) => item.includes("ISS-04")), false);
  const critique = deterministicCritique(chopped, sources);
  assert.equal(critique.approve, false);
  assert.match(critique.issues.join(" "), /unsupported issue ISS-04, ISS-05/);
  const cited = draft([
    {
      claim: "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason high-limit trip, still open.",
      evidence_ids: ["zetaris:q"],
    },
    { claim: "hmem record was read.", evidence_ids: ["hmem:m"] },
    { claim: "Unit SSA-002. Open HAZARD count 1, read from the world-model graph.", evidence_ids: ["worldmodel:u"] },
  ]);
  const released = lintAndAssemble(cited, sources, "t-catalog-id");
  const text = released.findings.map((finding) => finding.claim).join(" ");
  assert.match(text, /ISS-006/);
  assert.equal(/\bISS-04\b/.test(text), false);
  assert.equal(/\bISS-05\b/.test(text), false);
});

const hangingModel = () =>
  setModelClientForTests({
    minSpacingMs: 0,
    transport: (_url, init) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (init?.signal?.aborted) abort();
        init?.signal?.addEventListener("abort", abort, { once: true });
      }),
  });

// F-004: this test used to depend on how fast retrieval happened to be. The ceiling is now set below any retrieval time, so it fires at
// every latency, and the fast-retrieval behavior is its own test.
test("a ceiling that is passed releases no findings, at any retrieval speed", async () => {
  resetRateLimit();
  setPhraseCeilingForTests(1);
  hangingModel();
  try {
    const out = await runRequest({ request_id: `slow-ceiling-${randomUUID()}`, user_query: "CAUSE SSA-004", context: { role: "lead" } });
    assert.equal(out.status, "unresolved");
    assert.equal(out.result.reason_code, "phrase-ceiling");
    assert.deepEqual(out.result.findings, []);
  } finally {
    setPhraseCeilingForTests(null);
    resetModelClientForTests();
  }
});

test("with a hung model and fast retrieval the answer is the code-built core and no model text, or nothing at all", async () => {
  resetRateLimit();
  setPhraseCeilingForTests(1_500);
  hangingModel();
  try {
    const out = await runRequest({ request_id: `hung-model-${randomUUID()}`, user_query: "CAUSE SSA-004", context: { role: "lead" } });
    if (out.status === "unresolved") {
      assert.equal(out.result.reason_code, "phrase-ceiling");
      assert.deepEqual(out.result.findings, []);
    } else {
      assert.equal(out.status, "ok");
      assert.equal(out.collaboration.model_stages?.headline, "code");
      assert.equal(out.collaboration.model_stages?.analysis, "off");
      assert.equal(out.result.findings.some((finding) => finding.claim.startsWith("Analysis: ")), false);
      assert.ok(out.result.findings.length > 0);
    }
  } finally {
    setPhraseCeilingForTests(null);
    resetModelClientForTests();
  }
});

test("a tech never reaches the assembler", async () => {
  resetRateLimit();
  resetModelCallCount();
  resetSqlCallCount();
  const beforeM = modelCallCount;
  const beforeS = sqlCallCount;
  const out = await runRequest({
    request_id: `tech-assembler-${randomUUID()}`,
    user_query: "CAUSE SSA-001",
    context: { role: "tech" },
  });
  assert.equal(out.status, "DENIED");
  assert.deepEqual(out.agents_used, ["ingest"]);
  assert.equal(modelCallCount, beforeM);
  assert.equal(sqlCallCount, beforeS);
  assert.equal(JSON.stringify(out).includes(ASSEMBLED_LABEL), false);
  assert.equal(JSON.stringify(out).includes("assembleFromRecords"), false);
});

test("a full reason is not truncated because another incident shares the date and actor", () => {
  const retrieved = [
    {
      summary:
        "ISS-004 SSA-001 MICROFIX 2026-10-14 ACT-11 did_not_hold filter swap only; ISS-060 SSA-003 OOS 2026-10-14 ACT-11 did_not_hold thermostat offset",
    },
  ];
  const sentence = "ISS-004 SSA-001 MICROFIX opened 2026-10-14 actor ACT-11 did_not_hold reason filter swap only.";
  assert.equal(truncatedReason(sentence, retrieved), null);
  assert.match(truncatedReason("On 2026-10-14 ACT-11 had reason filter.", retrieved) ?? "", /ISS-004|ISS-060/);
});

test("the board escapes every value it interpolates into markup", () => {
  const source = fs.readFileSync(new URL("../public/board.js", import.meta.url), "utf8");
  const start = source.indexOf("function esc");
  const end = source.indexOf("function stationFor");
  const esc = new Function(`${source.slice(start, end)}; return esc;`)() as (value: unknown) => string;
  assert.equal(esc('<img "x" & \'>'), "&lt;img &quot;x&quot; &amp; &#39;&gt;");
  const templates = templatesWithMarkup(source);
  assert.ok(templates.length >= 4);
  for (const template of templates) {
    for (const expr of interpolations(template)) {
      const safe =
        expr.includes("esc(") ||
        expr.startsWith("evidenceGroups(") ||
        expr.startsWith("claims") ||
        expr.startsWith("extra ?") ||
        expr.startsWith("hazard ?") ||
        expr === "hazard" ||
        expr === "fresh" ||
        expr.startsWith("run.trace_id === selected") ||
        expr.startsWith("statusTone(") ||
        ["whatHtml", "moreHtml", "flagHtml", "tableHtml", "unitHeadHtml", "unitCellHtml", "uncertainHtml", "nextHtml", "trustHtml", "verdictHtml", 'flagItems.join("")'].includes(expr) ||
        expr.startsWith("decisionCard(");
      assert.equal(safe, true, expr);
    }
  }
});

test("a missing retrieved kind is cited from that source", () => {
  const retrieved = [
    { id: "zetaris:1", kind: "zetaris" as const, summary: "ISS-001 SSA-001 OOS 2026-09-02 ACT-17 did_not_hold intake filter packed with dust." },
    { id: "hmem:mem-1", kind: "hmem" as const, summary: "D3 synthetic incident ISS-001 on SSA-001." },
  ];
  const draft = {
    headline: "SSA-001 repeats",
    findings: [{ claim: "ISS-001 did not hold.", evidence_ids: ["zetaris:1"] }],
    recommended_next_check: "A human inspects the unit.",
    needs_human_decision: true as const,
    not_checked: [],
    confidence: 0.4,
  };
  const cited = citeMissingKinds(draft, retrieved);
  assert.ok(cited.findings.some((finding) => finding.evidence_ids.includes("hmem:mem-1")));
  assert.equal(citeMissingKinds(cited, retrieved).findings.length, cited.findings.length);
});

test("a headline over 240 characters is not a draft", () => {
  assert.throws(
    () =>
      parseSmokeDraft({
        headline: "x".repeat(241),
        findings: [],
        recommended_next_check: "A human inspects the unit.",
        needs_human_decision: true,
        not_checked: [],
        confidence: 0.4,
      }),
    /headline too long/,
  );
});

test("model-call causes stay in the named set", () => {
  assert.equal(modelCallCause(new ModelError(500, "model HTTP 500")), "http-5xx");
  assert.equal(modelCallCause(new ModelError(429, "model HTTP 429")), "http-429");
  assert.equal(modelCallCause(new ModelError(0, "model timeout")), "timeout");
  assert.equal(modelCallCause(new ModelError(200, "model content empty after retry")), "empty-completion");
  assert.equal(modelCallCause(new Error("no JSON object in model content")), "invalid-json");
});

test("a claim without a final period does not merge into the next claim", () => {
  const mixed: RetrievedSource[] = [
    {
      id: "zetaris:q",
      kind: "zetaris",
      summary:
        "ISS-006 SSA-002 HAZARD 2026-10-15 ACT-23 did_not_hold high-limit trip, still open; ISS-005 SSA-001 OOS 2026-10-20 ACT-23 did_not_hold reset only, filter still packed",
    },
    { id: "hmem:m", kind: "hmem", summary: "Memory notes ISS-005 and ISS-006." },
    { id: "worldmodel:u", kind: "worldmodel", summary: "Unit SSA-002. Open HAZARD count 1, read from the world-model graph." },
  ];
  const split = draft([
    { claim: "Unit SSA-002. Open HAZARD count 1, read from the world-model graph", evidence_ids: ["zetaris:q", "worldmodel:u"] },
    { claim: "ISS-005 SSA-001 OOS 2026-10-20 ACT-23 did_not_hold reset only, filter still packed", evidence_ids: ["zetaris:q"] },
    { claim: "hmem record was read.", evidence_ids: ["hmem:m"] },
  ]);
  assert.doesNotThrow(() => lintAndAssemble(split, mixed, "t-claim-boundary"));
  assert.equal(deterministicCritique(split, mixed).approve, true);
  const wrong = draft([
    { claim: "Unit SSA-001 has one open HAZARD", evidence_ids: ["zetaris:q", "worldmodel:u"] },
    { claim: "hmem record was read.", evidence_ids: ["hmem:m"] },
  ]);
  assert.throws(() => lintAndAssemble(wrong, mixed, "t-claim-boundary-bad"), /invented open HAZARD SSA-001/);
});

test("the model payload carries no open-HAZARD facts", () => {
  const sources: RetrievedSource[] = [
    {
      id: "zetaris:a",
      kind: "zetaris",
      summary:
        "ISS-006 SSA-002 HAZARD 2026-10-15 ACT-23 did_not_hold high-limit trip, still open; ISS-005 SSA-001 OOS 2026-10-20 ACT-23 did_not_hold reset only",
    },
    {
      id: "zetaris:h",
      kind: "zetaris",
      summary: "Open HAZARD rows; ISS-006 SSA-002 HAZARD 2026-10-15 ACT-23 did_not_hold high-limit trip, still open",
    },
    {
      id: "worldmodel:u",
      kind: "worldmodel",
      summary: "Unit SSA-002 model X zone Y location Z. Open HAZARD count 1, read from the world-model graph.",
    },
  ];
  const view = modelRetrieved(sources);
  assert.equal(view.some((item) => item.id === "zetaris:h"), false);
  assert.equal(/hazard/i.test(JSON.stringify(view)), false);
  assert.equal(view.find((item) => item.id === "worldmodel:u")?.summary, "Unit SSA-002 model X zone Y location Z.");
  assert.equal(view.find((item) => item.id === "zetaris:a")?.summary.includes("ISS-006 SSA-002 flagged 2026-10-15"), true);
});

test("a model draft over the size limits is rejected locally, at the limits it is accepted", () => {
  const ok = (over: Record<string, unknown>) =>
    parseSmokeDraft({
      headline: "x".repeat(DRAFT_LIMITS.headline),
      findings: Array.from({ length: DRAFT_LIMITS.findings }, () => ({ claim: "y".repeat(DRAFT_LIMITS.claim), evidence_ids: ["a"] })),
      recommended_next_check: "A human inspects the unit.",
      needs_human_decision: true,
      not_checked: [],
      confidence: 0.4,
      ...over,
    });
  assert.doesNotThrow(() => ok({}));
  assert.throws(() => ok({ headline: "x".repeat(DRAFT_LIMITS.headline + 1) }), /headline too long/);
  assert.throws(
    () => ok({ findings: Array.from({ length: DRAFT_LIMITS.findings + 1 }, () => ({ claim: "y", evidence_ids: ["a"] })) }),
    /too many findings/,
  );
  assert.throws(() => ok({ findings: [{ claim: "y".repeat(DRAFT_LIMITS.claim + 1), evidence_ids: ["a"] }] }), /claim too long/);
  const schema = draftSchema(["a"]).properties as {
    headline: { maxLength: number };
    findings: { maxItems: number; items: { properties: { claim: { maxLength: number } } } };
  };
  assert.equal(schema.headline.maxLength, DRAFT_LIMITS.headline);
  assert.equal(schema.findings.maxItems, DRAFT_LIMITS.findings);
  assert.equal(schema.findings.items.properties.claim.maxLength, DRAFT_LIMITS.claim);
});

test("unknown cache status stays out of the latency numbers but inside the reliability count", () => {
  const row = (over: Partial<NightshiftRow>): NightshiftRow => ({
    query: "CAUSE SSA-001",
    status: "ok",
    failed: false,
    reason: null,
    elapsed_ms: 1000,
    trace_id: "t",
    cache_hit: false,
    cache_known: true,
    routed_models: ["m"],
    ...over,
  });
  const summary = summarizeMode("meterless/fast", [
    row({ elapsed_ms: 4000 }),
    row({ cache_hit: true, elapsed_ms: 50 }),
    row({ cache_known: false, failed: true, reason: "timeout", elapsed_ms: 23000, routed_models: [] }),
  ]) as {
    cache_hits_excluded: number;
    reliability: { denominator: number; failures: number };
    verified_uncached: { requests: number; median_ms: number; routed_models: Record<string, number> };
    cache_unknown: { requests: number; failures: number };
  };
  assert.equal(summary.cache_hits_excluded, 1);
  assert.deepEqual(summary.reliability, { denominator: 2, failures: 1, available: 2 });
  assert.equal(summary.verified_uncached.requests, 1);
  assert.equal(summary.verified_uncached.median_ms, 4000);
  assert.deepEqual(summary.verified_uncached.routed_models, { m: 1 });
  assert.equal(summary.cache_unknown.requests, 1);
  assert.equal(summary.cache_unknown.failures, 1);
});

test("PATTERNS core is built in code, cited, not a fallback, and passes the linter and the critique", () => {
  const patternsCall: CallObject = { verb: "PATTERNS", period: "thisweek", role: "lead", trace_id: "t-patterns-core" };
  const sources: RetrievedSource[] = [
    {
      id: "zetaris:rows",
      kind: "zetaris",
      summary:
        "ISS-005 SSA-001 OOS 2026-10-20 ACT-23 did_not_hold reset only, filter still packed; ISS-006 SSA-002 HAZARD 2026-10-15 ACT-23 did_not_hold high-limit trip, still open",
    },
    {
      id: "zetaris:hist",
      kind: "zetaris",
      summary: "Historical did_not_hold rows, not limited to thisweek. ACT-23: fixes did not hold on ISS-005 SSA-001 opened 2026-10-20, ISS-006 SSA-002 opened 2026-10-15.",
    },
    { id: "hmem:m", kind: "hmem", summary: "D3 synthetic incident ISS-005 on SSA-001: kind OOS, opened 2026-10-20, actor ACT-23, fix_outcome did_not_hold, reason reset only, filter still packed." },
    { id: "worldmodel:u", kind: "worldmodel", summary: "Unit SSA-002 model X zone Y location Z. Open HAZARD count 1, read from the world-model graph." },
  ];
  const core = codePatternsDraft(patternsCall, sources);
  assert.equal(core.headline, "PATTERNS thisweek: cited rows, human decides");
  assert.equal(core.headline.includes(ASSEMBLED_LABEL), false);
  assert.ok(core.findings.every((finding) => finding.evidence_ids.length > 0));
  assert.ok(core.findings.some((finding) => finding.evidence_ids.includes("zetaris:hist")));
  assert.equal(core.recommended_next_check.startsWith("Propose a coaching conversation"), true);
  const critique = deterministicCritique(core, sources);
  assert.equal(critique.approve, true, JSON.stringify(critique));
  const released = lintAndAssemble(core, sources, "t-patterns-core");
  assert.ok(released.findings.some((finding) => finding.claim.includes("ISS-006 SSA-002 HAZARD")));
});

test("the Evaluator model call is schema-constrained, short, and gets compact claims", async () => {
  const bodies: Record<string, unknown>[] = [];
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"approve":true,"requires_revision":false,"issues":[],"missing_evidence":[],"confidence":0.8}' } }],
        }),
        { status: 200 },
      );
    },
  });
  const long = "A belt tension tweak was logged and a human reviewed the unit afterwards. ".repeat(8);
  const quietLong = quiet.map((s) => (s.id === "zetaris:q" ? { ...s, summary: `${s.summary} ${long}` } : s));
  const wide = draft(
    [
      { claim: "zetaris record was read.", evidence_ids: ["zetaris:q"] },
      { claim: long, evidence_ids: ["zetaris:q"] },
      { claim: "hmem record was read.", evidence_ids: ["hmem:m"] },
      { claim: "worldmodel record was read.", evidence_ids: ["worldmodel:u"] },
    ],
    "CAUSE SSA-004 cited",
  );
  const out = await evaluate({ objective: "o", subtasks: [], required_data: [], success_criteria: ["c"] }, wide, quietLong, 8_000);
  resetModelClientForTests();
  assert.equal(out.value.approve, true);
  assert.equal(bodies.length, 1);
  const body = bodies[0] as { max_tokens: number; response_format?: { type: string }; messages: { content: string }[] };
  assert.equal(body.response_format?.type, "json_schema");
  assert.ok(body.max_tokens <= 400, `max_tokens ${body.max_tokens}`);
  const user = JSON.parse(body.messages[1].content) as { draft: { findings: { claim: string }[] } };
  assert.ok(user.draft.findings.every((finding) => finding.claim.length <= 200));
});

test("CAUSE core is built in code from the asset's rows and is not a fallback", () => {
  const causeCall: CallObject = { verb: "CAUSE", asset: "SSA-004", role: "lead", trace_id: "t-cause-core" };
  const core = codeRowsDraft(causeCall, quiet);
  assert.equal(core.headline, "CAUSE SSA-004: cited rows, human decides");
  assert.equal(core.headline.includes(ASSEMBLED_LABEL), false);
  assert.ok(core.findings.length > 0 && core.findings.every((finding) => finding.evidence_ids.length > 0));
  assert.equal(deterministicCritique(core, quiet).approve, true);
  assert.doesNotThrow(() => lintAndAssemble(core, quiet, "t-cause-core"));
});

test("the Evaluator repair call keeps the 400-token cap", async () => {
  const caps: number[] = [];
  let calls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async (_url, init) => {
      caps.push((JSON.parse(String((init as RequestInit).body)) as { max_tokens: number }).max_tokens);
      calls += 1;
      const content = calls === 1 ? "{}" : '{"approve":true,"requires_revision":false,"issues":[],"missing_evidence":[],"confidence":0.8}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });
  const ok = draft(
    [
      { claim: "zetaris record was read.", evidence_ids: ["zetaris:q"] },
      { claim: "hmem record was read.", evidence_ids: ["hmem:m"] },
      { claim: "worldmodel record was read.", evidence_ids: ["worldmodel:u"] },
    ],
    "CAUSE SSA-004 cited",
  );
  const out = await evaluate({ objective: "o", subtasks: [], required_data: [], success_criteria: ["c"] }, ok, quiet, 8_000);
  resetModelClientForTests();
  assert.equal(out.value.approve, true);
  assert.deepEqual(caps, [400, 400]);
});

test("an empty completion does not raise the Evaluator token cap on any retry path", async () => {
  const scenarios: { name: string; contents: string[] }[] = [
    { name: "empty first, valid second", contents: ["", '{"approve":true,"requires_revision":false,"issues":[],"missing_evidence":[],"confidence":0.8}'] },
    { name: "empty first and empty repair", contents: ["", "", '{"approve":true,"requires_revision":false,"issues":[],"missing_evidence":[],"confidence":0.8}'] },
    { name: "empty first, malformed second, valid third", contents: ["", "{}", '{"approve":true,"requires_revision":false,"issues":[],"missing_evidence":[],"confidence":0.8}'] },
  ];
  for (const scenario of scenarios) {
    const caps: number[] = [];
    let calls = 0;
    setModelClientForTests({
      minSpacingMs: 0,
      random: () => 0,
      sleep: async () => {},
      transport: async (_url, init) => {
        caps.push((JSON.parse(String((init as RequestInit).body)) as { max_tokens: number }).max_tokens);
        const content = scenario.contents[Math.min(calls, scenario.contents.length - 1)];
        calls += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      },
    });
    const ok = draft(
      [
        { claim: "zetaris record was read.", evidence_ids: ["zetaris:q"] },
        { claim: "hmem record was read.", evidence_ids: ["hmem:m"] },
        { claim: "worldmodel record was read.", evidence_ids: ["worldmodel:u"] },
      ],
      "CAUSE SSA-004 cited",
    );
    await evaluate({ objective: "o", subtasks: [], required_data: [], success_criteria: ["c"] }, ok, quiet, 20_000);
    resetModelClientForTests();
    assert.ok(caps.length >= 2, `${scenario.name}: ${caps.length} requests`);
    assert.ok(caps.every((cap) => cap <= 400), `${scenario.name}: max_tokens ${JSON.stringify(caps)}`);
  }
});
