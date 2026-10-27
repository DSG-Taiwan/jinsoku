import type { StructuredClaim } from "../src/schemas.ts";

/** What the stub model sees: the typed rows the Analyst is given. */
export interface ModelPayload {
  allowed_issue_ids?: string[];
  incident_rows?: { id: string; unit: string; kind: string; date: string; actor: string; outcome: string }[];
}

/** A claim the rows support: repeat_failure over the first two incidents of one unit whose fix did not hold. */
export function goodClaim(user: ModelPayload): StructuredClaim {
  const rows = (user.incident_rows ?? []).filter((row) => row.outcome === "did_not_hold");
  const unit = rows[0]?.unit ?? "SSA-004";
  const ids = rows.filter((row) => row.unit === unit).slice(0, 2).map((row) => row.id);
  return { template: "repeat_failure", unit, ids, weigh: ids.map((id) => ({ id, verdict: "supports" })), judge: "supported", reasons: ["same_unit"], recommend: "inspect_unit" };
}

/** A claim about a unit that is not in the rows. */
export function badClaim(user: ModelPayload): StructuredClaim {
  return { ...goodClaim(user), unit: "SSA-099" };
}

export const reply = (claims: StructuredClaim[]): string => JSON.stringify({ claims });
