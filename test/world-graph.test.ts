import assert from "node:assert/strict";
import { test } from "node:test";
import { queryUnits } from "../src/adapters/world-model.ts";
import { ISSUES } from "../src/data/seed.ts";

test("open HAZARD count is read from the world-model graph", async () => {
  const asset = "SSA-002";
  const expected = ISSUES.filter((row) => row.asset_id === asset && row.kind === "HAZARD" && row.closed_at === null).length;
  const units = await queryUnits(asset);
  assert.equal(units.length, 1);
  assert.match(units[0].content, new RegExp(`Open HAZARD count ${expected}, read from the world-model graph`));
  assert.doesNotMatch(units[0].content, /seed|ISSUES|open_hazard_count/i);
});
