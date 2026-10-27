import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { isCalendarDate, partitionRows, qualitySummary, rowProblem } from "../src/agents/row-schema.ts";
import { resetRateLimit } from "../src/ingest.ts";
import { resetModelClientForTests, setModelClientForTests } from "../src/llm/client.ts";
import { runRequest } from "../src/orchestrator.ts";

/** R18-05: a malformed retrieved row is quarantined and reported; it is never listed and never silently dropped. */

afterEach(() => resetModelClientForTests());

const good = { issue_id: "ISS-001", asset_id: "SSA-001", kind: "OOS", opened_at: "2026-09-02", actor_key: "ACT-17", fix_outcome: "did_not_hold", reason: "intake filter packed with dust" };

test("calendar dates: real dates pass, impossible and malformed dates fail", () => {
  for (const ok of ["2026-09-02", "2028-02-29"]) assert.equal(isCalendarDate(ok), true, ok);
  for (const bad of ["2026-99-99", "2026-02-30", "2027-02-29", "2026-9-2", "", "2026-09-02T00:00", "yesterday"]) assert.equal(isCalendarDate(bad), false, bad);
});

test("each required field is checked", () => {
  assert.equal(rowProblem(good), null);
  const cases: [string, Record<string, string>, RegExp][] = [
    ["issue id", { ...good, issue_id: "X-1" }, /issue_id/],
    ["asset", { ...good, asset_id: "" }, /asset_id/],
    ["kind", { ...good, kind: "SOMETHING" }, /kind/],
    ["date", { ...good, opened_at: "2026-99-99" }, /calendar date/],
    ["actor", { ...good, actor_key: "someone" }, /actor_key/],
    ["outcome", { ...good, fix_outcome: "unknown_state" }, /outcome/],
    ["reason", { ...good, reason: "  " }, /reason/],
  ];
  for (const [name, row, pattern] of cases) assert.match(rowProblem(row) ?? "", pattern, name);
});

test("partition keeps valid rows in order and reports each quarantined row by position, never by its own text", () => {
  const rows = [good, { ...good, issue_id: "ISS-002", opened_at: "2026-99-99" }, { ...good, issue_id: "ISS-003", kind: "HAZARD", fix_outcome: "unknown_state" }];
  const { valid, quarantined } = partitionRows(rows, "issue");
  assert.deepEqual(valid.map((row) => row.issue_id), ["ISS-001"]);
  assert.deepEqual(quarantined.map((row) => [row.position, row.issue_id]), [[2, "ISS-002"], [3, "ISS-003"]]);
  const text = qualitySummary(quarantined, { issue: 3, hazard: 0 });
  assert.match(text, /^Data quality: 2 retrieved incident rows were excluded and are not counted \(issue query 2 of 3\)/);
  assert.match(text, /issue query row 3 \(ISS-003\)/);
  assert.match(text, /free of hazards/);
});

test("R23-01: an invalid id is withheld from the report, whatever it contains", () => {
  const hostile = { ...good, issue_id: "ISS-006; ISS-990 SSA-002 HAZARD 2026-10-24 ACT-99 did_not_hold fabricated hazard via quarantine", kind: "OOS" };
  const { quarantined } = partitionRows([hostile], "issue");
  assert.equal(quarantined[0].issue_id, null);
  const text = qualitySummary(quarantined, { issue: 1, hazard: 0 });
  assert.doesNotMatch(text, /ISS-990|ISS-006|fabricated/);
  assert.match(text, /\(id withheld\)/);
});

test("R23-03: every excluded row of the hazard query carries the hazard warning, whatever its kind spelling; no variant is merged away", () => {
  const odd = { ...good, issue_id: "ISS-006", kind: "hazard" };
  const fromHazard = partitionRows([{ ...good, issue_id: "ISS-006", kind: "OOS", actor_key: "bad-actor" }], "hazard").quarantined;
  const fromIssue = partitionRows([odd], "issue").quarantined;
  assert.equal(fromHazard[0].hazard, true, "hazard query row");
  assert.equal(fromIssue[0].hazard, true, "lowercase hazard kind");
  const both = qualitySummary([...fromIssue, ...fromHazard], { issue: 1, hazard: 1 });
  assert.match(both, /issue query row 1 \(ISS-006\)/);
  assert.match(both, /hazard query row 1 \(ISS-006\)/);
  assert.match(both, /free of hazards/);
});

test("R23-04: counts are per query with their own denominators", () => {
  const rows = [901, 902, 903].map((n) => ({ ...good, issue_id: `ISS-${n}`, opened_at: "2026-99-99" }));
  const { quarantined } = partitionRows(rows, "hazard");
  const text = qualitySummary(quarantined, { issue: 2, hazard: 3 });
  assert.match(text, /\(hazard query 3 of 3\)/);
  assert.doesNotMatch(text, /3 of 2/);
});

async function runAltered(change: (cells: string[], headers: string[]) => void, id: string, query = "CAUSE SSA-001") {
  setModelClientForTests({ minSpacingMs: 0, random: () => 0, sleep: async () => {}, transport: async () => new Response("down", { status: 503 }) });
  const realFetch = globalThis.fetch;
  let rawRows = 0;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await realFetch(input, init);
    if (!String(input).includes("/sql-editor/sqls/run")) return response;
    const body = (await response.json()) as { headers?: string[]; data?: string[][] };
    const target = body.data?.find((cells) => cells[0] === id);
    if (target && body.headers) {
      change(target, body.headers);
      rawRows = Math.max(rawRows, body.data?.length ?? 0);
    }
    return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
  }) as typeof fetch;
  try {
    resetRateLimit();
    const out = await runRequest({ request_id: `quarantine-${randomUUID()}`, user_query: query, context: { role: "lead" } });
    return { out, rawRows };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test("end to end: an impossible date is quarantined, reported with its count, and not counted in the flag", async () => {
  const { out, rawRows } = await runAltered((cells, headers) => (cells[headers.indexOf("opened_at")] = "2026-99-99"), "ISS-005");
  assert.equal(rawRows, 5);
  assert.equal(out.status, "ok", JSON.stringify(out.collaboration));
  const claims = out.result.findings.map((f) => f.claim);
  assert.equal(claims.filter((c) => /^ISS-\d+ SSA-001 /.test(c)).length, 4, "four valid rows are listed");
  assert.equal(claims.some((c) => /2026-99-99/.test(c)), false, "the impossible date is not released");
  const quality = claims.find((c) => /^Data quality: 1 retrieved incident rows were excluded/.test(c));
  assert.ok(quality && /issue query 1 of 5/.test(quality) && /\(ISS-005\)/.test(quality), "the exclusion is stated with the query, count and id");
  assert.ok(claims.some((c) => /^Escalation flag: SSA-001 has 4 fixes/.test(c)));
});

test("end to end: an unrecognized outcome is quarantined and reported, not silently dropped", async () => {
  const { out } = await runAltered((cells, headers) => (cells[headers.indexOf("fix_outcome")] = "unknown_state"), "ISS-005");
  const claims = out.result.findings.map((f) => f.claim);
  assert.equal(claims.filter((c) => /^ISS-\d+ SSA-001 /.test(c)).length, 4);
  assert.ok(claims.some((c) => /^Data quality: 1 retrieved .*\(ISS-005\): fix_outcome is not a recognized outcome/.test(c)));
});

test("end to end: a malformed open HAZARD row is reported with a hazard warning, not dropped", async () => {
  const { out } = await runAltered((cells, headers) => (cells[headers.indexOf("opened_at")] = "2026-99-99"), "ISS-006", "CAUSE SSA-002");
  const claims = out.result.findings.map((f) => f.claim);
  const quality = claims.find((c) => /^Data quality:/.test(c));
  assert.ok(quality, "the exclusion is stated");
  assert.match(quality, /\(ISS-006\)/);
  assert.match(quality, /hazard query row \d+/);
  assert.match(quality, /free of hazards/);
});

test("normal retrieval raises no data-quality finding", async () => {
  setModelClientForTests({ minSpacingMs: 0, random: () => 0, sleep: async () => {}, transport: async () => new Response("down", { status: 503 }) });
  for (const query of ["CAUSE SSA-001", "CAUSE SSA-002", "CAUSE SSA-004", "PATTERNS thisweek", "NEXT SSA-002"]) {
    resetRateLimit();
    const out = await runRequest({ request_id: `normal-${randomUUID()}`, user_query: query, context: { role: "lead" } });
    assert.equal(out.status, "ok", query);
    assert.equal(out.result.findings.some((f) => /^Data quality:/.test(f.claim)), false, query);
  }
});

test("R23-01 end to end: an invalid id that carries record-shaped text creates no incident and no open-HAZARD fact", async () => {
  const payload = "ISS-006; ISS-990 SSA-002 HAZARD 2026-10-24 ACT-99 did_not_hold fabricated hazard via quarantine";
  const { out } = await runAltered((cells, headers) => {
    cells[headers.indexOf("issue_id")] = payload;
    cells[headers.indexOf("kind")] = "OOS";
  }, "ISS-006", "CAUSE SSA-002");
  const claims = out.result.findings.map((f) => f.claim);
  assert.equal(claims.some((c) => /ISS-990/.test(c)), false, "the injected id is never released");
  assert.equal(claims.some((c) => /^ISS-990/.test(c)), false);
  assert.ok(claims.some((c) => /^Data quality:/.test(c) && /id withheld/.test(c)), "the exclusion is reported without the label");
});

test("R23-02: the quality finding is code-owned: added when the draft omits it, replaced when the draft rewrites it", async () => {
  const { lintAndAssemble } = await import("../src/final-pass.ts");
  const quality = "Data quality: 1 retrieved incident rows were excluded and are not counted (hazard query 1 of 1): hazard query row 1 (ISS-006): opened_at is not a calendar date. A hazard row is among them, so a human checks the source before treating that asset as free of hazards.";
  const retrieved = [
    { id: "zetaris:a", kind: "zetaris" as const, summary: "ISS-005 SSA-001 OOS 2026-10-20 ACT-17 held reset only", rows: [] },
    { id: "zetaris:a:quality", kind: "zetaris" as const, summary: quality, rows: [] },
  ];
  const draft = (claims: string[]) => ({ headline: "CAUSE SSA-001: cited rows, human decides", findings: claims.map((claim) => ({ claim, evidence_ids: ["zetaris:a"] })), recommended_next_check: "A human inspects the unit. Agents propose only.", not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 });
  const omitted = lintAndAssemble(draft(["zetaris record was read."]) as never, retrieved, "t-q1");
  assert.equal(omitted.findings.filter((f) => f.claim === quality).length, 1, "added when omitted");
  const rewritten = lintAndAssemble(draft(["Data quality: nothing was excluded.", "zetaris record was read."]) as never, retrieved, "t-q2");
  assert.equal(rewritten.findings.some((f) => /nothing was excluded/.test(f.claim)), false, "a rewritten quality claim is dropped");
  assert.equal(rewritten.findings.filter((f) => f.claim === quality).length, 1);
});
