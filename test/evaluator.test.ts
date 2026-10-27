import assert from "node:assert/strict";
import { test } from "node:test";
import { deterministicCritique } from "../src/agents/evaluator.ts";
import { lintAndAssemble } from "../src/final-pass.ts";
import type { SmokeDraft } from "../src/schemas.ts";

const retrieved = [
  { id: "zetaris:q1", kind: "zetaris" as const, summary: "rows" },
  { id: "hmem:m1", kind: "hmem" as const, summary: "mem" },
];

test("deterministic evaluator flags missing dual citation", () => {
  const draft: SmokeDraft = {
    headline: "Only sql",
    findings: [{ claim: "row", evidence_ids: ["zetaris:q1"] }],
    recommended_next_check: "human check",
    needs_human_decision: true,
    not_checked: ["full history"],
    confidence: 0.5,
  };
  const c = deterministicCritique(draft, retrieved);
  assert.equal(c.requires_revision, true);
  assert.ok(c.missing_evidence.some((m) => m.includes("dual-citation")));
});

test("a fallback headline is not released", () => {
  const draft: SmokeDraft = {
    headline: "NEXT SSA-002: evidence retrieved, human decides",
    findings: [
      { claim: "row", evidence_ids: ["zetaris:q1"] },
      { claim: "mem", evidence_ids: ["hmem:m1"] },
    ],
    recommended_next_check: "A human inspects the unit. Agents propose only.",
    needs_human_decision: true,
    not_checked: ["Anything not in retrieved sources"],
    confidence: 0.4,
  };
  const critique = deterministicCritique(draft, retrieved);
  assert.equal(critique.requires_revision, true);
  assert.ok(critique.issues.some((issue) => issue.includes("fallback draft")));
  assert.throws(() => lintAndAssemble(draft, retrieved, "t-fallback"), /fallback draft was not released/);
});

test("deliberately bad draft is blocked by the linter", () => {
  const bad: SmokeDraft = {
    headline: "Invented",
    findings: [{ claim: "no source", evidence_ids: ["nope"] }],
    recommended_next_check: "none",
    needs_human_decision: true,
    not_checked: [],
    confidence: 0.9,
  };
  assert.throws(() => lintAndAssemble(bad, retrieved, "t-bad"), /evidence|dual-citation|retrieved/);
});
