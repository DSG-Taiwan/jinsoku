import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import {
  ANALYSIS_LIMITS,
  ANALYSIS_PREFIX,
  analysisClaims,
  analysisEnabled,
  hasAnalysis,
  parseAnalysis,
  stripAnalysis,
} from "../src/agents/analysis.ts";
import { deterministicCritique } from "../src/agents/evaluator.ts";
import { resetRateLimit } from "../src/ingest.ts";
import { resetModelClientForTests, setModelClientForTests } from "../src/llm/client.ts";
import { runRequest } from "../src/orchestrator.ts";
import type { RetrievedSource, SmokeDraft, StructuredClaim } from "../src/schemas.ts";
import { badClaim, goodClaim, reply as claimsJson, type ModelPayload } from "./structured-helpers.ts";

const GOOD: StructuredClaim = { template: "repeat_failure", unit: "SSA-004", ids: ["ISS-010", "ISS-011"], weigh: [{ id: "ISS-010", verdict: "supports" }, { id: "ISS-011", verdict: "supports" }], judge: "supported", reasons: ["same_unit"], recommend: "inspect_unit" };

const retrieved: RetrievedSource[] = [
  {
    id: "zetaris:q",
    kind: "zetaris",
    summary:
      "ISS-010 SSA-004 OOS 2026-10-08 ACT-23 did_not_hold belt tension tweak; ISS-011 SSA-004 OOS 2026-10-12 ACT-17 did_not_hold belt tension tweak",
  },
  { id: "hmem:m", kind: "hmem", summary: "Memory notes ISS-010 and ISS-011 on SSA-004." },
  { id: "worldmodel:u", kind: "worldmodel", summary: "Unit SSA-004 model X zone Y location Z. Open HAZARD count 0, read from the world-model graph." },
];

function core(extra: SmokeDraft["findings"] = []): SmokeDraft {
  return {
    headline: "CAUSE SSA-004: cited rows, human decides",
    findings: [
      { claim: "ISS-010 SSA-004 OOS opened 2026-10-08 actor ACT-23 did_not_hold reason belt tension tweak.", evidence_ids: ["zetaris:q"] },
      { claim: "Memory notes ISS-010 and ISS-011 on SSA-004.", evidence_ids: ["hmem:m"] },
      { claim: "Unit SSA-004 model X zone Y location Z.", evidence_ids: ["worldmodel:u"] },
      ...extra,
    ],
    recommended_next_check: "A human inspects the unit. Agents propose only.",
    needs_human_decision: true,
    not_checked: ["Anything not in retrieved sources"],
    confidence: 0.4,
  };
}

afterEach(() => {
  delete process.env.MODEL_ANALYSIS;
  delete process.env.FAULT_INJECT;
  resetModelClientForTests();
});

test("the analysis switch defaults OFF and only the exact value on turns it on", () => {
  delete process.env.MODEL_ANALYSIS;
  assert.equal(analysisEnabled(), false);
  for (const value of ["", "0", "true", "1", "ON "]) {
    process.env.MODEL_ANALYSIS = value;
    assert.equal(analysisEnabled(), false, `value ${JSON.stringify(value)}`);
  }
  process.env.MODEL_ANALYSIS = "on";
  assert.equal(analysisEnabled(), true);
});

test("parseAnalysis checks the shape, keeps values outside the closed lists so the critique can name them, and limits the count", () => {
  const ok = parseAnalysis({ claims: [GOOD] });
  assert.equal(ok.length, 1);
  assert.equal(ok[0].template, "repeat_failure");
  const outside = parseAnalysis({ claims: [{ ...GOOD, template: "close_hazard", reasons: ["blames_person"] }] });
  assert.equal(outside[0].template, "close_hazard");
  assert.throws(() => parseAnalysis({ claims: Array.from({ length: ANALYSIS_LIMITS.claims + 1 }, () => GOOD) }), /too many analysis claims/);
  assert.throws(() => parseAnalysis({ claims: [{ ...GOOD, ids: "ISS-010" }] }), /ids must be a list/);
  assert.throws(() => parseAnalysis({ claims: [{ claim: "free text", evidence_ids: ["zetaris:q"] }] }), /template required/);
  assert.throws(() => parseAnalysis({}), /claims required/);
});

test("analysis claims are marked, found, and stripped without touching the evidence core", () => {
  const withAnalysis = core(analysisClaims([GOOD], retrieved));
  assert.equal(hasAnalysis(withAnalysis), true);
  assert.ok(withAnalysis.findings.at(-1)?.claim.startsWith(ANALYSIS_PREFIX));
  const stripped = stripAnalysis(withAnalysis);
  assert.equal(hasAnalysis(stripped), false);
  assert.deepEqual(stripped.findings, core().findings);
});

test("the deterministic critique verifies every selection against the rows", () => {
  const check = (claim: StructuredClaim) => deterministicCritique(core(analysisClaims([claim], retrieved)), retrieved);
  assert.equal(check(GOOD).approve, true);
  const issuesOf = (claim: StructuredClaim) => check(claim).issues.join(" | ");
  assert.match(issuesOf({ ...GOOD, unit: "SSA-099" }), /SSA-099 is not in the retrieved rows/);
  assert.match(issuesOf({ ...GOOD, template: "close_hazard" }), /not in the closed set/);
  assert.match(issuesOf({ ...GOOD, reasons: ["blames_person"] }), /not in the closed list/);
  assert.match(issuesOf({ ...GOOD, ids: ["ISS-010", "ISS-9999"], weigh: [{ id: "ISS-010", verdict: "supports" }, { id: "ISS-9999", verdict: "supports" }] }), /ISS-9999 is not in the retrieved rows/);
  assert.match(issuesOf({ ...GOOD, ids: [], weigh: [] }), /needs at least two incident ids/);
  assert.match(issuesOf({ ...GOOD, weigh: [{ id: "ISS-010", verdict: "contradicts" }, { id: "ISS-011", verdict: "supports" }] }), /ISS-010 was weighed as contradicts; the rows say supports/);
  assert.match(issuesOf({ ...GOOD, judge: "not_supported" }), /judged not_supported; the rows say supported/);
  assert.match(issuesOf({ ...GOOD, reasons: ["same_actor"] }), /do not share one actor key/);
  assert.match(issuesOf({ ...GOOD, template: "open_hazard_pending", ids: [], weigh: [] }), /no confirmed open HAZARD/);
  assert.equal(check({ ...GOOD, ids: [], weigh: [] }).approve, false);
});

test("with the switch OFF no analysis model call is made and the answer has no analysis claim", async () => {
  delete process.env.MODEL_ANALYSIS;
  resetRateLimit();
  let analysisCalls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { messages: { content: string }[] };
      if (body.messages.some((message) => /Analyst/.test(message.content))) analysisCalls += 1;
      const content = JSON.stringify({ headline: "CAUSE SSA-004 cited" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });
  const out = await runRequest({ request_id: `analysis-off-${randomUUID()}`, user_query: "CAUSE SSA-004", context: { role: "lead" } });
  assert.equal(analysisCalls, 0);
  assert.equal(out.status, "ok");
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX)), false);
});

/** A stub provider that answers by role, so the whole pipeline runs with a scripted model and the real retrieval. */
type AnalystStep = string | number | ((user: ModelPayload) => string);

function stubModel(script: { analyst: AnalystStep[]; evaluator?: "approve" | "reject" | "reject-once" | "down" | "reject-then-down" | "garbage" }) {
  const calls = { analyst: 0, revise: 0, evaluator: 0, headline: 0, bodies: [] as string[] };
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { messages: { content: string }[] };
      const text = body.messages.map((message) => message.content).join("\n");
      calls.bodies.push(text);
      const user = JSON.parse(body.messages.at(-1)?.content ?? "{}") as ModelPayload;
      const step = (index: number): Response => {
        const item = script.analyst[Math.min(index, script.analyst.length - 1)];
        if (typeof item === "number") return new Response("", { status: item });
        return reply(typeof item === "function" ? item(user) : item);
      };
      const reply = (content: unknown) =>
        new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status: 200 });
      if (/Revise the analysis/.test(text)) {
        const response = step(calls.analyst + calls.revise);
        calls.revise += 1;
        return response;
      }
      if (/You are the Analyst/.test(text)) {
        const response = step(calls.analyst + calls.revise);
        calls.analyst += 1;
        return response;
      }
      if (/You are the Evaluator/.test(text)) {
        calls.evaluator += 1;
        if (script.evaluator === "down" || (script.evaluator === "reject-then-down" && calls.evaluator > 1)) return new Response("unavailable", { status: 503 });
        if (script.evaluator === "garbage") return reply("not a critique");
        const rejects = script.evaluator === "reject" || ((script.evaluator === "reject-once" || script.evaluator === "reject-then-down") && calls.evaluator === 1);
        return rejects
          ? reply({ approve: false, requires_revision: true, issues: ["the analysis goes beyond the cited rows"], missing_evidence: [], confidence: 0.4 })
          : reply({ approve: true, requires_revision: false, issues: [], missing_evidence: [], confidence: 0.8 });
      }
      calls.headline += 1;
      return reply({ headline: "CAUSE SSA-004 cited rows, human decides" });
    },
  });
  return calls;
}

const good: AnalystStep = (user) => claimsJson([goodClaim(user)]);

async function run(query = "CAUSE SSA-004") {
  resetRateLimit();
  return runRequest({ request_id: `analysis-${randomUUID()}`, user_query: query, context: { role: "lead" } });
}

test("with the switch ON a model-written analysis is added, cited, and marked", async () => {
  process.env.MODEL_ANALYSIS = "on";
  const calls = stubModel({ analyst: [good] });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.equal(calls.analyst, 1);
  const analysis = out.result.findings.filter((finding) => finding.claim.startsWith(ANALYSIS_PREFIX));
  assert.equal(analysis.length, 1);
  assert.ok(analysis[0].evidence_ids.length > 0);
  assert.ok(out.result.findings.length > analysis.length, "the evidence core is still there");
});

test("a failing analysis call releases the core answer, not an error", async () => {
  process.env.MODEL_ANALYSIS = "on";
  const calls = stubModel({ analyst: [500] });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.ok(calls.analyst >= 1);
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX)), false);
  assert.ok(out.result.findings.length > 0);
});

const badAsset: AnalystStep = (user) => claimsJson([badClaim(user)]);

test("a bad analysis is rejected by the critique, revised once by the model, then released with the repaired claim", async () => {
  process.env.MODEL_ANALYSIS = "on";
  const calls = stubModel({ analyst: [badAsset, good] });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.equal(calls.analyst, 1);
  assert.equal(calls.revise, 1);
  assert.equal(out.collaboration.revision_count, 1);
  const analysis = out.result.findings.filter((finding) => finding.claim.startsWith(ANALYSIS_PREFIX));
  assert.equal(analysis.length, 1);
  assert.equal(JSON.stringify(out.result).includes("SSA-099"), false);
});

test("an analysis that stays bad after two revisions is withheld and the evidence core is released", async () => {
  process.env.MODEL_ANALYSIS = "on";
  const calls = stubModel({ analyst: [badAsset] });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.equal(calls.revise, 2);
  assert.equal(out.collaboration.revision_count, 2);
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX)), false);
  assert.equal(JSON.stringify(out.result).includes("SSA-099"), false);
  assert.ok(out.result.findings.length > 0);
  assert.match(String(out.collaboration.note), /analysis withheld/i);
});

test("the model Evaluator can reject an analysis, which triggers a real revision", async () => {
  process.env.MODEL_ANALYSIS = "on";
  const calls = stubModel({ analyst: [good], evaluator: "reject-once" });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.equal(calls.revise, 1);
  assert.equal(out.collaboration.revision_count, 1);
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX)), true);
});

test("an Evaluator that keeps rejecting cannot block the answer: the analysis is withheld and the core is released", async () => {
  process.env.MODEL_ANALYSIS = "on";
  const calls = stubModel({ analyst: [good], evaluator: "reject" });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.equal(calls.revise, 2);
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX)), false);
  assert.match(String(out.collaboration.note), /analysis withheld/i);
});

test("the Evaluator rejection only counts when the draft carries analysis, so core answers behave as before", async () => {
  delete process.env.MODEL_ANALYSIS;
  const calls = stubModel({ analyst: [good], evaluator: "reject" });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.equal(calls.revise, 0);
  assert.equal(out.collaboration.revision_count, 0);
});

const claimsAnalysis = (out: Awaited<ReturnType<typeof run>>) => out.result.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX));

// R8-01: model-written analysis must not be released as reviewed when the model Evaluator could not review it.
// a claim whose weighing disagrees with the rows: the first incident is weighed as contradicting when the rows support it
const unsupported: AnalystStep = (user) => {
  const claim = goodClaim(user);
  return claimsJson([{ ...claim, weigh: claim.weigh.map((entry, i) => (i === 0 ? { ...entry, verdict: "contradicts" } : entry)) }]);
};

test("R8-01: an unavailable Evaluator withholds the analysis, even an unsupported one that cites a real id, and releases the core", async () => {
  process.env.MODEL_ANALYSIS = "on";
  for (const analyst of [good, unsupported]) {
    const calls = stubModel({ analyst: [analyst], evaluator: "down" });
    const out = await run();
    assert.equal(out.status, "ok");
    // a claim the rows contradict is caught by the deterministic check before the model Evaluator is asked; either way it is withheld
    if (analyst === good) assert.ok(calls.evaluator >= 1);
    assert.equal(claimsAnalysis(out), false);
    assert.equal(JSON.stringify(out.result).includes("selection not verified"), false);
    assert.ok(out.result.findings.length > 0, "the evidence core is still released");
    assert.match(String(out.collaboration.note), analyst === good ? /analysis withheld.*evaluator (was )?unavailable/i : /analysis withheld/i);
    assert.doesNotMatch(String(out.collaboration.note), /approved first draft/i);
  }
});

test("R8-01: an Evaluator that rejects once and then fails still withholds the analysis (after a revision)", async () => {
  process.env.MODEL_ANALYSIS = "on";
  const calls = stubModel({ analyst: [good], evaluator: "reject-then-down" });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.ok(calls.revise >= 1);
  assert.equal(claimsAnalysis(out), false);
  assert.match(String(out.collaboration.note), /analysis withheld/i);
});

test("R8-01: a malformed critique counts as an unavailable Evaluator and withholds the analysis", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stubModel({ analyst: [good], evaluator: "garbage" });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.equal(claimsAnalysis(out), false);
  assert.match(String(out.collaboration.note), /analysis withheld/i);
});

test("R8-01: with the analysis OFF an unavailable Evaluator still releases the core, and the note does not claim approval", async () => {
  delete process.env.MODEL_ANALYSIS;
  stubModel({ analyst: [good], evaluator: "down" });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.ok(out.result.findings.length > 0);
  assert.doesNotMatch(String(out.collaboration.note), /approved first draft/i);
});

test("R8-01: when the Evaluator is available and approves, the analysis is kept", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stubModel({ analyst: [good], evaluator: "approve" });
  const out = await run();
  assert.equal(claimsAnalysis(out), true);
  assert.match(String(out.collaboration.note), /approved first draft/i);
});

import fs from "node:fs";
import path from "node:path";
import { FAULT_SCENARIOS, faultScenario, injectFault } from "../src/agents/analysis.ts";

test("the five fault scenarios each produce a claim the deterministic critique rejects", () => {
  assert.deepEqual([...FAULT_SCENARIOS].sort(), ["closure_language", "hallucinated_issue", "invented_asset", "person_name", "uncited"]);
  for (const scenario of FAULT_SCENARIOS) {
    const claims = injectFault([GOOD], scenario);
    const critique = deterministicCritique(core(analysisClaims(claims, retrieved)), retrieved);
    assert.equal(critique.approve, false, `${scenario}: ${JSON.stringify(critique)}`);
  }
});

test("a fault is injected only with the switch ON and a known scenario name", () => {
  delete process.env.MODEL_ANALYSIS;
  process.env.FAULT_INJECT = "invented_asset";
  assert.equal(faultScenario(), null);
  process.env.MODEL_ANALYSIS = "on";
  assert.equal(faultScenario(), "invented_asset");
  process.env.FAULT_INJECT = "not_a_scenario";
  assert.equal(faultScenario(), null);
  delete process.env.FAULT_INJECT;
  assert.equal(faultScenario(), null);
});

test("an injected fault is labeled in the log, caught by the critique, repaired by a real revision, and not released", async () => {
  process.env.MODEL_ANALYSIS = "on";
  process.env.FAULT_INJECT = "invented_asset";
  const calls = stubModel({ analyst: [good, good] });
  const out = await run();
  assert.equal(out.status, "ok");
  assert.equal(calls.revise, 1);
  assert.equal(out.collaboration.revision_count, 1);
  assert.equal(JSON.stringify(out.result).includes("SSA-099"), false);
  const log = fs.readFileSync(path.join(process.cwd(), "logs", `${out.trace_id}.jsonl`), "utf8");
  assert.match(log, /"action":"fault-injected"/);
  assert.match(log, /synthetic fault: invented_asset/);
});

test("a persistent fault ends with the analysis withheld and the evidence core released", async () => {
  process.env.MODEL_ANALYSIS = "on";
  process.env.FAULT_INJECT = "uncited";
  process.env.FAULT_PERSIST = "on";
  const calls = stubModel({ analyst: [good, good, good] });
  try {
    const out = await run();
    assert.equal(out.status, "ok");
    assert.equal(calls.revise, 2);
    assert.equal(out.result.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX)), false);
    assert.match(String(out.collaboration.note), /analysis withheld/i);
  } finally {
    delete process.env.FAULT_PERSIST;
  }
});

import { acceptableHeadline } from "../src/agents/patterns-core.ts";

test("a model headline that mentions hazards in any form, or closure words, is not accepted", () => {
  assert.equal(acceptableHeadline("CAUSE SSA-001 coil icing keeps returning after filter swaps"), true);
  for (const text of [
    "Three open HAZARDs need resolution",
    "hazard count is zero",
    "All hazards resolved",
    "The trip was cleared on Monday",
    "Issue closed after the swap",
    "Jane Doe fixed it",
    "",
    "x".repeat(161),
  ]) {
    assert.equal(acceptableHeadline(text), false, JSON.stringify(text));
  }
});

test("an open-HAZARD claim is accepted only for a unit with a confirmed open item", () => {
  const confirmed: RetrievedSource[] = [
    {
      id: "zetaris:h",
      kind: "zetaris",
      summary: "ISS-006 SSA-002 HAZARD 2026-10-15 ACT-23 did_not_hold high-limit trip, still open; ISS-010 SSA-004 OOS 2026-10-08 ACT-23 did_not_hold belt tension tweak",
    },
    { id: "hmem:m", kind: "hmem", summary: "Memory notes ISS-006 on SSA-002 and ISS-010 on SSA-004." },
    { id: "worldmodel:u", kind: "worldmodel", summary: "Unit SSA-002 model B zone Y location Z. Open HAZARD count 1, read from the world-model graph. Unit SSA-004 model X zone Y location Z. Open HAZARD count 0." },
  ];
  const open = (unit: string, id: string): StructuredClaim => ({ template: "open_hazard_pending", unit, ids: [id], weigh: [{ id, verdict: unit === "SSA-002" ? "supports" : "contradicts" }], judge: unit === "SSA-002" ? "supported" : "not_supported", reasons: [], recommend: "hold_for_human_analysis" });
  const check = (claim: StructuredClaim) => deterministicCritique(core(analysisClaims([claim], confirmed)), confirmed);
  const own = /unit|weighed|judged|reason|template|closed|incident ids|HAZARD/i;
  const fine = check(open("SSA-002", "ISS-006"));
  assert.equal(fine.issues.filter((i) => own.test(i) && !/unsupported issue|code-built/i.test(i)).length, 0, JSON.stringify(fine));
  const bad = check(open("SSA-004", "ISS-010"));
  assert.ok(bad.issues.some((i) => /no confirmed open HAZARD/i.test(i)), JSON.stringify(bad));
  assert.equal(bad.approve, false);
});
