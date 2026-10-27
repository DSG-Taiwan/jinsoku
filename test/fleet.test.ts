import assert from "node:assert/strict";
import { test } from "node:test";
import { fleetStatus } from "../src/fleet.ts";

test("the fleet status counts units that reach the escalation rule or hold an open hazard, from the data", () => {
  const fleet = fleetStatus();
  assert.equal(fleet.units, 12);
  assert.equal(fleet.escalation_rule, 3);
  assert.equal(fleet.data_through, "2026-10-21");
  const byAsset = new Map(fleet.needs_a_look.map((u) => [u.asset, u]));
  assert.ok((byAsset.get("SSA-001")?.failed ?? 0) >= 3, "SSA-001 has five repairs that did not hold");
  assert.ok((byAsset.get("SSA-002")?.open_hazards ?? 0) >= 1, "SSA-002 has an open hazard");
  for (const unit of fleet.needs_a_look) assert.ok(unit.failed >= 3 || unit.open_hazards > 0, unit.asset);
  assert.equal(byAsset.has("SSA-004"), false, "SSA-004 has two failed repairs and no open hazard");
});
