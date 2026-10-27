import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { ANALYSIS_PREFIX, analysisClaims } from "../src/agents/analysis.ts";
import { renderClaim, verifyClaim } from "../src/agents/claims.ts";
import { deterministicCritique } from "../src/agents/evaluator.ts";
import { lintAndAssemble } from "../src/final-pass.ts";
import { resetRateLimit } from "../src/ingest.ts";
import { resetModelClientForTests, setModelClientForTests } from "../src/llm/client.ts";
import { runRequest } from "../src/orchestrator.ts";
import type { RetrievedSource, SmokeDraft, StructuredClaim } from "../src/schemas.ts";
import { goodClaim, reply, type ModelPayload } from "./structured-helpers.ts";

/** Structured claims: the model selects, code verifies from the typed rows and renders the words. No model sentence is released. */

afterEach(() => {
  delete process.env.MODEL_ANALYSIS;
  resetModelClientForTests();
});

const row = (id: string, asset: string, date: string, actor: string, outcome: string, kind = "OOS", reason = "intake filter packed with dust") => ({ issue_id: id, asset_id: asset, kind, opened_at: date, actor_key: actor, fix_outcome: outcome, reason });
const rows = [
  row("ISS-001", "SSA-001", "2026-09-02", "ACT-17", "did_not_hold"),
  row("ISS-002", "SSA-001", "2026-09-16", "ACT-11", "did_not_hold"),
  row("ISS-003", "SSA-001", "2026-09-30", "ACT-17", "did_not_hold"),
  row("ISS-004", "SSA-001", "2026-10-14", "ACT-11", "held"),
  row("ISS-006", "SSA-002", "2026-10-15", "ACT-23", "did_not_hold", "HAZARD", "high-limit trip, still open"),
];
const text = (r: ReturnType<typeof row>) => `${r.issue_id} ${r.asset_id} ${r.kind} ${r.opened_at} ${r.actor_key} ${r.fix_outcome} ${r.reason}`;
const retrieved: RetrievedSource[] = [
  { id: "zetaris:q", kind: "zetaris", summary: rows.map(text).join("; "), rows },
  { id: "hmem:m", kind: "hmem", summary: "Memory notes ISS-001 and ISS-003 on SSA-001." },
  { id: "worldmodel:u", kind: "worldmodel", summary: "Unit SSA-001 model A zone N location R. Open HAZARD count 0. Unit SSA-002 model B zone S location Q. Open HAZARD count 1." },
];

const claim = (over: Partial<StructuredClaim>): StructuredClaim => ({
  template: "repeat_failure",
  unit: "SSA-001",
  ids: ["ISS-001", "ISS-002", "ISS-003"],
  weigh: [
    { id: "ISS-001", verdict: "supports" },
    { id: "ISS-002", verdict: "supports" },
    { id: "ISS-003", verdict: "supports" },
  ],
  judge: "supported",
  reasons: ["same_unit"],
  recommend: "inspect_unit",
  ...over,
});

test("each of the five templates verifies from the rows and is rendered by code", () => {
  const cases: [StructuredClaim, RegExp][] = [
    [claim({}), /^\[repeat_failure\] SSA-001: 3 fixes did not hold \(ISS-001, ISS-002, ISS-003\)\./],
    [claim({ template: "same_actor_repeat", ids: ["ISS-001", "ISS-003"], weigh: [{ id: "ISS-001", verdict: "supports" }, { id: "ISS-003", verdict: "supports" }], reasons: ["same_actor"] }), /ACT-17 appears on ISS-001 and ISS-003, all did not hold\./],
    [claim({ template: "recurrence_after_fix", ids: ["ISS-001", "ISS-003"], weigh: [{ id: "ISS-001", verdict: "supports" }, { id: "ISS-003", verdict: "supports" }], reasons: ["repeated_after_fix"] }), /ISS-003 recurred after ISS-001 \(opened 2026-09-02\)\./],
    [claim({ template: "open_hazard_pending", unit: "SSA-002", ids: ["ISS-006"], weigh: [{ id: "ISS-006", verdict: "supports" }], reasons: ["open_hazard_on_unit"], recommend: "hold_for_human_analysis" }), /SSA-002: open HAZARD, a human decides\./],
    [claim({ template: "inspect_unit", ids: [], weigh: [], reasons: [], recommend: "escalate_to_lead" }), /A human inspects SSA-001 next\./],
  ];
  for (const [item, pattern] of cases) {
    const verified = verifyClaim(item, retrieved);
    assert.deepEqual(verified.issues, [], item.template);
    const words = renderClaim(item, retrieved);
    assert.match(words, pattern, item.template);
    assert.match(words, /Evidence check: .*judged supported\./);
    assert.match(words, /Suggested option: /);
  }
});

test("the weighing and the judgment are recomputed from the rows, and a disagreement is named", () => {
  const held = claim({ ids: ["ISS-001", "ISS-004"], weigh: [{ id: "ISS-001", verdict: "supports" }, { id: "ISS-004", verdict: "supports" }] });
  const issues = verifyClaim(held, retrieved).issues.join(" | ");
  assert.match(issues, /ISS-004 was weighed as supports; the rows say contradicts/);
  assert.match(issues, /judged supported; the rows say not_supported/);
  const honest = claim({ ids: ["ISS-001", "ISS-004"], weigh: [{ id: "ISS-001", verdict: "supports" }, { id: "ISS-004", verdict: "contradicts" }], judge: "not_supported" });
  assert.match(verifyClaim(honest, retrieved).issues.join(" | "), /the claim is not supported by the rows/, "an honest not-supported judgment is still not released");
});

test("a claim cannot state what the rows do not show", () => {
  const issues = (item: StructuredClaim) => verifyClaim(item, retrieved).issues.join(" | ");
  assert.match(issues(claim({ ids: ["ISS-001", "ISS-006"], weigh: [{ id: "ISS-001", verdict: "supports" }, { id: "ISS-006", verdict: "supports" }] })), /ISS-006 is not on SSA-001/);
  assert.match(issues(claim({ reasons: ["same_actor"] })), /do not share one actor key/);
  assert.match(issues(claim({ reasons: ["open_hazard_on_unit"] })), /no confirmed open HAZARD/);
  assert.match(issues(claim({ template: "open_hazard_pending", ids: [], weigh: [] })), /has no confirmed open HAZARD/);
  assert.match(issues(claim({ reasons: ["no_other_pattern", "same_unit"] })), /cannot be combined/);
});

test("r28 findings: no_other_pattern must be true of the unit, duplicates are rejected, sizes are capped locally", () => {
  const issues = (item: StructuredClaim) => verifyClaim(item, retrieved).issues.join(" | ");
  const inspect = (over: Partial<StructuredClaim>) => claim({ template: "inspect_unit", ids: ["ISS-001", "ISS-003"], weigh: [{ id: "ISS-001", verdict: "supports" }, { id: "ISS-003", verdict: "supports" }], reasons: ["no_other_pattern"], recommend: "escalate_to_lead", ...over });
  // a unit that shows repeat failure, same actor and recurrence cannot be called pattern-free
  assert.match(issues(inspect({})), /no_other_pattern: the rows on SSA-001 show repeat_failure, same_actor_repeat, recurrence_after_fix/);
  assert.match(issues(inspect({ template: "repeat_failure" })), /only allowed with inspect_unit/);
  // a unit with one incident and no hazard really has no pattern
  const quiet: RetrievedSource[] = [{ id: "zetaris:q", kind: "zetaris", summary: text(rows[0]), rows: [rows[0]] }, retrieved[1], retrieved[2]];
  const ok = claim({ template: "inspect_unit", ids: ["ISS-001"], weigh: [{ id: "ISS-001", verdict: "supports" }], reasons: ["no_other_pattern"], recommend: "inspect_unit" });
  assert.deepEqual(verifyClaim(ok, quiet).issues, []);
  // duplicates and sizes
  const dupWeigh = claim({ ids: ["ISS-001", "ISS-002"], weigh: [{ id: "ISS-001", verdict: "supports" }, { id: "ISS-001", verdict: "supports" }, { id: "ISS-002", verdict: "supports" }] });
  assert.match(issues(dupWeigh), /an incident is weighed more than once/);
  assert.match(issues(claim({ ids: ["ISS-001", "ISS-001", "ISS-002"] })), /listed more than once/);
  assert.match(issues(claim({ reasons: ["same_unit", "same_unit", "same_unit", "same_unit"] })), /more than 3 reasons/);
  assert.match(issues(claim({ reasons: ["same_unit", "same_unit"] })), /a reason is given more than once/);
  // even if a duplicate got past, the count shown is of distinct incidents
  assert.doesNotMatch(renderClaim(dupWeigh, retrieved), /3 of 2/);
});

test("r29-01: the positive templates and no_other_pattern agree, over every combination of small fixtures", () => {
  const outcomes = ["held", "did_not_hold"];
  const actors = ["ACT-17", "ACT-11"];
  const dates = ["2026-09-02", "2026-09-16"];
  const kinds = ["OOS", "HAZARD"];
  let combos = 0;
  // every unit of two or three incidents drawn from the field values; the checked claim set is every template over every id subset
  const options = outcomes.flatMap((o) => actors.flatMap((a) => dates.flatMap((d) => kinds.map((k) => ({ o, a, d, k })))));
  const build = (picks: typeof options): RetrievedSource[] => {
    const rs = picks.map((p, i) => row(`ISS-10${i}`, "SSA-001", p.d, p.a, p.o, p.k));
    return [
      { id: "zetaris:q", kind: "zetaris", summary: rs.map(text).join("; "), rows: rs },
      { id: "hmem:m", kind: "hmem", summary: "Memory notes on SSA-001." },
      { id: "worldmodel:u", kind: "worldmodel", summary: `Unit SSA-001 model A zone N location R. Open HAZARD count ${rs.some((r) => r.kind === "HAZARD" && r.fix_outcome === "did_not_hold") ? 1 : 0}.` },
    ];
  };
  const templates = ["repeat_failure", "same_actor_repeat", "recurrence_after_fix", "open_hazard_pending"] as const;
  const check = (picks: typeof options) => {
    const src = build(picks);
    const ids = picks.map((_, i) => `ISS-10${i}`);
    const quiet = verifyClaim({ template: "inspect_unit", unit: "SSA-001", ids, weigh: ids.map((id) => ({ id, verdict: "supports" })), judge: "supported", reasons: ["no_other_pattern"], recommend: "inspect_unit" }, src);
    const quietOk = quiet.issues.length === 0;
    for (const template of templates) {
      for (let mask = 1; mask < 1 << ids.length; mask++) {
        const subset = ids.filter((_, i) => mask & (1 << i));
        const expected = verifyClaim({ template, unit: "SSA-001", ids: subset, weigh: [], judge: "supported", reasons: [], recommend: "inspect_unit" }, src).expected;
        const said = verifyClaim({ template, unit: "SSA-001", ids: subset, weigh: expected.weigh, judge: expected.judge, reasons: [], recommend: "inspect_unit" }, src);
        combos++;
        if (said.issues.length === 0) assert.equal(quietOk, false, `${template} on ${subset.join(",")} verifies, so "no other pattern" must not: ${JSON.stringify(picks)}`);
      }
    }
  };
  for (const a of options) for (const b of options) {
    check([a, b]);
    for (const c of options) check([a, b, c]);
  }
  assert.ok(combos > 1000, `only ${combos} combinations were checked`);
});

test("rendered analysis cites the sources that carry its rows and passes the final linter and the critique", () => {
  const findings = analysisClaims([claim({})], retrieved);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].claim.startsWith(ANALYSIS_PREFIX));
  assert.deepEqual(findings[0].evidence_ids, ["zetaris:q"]);
  const draft: SmokeDraft = {
    headline: "CAUSE SSA-001: cited rows, human decides",
    findings: [{ claim: "Memory notes ISS-001 and ISS-003 on SSA-001.", evidence_ids: ["hmem:m"] }, { claim: "Unit SSA-001 model A zone N location R.", evidence_ids: ["worldmodel:u"] }, ...findings],
    recommended_next_check: "A human inspects the unit. Agents propose only.",
    needs_human_decision: true,
    not_checked: ["Anything not in the retrieved sources"],
    confidence: 0.4,
  };
  assert.equal(deterministicCritique(draft, retrieved).issues.filter((issue) => /claim states|selection|weighed|judged/i.test(issue)).length, 0);
  const released = lintAndAssemble(draft, retrieved, "t-structured");
  assert.ok(released.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX) && finding.analysis?.template === "repeat_failure"));
  // text that is not what code renders from the structured claim is not accepted as analysis
  const tampered = { ...draft, findings: draft.findings.map((finding) => (finding.analysis ? { ...finding, claim: `${finding.claim} It was the wiring.` } : finding)) };
  assert.throws(() => lintAndAssemble(tampered, retrieved, "t-tampered"));
});

test("free text from the model is never released: a sentence-shaped reply is not an analysis (F-001 and F-003 by construction)", async () => {
  process.env.MODEL_ANALYSIS = "on";
  resetRateLimit();
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { messages: { content: string }[] };
      const all = body.messages.map((message) => message.content).join("\n");
      const content = /You are the Analyst|Revise the analysis/.test(all)
        ? JSON.stringify({ claims: [{ claim: "it was the wiring, ask jane doe", evidence_ids: ["zetaris:x"] }] })
        : /You are the Evaluator/.test(all)
          ? JSON.stringify({ approve: true, requires_revision: false, issues: [], missing_evidence: [], confidence: 0.8 })
          : JSON.stringify({ headline: "x" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });
  const out = await runRequest({ request_id: `free-text-${randomUUID()}`, user_query: "CAUSE SSA-004", context: { role: "lead" } });
  assert.equal(out.status, "ok");
  const all = JSON.stringify(out.result);
  assert.equal(/wiring|jane doe/i.test(all), false);
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX)), false);
  assert.equal(out.collaboration.model_stages?.analysis, "skipped");
});

test("end to end: the model's selection is verified, rendered by code, shown with its evidence check, and the headline is code-built", async () => {
  process.env.MODEL_ANALYSIS = "on";
  resetRateLimit();
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { messages: { content: string }[] };
      const all = body.messages.map((message) => message.content).join("\n");
      const user = JSON.parse(body.messages.at(-1)?.content ?? "{}") as ModelPayload;
      const content = /You are the Analyst|Revise the analysis/.test(all)
        ? reply([goodClaim(user)])
        : /You are the Evaluator/.test(all)
          ? JSON.stringify({ approve: true, requires_revision: false, issues: [], missing_evidence: [], confidence: 0.8 })
          : JSON.stringify({ headline: "Whatever the model wants to say" });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    },
  });
  const out = await runRequest({ request_id: `structured-e2e-${randomUUID()}`, user_query: "CAUSE SSA-004", context: { role: "lead" } });
  assert.equal(out.status, "ok");
  assert.equal(out.result.headline, "CAUSE SSA-004: cited rows, human decides");
  assert.equal(out.collaboration.model_stages?.headline, "code");
  assert.equal(out.collaboration.model_stages?.analysis, "produced");
  const analysis = out.result.findings.find((finding) => finding.claim.startsWith(ANALYSIS_PREFIX));
  assert.ok(analysis, "an analysis finding is released");
  assert.match(analysis.claim, /^Analysis: \[repeat_failure\] SSA-004: \d+ fixes did not hold \(ISS-\d+, ISS-\d+\)\. Evidence check: read 2 incidents \(ISS-\d+, ISS-\d+\); 2 of 2 support; judged supported\./);
  assert.ok(analysis.evidence_ids.length > 0);
  assert.equal(JSON.stringify(out.result).includes("Whatever the model wants"), false);
});
