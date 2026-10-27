import assert from "node:assert/strict";
import { test } from "node:test";
import { lintAndAssemble, reasonConflation } from "../src/final-pass.ts";
import type { SmokeDraft } from "../src/schemas.ts";

const retrieved = [
  { id: "zetaris:q1", kind: "zetaris" as const, summary: "SELECT 1. Connectivity probe returned a result" },
  { id: "hmem:m1", kind: "hmem" as const, summary: "smoke. Memory notes the smoke incident" },
];

function draft(over: Partial<SmokeDraft> = {}): SmokeDraft {
  return {
    headline: "Zetaris answered 1; HVAC tables not loaded",
    findings: [
      { claim: "Connectivity probe returned a result", evidence_ids: ["zetaris:q1"] },
      { claim: "Memory notes the smoke incident", evidence_ids: ["hmem:m1"] },
    ],
    recommended_next_check: "Load synthetic HVAC tables, then rerun CAUSE SSA-001",
    needs_human_decision: true,
    not_checked: ["HVAC issue history"],
    confidence: 0.4,
    ...over,
  };
}

test("assembles a cited answer", () => {
  const out = lintAndAssemble(draft(), retrieved, "t1");
  assert.equal(out.trace_id, "t1");
  assert.equal(out.findings[0].evidence_ids[0], "zetaris:q1");
  assert.equal(out.needs_human_decision, true);
});

test("blocks a same-reason claim when the two incidents differ", () => {
  const sources = [
    {
      id: "zetaris:q1",
      kind: "zetaris" as const,
      summary:
        "ISS-001 SSA-001 OOS 2026-09-02 ACT-17 did_not_hold intake filter packed with dust; ISS-002 SSA-001 OOS 2026-09-16 ACT-11 did_not_hold same filter bypass, coil iced",
    },
    {
      id: "hmem:m1",
      kind: "hmem" as const,
      summary:
        "incident ISS-001 on SSA-001: kind OOS, opened 2026-09-02, actor ACT-17, fix_outcome did_not_hold, reason intake filter packed with dust.",
    },
    {
      id: "worldmodel:u1",
      kind: "worldmodel" as const,
      summary: "Unit SSA-001. Open HAZARD count 0, read from the world-model graph.",
    },
  ];
  const shared = {
    recommended_next_check: "A human inspects SSA-001.",
    needs_human_decision: true,
    not_checked: ["Anything not in the retrieved sources"],
    confidence: 0.6,
  };
  assert.throws(
    () =>
      lintAndAssemble(
        {
          headline: "SSA-001 fixes did not hold",
          findings: [
            {
              claim: "SSA-001 had an out-of-service event on 2026-09-02 where ACT-17's fix did not hold because the intake filter was packed with dust.",
              evidence_ids: ["zetaris:q1", "hmem:m1"],
            },
            {
              claim: "SSA-001 had another out-of-service event on 2026-09-16 where ACT-11's fix did not hold for the same reason.",
              evidence_ids: ["zetaris:q1"],
            },
            { claim: "Unit SSA-001 has an open HAZARD count of 0 from the world-model graph.", evidence_ids: ["worldmodel:u1"] },
          ],
          ...shared,
        },
        sources,
        "t-conflate",
      ),
    /reason conflation/,
  );
  // Two different incidents with different reasons are not a conflation. (The release contract withholds a model claim that states dates and actors, so the rule is checked directly.)
  assert.equal(
    reasonConflation("On 2026-09-02 ACT-17's fix did not hold because the intake filter was packed with dust. On 2026-09-16 ACT-11's fix did not hold because of a filter bypass and an iced coil.", sources),
    null,
  );
  const same = [
    {
      id: "zetaris:q1",
      kind: "zetaris" as const,
      summary:
        "ISS-001 SSA-001 OOS 2026-09-02 ACT-17 did_not_hold intake filter packed with dust; ISS-009 SSA-001 OOS 2026-10-02 ACT-23 did_not_hold intake filter packed with dust",
    },
    ...sources.slice(1),
  ];
  assert.equal(reasonConflation("On 2026-09-02 ACT-17 and on 2026-10-02 ACT-23 the fix did not hold for the same reason.", same), null, "two incidents with one reason");
  assert.throws(
    () =>
      lintAndAssemble(
        {
          headline: "SSA-001 fixes did not hold",
          findings: [
            {
              claim: "ISS-002 SSA-001 OOS opened 2026-09-16 by ACT-11 with reason same and fix outcome did_not_hold.",
              evidence_ids: ["zetaris:q1", "hmem:m1"],
            },
            { claim: "Unit SSA-001 has an open HAZARD count of 0 from the world-model graph.", evidence_ids: ["worldmodel:u1"] },
          ],
          ...shared,
        },
        sources,
        "t-chop",
      ),
    /reason truncated|retrieved record/,
  );
});

test("blocks missing evidence, names, secrets, HAZARD close", () => {
  assert.throws(
    () => lintAndAssemble(draft({ findings: [{ claim: "invented", evidence_ids: ["nope"] }] }), retrieved, "t"),
    /evidence/,
  );
  assert.throws(
    () => lintAndAssemble(draft({ headline: "Jordan Hale closed it" }), retrieved, "t"),
    /person name/,
  );
  assert.throws(
    () => lintAndAssemble(draft({ headline: `key ${"nvapi" + "-"}aaaa` }), retrieved, "t"),
    /secret/,
  );
  assert.throws(
    () => lintAndAssemble(draft({ headline: "HAZARD ticket was closed automatically" }), retrieved, "t"),
    /HAZARD/,
  );
  assert.throws(
    () =>
      lintAndAssemble(
        draft({ findings: [{ claim: "sql only", evidence_ids: ["zetaris:q1"] }] }),
        retrieved,
        "t",
      ),
    /dual-citation/,
  );
});
