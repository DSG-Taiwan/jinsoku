import type { Finding, RetrievedSource } from "../schemas.ts";

const ACTOR = /^ACT-\d+$/;
const ROW =
  /^(ISS-\d+) (SSA-\d+) (OOS|HAZARD|MICROFIX) (\d{4}-\d{2}-\d{2}) (ACT-\d+) (held|did_not_hold) (.+)$/;
const UNIT = /Unit (SSA-\d+)\b[\s\S]*?Open HAZARD count (\d+)/gi;

export interface IssueRecord {
  issue_id: string;
  asset_id: string;
  kind: string;
  opened_at: string;
  actor_key: string;
  fix_outcome: string;
  reason: string;
}

export interface HazardFact extends IssueRecord {
  zetaris_id: string;
  world_id: string;
  /** The same issue id appears in the retrieved rows with differing records; this is one of those records, stated as retrieved. */
  conflict?: boolean;
}

/** The incident rows of a source: the typed rows when the source carries them, otherwise the rows parsed from its text. */
export function rowsOf(source: { summary: string; rows?: IssueRecord[] }): IssueRecord[] {
  return source.rows ?? parseIssueRows(source.summary);
}

export function blankClosedAt(value: string | null | undefined): boolean {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "" || text === "null" || text === "none";
}

/** Whole incident rows only. A non-pseudonymous actor id is dropped. */
export function parseIssueRows(summary: string): IssueRecord[] {
  const rows: IssueRecord[] = [];
  for (const part of summary.split(";")) {
    const match = ROW.exec(part.trim());
    if (!match || !ACTOR.test(match[5])) continue;
    rows.push({
      issue_id: match[1],
      asset_id: match[2],
      kind: match[3],
      opened_at: match[4],
      actor_key: match[5],
      fix_outcome: match[6],
      reason: match[7].trim(),
    });
  }
  return rows;
}

export function worldHazardCounts(retrieved: RetrievedSource[]): Map<string, { count: number; id: string }> {
  const counts = new Map<string, { count: number; id: string }>();
  for (const source of retrieved) {
    if (source.kind !== "worldmodel") continue;
    UNIT.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = UNIT.exec(source.summary))) {
      counts.set(match[1], { count: Number(match[2]), id: source.id });
    }
  }
  return counts;
}

const sameRow = (a: IssueRecord, b: IssueRecord): boolean =>
  a.asset_id === b.asset_id && a.kind === b.kind && a.opened_at === b.opened_at && a.actor_key === b.actor_key && a.fix_outcome === b.fix_outcome && a.reason === b.reason;

interface IssueVariants {
  issue_id: string;
  /** zetaris_ids lists every retrieved source that carries this exact row. */
  variants: { row: IssueRecord; zetaris_id: string; zetaris_ids: string[] }[];
}

/** Every distinct retrieved row per issue id, in retrieval order. Identical repeats are one row; differing rows are all kept. */
function variantsById(retrieved: RetrievedSource[]): IssueVariants[] {
  const byId = new Map<string, IssueVariants>();
  for (const source of retrieved) {
    if (source.kind !== "zetaris") continue;
    for (const row of rowsOf(source)) {
      const entry = byId.get(row.issue_id) ?? { issue_id: row.issue_id, variants: [] };
      const same = entry.variants.find((variant) => sameRow(variant.row, row));
      if (same) {
        if (!same.zetaris_ids.includes(source.id)) same.zetaris_ids.push(source.id);
      } else entry.variants.push({ row, zetaris_id: source.id, zetaris_ids: [source.id] });
      byId.set(row.issue_id, entry);
    }
  }
  return [...byId.values()];
}

/**
 * An open HAZARD is confirmed only when a retrieved Zetaris row has kind HAZARD
 * and the retrieved World Model count for that asset is at least 1.
 * When one issue id appears with differing rows, no row is preferred: every HAZARD row is stated as retrieved and marked conflict.
 */
export function confirmedOpenHazards(retrieved: RetrievedSource[]): HazardFact[] {
  const worlds = worldHazardCounts(retrieved);
  const facts: HazardFact[] = [];
  for (const entry of variantsById(retrieved)) {
    const conflict = entry.variants.length > 1;
    for (const { row, zetaris_id } of entry.variants) {
      if (row.kind !== "HAZARD") continue;
      const world = worlds.get(row.asset_id);
      if (!world || world.count < 1) continue;
      facts.push({ ...row, zetaris_id, world_id: world.id, ...(conflict ? { conflict: true } : {}) });
    }
  }
  return facts;
}

/** One finding per conflicted open HAZARD id, listing every retrieved version. Pending human attention; nothing is chosen. */
function hazardConflictFindings(retrieved: RetrievedSource[], facts: HazardFact[]): Finding[] {
  const findings: Finding[] = [];
  for (const entry of variantsById(retrieved)) {
    const confirmed = facts.filter((fact) => fact.issue_id === entry.issue_id && fact.conflict);
    if (confirmed.length === 0) continue;
    const listed = entry.variants
      .map(({ row }, i) => `Version ${i + 1}: ${row.issue_id} ${row.asset_id} ${row.kind} opened ${row.opened_at} actor ${row.actor_key} ${row.fix_outcome} reason ${row.reason}.`)
      .join(" ");
    findings.push({
      claim: `Data conflict: ${entry.issue_id} appears in the retrieved rows with differing records. ${listed} All versions are stated as retrieved and the HAZARD stays open pending human attention.`,
      evidence_ids: [...new Set([...entry.variants.flatMap((variant) => variant.zetaris_ids), ...confirmed.map((fact) => fact.world_id)])],
    });
  }
  return findings;
}

export function hazardClaimSentence(fact: HazardFact): string {
  return `${fact.issue_id} ${fact.asset_id} HAZARD opened ${fact.opened_at} actor ${fact.actor_key} ${fact.fix_outcome} reason ${fact.reason} and stays open for a human.`;
}

/** Code-owned block. Callers append it after the model text so the model cannot omit or rewrite it. */
export function hazardBlockFindings(retrieved: RetrievedSource[]): Finding[] {
  const facts = confirmedOpenHazards(retrieved);
  if (facts.length > 0) {
    return [
      ...facts.map((fact) => ({
        claim: hazardClaimSentence(fact),
        evidence_ids: [fact.zetaris_id, fact.world_id],
      })),
      ...hazardConflictFindings(retrieved, facts),
    ];
  }
  const worlds = [...worldHazardCounts(retrieved).values()];
  if (worlds.length === 0 || worlds.some((item) => item.count > 0)) return [];
  return [{ claim: "Open HAZARD count 0.", evidence_ids: [worlds[0].id] }];
}

/**
 * A positive open-HAZARD claim for an asset the retrieved Zetaris row and World Model
 * count do not both show. "Open HAZARD count 0" is not a positive claim.
 */
export function inventedOpenHazard(text: string, retrieved: RetrievedSource[]): string | null {
  const allowed = new Set(confirmedOpenHazards(retrieved).map((fact) => fact.asset_id));
  for (const sentence of text.split(/[.!?\n;]+/)) {
    if (!/\bhazard\b/i.test(sentence) || !/\bopen\b/i.test(sentence)) continue;
    if (/open hazard count(?:\s+of)?\s+0\b/i.test(sentence)) continue;
    const assets = [...sentence.matchAll(/\bSSA-\d+\b/gi)].map((match) => match[0].toUpperCase());
    const positiveCount = /open hazard count(?:\s+of)?\s+[1-9]/i.test(sentence);
    const namesHazard = /\bopen hazard\b/i.test(sentence) || (/\bhazard\b/i.test(sentence) && /\bopen\b/i.test(sentence));
    if (!namesHazard && !positiveCount) continue;
    if (assets.length === 0) {
      if (positiveCount && allowed.size === 0) return "invented open HAZARD";
      continue;
    }
    for (const asset of assets) {
      if (!allowed.has(asset)) return `invented open HAZARD ${asset}`;
    }
  }
  return null;
}
