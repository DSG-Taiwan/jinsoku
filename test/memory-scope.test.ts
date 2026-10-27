import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { memoryDatasetFingerprint, resetStaleHmem, writeDatasetMarker } from "../src/adapters/meterless.ts";
import { retainCurrentMemories, scopeMemoryHits } from "../src/agents/executor.ts";
import { ISSUES } from "../src/data/seed.ts";

test("memory hits for a CAUSE stay on that asset and prefer ISS- facts", () => {
  const hits = [
    { content: "D1 smoke mem-1 about SSA-001" },
    { content: "Synthetic incident ISS-04 on SSA-002: kind HAZARD, still open" },
    { content: "Synthetic incident ISS-01 on SSA-001: kind OOS" },
  ];
  const scoped = scopeMemoryHits(hits, "SSA-001");
  assert.deepEqual(
    scoped.map((hit) => hit.content),
    ["Synthetic incident ISS-01 on SSA-001: kind OOS", "D1 smoke mem-1 about SSA-001"],
  );
  assert.equal(scopeMemoryHits(hits).length, 3);
  assert.ok(scopeMemoryHits(hits)[0].content.includes("ISS-"));
});

test("legacy ISS-05 is not passed when ISS-007 held is the current row", () => {
  const legacy =
    "Synthetic incident ISS-05 on SSA-002: kind OOS, opened 2026-10-08, actor ACT-23, fix_outcome did_not_hold, reason ignition lockout. HAZARD items stay open for a human.";
  const current =
    "D3 synthetic incident ISS-007 on SSA-002: kind OOS, opened 2026-09-08, actor ACT-23, fix_outcome held, reason ignition lockout.";
  const lie = "D3 synthetic incident ISS-007 on SSA-002: kind OOS, fix_outcome did_not_hold, reason ignition lockout.";
  const kept = retainCurrentMemories(
    scopeMemoryHits(
      [
        { id: "mem-8", content: legacy },
        { id: "mem-d3", content: current },
        { id: "lie", content: lie },
      ],
      "SSA-002",
    ),
    ISSUES,
  );
  assert.deepEqual(
    kept.map((hit) => hit.id),
    ["mem-d3"],
  );
  assert.equal(ISSUES.find((row) => row.issue_id === "ISS-007")?.fix_outcome, "held");
  assert.equal(ISSUES.some((row) => row.issue_id === "ISS-05"), false);
});

test("a dataset change drops the persisted H-MEM files before the next load", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hmem-rebuild-"));
  fs.writeFileSync(path.join(dir, "state.json"), '{"seq":8,"records":[{"id":"mem-8","content":"ISS-05"}]}\n');
  fs.writeFileSync(path.join(dir, "ledger.jsonl"), '{"memoryId":"mem-8"}\n');
  const fingerprint = memoryDatasetFingerprint([{ content: "D3 synthetic incident ISS-007 held" }]);
  assert.equal(resetStaleHmem(dir, fingerprint), true);
  assert.equal(fs.existsSync(path.join(dir, "state.json")), false);
  assert.equal(fs.existsSync(path.join(dir, "ledger.jsonl")), false);
  fs.writeFileSync(path.join(dir, "state.json"), '{"seq":1,"records":[]}\n');
  writeDatasetMarker(dir, fingerprint);
  assert.equal(resetStaleHmem(dir, fingerprint), false);
  assert.equal(fs.existsSync(path.join(dir, "state.json")), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
