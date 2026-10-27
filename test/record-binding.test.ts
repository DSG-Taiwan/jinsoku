import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmedOpenHazards, hazardBlockFindings } from "../src/agents/hazard-block.ts";
import { lintAndAssemble, truncatedReason } from "../src/final-pass.ts";
import type { RetrievedSource, SmokeDraft } from "../src/schemas.ts";

/** R18-01 and R18-02: a claim that has the shape of an incident record must match ONE retrieved version in every field. */

const a = "ISS-050 SSA-001 HAZARD 2026-10-05 ACT-17 did_not_hold belt slip on the north fan";
const b = "ISS-050 SSA-001 OOS 2026-10-06 ACT-23 held belt replaced";
const retrieved: RetrievedSource[] = [
  { id: "zetaris:a", kind: "zetaris", summary: a },
  { id: "zetaris:b", kind: "zetaris", summary: b },
  { id: "worldmodel:w", kind: "worldmodel", summary: "Unit SSA-001 Open HAZARD count 1" },
];
const claimA = "ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 did_not_hold reason belt slip on the north fan.";
const claimB = "ISS-050 SSA-001 OOS opened 2026-10-06 actor ACT-23 held reason belt replaced.";
const rejects = (claim: string) => assert.notEqual(truncatedReason(claim, retrieved), null, claim);

test("each retrieved version, stated whole, is accepted", () => {
  assert.equal(truncatedReason(claimA, retrieved), null);
  assert.equal(truncatedReason(claimB, retrieved), null);
  assert.equal(truncatedReason(claimA.replace(/\.$/, " and stays open for a human."), retrieved), null, "the floor's own wording");
});

test("R18-01: splitting identity from reason with a pipe does not hide either part", () => {
  rejects("ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 did_not_hold | reason belt replaced.");
  rejects("ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 did_not_hold | reason compressor destroyed.");
  rejects("ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 did_not_hold reason compressor destroyed.");
});

test("R18-02: a recombined or partly invented record is rejected, field by field", () => {
  rejects("ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 did_not_hold reason belt replaced."); // A fields, B reason
  rejects("ISS-050 SSA-001 OOS opened 2026-10-06 actor ACT-23 held reason belt slip on the north fan."); // B fields, A reason
  rejects("ISS-050 SSA-001 MICROFIX opened 2026-10-19 actor ACT-99 held reason belt replaced."); // unknown kind, date, actor
  rejects("ISS-050 SSA-004 HAZARD opened 2026-10-05 actor ACT-17 did_not_hold reason belt slip on the north fan."); // asset swapped
  rejects("ISS-050 SSA-001 hazard opened 2026-10-05 actor ACT-17 did_not_hold reason belt slip on the north fan."); // case evasion
  rejects("ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17-extra did_not_hold reason belt slip on the north fan."); // suffix evasion
  rejects("ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 held reason belt slip on the north fan."); // outcome
  rejects("ISS-050 SSA-001 HAZARD opened 2026-10-06 actor ACT-17 did_not_hold reason belt slip on the north fan."); // date
});

test("R18-02: a reason is matched whole, not as a substring", () => {
  const stored: RetrievedSource[] = [{ id: "zetaris:s", kind: "zetaris", summary: "ISS-051 SSA-001 OOS 2026-10-05 ACT-17 held belt" }];
  assert.equal(truncatedReason("ISS-051 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason belt.", stored), null);
  assert.notEqual(truncatedReason("ISS-051 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason beltacular invented cause.", stored), null);
  assert.notEqual(truncatedReason("ISS-051 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason belt and more.", stored), null);
});

test("R18-02: a legitimate reason that contains an outcome word is not rejected", () => {
  const stored: RetrievedSource[] = [
    { id: "zetaris:s", kind: "zetaris", summary: "ISS-052 SSA-001 OOS 2026-10-05 ACT-17 did_not_hold filter held briefly; ISS-052 SSA-001 OOS 2026-10-06 ACT-11 held belt replaced" },
  ];
  assert.equal(truncatedReason("ISS-052 SSA-001 OOS opened 2026-10-05 actor ACT-17 did_not_hold reason filter held briefly.", stored), null);
});

test("a reason that contains sentence punctuation is checked whole (typed rows)", () => {
  const reason = "reset only; filter still packed. Check again";
  const typed = { issue_id: "ISS-053", asset_id: "SSA-001", kind: "OOS", opened_at: "2026-10-05", actor_key: "ACT-17", fix_outcome: "held", reason };
  const stored: RetrievedSource[] = [{ id: "zetaris:s", kind: "zetaris", summary: `ISS-053 SSA-001 OOS 2026-10-05 ACT-17 held ${reason}`, rows: [typed] }];
  assert.equal(truncatedReason(`ISS-053 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason ${reason}.`, stored), null);
  assert.notEqual(truncatedReason("ISS-053 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason reset only.", stored), null);
});

test("the floor's conflict finding lists each version as its own bound record and lints", () => {
  const blocks = hazardBlockFindings(retrieved);
  const conflict = blocks.find((block) => /^Data conflict: ISS-050/.test(block.claim));
  assert.ok(conflict);
  assert.match(conflict.claim, /Version 1: ISS-050 SSA-001 HAZARD opened 2026-10-05/);
  assert.match(conflict.claim, /Version 2: ISS-050 SSA-001 OOS opened 2026-10-06/);
  assert.equal(confirmedOpenHazards(retrieved).length, 1);
  const draft = { headline: "CAUSE SSA-001: cited rows, human decides", findings: [{ claim: "zetaris record was read.", evidence_ids: ["zetaris:a", "worldmodel:w"] }], recommended_next_check: "A human inspects the unit. Agents propose only.", not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 } as SmokeDraft;
  assert.doesNotThrow(() => lintAndAssemble(draft, retrieved, "t-floor-bound"));
});

test("a draft that carries a forged record is blocked by the final linter", () => {
  const forged = (claim: string) => ({ headline: "CAUSE SSA-001: cited rows, human decides", findings: [{ claim, evidence_ids: ["zetaris:a", "worldmodel:w"] }], recommended_next_check: "A human inspects the unit. Agents propose only.", not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 }) as SmokeDraft;
  assert.throws(() => lintAndAssemble(forged("ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 did_not_hold | reason belt replaced."), retrieved, "t-forged"), /record claim|reason/);
  assert.throws(() => lintAndAssemble(forged("ISS-050 SSA-001 MICROFIX opened 2026-10-19 actor ACT-99 held reason belt replaced."), retrieved, "t-forged2"), /record claim|reason/);
  assert.doesNotThrow(() => lintAndAssemble(forged(claimA), retrieved, "t-genuine"));
});

/** R23-06: binding holds whatever the wording, label or sentence boundary. */
import { claimBindingProblem } from "../src/final-pass.ts";

const bad = (claim: string) => assert.notEqual(claimBindingProblem(claim, retrieved), null, claim);

test("R23-06: a claim that states an asset, date, actor, kind or outcome no retrieved version has is rejected, in any wording", () => {
  bad("ISS-050 SSA-004 OOS opened 2030-01-01 actor ACT-99 held because fabricated.");
  bad("ISS-050 SSA-004 OOS opened 2030-01-01 actor ACT-99 held. reason fabricated.");
  bad("ISS-050 SSA-004 OOS opened 2030-01-01 actor ACT-99 held\nreason fabricated");
  bad("ISS-050 SSA-001 OOS 2026-10-06 ACT-23 held belt replaced on SSA-004.");
  bad("ISS-050 opened 2026-10-06 SSA-001 OOS actor ACT-77 held.");
  bad("ISS-050  SSA-001  OOS  opened  2026-10-07  actor  ACT-23  held.");
  bad("ISS-050\tSSA-001\tOOS\topened\t2026-10-06\tactor\tACT-23-extra\theld.");
  bad("ISS-050 SSA-001 OOS opened 2026-10-06 actor ACT-23 held reason: belt replaced. It was a MICROFIX.");
  bad("ISS-050 was a hazard on 2026-10-09.");
});

test("R23-06: genuine claims about the same incidents are not rejected", () => {
  for (const claim of [claimA, claimB, "ISS-050 was a hazard that did not hold.", "ISS-050 was opened on 2026-10-05 by ACT-17.", "A human checks ISS-050.", "Unit SSA-001 has an open HAZARD count of 1."]) {
    assert.equal(claimBindingProblem(claim, retrieved), null, claim);
  }
  const stored: RetrievedSource[] = [{ id: "zetaris:s", kind: "zetaris", summary: "ISS-052 SSA-001 OOS 2026-10-05 ACT-17 did_not_hold filter held briefly" }];
  assert.equal(claimBindingProblem("ISS-052 SSA-001 OOS opened 2026-10-05 actor ACT-17 did_not_hold reason filter held briefly.", stored), null, "words inside a reason are not attributes");
});

test("R23-06: the final linter and the deterministic critique both enforce it", async () => {
  const { deterministicCritique } = await import("../src/agents/evaluator.ts");
  const draft = (claim: string) => ({ headline: "CAUSE SSA-001: cited rows, human decides", findings: [{ claim, evidence_ids: ["zetaris:a", "worldmodel:w"] }], recommended_next_check: "A human inspects the unit. Agents propose only.", not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 }) as SmokeDraft;
  const forged = "ISS-050 SSA-004 OOS opened 2030-01-01 actor ACT-99 held because fabricated.";
  assert.throws(() => lintAndAssemble(draft(forged), retrieved, "t-r23-06"), /no retrieved version/);
  assert.equal(deterministicCritique(draft(forged), retrieved).requires_revision, true);
  assert.equal(deterministicCritique(draft("zetaris record was read."), retrieved).requires_revision, false);
  assert.equal(deterministicCritique(draft("A human checks ISS-050."), retrieved).requires_revision, true, "free prose is not a release class");
});

/** R23-05: a valid reason is never falsely rejected because of what it contains. */
test("R23-05: reasons with newlines, sentence punctuation or the old mask characters are checked whole", () => {
  for (const reason of ["belt a\nbelt b", "reset only; filter still packed. Check again", "uses  and  characters"]) {
    const typed = { issue_id: "ISS-054", asset_id: "SSA-001", kind: "OOS", opened_at: "2026-10-05", actor_key: "ACT-17", fix_outcome: "held", reason };
    const stored: RetrievedSource[] = [{ id: "zetaris:s", kind: "zetaris", summary: "ISS-054 SSA-001 OOS 2026-10-05 ACT-17 held x", rows: [typed] }];
    const claim = `ISS-054 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason ${reason}.`;
    assert.equal(truncatedReason(claim, stored), null, JSON.stringify(reason));
    assert.equal(claimBindingProblem(claim, stored), null, JSON.stringify(reason));
    assert.notEqual(truncatedReason(`ISS-054 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason ${reason.slice(0, 5)}.`, stored), null, "a chopped reason still fails");
  }
});

/** R24-01 to R24-03: each statement is read against the incident it is about; alternate display forms are read, not skipped; long reasons are matched literally. */
const row = (id: string, asset: string, date: string, actor: string, outcome: string, reason: string, kind = "OOS") => ({ issue_id: id, asset_id: asset, kind, opened_at: date, actor_key: actor, fix_outcome: outcome, reason });
const two: RetrievedSource[] = [
  {
    id: "zetaris:two",
    kind: "zetaris",
    summary: "ISS-001 and ISS-005",
    rows: [row("ISS-001", "SSA-001", "2026-09-02", "ACT-17", "did_not_hold", "intake filter packed with dust"), row("ISS-005", "SSA-001", "2026-10-20", "ACT-11", "did_not_hold", "reset only")],
  },
];
const problem = (claim: string) => claimBindingProblem(claim, two);

test("R24-01: naming a second incident does not widen what the first may claim", () => {
  assert.notEqual(problem("ISS-001 was opened on 2026-10-20 by ACT-17. ISS-005 is also in the retrieved records."), null);
  assert.notEqual(problem("ISS-005 was opened on 2026-09-02 by ACT-17. ISS-001 is also in the retrieved records."), null);
  assert.notEqual(problem("ISS-001 was opened on 2026-10-20 and ISS-005 on 2026-09-02."), null, "swapped within one sentence");
  assert.notEqual(problem("ISS-001 and ISS-005 were opened by ACT-11 on 2026-09-02."), null, "a shared claim must hold for both");
  assert.equal(problem("ISS-001 was opened on 2026-09-02 and ISS-005 on 2026-10-20."), null);
  assert.equal(problem("ISS-001 was opened on 2026-09-02. ISS-005 was opened on 2026-10-20 by ACT-11."), null);
  assert.equal(problem("On 2026-10-20 ISS-005 was reset by ACT-11."), null, "text before the first id is about that id");
});

test("R24-01: a back-reference sentence is about the incident just named", () => {
  assert.notEqual(problem("ISS-005 was reset. It was a MICROFIX."), null);
  assert.equal(problem("ISS-005 was reset. It was an OOS."), null);
});

test("R24-02: alternate spellings of an attribute are read, not skipped", () => {
  assert.notEqual(problem("ISS-005 was OOS on SSA 004, opened 01/01/2030, actor ACT 99, outcome unknown_state."), null);
  assert.notEqual(problem("ISS-005 was OOS on SSA-００４, opened ２０３０-０１-０１ by ACT-９９."), null, "full-width digits");
  assert.notEqual(problem("ISS-005 on SSA-001 did hold."), null, "ISS-005 did not hold");
  assert.notEqual(problem("ISS-005 was opened on January 1, 2030."), null);
  assert.notEqual(problem("ISS-005 was opened on 31 December 2029."), null);
  assert.notEqual(problem("ISS-005 was opened on 2026-02-30."), null, "an impossible date matches nothing");
  assert.notEqual(problem("ISS-005 has fix_outcome unknown_state."), null);
  assert.equal(problem("ISS-005 on SSA 001 was opened 10/20/2026 by ACT 11."), null, "genuine data in another display form");
  assert.equal(problem("ISS-005 was opened on October 20, 2026 by ACT-11 and did not hold."), null);
  assert.equal(problem("ISS-005 has outcome did_not_hold."), null);
});

test("R24-02: the headline and the next check are held to the same binding", () => {
  const draft = (headline: string, next: string) => ({ headline, findings: [{ claim: "zetaris record was read.", evidence_ids: ["zetaris:two"] }], recommended_next_check: next, not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 }) as SmokeDraft;
  assert.throws(() => lintAndAssemble(draft("ISS-005 on SSA 004 opened 01/01/2030 by ACT 99", "A human inspects the unit."), two, "t-h"), /no retrieved version/);
  assert.throws(() => lintAndAssemble(draft("CAUSE SSA-001: cited rows, human decides", "Inspect ISS-005 on SSA 004, opened 01/01/2030 by ACT 99."), two, "t-n"), /no retrieved version/);
  assert.doesNotThrow(() => lintAndAssemble(draft("CAUSE SSA-001: cited rows, human decides", "Inspect ISS-005, opened 10/20/2026."), two, "t-ok"));
});

test("R24-03: a very long reason is matched literally and does not break the check", () => {
  const long = "x".repeat(60_000);
  const stored: RetrievedSource[] = [{ id: "zetaris:l", kind: "zetaris", summary: "ISS-060 long", rows: [row("ISS-060", "SSA-001", "2026-10-05", "ACT-17", "held", long)] }];
  const claim = `ISS-060 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason ${long}.`;
  assert.doesNotThrow(() => truncatedReason(claim, stored));
  assert.equal(truncatedReason(claim, stored), null);
  assert.equal(claimBindingProblem(claim, stored), null);
  assert.notEqual(truncatedReason(`ISS-060 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason ${long.slice(0, 100)}.`, stored), null, "a chopped long reason still fails");
});

/** NEXT SSA-004 was withheld on every run: one retrieved reason ("belt slip") is a prefix of another ("belt slip again"), and the doubled removal of the overlap ate the next record's text. */
test("a reason that is a prefix of another reason does not corrupt the claim, and the kinds stay with their own incidents", () => {
  const row = (issue_id: string, kind: string, opened_at: string, fix_outcome: string, reason: string) => ({ issue_id, asset_id: "SSA-004", kind, opened_at, actor_key: "ACT-23", fix_outcome, reason });
  const rows = [
    row("ISS-008", "OOS", "2026-09-08", "did_not_hold", "belt slip"),
    row("ISS-009", "OOS", "2026-09-22", "did_not_hold", "belt slip again"),
    row("ISS-010", "MICROFIX", "2026-10-06", "held", "belt tension tweak"),
  ];
  const stored: RetrievedSource[] = [{ id: "zetaris:s", kind: "zetaris", summary: rows.map((r) => `${r.issue_id} ${r.asset_id} ${r.kind} ${r.opened_at} ${r.actor_key} ${r.fix_outcome} ${r.reason}`).join("\n"), rows }];
  const chain = "ISS-008 2026-09-08 OOS ACT-23 did_not_hold note belt slip.\nISS-009 2026-09-22 OOS ACT-23 did_not_hold note belt slip again.\nISS-010 2026-10-06 MICROFIX ACT-23 held note belt tension tweak.";
  assert.equal(claimBindingProblem(chain, stored), null);
  assert.notEqual(claimBindingProblem(chain.replace("ISS-009 2026-09-22 OOS", "ISS-009 2026-09-22 MICROFIX"), stored), null, "a wrong kind on ISS-009 is still rejected");
  assert.notEqual(claimBindingProblem(chain.replace("ISS-010 2026-10-06 MICROFIX", "ISS-010 2026-10-06 OOS"), stored), null, "a wrong kind on ISS-010 is still rejected");
});
