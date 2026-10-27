import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { deterministicCritique } from "../src/agents/evaluator.ts";
import { memoryFacts } from "../src/data/seed.ts";
import { hazardDowngrade, lintAndAssemble } from "../src/final-pass.ts";
import type { SmokeDraft } from "../src/schemas.ts";

const retrieved = [
  { id: "zetaris:q1", kind: "zetaris" as const, summary: "rows. Connectivity probe returned a result" },
  { id: "hmem:m1", kind: "hmem" as const, summary: "mem. Memory notes the incident" },
];

function probes(): { block: string[]; allow: string[] } {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "hazard-probes.txt");
  const lines = fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const block: string[] = [];
  const allow: string[] = [];
  let mode: "block" | "allow" | null = null;
  for (const line of lines) {
    if (line === "BLOCK") {
      mode = "block";
      continue;
    }
    if (line === "ALLOW") {
      mode = "allow";
      continue;
    }
    if (mode === "block") block.push(line);
    if (mode === "allow") allow.push(line);
  }
  return { block, allow };
}

function draft(headline: string): SmokeDraft {
  return {
    headline,
    findings: [
      { claim: "Connectivity probe returned a result", evidence_ids: ["zetaris:q1"] },
      { claim: "Memory notes the incident", evidence_ids: ["hmem:m1"] },
    ],
    recommended_next_check: "A human inspects the unit. Agents propose only.",
    needs_human_decision: true,
    not_checked: ["Full history"],
    confidence: 0.4,
  };
}

test("hazard-probes.txt blocks close and downgrade wording in either order", () => {
  const { block, allow } = probes();
  assert.ok(block.length >= 3);
  for (const line of block) {
    assert.equal(hazardDowngrade(line), true, line);
    assert.throws(() => lintAndAssemble(draft(line), retrieved, "t-hazard"), /HAZARD/);
    const critique = deterministicCritique(draft(line), retrieved);
    assert.equal(critique.requires_revision, true, line);
    assert.equal(critique.approve, false, line);
  }
  for (const line of allow) {
    assert.equal(hazardDowngrade(line), false, line);
    const out = lintAndAssemble(draft(line), retrieved, "t-open");
    // Allowed wording is never blocked. The release contract may still replace a headline that names an incident kind with the fixed text.
    assert.ok(out.headline === line || out.headline === "Cited rows, human decides", out.headline);
    const critique = deterministicCritique(draft(line), retrieved);
    assert.equal(critique.requires_revision, false, line);
  }
});

test("synthetic memory text does not itself close a HAZARD", () => {
  for (const fact of memoryFacts()) {
    assert.equal(hazardDowngrade(fact.content), false, fact.content);
  }
});
