import type { Finding, RetrievedSource } from "../schemas.ts";
import { rowsOf, type IssueRecord } from "./hazard-block.ts";

/**
 * Proof of concept. Deterministic precursor flags, decided in code from the retrieved issue rows. A flag cites the rows
 * that triggered it. It is a flag for a human, never a probability, and no model is involved.
 * Rule 1 is the engine owner's own rule: three fixes that did not hold on one unit escalate it to a lead for human analysis.
 * Rule 2 is a DRAFT precursor from general HVAC practice (repeating airflow fixes plus coil icing). It is labeled as not validated.
 */
export const ESCALATION_THRESHOLD = 3;
const AIRFLOW = /\b(filter|airflow|bypass)\b/i;
const ICING = /\b(ice|iced|icing)\b/i;

interface Found {
  /** Every source that carries rows for this asset; flags and notes cite all of them. */
  sourceIds: string[];
  rows: IssueRecord[];
  conflicts: string[];
  repeats: { id: string; times: number }[];
}

export const sameRecord = (a: IssueRecord, b: IssueRecord): boolean =>
  a.asset_id === b.asset_id && a.kind === b.kind && a.opened_at === b.opened_at && a.actor_key === b.actor_key && a.fix_outcome === b.fix_outcome && a.reason === b.reason;

/**
 * One row per incident. A repeated identical row is the same incident, not more evidence. Rows that share an issue id but disagree
 * are a data conflict: no row is picked, the id counts toward no flag, and the conflict is reported.
 */
function resolve(rows: IssueRecord[], asset: string): { rows: IssueRecord[]; conflicts: string[]; repeats: { id: string; times: number }[] } {
  const byId = new Map<string, IssueRecord[]>();
  for (const row of rows) byId.set(row.issue_id, [...(byId.get(row.issue_id) ?? []), row]);
  const clean: IssueRecord[] = [];
  const conflicts: string[] = [];
  const repeats: { id: string; times: number }[] = [];
  for (const [id, group] of byId) {
    if (!group.some((row) => row.asset_id === asset)) continue;
    if (group.every((row) => sameRecord(row, group[0]))) {
      clean.push(group[0]);
      if (group.length > 1) repeats.push({ id, times: group.length });
    } else conflicts.push(id);
  }
  return { rows: clean, conflicts: conflicts.sort(), repeats: repeats.sort((a, b) => a.id.localeCompare(b.id)) };
}

/** Issue rows from every retrieved incident source are resolved together, so a conflict or repeat across sources is seen. The open-HAZARD and historical summaries are views over the same rows and are left out. */
export const isIssueSource = (source: RetrievedSource): boolean =>
  source.kind === "zetaris" && !source.summary.startsWith("Open HAZARD rows") && !source.summary.startsWith("Historical") && !source.summary.startsWith("Data quality:");

function issueRowsFor(retrieved: RetrievedSource[], asset: string): Found | null {
  // Every incident source is read before any asset filter, so a conflicting version of an id that sits in another asset's source is seen.
  const perSource = retrieved.filter(isIssueSource).map((source) => ({ id: source.id, rows: rowsOf(source) }));
  const all = perSource.flatMap((entry) => entry.rows);
  const resolved = resolve(all, asset);
  const relevant = new Set([...resolved.rows.map((row) => row.issue_id), ...resolved.conflicts]);
  const sourceIds = perSource.filter((entry) => entry.rows.some((row) => relevant.has(row.issue_id))).map((entry) => entry.id);
  if (sourceIds.length === 0) return null;
  return { sourceIds, ...resolved };
}

const ids = (rows: IssueRecord[]): string => [...new Set(rows.map((row) => row.issue_id))].sort().join(", ");

export function precursorFindings(retrieved: RetrievedSource[], asset?: string): Finding[] {
  if (!asset) return [];
  const found = issueRowsFor(retrieved, asset);
  if (!found) return [];
  const failed = found.rows.filter((row) => row.fix_outcome === "did_not_hold");
  const flags: Finding[] = [];
  if (found.conflicts.length > 0) {
    flags.push({
      claim: `Data conflict: ${found.conflicts.join(", ")} appear${found.conflicts.length === 1 ? "s" : ""} in the retrieved rows with differing records. ${found.conflicts.length === 1 ? "It is" : "They are"} not counted toward any flag. A human checks the source.`,
      evidence_ids: found.sourceIds,
    });
  }
  if (found.repeats.length > 0) {
    const list = found.repeats.map((r) => `${r.id} (${r.times} times)`).join(", ");
    flags.push({
      claim: `Data note: ${list} appear${found.repeats.length === 1 ? "s" : ""} more than once in the retrieved rows with identical records. Each is counted once.`,
      evidence_ids: found.sourceIds,
    });
  }
  if (failed.length >= ESCALATION_THRESHOLD) {
    flags.push({
      claim: `Escalation flag: ${asset} has ${failed.length} fixes that did not hold (${ids(failed)}). The rule is ${ESCALATION_THRESHOLD}. Propose an escalation to a lead for human analysis.`,
      evidence_ids: found.sourceIds,
    });
  }
  const airflowFailed = failed.filter((row) => AIRFLOW.test(row.reason));
  const icing = found.rows.filter((row) => ICING.test(row.reason));
  if (airflowFailed.length >= 2 && icing.length >= 1) {
    flags.push({
      claim: `Pattern flag: ${asset} shows airflow fixes that did not hold (${ids(airflowFailed)}) and coil icing (${ids(icing)}). This matches a draft precursor rule for compressor damage (general HVAC practice, not validated). Propose a lead's analysis.`,
      evidence_ids: found.sourceIds,
    });
  }
  return flags;
}

/** A flag, as opposed to a data note or conflict. Only a flag may change the recommended next check. */
export const isPrecursorFlag = (finding: Finding): boolean => /^(Escalation|Pattern) flag/.test(finding.claim);
