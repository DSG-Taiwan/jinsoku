import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { chainFor, compressNext, foldChain } from "../src/adapters/markov.ts";
import { codeNextDraft, prepareNextDraft } from "../src/agents/next-check.ts";
import { PROJECT_ROOT } from "../src/config.ts";
import { hazardDowngrade, lintAndAssemble } from "../src/final-pass.ts";
import type { RetrievedSource, SmokeDraft } from "../src/schemas.ts";
import { logPathFor } from "../src/tracing.ts";

const TRACE = "markov-test-ssa-001";

function draftWithoutMarkov(): SmokeDraft {
  return {
    headline: "NEXT SSA-001 compressed check",
    findings: [
      { claim: "Zetaris listed the asset issues.", evidence_ids: ["zetaris:q1"] },
      { claim: "Memory recalled the asset incidents.", evidence_ids: ["hmem:m1"] },
      { claim: "Unit SSA-001 has an open HAZARD count of 0 from the world-model graph.", evidence_ids: ["worldmodel:u1"] },
    ],
    recommended_next_check: "A human inspects the unit. Agents propose only.",
    needs_human_decision: true,
    not_checked: ["Anything not in retrieved sources"],
    confidence: 0.6,
  };
}

test("NEXT cites the Markovian carryover and that text changes the check", async () => {
  const hit = await compressNext("SSA-001", TRACE);
  assert.equal(hit.id, "markov:SSA-001");
  assert.equal(hit.steps, chainFor("SSA-001").length);
  assert.ok(hit.steps > 1);
  assert.equal(hit.content.includes("intake filter packed with dust"), false);
  assert.equal(hit.content.includes("pan hose flushed"), true);
  assert.equal(hit.content, foldChain(chainFor("SSA-001")));
  for (const line of hit.content.split("\n")) {
    assert.match(line, /^ISS-\d+ /);
    assert.match(line, /\.$/);
  }

  const entry = path.join(PROJECT_ROOT, "vendor", "markovian", "reference", "src", "index.ts");
  const engine = await import(pathToFileURL(entry).href);
  const config = engine.resolveConfig({ chunkSize: 2000, carryoverTokens: 128, maxChunks: hit.steps, overlapTokens: 0 });
  const direct = await new engine.CarryoverService().next({
    markerState: hit.content,
    previousCarryover: "",
    chunkText: "plain words with no extractable key phrases at all",
    config,
  });
  assert.equal(direct.level, "marker");
  assert.equal(String(direct.carryover), hit.content);
  assert.ok(engine.estimateTokens(hit.content) <= 128);

  const sources: RetrievedSource[] = [
    { id: "zetaris:q1", kind: "zetaris", summary: "ISS-208 SSA-001 MICROFIX 2026-10-29 ACT-23 held pan hose flushed" },
    { id: "hmem:m1", kind: "hmem", summary: "D3 synthetic incident ISS-208 on SSA-001." },
    { id: "worldmodel:u1", kind: "worldmodel", summary: "Unit SSA-001. Open HAZARD count 0, read from the world-model graph." },
    { id: hit.id, kind: "markov", summary: hit.content },
  ];
  const unbound = draftWithoutMarkov();
  assert.throws(() => lintAndAssemble(unbound, sources, TRACE), /dual-citation: missing markov/);

  const core = codeNextDraft(sources);
  assert.equal(core.findings.some((finding) => finding.evidence_ids.includes(hit.id)), true);
  assert.match(core.recommended_next_check, /Propose only/);

  const bound = prepareNextDraft(unbound, sources);
  assert.equal(bound.recommended_next_check.includes(hit.content), true);
  assert.notEqual(bound.recommended_next_check, unbound.recommended_next_check);
  const cited = bound.findings.find((finding) => finding.evidence_ids.includes(hit.id));
  assert.ok(cited);
  assert.equal(cited.claim, hit.content);
  assert.equal(cited.evidence_ids.length, 1);
  assert.equal(bound.findings.some((finding) => finding.claim === "Zetaris listed the asset issues."), false);

  const released = lintAndAssemble(bound, sources, TRACE);
  assert.equal(released.recommended_next_check.includes("pan hose flushed"), true);
  assert.equal(released.findings.some((finding) => finding.evidence_ids.includes("markov:SSA-001")), true);

  const other = await compressNext("SSA-003", "markov-test-ssa-003");
  assert.equal(other.content.includes("economizer linkage seized"), true);
  assert.notEqual(other.content, hit.content);

  const hazard = await compressNext("SSA-002", "markov-test-ssa-002");
  assert.equal(hazard.content, foldChain(chainFor("SSA-002")));
  for (const line of hazard.content.split("\n")) assert.match(line, /^ISS-\d+ /);
  assert.equal(hazard.content.includes("ISS-006"), true);
  assert.equal(hazard.content.includes("stays open for a human"), true);
  assert.equal(hazardDowngrade(hazard.content), false);
  assert.equal(hazardDowngrade(`Propose only. A human decides. ${hazard.content}`), false);

  const hazardSources: RetrievedSource[] = [
    {
      id: "zetaris:q2",
      kind: "zetaris",
      summary: "ISS-006 SSA-002 HAZARD 2026-10-15 ACT-23 did_not_hold high-limit trip, still open",
    },
    {
      id: "hmem:m2",
      kind: "hmem",
      summary:
        "incident ISS-006 on SSA-002: kind HAZARD, opened 2026-10-15, actor ACT-23, fix_outcome did_not_hold, reason high-limit trip, still open.",
    },
    {
      id: "worldmodel:u2",
      kind: "worldmodel",
      summary: "Unit SSA-002. Open HAZARD count 1, read from the world-model graph.",
    },
    { id: hazard.id, kind: "markov", summary: hazard.content },
  ];
  const dirty = {
    headline: "NEXT SSA-002 compressed check",
    findings: [
      { claim: "On 2026-10-15 ACT-23 had reason high-limit.", evidence_ids: ["zetaris:q2"] },
      { claim: "Memory recalled ISS-006.", evidence_ids: ["hmem:m2"] },
    ],
    recommended_next_check: "A human inspects the unit.",
    needs_human_decision: true,
    not_checked: ["Anything not in retrieved sources"],
    confidence: 0.5,
  };
  const repaired = prepareNextDraft(dirty, hazardSources);
  assert.equal(repaired.headline, dirty.headline);
  assert.equal(repaired.findings.some((finding) => finding.claim.includes("reason high-limit.")), false);
  assert.equal(repaired.findings.some((finding) => finding.claim.includes("Memory recalled")), false);
  assert.match(
    repaired.findings.find((finding) => finding.evidence_ids.includes("zetaris:q2"))?.claim ?? "",
    /high-limit trip, still open/,
  );
  const held = prepareNextDraft(
    { ...dirty, headline: "NEXT SSA-002: evidence retrieved, human decides" },
    hazardSources,
  );
  assert.equal(held.headline.includes("evidence retrieved"), true);
  assert.throws(() => lintAndAssemble(held, hazardSources, "markov-fallback"), /fallback/);
  assert.equal(repaired.findings.some((finding) => finding.evidence_ids.includes("worldmodel:u2")), true);
  const hazardAnswer = lintAndAssemble(repaired, hazardSources, "markov-test-ssa-002");
  assert.equal(hazardAnswer.recommended_next_check.includes("stays open for a human"), true);
  assert.equal(hazardAnswer.findings.some((finding) => finding.evidence_ids.includes("markov:SSA-002")), true);

  const lines = fs
    .readFileSync(logPathFor(TRACE), "utf8")
    .trim()
    .split(/\n/)
    .map((line) => JSON.parse(line) as { action: string; retrieval?: { evidence_ids: string[]; queries: { source: string }[] }; output_summary: string });
  const logged = lines.find((line) => line.action === "markov-query");
  assert.ok(logged);
  assert.deepEqual(logged.retrieval?.evidence_ids, ["markov:SSA-001"]);
  assert.equal(logged.retrieval?.queries[0].source, "markov");
  assert.equal(logged.output_summary.includes("pan hose flushed"), true);

  for (const trace of [TRACE, "markov-test-ssa-003", "markov-test-ssa-002"]) {
    fs.rmSync(logPathFor(trace), { force: true });
  }
});
