/**
 * Typed check of one retrieved incident row before it is turned into text. A row that fails is quarantined and reported,
 * never listed and never silently dropped. The report never repeats the row's own text: an invalid label is shown by its
 * position only, so a diagnostic cannot carry a record-shaped string back into the pipeline.
 */
const KINDS = new Set(["OOS", "HAZARD", "MICROFIX"]);
const OUTCOMES = new Set(["held", "did_not_hold"]);

export type RowQuery = "issue" | "hazard";

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The first problem with a row, or null when the row is well formed. */
export function rowProblem(row: Record<string, string>): string | null {
  if (!/^ISS-\d+$/.test(row.issue_id ?? "")) return "issue_id is not an ISS id";
  if (!/^SSA-\d+$/.test(row.asset_id ?? "")) return "asset_id is not an SSA id";
  if (!KINDS.has(row.kind ?? "")) return "kind is not a recognized kind";
  if (!isCalendarDate(row.opened_at ?? "")) return "opened_at is not a calendar date";
  if (!/^ACT-\d+$/.test(row.actor_key ?? "")) return "actor_key is not an ACT id";
  if (!OUTCOMES.has(row.fix_outcome ?? "")) return "fix_outcome is not a recognized outcome";
  if (!(row.reason ?? "").trim()) return "reason is empty";
  return null;
}

export interface QuarantinedRow {
  query: RowQuery;
  /** 1-based position of the row within its query result. */
  position: number;
  /** Only an id that is itself a well-formed ISS id; anything else is withheld from the report. */
  issue_id: string | null;
  /** True for every excluded row of the hazard query, and for any excluded row whose kind looks like a hazard, whatever its spelling. */
  hazard: boolean;
  problem: string;
}

export function partitionRows(rows: Record<string, string>[], query: RowQuery): { valid: Record<string, string>[]; quarantined: QuarantinedRow[] } {
  const valid: Record<string, string>[] = [];
  const quarantined: QuarantinedRow[] = [];
  rows.forEach((row, index) => {
    const problem = rowProblem(row);
    if (!problem) {
      valid.push(row);
      return;
    }
    quarantined.push({
      query,
      position: index + 1,
      issue_id: /^ISS-\d+$/.test(row.issue_id ?? "") ? row.issue_id : null,
      hazard: query === "hazard" || /hazard/i.test(row.kind ?? ""),
      problem,
    });
  });
  return { valid, quarantined };
}

/** One cited finding text for the rows that were excluded: per-query counts, each excluded row by position, no echo of the row's own text. */
export function qualitySummary(quarantined: QuarantinedRow[], totals: Record<RowQuery, number>): string {
  const counts = (["issue", "hazard"] as const)
    .map((query) => ({ query, bad: quarantined.filter((row) => row.query === query).length }))
    .filter((entry) => entry.bad > 0)
    .map((entry) => `${entry.query} query ${entry.bad} of ${totals[entry.query]}`)
    .join("; ");
  const listed = quarantined
    .map((row) => `${row.query} query row ${row.position}${row.issue_id ? ` (${row.issue_id})` : " (id withheld)"}: ${row.problem}`)
    .join("; ");
  const hazard = quarantined.some((row) => row.hazard)
    ? " A hazard row is among them, so a human checks the source before treating that asset as free of hazards."
    : "";
  return `Data quality: ${quarantined.length} retrieved incident rows were excluded and are not counted (${counts}): ${listed}.${hazard}`;
}
