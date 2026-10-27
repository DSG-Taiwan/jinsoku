import assert from "node:assert/strict";
import { test } from "node:test";
import { assembleFromRecords, verbatimReasons } from "../src/agents/executor.ts";
import { codeRowsDraft } from "../src/agents/patterns-core.ts";
import { confirmedOpenHazards, hazardBlockFindings } from "../src/agents/hazard-block.ts";
import { incidentsFromRetrieved, lintAndAssemble, truncatedReason } from "../src/final-pass.ts";
import type { CallObject, RetrievedSource, SmokeDraft } from "../src/schemas.ts";

/** Same issue id, differing rows: every retrieved version is stated as retrieved; none is preferred. Pending human attention. */

const hz = (outcome: string, reason: string) => `ISS-050 SSA-001 HAZARD 2026-10-05 ACT-17 ${outcome} ${reason}`;
const oos = (outcome: string, reason: string) => `ISS-050 SSA-001 OOS 2026-10-05 ACT-17 ${outcome} ${reason}`;
const world: RetrievedSource = { id: "worldmodel:w", kind: "worldmodel", summary: "Unit SSA-001 Open HAZARD count 1" };
const zet = (id: string, summary: string): RetrievedSource => ({ id, kind: "zetaris", summary });
const cause = { verb: "CAUSE", asset: "SSA-001", role: "lead", trace_id: "t" } as CallObject;

test("conflicting HAZARD rows: both are stated as open HAZARD rows with a conflict finding, none preferred", () => {
  const retrieved = [zet("zetaris:a", hz("did_not_hold", "belt slip")), zet("zetaris:b", hz("held", "belt slip, tension reset")), world];
  const facts = confirmedOpenHazards(retrieved);
  assert.equal(facts.length, 2);
  assert.ok(facts.every((fact) => fact.conflict === true));
  const blocks = hazardBlockFindings(retrieved);
  assert.equal(blocks.filter((b) => /stays open for a human/.test(b.claim)).length, 2);
  const conflict = blocks.find((b) => /^Data conflict: ISS-050/.test(b.claim));
  assert.ok(conflict);
  assert.match(conflict.claim, /pending human attention/);
  assert.match(conflict.claim, /belt slip, tension reset/);
  for (const id of ["zetaris:a", "zetaris:b", "worldmodel:w"]) assert.ok(conflict.evidence_ids.includes(id), id);
});

test("an identical repeated HAZARD row is one fact with no conflict", () => {
  const retrieved = [zet("zetaris:a", [hz("did_not_hold", "belt slip"), hz("did_not_hold", "belt slip")].join("; ")), world];
  const facts = confirmedOpenHazards(retrieved);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].conflict, undefined);
  assert.equal(hazardBlockFindings(retrieved).some((b) => /^Data conflict/.test(b.claim)), false);
});

test("a same-id row of another kind is a conflict too: the HAZARD row is stated, the other version is listed in the conflict finding", () => {
  const retrieved = [zet("zetaris:a", hz("did_not_hold", "belt slip")), zet("zetaris:b", oos("held", "belt replaced")), world];
  const blocks = hazardBlockFindings(retrieved);
  assert.equal(blocks.filter((b) => /stays open for a human/.test(b.claim)).length, 1);
  assert.match(blocks.find((b) => /^Data conflict/.test(b.claim))?.claim ?? "", /belt replaced/);
});

test("the final linter keeps every variant and accepts either full reason; a chopped reason still fails", () => {
  const retrieved = [zet("zetaris:a", oos("did_not_hold", "belt slip on the north fan")), zet("zetaris:b", oos("held", "belt replaced"))];
  assert.equal(incidentsFromRetrieved(retrieved).filter((row) => row.id === "ISS-050").length, 2);
  assert.equal(truncatedReason("ISS-050 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason belt replaced.", retrieved), null);
  assert.equal(truncatedReason("ISS-050 SSA-001 OOS opened 2026-10-05 actor ACT-17 did_not_hold reason belt slip on the north fan.", retrieved), null);
  assert.match(truncatedReason("ISS-050 SSA-001 OOS opened 2026-10-05 actor ACT-17 did_not_hold reason belt slip.", retrieved) ?? "", /record claim|reason truncated/);
});

test("a single-variant id still fails a chopped reason", () => {
  const retrieved = [zet("zetaris:a", oos("did_not_hold", "belt slip on the north fan"))];
  assert.match(truncatedReason("ISS-050 SSA-001 OOS opened 2026-10-05 actor ACT-17 did_not_hold reason belt slip.", retrieved) ?? "", /record claim|reason truncated/);
});

test("a core with two conflicting rows for one id is released, listing both, instead of failing closed", () => {
  const retrieved = [zet("zetaris:a", [oos("did_not_hold", "belt slip on the north fan"), oos("held", "belt replaced")].join("; ")), world];
  const released = lintAndAssemble(codeRowsDraft(cause, retrieved), retrieved, "t-conflict-release");
  const claims = released.findings.map((f) => f.claim);
  assert.ok(claims.some((c) => /belt slip on the north fan/.test(c)));
  assert.ok(claims.some((c) => /belt replaced/.test(c)));
  assert.ok(claims.some((c) => /^Data conflict: ISS-050/.test(c)), "the conflict is stated in the released answer");
});

test("end to end: a conflicting second ISS-005 row in the live retrieval is released with both versions and a conflict finding", async () => {
  const { randomUUID } = await import("node:crypto");
  const { resetRateLimit } = await import("../src/ingest.ts");
  const { resetModelClientForTests, setModelClientForTests } = await import("../src/llm/client.ts");
  const { runRequest } = await import("../src/orchestrator.ts");
  setModelClientForTests({ minSpacingMs: 0, random: () => 0, sleep: async () => {}, transport: async () => new Response("down", { status: 503 }) });
  const realFetch = globalThis.fetch;
  let altered = false;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await realFetch(input, init);
    if (!String(input).includes("/sql-editor/sqls/run")) return response;
    const body = (await response.json()) as { headers?: string[]; data?: string[][] };
    const reasonAt = body.headers?.indexOf("reason") ?? -1;
    const original = body.data?.find((cells) => cells[0] === "ISS-005");
    if (original && reasonAt >= 0) {
      const copy = [...original];
      copy[reasonAt] = "reset only, a different account of the same incident";
      body.data!.push(copy);
      altered = true;
    }
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  }) as typeof fetch;
  try {
    resetRateLimit();
    const out = await runRequest({ request_id: `conflict-${randomUUID()}`, user_query: "CAUSE SSA-001", context: { role: "lead" } });
    assert.ok(altered, "the retrieval result was altered in memory");
    assert.equal(out.status, "ok", JSON.stringify(out.collaboration));
    const claims = out.result.findings.map((f) => f.claim);
    assert.ok(claims.some((c) => /^Data conflict: ISS-005/.test(c)), "conflict stated");
    assert.ok(claims.some((c) => /a different account of the same incident/.test(c)), "the second version is stated as retrieved");
    assert.ok(claims.some((c) => /^ISS-005 .*reason reset only, filter still packed/.test(c)), "the original version is stated too");
  } finally {
    globalThis.fetch = realFetch;
    resetModelClientForTests();
  }
});

/** R17-01 to R17-04 (QA r17). */
const generic = (ids: string[]): SmokeDraft => ({
  headline: "CAUSE SSA-001: cited rows, human decides",
  findings: [{ claim: "zetaris record was read.", evidence_ids: ids }],
  recommended_next_check: "A human inspects the unit. Agents propose only.",
  not_checked: ["Anything not in the retrieved sources"],
  confidence: 0.5,
} as SmokeDraft);

test("R17-01: a secret-shaped or person-name string that only the floor's conflict text would release is blocked", () => {
  for (const bad of ["Bearer synthetic-fixture", "Jane Doe inspected"]) {
    const retrieved = [zet("zetaris:a", hz("did_not_hold", "belt slip")), zet("zetaris:b", oos("held", bad)), world];
    assert.throws(() => lintAndAssemble(generic(["zetaris:a", "worldmodel:w"]), retrieved, "t-leak"), /released text|in draft/i, bad);
  }
  const clean = [zet("zetaris:a", hz("did_not_hold", "belt slip")), zet("zetaris:b", oos("held", "belt replaced")), world];
  assert.doesNotThrow(() => lintAndAssemble(generic(["zetaris:a", "worldmodel:w"]), clean, "t-clean"));
});

test("R17-02: a row built from one version's date, actor, kind and outcome and another version's reason is rejected", () => {
  const a = "ISS-050 SSA-001 HAZARD 2026-10-05 ACT-17 did_not_hold belt slip on the north fan";
  const b = "ISS-050 SSA-001 OOS 2026-10-06 ACT-23 held belt replaced";
  const retrieved = [zet("zetaris:a", a), zet("zetaris:b", b)];
  const hybrid = "ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 did_not_hold reason belt replaced.";
  assert.match(truncatedReason(hybrid, retrieved) ?? "", /record claim/);
  assert.equal(truncatedReason("ISS-050 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 did_not_hold reason belt slip on the north fan.", retrieved), null);
  assert.equal(truncatedReason("ISS-050 SSA-001 OOS opened 2026-10-06 actor ACT-23 held reason belt replaced.", retrieved), null);
});

test("R17-02: the floor's own conflict finding, which lists every version, still lints", () => {
  const retrieved = [zet("zetaris:a", hz("did_not_hold", "belt slip on the north fan")), zet("zetaris:b", oos("held", "belt replaced")), world];
  assert.doesNotThrow(() => lintAndAssemble(generic(["zetaris:a", "worldmodel:w"]), retrieved, "t-floor"));
});

test("R17-02: versions that differ only in outcome cannot be recombined", () => {
  const retrieved = [zet("zetaris:a", "ISS-051 SSA-001 HAZARD 2026-10-05 ACT-17 did_not_hold belt slip"), zet("zetaris:b", "ISS-051 SSA-001 OOS 2026-10-05 ACT-17 held belt slip")];
  assert.match(truncatedReason("ISS-051 SSA-001 HAZARD opened 2026-10-05 actor ACT-17 held reason belt slip.", retrieved) ?? "", /record claim/);
  assert.equal(truncatedReason("ISS-051 SSA-001 OOS opened 2026-10-05 actor ACT-17 held reason belt slip.", retrieved), null);
});

test("R17-03: non-HAZARD versions split across sources are both listed, each citing its own source", () => {
  const retrieved = [zet("zetaris:a", oos("did_not_hold", "belt slip on the north fan")), zet("zetaris:b", oos("held", "belt replaced"))];
  const base = assembleFromRecords(cause, retrieved);
  const claims = base.findings.map((f) => f.claim);
  assert.ok(claims.some((c) => /belt slip on the north fan/.test(c)));
  const second = base.findings.find((f) => /belt replaced/.test(f.claim));
  assert.ok(second);
  assert.deepEqual(second.evidence_ids, ["zetaris:b"]);
  const released = lintAndAssemble(codeRowsDraft(cause, retrieved), retrieved, "t-split");
  assert.ok(released.findings.some((f) => /belt replaced/.test(f.claim)));
});

test("R17-03: a different incident in a second source is not pulled into the listing", () => {
  const other = "ISS-060 SSA-001 OOS 2026-10-09 ACT-11 held filter swap";
  const base = assembleFromRecords(cause, [zet("zetaris:a", oos("did_not_hold", "belt slip")), zet("zetaris:b", other)]);
  assert.equal(base.findings.some((f) => /ISS-060/.test(f.claim)), false);
});

test("R17-03: the model payload keeps every distinct reason per id", () => {
  const reasons = verbatimReasons([zet("zetaris:a", oos("did_not_hold", "belt slip")), zet("zetaris:b", oos("held", "belt replaced"))]);
  assert.deepEqual(reasons.filter((r) => r.issue_id === "ISS-050").map((r) => r.reason).sort(), ["belt replaced", "belt slip"]);
});

test("R17-04: the conflict finding cites every source that carries a version and every world source behind an open claim", () => {
  const retrieved = [zet("zetaris:a", hz("did_not_hold", "belt slip")), zet("zetaris:b", hz("did_not_hold", "belt slip")), zet("zetaris:c", hz("held", "belt replaced")), world];
  const conflict = hazardBlockFindings(retrieved).find((b) => /^Data conflict: ISS-050/.test(b.claim));
  assert.ok(conflict);
  for (const id of ["zetaris:a", "zetaris:b", "zetaris:c", "worldmodel:w"]) assert.ok(conflict.evidence_ids.includes(id), id);
  const w2: RetrievedSource = { id: "worldmodel:w2", kind: "worldmodel", summary: "Unit SSA-002 Open HAZARD count 1" };
  const two = [zet("zetaris:a", "ISS-070 SSA-001 HAZARD 2026-10-05 ACT-17 did_not_hold belt slip"), zet("zetaris:b", "ISS-070 SSA-002 HAZARD 2026-10-05 ACT-17 did_not_hold belt slip"), world, w2];
  const both = hazardBlockFindings(two).find((b) => /^Data conflict: ISS-070/.test(b.claim));
  assert.ok(both);
  assert.ok(both.evidence_ids.includes("worldmodel:w") && both.evidence_ids.includes("worldmodel:w2"));
});

test("R17-04: the full CAUSE answer states a conflicted id once", () => {
  const retrieved = [zet("zetaris:a", [hz("did_not_hold", "belt slip"), hz("held", "belt replaced")].join("; ")), world];
  const released = lintAndAssemble(codeRowsDraft(cause, retrieved), retrieved, "t-once");
  assert.equal(released.findings.filter((f) => /^Data conflict: ISS-050/.test(f.claim)).length, 1);
  assert.equal(released.findings.filter((f) => /stays open for a human/.test(f.claim)).length, 2);
});

/** R19-01: the core listing is chosen by relevance to the asset, not by source position. */
test("R19-01: an unrelated first source does not become the CAUSE listing; both versions of the conflicted id are listed", () => {
  const r = (id: string, asset: string, n: number) => `ISS-00${n} ${asset} OOS 2026-10-0${n} ACT-17 did_not_hold sensor drift`;
  const retrieved: RetrievedSource[] = [
    zet("zetaris:unrelated", r("x", "SSA-004", 9)),
    zet("zetaris:target", [1, 2, 3].map((n) => r("x", "SSA-001", n)).join("; ")),
    zet("zetaris:conflict", "ISS-003 SSA-002 OOS 2026-10-03 ACT-17 did_not_hold sensor drift"),
    { id: "worldmodel:w0", kind: "worldmodel", summary: "Unit SSA-001 Open HAZARD count 0" },
  ];
  const claims = assembleFromRecords(cause, retrieved).findings;
  assert.equal(claims.some((f) => /ISS-009/.test(f.claim)), false, "the unrelated incident is not listed");
  assert.equal(claims.some((f) => f.evidence_ids.includes("zetaris:unrelated")), false, "and not cited");
  const iss3 = claims.filter((f) => /^ISS-003 /.test(f.claim));
  assert.equal(iss3.length, 2, "both versions of ISS-003");
  assert.deepEqual(iss3.map((f) => f.evidence_ids[0]).sort(), ["zetaris:conflict", "zetaris:target"]);
  const released = lintAndAssemble(codeRowsDraft(cause, retrieved), retrieved, "t-r19");
  assert.equal(released.findings.some((f) => /ISS-009/.test(f.claim)), false);
});

test("R19-01: with the sources in any order the same incidents are listed", () => {
  const a = zet("zetaris:a", "ISS-001 SSA-001 OOS 2026-10-01 ACT-17 did_not_hold sensor drift; ISS-002 SSA-001 OOS 2026-10-02 ACT-17 did_not_hold sensor drift");
  const u = zet("zetaris:u", "ISS-009 SSA-004 OOS 2026-10-09 ACT-17 did_not_hold sensor drift");
  const ids = (sources: RetrievedSource[]) => assembleFromRecords(cause, sources).findings.map((f) => f.claim.split(" ")[0]).filter((x) => /^ISS-/.test(x)).sort();
  assert.deepEqual(ids([a, u]), ["ISS-001", "ISS-002"]);
  assert.deepEqual(ids([u, a]), ["ISS-001", "ISS-002"]);
});
