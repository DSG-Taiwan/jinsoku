import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { codeRowsDraft } from "../src/agents/patterns-core.ts";
import { ESCALATION_THRESHOLD, precursorFindings } from "../src/agents/precursors.ts";
import { lintAndAssemble } from "../src/final-pass.ts";
import { resetRateLimit } from "../src/ingest.ts";
import { resetModelClientForTests, setModelClientForTests } from "../src/llm/client.ts";
import { runRequest } from "../src/orchestrator.ts";
import type { CallObject, RetrievedSource } from "../src/schemas.ts";

/** POC: deterministic precursor flags. Code decides; the flag cites the rows that triggered it; no probability, no model. */

afterEach(() => resetModelClientForTests());

const row = (id: number, asset: string, kind: string, date: string, outcome: string, reason: string) =>
  `ISS-${String(id).padStart(3, "0")} ${asset} ${kind} ${date} ACT-17 ${outcome} ${reason}`;

const SSA001 = [
  row(1, "SSA-001", "OOS", "2026-09-02", "did_not_hold", "intake filter packed with dust"),
  row(2, "SSA-001", "OOS", "2026-09-16", "did_not_hold", "same filter bypass, coil iced"),
  row(3, "SSA-001", "OOS", "2026-09-30", "did_not_hold", "coil iced after filter change"),
  row(4, "SSA-001", "MICROFIX", "2026-10-14", "did_not_hold", "filter swap only"),
  row(5, "SSA-001", "OOS", "2026-10-20", "did_not_hold", "reset only, filter still packed"),
].join("; ");

const source = (summary: string): RetrievedSource[] => [{ id: "zetaris:q-1", kind: "zetaris", summary }];
const cause = (asset: string): CallObject => ({ verb: "CAUSE", asset, role: "lead", trace_id: "t" }) as CallObject;

test("the escalation threshold is three, as the engine owner states it", () => {
  assert.equal(ESCALATION_THRESHOLD, 3);
});

test("three or more fixes that did not hold on one unit raise an escalation flag citing those rows", () => {
  const flags = precursorFindings(source(SSA001), "SSA-001");
  const flag = flags.find((f) => /^Escalation flag/.test(f.claim));
  assert.ok(flag, "an escalation flag is present");
  assert.deepEqual(flag.evidence_ids, ["zetaris:q-1"]);
  for (const id of ["ISS-001", "ISS-002", "ISS-003", "ISS-004", "ISS-005"]) assert.ok(flag.claim.includes(id), `${id} named`);
  assert.match(flag.claim, /5 fixes/);
  assert.match(flag.claim, /lead/i);
});

test("two failures are below the threshold: no escalation flag", () => {
  const two = [row(1, "SSA-004", "OOS", "2026-09-08", "did_not_hold", "belt slip"), row(2, "SSA-004", "OOS", "2026-09-22", "did_not_hold", "belt slip again"), row(3, "SSA-004", "MICROFIX", "2026-10-06", "held", "belt tension tweak")].join("; ");
  assert.deepEqual(precursorFindings(source(two), "SSA-004"), []);
});

test("fixes that held never count toward the threshold", () => {
  const held = [1, 2, 3, 4].map((n) => row(n, "SSA-003", "OOS", `2026-09-0${n}`, "held", "sensor drift")).join("; ");
  assert.deepEqual(precursorFindings(source(held), "SSA-003"), []);
});

test("three failures with unrelated reasons raise the escalation flag only, not the airflow pattern", () => {
  const rows = [1, 2, 3].map((n) => row(n, "SSA-008", "OOS", `2026-09-1${n}`, "did_not_hold", "sensor drift")).join("; ");
  const flags = precursorFindings(source(rows), "SSA-008");
  assert.equal(flags.length, 1);
  assert.match(flags[0].claim, /^Escalation flag/);
});

test("repeating airflow fixes that did not hold plus coil icing raise a draft pattern flag, labeled as not validated", () => {
  const flags = precursorFindings(source(SSA001), "SSA-001");
  const pattern = flags.find((f) => /^Pattern flag/.test(f.claim));
  assert.ok(pattern, "a pattern flag is present");
  assert.match(pattern.claim, /draft/i);
  assert.match(pattern.claim, /not validated/i);
  assert.ok(pattern.claim.includes("ISS-002"), "the icing row is named");
});

test("a pattern needs both parts: airflow failures without icing raise no pattern flag", () => {
  const rows = [1, 2].map((n) => row(n, "SSA-009", "OOS", `2026-09-0${n}`, "did_not_hold", "filter packed")).join("; ");
  assert.equal(precursorFindings(source(rows), "SSA-009").some((f) => /^Pattern flag/.test(f.claim)), false);
});

test("rows with a non-pseudonymous actor are ignored, as everywhere else", () => {
  const rows = [1, 2, 3].map((n) => `ISS-00${n} SSA-001 OOS 2026-09-0${n} Jane-Smith did_not_hold filter packed`).join("; ");
  assert.deepEqual(precursorFindings(source(rows), "SSA-001"), []);
});

test("a flag mentions no hazard, closure, or person, so the final linter accepts it", () => {
  const flags = precursorFindings(source(SSA001), "SSA-001");
  for (const f of flags) assert.equal(/hazard|\bclos|resolv|\bclear|downgrad/i.test(f.claim), false, f.claim);
  const draft = { ...codeRowsDraft(cause("SSA-001"), source(SSA001)) };
  assert.doesNotThrow(() => lintAndAssemble(draft, source(SSA001), "t-precursor"));
});

test("the CAUSE evidence core carries the flags, and a unit under the threshold carries none", () => {
  const withFlags = codeRowsDraft(cause("SSA-001"), source(SSA001));
  assert.ok(withFlags.findings.some((f) => /^Escalation flag/.test(f.claim)));
  assert.match(withFlags.recommended_next_check, /escalat/i);
  const under = [row(1, "SSA-004", "OOS", "2026-09-08", "did_not_hold", "belt slip")].join("; ");
  const none = codeRowsDraft(cause("SSA-004"), source(under));
  assert.equal(none.findings.some((f) => /flag/i.test(f.claim)), false);
  assert.doesNotMatch(none.recommended_next_check, /escalat/i);
});

test("end to end on real retrieval: CAUSE SSA-001 releases the escalation flag and CAUSE SSA-004 does not; no model needed", async () => {
  setModelClientForTests({ minSpacingMs: 0, random: () => 0, sleep: async () => {}, transport: async () => new Response("down", { status: 503 }) });
  resetRateLimit();
  const hot = await runRequest({ request_id: `poc-${randomUUID()}`, user_query: "CAUSE SSA-001", context: { role: "lead" } });
  assert.equal(hot.status, "ok");
  const claims = hot.result.findings.map((f) => f.claim);
  assert.ok(claims.some((c) => /^Escalation flag/.test(c)), "SSA-001 is flagged");
  assert.equal(claims.some((c) => /^Data (note|conflict)/.test(c)), false, "normal retrieval raises no data note: the HAZARD and historical views are not counted as repeats");
  resetRateLimit();
  const cold = await runRequest({ request_id: `poc-${randomUUID()}`, user_query: "CAUSE SSA-004", context: { role: "lead" } });
  assert.equal(cold.status, "ok");
  assert.equal(cold.result.findings.some((f) => /flag/i.test(f.claim)), false);
});

/** R12-01: a repeated row is one incident. Thresholds and displayed counts use distinct issue ids. */
const DUP = row(1, "SSA-001", "OOS", "2026-10-01", "did_not_hold", "sensor drift");

test("the same incident repeated three times is one failure: no escalation flag", () => {
  const rows = [DUP, DUP, DUP].join("; ");
  const flags = precursorFindings(source(rows), "SSA-001");
  assert.equal(flags.some((f) => /^Escalation flag/.test(f.claim)), false);
  const note = flags.find((f) => /^Data note/.test(f.claim));
  assert.ok(note, "the repeat is reported, not silently ignored");
  assert.match(note.claim, /ISS-001 \(3 times\)/);
  assert.match(note.claim, /counted once/);
  assert.deepEqual(note.evidence_ids, ["zetaris:q-1"]);
  const draft = codeRowsDraft(cause("SSA-001"), source(rows));
  assert.equal(draft.findings.some((f) => /Escalation flag|Pattern flag/.test(f.claim)), false);
  const released = lintAndAssemble(draft, source(rows), "t-dup");
  assert.equal(released.findings.some((f) => /Escalation flag/.test(f.claim)), false);
  assert.equal(released.findings.some((f) => /^Data note/.test(f.claim)), true, "the note survives to the released answer");
});

test("duplicate rows do not count toward the threshold but distinct incidents still do", () => {
  const two = [DUP, DUP, row(2, "SSA-001", "OOS", "2026-10-08", "did_not_hold", "sensor drift")].join("; ");
  assert.equal(precursorFindings(source(two), "SSA-001").some((f) => /flag/i.test(f.claim)), false);
  const three = [DUP, DUP, row(2, "SSA-001", "OOS", "2026-10-08", "did_not_hold", "sensor drift"), row(3, "SSA-001", "OOS", "2026-10-15", "did_not_hold", "sensor drift"), row(3, "SSA-001", "OOS", "2026-10-15", "did_not_hold", "sensor drift")].join("; ");
  const flag = precursorFindings(source(three), "SSA-001").find((f) => /^Escalation flag/.test(f.claim));
  assert.ok(flag);
  assert.match(flag.claim, /has 3 fixes/);
});

test("duplicate airflow rows do not make the pattern flag", () => {
  const one = row(1, "SSA-001", "OOS", "2026-10-01", "did_not_hold", "filter packed");
  const ice = row(2, "SSA-001", "OOS", "2026-10-08", "held", "coil iced");
  const rows = [one, one, ice].join("; ");
  assert.equal(precursorFindings(source(rows), "SSA-001").some((f) => /^Pattern flag/.test(f.claim)), false);
});

/** Same issue id, different records: no row is picked. The id counts toward nothing and the conflict is reported. */
test("an issue id with conflicting outcomes is not counted and is reported as a data conflict", () => {
  const fail = (n: number) => row(n, "SSA-001", "OOS", `2026-10-0${n}`, "did_not_hold", "sensor drift");
  const conflicted = row(3, "SSA-001", "OOS", "2026-10-03", "held", "sensor drift");
  const rows = [fail(1), fail(2), fail(3), conflicted].join("; ");
  const flags = precursorFindings(source(rows), "SSA-001");
  assert.equal(flags.some((f) => /^Escalation flag/.test(f.claim)), false, "ISS-003 is neither counted as failed nor as held");
  const conflict = flags.find((f) => /^Data conflict/.test(f.claim));
  assert.ok(conflict);
  assert.match(conflict.claim, /ISS-003/);
  assert.deepEqual(conflict.evidence_ids, ["zetaris:q-1"]);
  assert.doesNotThrow(() => lintAndAssemble(codeRowsDraft(cause("SSA-001"), source(rows)), source(rows), "t-conflict"));
});

test("a conflict is reported even when the same id also differs in asset, and clean data reports none", () => {
  const other = row(3, "SSA-002", "OOS", "2026-10-03", "did_not_hold", "sensor drift");
  const mine = row(3, "SSA-001", "OOS", "2026-10-03", "did_not_hold", "sensor drift");
  const flags = precursorFindings(source([mine, other].join("; ")), "SSA-001");
  assert.ok(flags.some((f) => /^Data conflict.*ISS-003/.test(f.claim)));
  assert.equal(precursorFindings(source(SSA001), "SSA-001").some((f) => /^Data (conflict|note)/.test(f.claim)), false, "clean data reports neither");
});

/** R14-02: rows are resolved across every retrieved incident source, not one source at a time. */
const two = (a: string, b: string): RetrievedSource[] => [
  { id: "zetaris:first", kind: "zetaris", summary: a },
  { id: "zetaris:second", kind: "zetaris", summary: b },
];
const fail = (n: number) => row(n, "SSA-001", "OOS", `2026-10-0${n}`, "did_not_hold", "sensor drift");

test("a conflict in a second source uncounts the id and is reported, citing both sources", () => {
  const first = [fail(1), fail(2), fail(3)].join("; ");
  const second = row(3, "SSA-001", "OOS", "2026-10-03", "held", "sensor drift");
  const flags = precursorFindings(two(first, second), "SSA-001");
  assert.equal(flags.some((f) => /^Escalation flag/.test(f.claim)), false, "only two unconflicted failures remain");
  const conflict = flags.find((f) => /^Data conflict/.test(f.claim));
  assert.ok(conflict);
  assert.match(conflict.claim, /ISS-003/);
  assert.deepEqual(conflict.evidence_ids, ["zetaris:first", "zetaris:second"]);
});

test("an identical repeat that sits only in a second source gets a data note", () => {
  const flags = precursorFindings(two([fail(1), fail(2)].join("; "), fail(2)), "SSA-001");
  const note = flags.find((f) => /^Data note/.test(f.claim));
  assert.ok(note);
  assert.match(note.claim, /ISS-002 \(2 times\)/);
});

test("two sources with distinct incidents add up, and the flag cites both", () => {
  const flags = precursorFindings(two([fail(1), fail(2)].join("; "), fail(3)), "SSA-001");
  const flag = flags.find((f) => /^Escalation flag/.test(f.claim));
  assert.ok(flag);
  assert.match(flag.claim, /has 3 fixes/);
  assert.deepEqual(flag.evidence_ids, ["zetaris:first", "zetaris:second"]);
});

test("the open-HAZARD and historical summaries are not counted as repeats", () => {
  const hazard = { id: "zetaris:hz", kind: "zetaris" as const, summary: `Open HAZARD rows: ${fail(1)}` };
  const flags = precursorFindings([{ id: "zetaris:q-1", kind: "zetaris", summary: [fail(1), fail(2)].join("; ") }, hazard], "SSA-001");
  assert.equal(flags.some((f) => /^Data/.test(f.claim)), false);
});

/** P3: a data note or conflict alone never changes the recommended next check. */
test("a data note alone does not trigger the escalation recommendation", () => {
  const rows = [DUP, DUP, DUP].join("; ");
  const draft = codeRowsDraft(cause("SSA-001"), source(rows));
  assert.ok(draft.findings.some((f) => /^Data note/.test(f.claim)));
  assert.doesNotMatch(draft.recommended_next_check, /escalat/i);
});

/** R18-03: a conflicting version in another asset's source is seen before any asset filter. */
test("a same-id row that sits only in another asset's source is a conflict and is uncounted", () => {
  const first = [fail(1), fail(2), fail(3)].join("; ");
  const second = row(3, "SSA-002", "OOS", "2026-10-03", "did_not_hold", "sensor drift");
  const flags = precursorFindings(two(first, second), "SSA-001");
  assert.equal(flags.some((f) => /^Escalation flag/.test(f.claim)), false, "only two unconflicted failures remain");
  const conflict = flags.find((f) => /^Data conflict/.test(f.claim));
  assert.ok(conflict);
  assert.match(conflict.claim, /ISS-003/);
  assert.deepEqual(conflict.evidence_ids, ["zetaris:first", "zetaris:second"]);
});

test("an unrelated incident in another asset's source is neither counted nor cited", () => {
  const flags = precursorFindings(two([fail(1), fail(2), fail(3)].join("; "), row(9, "SSA-002", "OOS", "2026-10-09", "did_not_hold", "belt slip")), "SSA-001");
  const flag = flags.find((f) => /^Escalation flag/.test(f.claim));
  assert.ok(flag);
  assert.deepEqual(flag.evidence_ids, ["zetaris:first"]);
  assert.equal(flags.some((f) => /^Data/.test(f.claim)), false);
});
