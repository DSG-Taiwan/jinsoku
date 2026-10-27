import assert from "node:assert/strict";
import { test } from "node:test";
import { deterministicCritique } from "../src/agents/evaluator.ts";
import { assembleFromRecords, ASSEMBLED_LABEL, draftFromRetrieved } from "../src/agents/executor.ts";
import { codeNextDraft } from "../src/agents/next-check.ts";
import { codeRowsDraft } from "../src/agents/patterns-core.ts";
import { attributeFree, createReleaseChecker, HEADLINE_FALLBACK, lintAndAssemble, NEXT_CHECK_FALLBACK } from "../src/final-pass.ts";
import type { CallObject, RetrievedSource, SmokeDraft } from "../src/schemas.ts";

/**
 * Release contract. Every released claim is (a) code-built from the retrieved rows, (b) a verbatim passage of a source it cites,
 * or (c) a structured analysis that code re-verifies from the rows and renders itself. Attribute-free model prose is not a release class for findings.
 * Nothing depends on layout. Model-written prose (a cause, a pattern, a name in any case) is rejected whatever words it uses.
 */

const row = (id: string, asset: string, date: string, actor: string, outcome: string, reason: string, kind = "OOS") => ({ issue_id: id, asset_id: asset, kind, opened_at: date, actor_key: actor, fix_outcome: outcome, reason });
const text = (r: ReturnType<typeof row>) => `${r.issue_id} ${r.asset_id} ${r.kind} ${r.opened_at} ${r.actor_key} ${r.fix_outcome} ${r.reason}`;
const rows = [
  row("ISS-001", "SSA-001", "2026-09-02", "ACT-17", "did_not_hold", "intake filter packed with dust"),
  row("ISS-002", "SSA-001", "2026-09-16", "ACT-11", "did_not_hold", "same filter bypass, coil iced"),
  row("ISS-003", "SSA-001", "2026-09-30", "ACT-17", "did_not_hold", "coil iced after filter change"),
  row("ISS-005", "SSA-001", "2026-10-20", "ACT-11", "did_not_hold", "reset only"),
];
const retrieved: RetrievedSource[] = [
  { id: "zetaris:q", kind: "zetaris", summary: rows.map(text).join("; "), rows },
  { id: "hmem:m", kind: "hmem", summary: "incident ISS-005 on SSA-001: kind OOS, opened 2026-10-20, actor ACT-11, fix_outcome did_not_hold, reason reset only." },
  { id: "worldmodel:u", kind: "worldmodel", summary: "Unit SSA-001. Open HAZARD count 0, read from the world-model graph." },
];
const checker = createReleaseChecker(retrieved);
const VERB = "incident ISS-005 on SSA-001: kind OOS, opened 2026-10-20, actor ACT-11, fix_outcome did_not_hold, reason reset only.";
const bad = (claim: string, ids = ["zetaris:q"]) => assert.notEqual(checker.finding(claim, ids), null, claim);
const good = (claim: string, ids = ["zetaris:q"]) => assert.equal(checker.finding(claim, ids), null, claim);

test("attribute-free prose: ids are allowed; digits, kind and outcome words and month names are not", () => {
  for (const ok of ["The repair recurred, so a human should inspect the unit.", "ISS-001 and ISS-005 look related.", "It may be the filter."]) assert.equal(attributeFree(ok), true, ok);
  for (const no of ["opened 2030.01.01", "SSA  004", "SSA_004", "ACT_99", "２０３０", "on 01/01/2030", "did hold", "it held", "did not hold", "an OOS event", "a hazard", "a microfix", "in October", "Jan 5"]) {
    assert.equal(attributeFree(no), false, no);
  }
});

test("(a) code-built findings are accepted: core records, floor, flags and notes", () => {
  good("ISS-005 SSA-001 OOS opened 2026-10-20 actor ACT-11 did_not_hold reason reset only.", ["zetaris:q"]);
  good("Open HAZARD count 0.", ["worldmodel:u"]);
  const call = { verb: "CAUSE", asset: "SSA-001", role: "lead", trace_id: "t" } as CallObject;
  for (const finding of codeRowsDraft(call, retrieved).findings) assert.equal(checker.finding(finding.claim, finding.evidence_ids), null, finding.claim);
});

test("(b) verbatim passages are accepted only for a source the finding cites", () => {
  good("incident ISS-005 on SSA-001: kind OOS, opened 2026-10-20, actor ACT-11, fix_outcome did_not_hold, reason reset only.", ["hmem:m"]);
  good("Unit SSA-001. Open HAZARD count 0, read from the world-model graph", ["worldmodel:u"]);
  bad("incident ISS-005 on SSA-001: kind OOS, opened 2026-10-20, actor ACT-11, fix_outcome did_not_hold, reason reset only.", ["zetaris:q"]);
});

test("(c) model prose is rejected, with or without a structured attribute, in any layout (QA r25 fixtures, audit F-001 and F-002)", () => {
  for (const claim of [
    "ISS-001 and ISS-005 both opened on 2026-10-20.",
    "ISS-001 to ISS-005 opened on 2026-10-20.",
    "ISS-001 was reviewed and opened on 2026-10-20 alongside ISS-005.",
    "ISS-005 was opened on 2030.01.01.",
    "ISS-005 is retrieved. The opening date was 2030-01-01.",
    "ISS-005 was on SSA  004 by ACT  99.",
    "ISS-005 was on SSA_004 by ACT_99.",
    "ISS-005 was OOS on 2026-10-20 by ACT-23 and held.",
    "ISS-005 was OOS on SSA 004, opened 01/01/2030, actor ACT 99, outcome unknown_state.",
    "ISS-005 was OOS on SSA-００４, opened ２０３０-０１-０１ by ACT-９９.",
    "ISS-005 on SSA-001 did hold.",
    "ISS-005 was reset in October.",
    "Analysis: ISS-005 recurred 3 times.",
  ]) {
    bad(claim);
  }
  // free model prose with no structured attribute is no longer released either (audit F-001 and F-002)
  for (const claim of [
    "Analysis: ISS-005 recurred under different actors, so a human should inspect the repair.",
    "It may be the filter.",
    "the repair recurred under different actors.",
    "it was the wiring, ask jane doe",
    "Ask Jane Doe about it.",
  ]) bad(claim);
});

test("the headline and the next check are rebuilt from fixed text when they do not meet the contract", () => {
  const draft = (headline: string, next: string) => ({ headline, findings: [{ claim: VERB, evidence_ids: ["zetaris:q", "hmem:m", "worldmodel:u"] }], recommended_next_check: next, not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 }) as SmokeDraft;
  const kept = lintAndAssemble(draft("CAUSE SSA-001: cited rows, human decides", "A human inspects the unit. Agents propose only."), retrieved, "t-ok");
  assert.equal(kept.headline, "CAUSE SSA-001: cited rows, human decides");
  assert.equal(kept.recommended_next_check, "A human inspects the unit. Agents propose only.");
  const repaired = lintAndAssemble(draft("Recurring coil icing on SSA-001 since 2026-09-02", "Replace the belt on 2030-01-01."), retrieved, "t-fix");
  assert.equal(repaired.headline, HEADLINE_FALLBACK);
  assert.equal(repaired.recommended_next_check, NEXT_CHECK_FALLBACK);
});

test("the final linter and the critique both enforce it", () => {
  const draft = (claim: string) => ({ headline: "CAUSE SSA-001: cited rows, human decides", findings: [{ claim, evidence_ids: ["zetaris:q", "hmem:m", "worldmodel:u"] }], recommended_next_check: "A human inspects the unit. Agents propose only.", not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 }) as SmokeDraft;
  const forged = "ISS-001 and ISS-005 both opened on 2026-10-20.";
  assert.throws(() => lintAndAssemble(draft(forged), retrieved, "t-forged"), /verified structured analysis/);
  assert.equal(deterministicCritique(draft(forged), retrieved).requires_revision, true);
  assert.equal(deterministicCritique(draft(VERB), retrieved).requires_revision, false);
  assert.equal(deterministicCritique(draft("The repair recurred under different actors."), retrieved).requires_revision, true);
});

test("the former documented limits are closed: a fact in words and a free-text cause are rejected", () => {
  bad("ISS-005 was opened on the twentieth of the tenth month.", ["zetaris:q"]);
  bad("ISS-005 failed because of an unseen wiring fault.", ["zetaris:q"]);
});

/** R26-01 and R26-02 (QA r26). */
test("R26-01: a headline target is trusted only when it is a real target", () => {
  const ok = (headline: string) => assert.equal(checker.headlineOk(headline), true, headline);
  const no = (headline: string) => assert.equal(checker.headlineOk(headline), false, headline);
  ok("CAUSE SSA-001: cited rows, human decides");
  ok("CAUSE SSA-001: assembled from records, no model synthesis");
  ok("NEXT unit check, human decides");
  ok("PATTERNS thisweek: cited rows, human decides");
  ok("PATTERNS lastweek: cited rows, human decides");
  ok("PATTERNS 2026-10-01..2026-10-21: cited rows, human decides");
  no("PATTERNS 2026-13-45..2026-14-01: cited rows, human decides");
  no("PATTERNS 2026-10-21..2026-10-01: cited rows, human decides");
  no("CAUSE SSA-999: cited rows, human decides");
  no("CAUSE 999: cited rows, human decides");
  no("NEXT SSA-999 check, human decides");
  no("CAUSE SSA-001: repeated on 2030-01-01");
  const draft = (headline: string) => ({ headline, findings: [{ claim: VERB, evidence_ids: ["zetaris:q", "hmem:m", "worldmodel:u"] }], recommended_next_check: "A human inspects the unit. Agents propose only.", not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 }) as SmokeDraft;
  assert.equal(lintAndAssemble(draft("CAUSE SSA-999: cited rows, human decides"), retrieved, "t-r2601").headline, HEADLINE_FALLBACK);
  assert.equal(lintAndAssemble(draft("CAUSE SSA-001: cited rows, human decides"), retrieved, "t-r2601b").headline, "CAUSE SSA-001: cited rows, human decides");
});

test("R26-02: the Analysis label is removed once, before every class is tried", () => {
  const sources: RetrievedSource[] = [
    { id: "hmem:c", kind: "hmem", summary: "calibration channel 7 reports stable readings." },
    { id: "hmem:o", kind: "hmem", summary: "other note" },
  ];
  const c = createReleaseChecker(sources);
  assert.equal(c.finding("channel 7", ["hmem:c"]), null, "cited passage");
  assert.equal(c.finding("Analysis: channel 7", ["hmem:c"]), null, "the same passage with the label");
  assert.equal(c.finding("Analysis: calibration channel 7 reports stable readings.", ["hmem:c"]), null, "the full sentence with the label");
  assert.notEqual(c.finding("Analysis: channel 7", ["hmem:o"]), null, "the passage must be from a cited source");
  assert.notEqual(c.finding("Analysis: channel 8", ["hmem:c"]), null, "a changed digit");
  assert.notEqual(c.finding("Analysis: the repair recurred under different actors.", ["hmem:c"]), null, "attribute-free prose is no longer a release class, with or without the label");
  assert.notEqual(c.finding("Analysis: opened in October", ["hmem:c"]), null, "a month name with the label");
});

/** Audit F-001 on a660266: the linter itself, not only its callers, accepts only code-written text for the headline, next check and not-checked list. */
test("the linter rejects model prose in the headline, the next check and the not-checked list (audit F-001)", () => {
  const withDraft = (headline: string, next: string, notChecked: string[]) =>
    lintAndAssemble({ headline, findings: [{ claim: VERB, evidence_ids: ["zetaris:q", "hmem:m", "worldmodel:u"] }], recommended_next_check: next, not_checked: notChecked, needs_human_decision: true, confidence: 0.5 } as SmokeDraft, retrieved, "t-f001");
  for (const prose of ["It may be the filter.", "it was the wiring ask jane doe"]) {
    const out = withDraft(prose, prose, [prose]);
    assert.equal(out.headline, HEADLINE_FALLBACK, prose);
    assert.equal(out.recommended_next_check, NEXT_CHECK_FALLBACK, prose);
    assert.deepEqual(out.not_checked, ["Anything not in the retrieved sources"], prose);
    assert.equal(createReleaseChecker(retrieved).headlineOk(`CAUSE SSA-001: ${prose}`), false, prose);
  }
  for (const prose of ["Ask Jane Doe to replace the wiring", "Replace the wiring"]) {
    assert.equal(createReleaseChecker(retrieved).headlineOk(prose), false, prose);
    assert.equal(createReleaseChecker(retrieved).nextCheckOk(prose), false, prose);
    assert.equal(createReleaseChecker(retrieved).notCheckedOk(prose), false, prose);
  }
  // fixed code text is kept
  const kept = withDraft("CAUSE SSA-001: cited rows, human decides", "A human inspects the unit. Agents propose only.", ["Anything not in the retrieved sources"]);
  assert.equal(kept.headline, "CAUSE SSA-001: cited rows, human decides");
  assert.equal(kept.recommended_next_check, "A human inspects the unit. Agents propose only.");
  assert.deepEqual(kept.not_checked, ["Anything not in the retrieved sources"]);
});

test("every code producer's headline, next check and not-checked list passes the linter unchanged", () => {
  const sources: RetrievedSource[] = [...retrieved, { id: "markov:SSA-001", kind: "markov", summary: "After a repeat failure on SSA-001 the next step is a belt check." }];
  const coaching: RetrievedSource[] = sources.map((source) => (source.kind === "zetaris" ? { ...source, summary: `Historical did_not_hold ${source.summary}`, id: source.id } : source));
  const calls: CallObject[] = [
    { verb: "CAUSE", asset: "SSA-001", role: "lead", trace_id: "t" } as CallObject,
    { verb: "PATTERNS", period: "thisweek", role: "lead", trace_id: "t" } as CallObject,
  ];
  assert.equal(ASSEMBLED_LABEL, "assembled from records, no model synthesis");
  for (const set of [sources, coaching, retrieved]) {
    const checker = createReleaseChecker(set);
    const drafts: SmokeDraft[] = [codeNextDraft(set), ...calls.flatMap((call) => [codeRowsDraft(call, set), assembleFromRecords(call, set), draftFromRetrieved(call, set)])];
    for (const draft of drafts) {
      // the linter's own text checks accept every code producer (assembled drafts are never released as drafts, so they are checked directly)
      assert.equal(checker.headlineOk(draft.headline), true, draft.headline);
      assert.equal(checker.nextCheckOk(draft.recommended_next_check), true, draft.recommended_next_check);
      for (const item of draft.not_checked) assert.equal(checker.notCheckedOk(item), true, item);
    }
    for (const draft of [codeNextDraft(set), ...calls.map((call) => codeRowsDraft(call, set))]) {
      const out = lintAndAssemble(draft, set, "t-producers");
      assert.equal(out.headline, draft.headline, draft.headline);
      assert.equal(out.recommended_next_check, draft.recommended_next_check, draft.recommended_next_check);
      assert.deepEqual(out.not_checked, draft.not_checked, draft.headline);
    }
  }
});
