import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReadOnlySql } from "../src/adapters/zetaris.ts";
import { ASSET_IDS, issuesSelect, weekBounds } from "../src/data/seed.ts";

test("seed SELECT is read-only and names three assets", () => {
  const sql = issuesSelect({ assetId: "SSA-001" });
  assert.equal(assertReadOnlySql(sql), sql);
  assert.ok(ASSET_IDS.includes("SSA-002"));
  const week = issuesSelect(weekBounds("lastweek"));
  assert.doesNotMatch(week, /;/);
  assert.match(sql, /FROM hvac\.issues/);
  assert.doesNotMatch(sql, /UNION ALL/);
});
