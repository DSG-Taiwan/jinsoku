import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export interface PresenceRow {
  actor_key: string;
  state: "on_site" | "off_site" | "report";
  ts: string;
}

const assets: AssetRow[] = [
  { asset_id: "SSA-001", model: "RTU-12", location: "roof-n1", zone: "North" },
  { asset_id: "SSA-002", model: "BLR-4", location: "plant-e1", zone: "East" },
  { asset_id: "SSA-003", model: "AHU-9", location: "wing-s1", zone: "South" },
  { asset_id: "SSA-004", model: "FCU-2", location: "room-w1", zone: "West" },
  { asset_id: "SSA-005", model: "RTU-8", location: "roof-n2", zone: "North" },
  { asset_id: "SSA-006", model: "AHU-3", location: "wing-e1", zone: "East" },
  { asset_id: "SSA-007", model: "BLR-2", location: "plant-s1", zone: "South" },
  { asset_id: "SSA-008", model: "FCU-6", location: "room-w2", zone: "West" },
  { asset_id: "SSA-009", model: "RTU-15", location: "roof-e1", zone: "East" },
  { asset_id: "SSA-010", model: "AHU-1", location: "wing-n1", zone: "North" },
  { asset_id: "SSA-011", model: "FCU-4", location: "room-s2", zone: "South" },
  { asset_id: "SSA-012", model: "BLR-1", location: "plant-w1", zone: "West" },
];

const story: Omit<IssueRow, "issue_id">[] = [
  { asset_id: "SSA-001", kind: "OOS", opened_at: "2026-09-02", closed_at: "2026-09-03", reason: "intake filter packed with dust", actor_key: "ACT-17", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-001", kind: "OOS", opened_at: "2026-09-16", closed_at: "2026-09-17", reason: "same filter bypass, coil iced", actor_key: "ACT-11", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-001", kind: "OOS", opened_at: "2026-09-30", closed_at: "2026-10-01", reason: "coil iced after filter change", actor_key: "ACT-17", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-001", kind: "MICROFIX", opened_at: "2026-10-14", closed_at: "2026-10-14", reason: "filter swap only", actor_key: "ACT-11", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-001", kind: "OOS", opened_at: "2026-10-20", closed_at: "2026-10-20", reason: "reset only, filter still packed", actor_key: "ACT-23", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-002", kind: "HAZARD", opened_at: "2026-10-15", closed_at: null, reason: "high-limit trip, still open", actor_key: "ACT-23", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-002", kind: "OOS", opened_at: "2026-09-08", closed_at: "2026-09-09", reason: "ignition lockout", actor_key: "ACT-23", fix_outcome: "held" },
  { asset_id: "SSA-004", kind: "OOS", opened_at: "2026-09-08", closed_at: "2026-09-09", reason: "belt slip", actor_key: "ACT-23", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-004", kind: "OOS", opened_at: "2026-09-22", closed_at: "2026-09-23", reason: "belt slip again", actor_key: "ACT-23", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-004", kind: "MICROFIX", opened_at: "2026-10-06", closed_at: "2026-10-07", reason: "belt tension tweak", actor_key: "ACT-23", fix_outcome: "held" },
  { asset_id: "SSA-009", kind: "HAZARD", opened_at: "2026-10-18", closed_at: null, reason: "freeze-stat open, unit offline", actor_key: "ACT-17", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-003", kind: "OOS", opened_at: "2026-10-12", closed_at: "2026-10-13", reason: "damper stuck", actor_key: "ACT-31", fix_outcome: "held" },
  { asset_id: "SSA-005", kind: "MICROFIX", opened_at: "2026-10-19", closed_at: "2026-10-19", reason: "sensor drift trim", actor_key: "ACT-11", fix_outcome: "held" },
  { asset_id: "SSA-006", kind: "OOS", opened_at: "2026-10-13", closed_at: "2026-10-14", reason: "condensate pan full", actor_key: "ACT-31", fix_outcome: "held" },
  { asset_id: "SSA-007", kind: "OOS", opened_at: "2026-10-21", closed_at: null, reason: "no airflow, belt check pending", actor_key: "ACT-11", fix_outcome: "did_not_hold" },
  { asset_id: "SSA-010", kind: "MICROFIX", opened_at: "2026-10-16", closed_at: "2026-10-16", reason: "thermostat offset", actor_key: "ACT-17", fix_outcome: "held" },
  { asset_id: "SSA-008", kind: "OOS", opened_at: "2026-09-11", closed_at: "2026-09-11", reason: "fan wheel loose", actor_key: "ACT-31", fix_outcome: "held" },
  { asset_id: "SSA-011", kind: "OOS", opened_at: "2026-10-02", closed_at: "2026-10-03", reason: "drain line slow", actor_key: "ACT-11", fix_outcome: "held" },
  { asset_id: "SSA-012", kind: "MICROFIX", opened_at: "2026-10-09", closed_at: "2026-10-09", reason: "contactor buzz", actor_key: "ACT-23", fix_outcome: "held" },
];

const fillerAssets = ["SSA-003", "SSA-005", "SSA-006", "SSA-007", "SSA-008", "SSA-010", "SSA-011", "SSA-012"];
const fillerReasons = ["blower noise", "damper lag", "sensor drift", "drain line slow", "thermostat offset", "fan wheel loose"];
const actors = ["ACT-11", "ACT-17", "ACT-23", "ACT-31"];
const start = new Date("2026-09-04T00:00:00Z");
const filler: Omit<IssueRow, "issue_id">[] = [];
for (let i = 0; i < 54; i++) {
  const day = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);
  const opened = day.toISOString().slice(0, 10);
  if (opened > "2026-10-21") break;
  const asset = fillerAssets[i % fillerAssets.length];
  const kind = i % 11 === 0 ? "MICROFIX" : "OOS";
  const outcome = i % 5 === 0 ? "did_not_hold" : "held";
  const closed = opened <= "2026-10-20" ? opened : null;
  filler.push({
    asset_id: asset,
    kind,
    opened_at: opened,
    closed_at: closed,
    reason: fillerReasons[i % fillerReasons.length],
    actor_key: actors[i % actors.length],
    fix_outcome: outcome,
  });
}

const issues: IssueRow[] = [...story, ...filler].map((row, i) => ({
  issue_id: `ISS-${String(i + 1).padStart(3, "0")}`,
  ...row,
}));

const presence: PresenceRow[] = [];
for (const row of issues.slice(0, 24)) {
  presence.push({ actor_key: row.actor_key, state: "on_site", ts: `${row.opened_at}T08:00:00Z` });
  presence.push({ actor_key: row.actor_key, state: "report", ts: `${row.opened_at}T09:30:00Z` });
  if (row.closed_at) presence.push({ actor_key: row.actor_key, state: "off_site", ts: `${row.closed_at}T16:00:00Z` });
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "data", "synthetic");
const serve = path.join(dir, "csv");
fs.mkdirSync(serve, { recursive: true });
fs.writeFileSync(path.join(dir, "assets.json"), JSON.stringify(assets, null, 2));
fs.writeFileSync(path.join(dir, "issues.json"), JSON.stringify(issues, null, 2));
fs.writeFileSync(path.join(dir, "presence.json"), JSON.stringify(presence, null, 2));
fs.writeFileSync(path.join(serve, "assets.json"), JSON.stringify({ rows: assets }));
fs.writeFileSync(path.join(serve, "issues.json"), JSON.stringify({ rows: issues }));
fs.writeFileSync(path.join(serve, "presence.json"), JSON.stringify({ rows: presence }));
process.stdout.write(`assets=${assets.length} issues=${issues.length} presence=${presence.length}\n`);
