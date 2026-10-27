import { ESCALATION_THRESHOLD } from "./agents/precursors.ts";
import { blankClosedAt } from "./agents/hazard-block.ts";
import { ASSET_IDS, ISSUES, dataWindow } from "./data/seed.ts";

export interface FleetUnit {
  asset: string;
  failed: number;
  open_hazards: number;
}

/**
 * Where the fleet stands, counted from the incident data with the rules the answers use: a unit needs a look when it has the escalation
 * threshold of repairs that did not hold, or an open HAZARD (kind HAZARD, no closing date). Read-only; it proposes nothing.
 */
export function fleetStatus(): { data_through: string; units: number; escalation_rule: number; needs_a_look: FleetUnit[] } {
  const needs: FleetUnit[] = [];
  for (const asset of ASSET_IDS) {
    const rows = ISSUES.filter((row) => row.asset_id === asset);
    const failed = rows.filter((row) => row.fix_outcome === "did_not_hold").length;
    const openHazards = rows.filter((row) => row.kind === "HAZARD" && blankClosedAt(row.closed_at)).length;
    if (failed >= ESCALATION_THRESHOLD || openHazards > 0) needs.push({ asset, failed, open_hazards: openHazards });
  }
  return { data_through: dataWindow().to, units: ASSET_IDS.length, escalation_rule: ESCALATION_THRESHOLD, needs_a_look: needs };
}
