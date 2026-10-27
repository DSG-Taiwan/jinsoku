import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../config.ts";
import { parseDateRange, type Period } from "../schemas.ts";

export interface AssetRow {
  asset_id: string;
  model: string;
  location: string;
  zone: string;
}

export interface IssueRow {
  issue_id: string;
  asset_id: string;
  kind: "OOS" | "HAZARD" | "MICROFIX";
  opened_at: string;
  closed_at: string | null;
  reason: string;
  actor_key: string;
  fix_outcome: "held" | "did_not_hold";
}

function loadJson<T>(rel: string): T {
  const full = path.join(PROJECT_ROOT, rel);
  return JSON.parse(fs.readFileSync(full, "utf8")) as T;
}

export interface PresenceRow {
  actor_key: string;
  state: "on_site" | "off_site" | "report";
  ts: string;
}

export const ASSETS: AssetRow[] = loadJson("data/synthetic/assets.json");
export const ISSUES: IssueRow[] = loadJson("data/synthetic/issues.json");
export const PRESENCE: PresenceRow[] = loadJson("data/synthetic/presence.json");
export const ASSET_IDS = ASSETS.map((a) => a.asset_id);

export const ISSUE_COLUMNS = [
  "issue_id",
  "asset_id",
  "kind",
  "opened_at",
  "closed_at",
  "reason",
  "actor_key",
  "fix_outcome",
] as const;

const ISSUE_COLS = ISSUE_COLUMNS.join(", ");

function lit(s: string): string {
  return `'${s.replace(/'/g, "")}'`;
}

function knownAsset(assetId: string): boolean {
  return ASSET_IDS.includes(assetId);
}

/** SELECT-only against the loaded hvac tables. Literals are catalog ids or fixed week bounds. */
export function issuesSelect(opts: {
  assetId?: string;
  from?: string;
  to?: string;
  outcome?: "did_not_hold";
  openHazard?: boolean;
}): string {
  if (opts.openHazard) {
    if (opts.assetId && !knownAsset(opts.assetId)) return `SELECT ${ISSUE_COLS} FROM hvac.issues WHERE 1 = 0`;
    const asset = opts.assetId ? ` AND asset_id = ${lit(opts.assetId)}` : "";
    return `SELECT ${ISSUE_COLS} FROM hvac.issues WHERE kind = 'HAZARD'${asset}`;
  }
  if (opts.outcome === "did_not_hold") {
    return `SELECT ${ISSUE_COLS} FROM hvac.issues WHERE fix_outcome = 'did_not_hold'`;
  }
  if (opts.assetId) {
    if (!knownAsset(opts.assetId)) return `SELECT ${ISSUE_COLS} FROM hvac.issues WHERE 1 = 0`;
    return `SELECT ${ISSUE_COLS} FROM hvac.issues WHERE asset_id = ${lit(opts.assetId)}`;
  }
  if (opts.from && opts.to) {
    return `SELECT ${ISSUE_COLS} FROM hvac.issues WHERE opened_at >= ${lit(opts.from)} AND opened_at <= ${lit(opts.to)}`;
  }
  return `SELECT ${ISSUE_COLS} FROM hvac.issues WHERE 1 = 0`;
}

export function assetsSelect(assetId?: string): string {
  if (assetId && knownAsset(assetId)) {
    return `SELECT asset_id, model, location, zone FROM hvac.assets WHERE asset_id = ${lit(assetId)}`;
  }
  return "SELECT asset_id, model, location, zone FROM hvac.assets";
}

/** D2 clock: window opens 2026-10-21. thisweek = Mon 19–Wed 21. lastweek = Mon 12–Sun 18. */
export function weekBounds(period: Period): { from: string; to: string } {
  if (period === "thisweek") return { from: "2026-10-19", to: "2026-10-21" };
  if (period === "lastweek") return { from: "2026-10-12", to: "2026-10-18" };
  const range = parseDateRange(period);
  if (!range) throw new Error(`not a period: ${period}`);
  return range;
}

/** The first and last day the data covers. A range outside it has nothing to search. */
export function dataWindow(): { from: string; to: string } {
  const dates = ISSUES.map((row) => row.opened_at).filter(Boolean).sort();
  return { from: dates[0], to: dates[dates.length - 1] };
}

export function coachingLines(rows: { asset_id?: string; actor_key?: string; issue_id?: string; fix_outcome?: string; opened_at?: string }[]): string[] {
  const misses = rows.filter((row) => row.fix_outcome === "did_not_hold" && row.actor_key && row.asset_id && row.issue_id);
  const lines: string[] = [];
  const byActor = new Map<string, typeof misses>();
  for (const row of misses) {
    const list = byActor.get(row.actor_key!) ?? [];
    list.push(row);
    byActor.set(row.actor_key!, list);
  }
  for (const [actor, group] of byActor) {
    if (group.length < 2) continue;
    lines.push(
      `${actor}: fixes did not hold on ${group
        .slice(0, 4)
        .map((row) => `${row.issue_id} ${row.asset_id} opened ${row.opened_at}`)
        .join(", ")}.`,
    );
  }
  const byAsset = new Map<string, Set<string>>();
  for (const row of misses) {
    const actors = byAsset.get(row.asset_id!) ?? new Set<string>();
    actors.add(row.actor_key!);
    byAsset.set(row.asset_id!, actors);
  }
  for (const [asset, actors] of byAsset) {
    if (actors.size >= 2) lines.push(`${asset} failed under ${[...actors].join(" and ")}; the unit may be at fault.`);
  }
  return lines.slice(0, 6);
}

export function memoryFacts(): { content: string; tags: string[] }[] {
  return ISSUES.map((row) => ({
    content:
      row.kind === "HAZARD"
        ? `D3 synthetic incident ${row.issue_id} on ${row.asset_id}: kind HAZARD, opened ${row.opened_at}, actor ${row.actor_key}, fix_outcome ${row.fix_outcome}, reason ${row.reason}. This HAZARD stays open for a human.`
        : `D3 synthetic incident ${row.issue_id} on ${row.asset_id}: kind ${row.kind}, opened ${row.opened_at}, actor ${row.actor_key}, fix_outcome ${row.fix_outcome}, reason ${row.reason}.`,
    tags: [row.asset_id, row.kind, row.issue_id],
  }));
}
