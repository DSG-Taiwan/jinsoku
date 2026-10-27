import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT } from "../src/config.ts";

/** Evaluation clock. Same dates as the D2 clock in src/data/seed.ts. */
export const CLOCK = {
  thisweek: { from: "2026-10-19", to: "2026-10-21" },
  lastweek: { from: "2026-10-12", to: "2026-10-18" },
} as const;

export type Period = keyof typeof CLOCK;

const STOP = new Set([
  "only",
  "still",
  "after",
  "again",
  "with",
  "from",
  "this",
  "that",
  "same",
  "into",
  "have",
  "were",
  "unit",
  "open",
]);

export interface IssueFact {
  issue_id: string;
  asset_id: string;
  kind: "OOS" | "HAZARD" | "MICROFIX";
  opened_at: string;
  closed_at: string | null;
  reason: string;
  actor_key: string;
  fix_outcome: "held" | "did_not_hold";
  source: "issues" | "sequence";
  unresolved: boolean;
}

export interface AssetFacts {
  asset_id: string;
  issues: IssueFact[];
  chain: IssueFact[];
  did_not_hold: IssueFact[];
  repeat_tokens: string[];
  reasons_distinct: boolean;
  open_hazards: IssueFact[];
  next: {
    event: IssueFact;
    because: "unresolved" | "repeating-kind" | "latest";
    repeating_kinds: string[];
  };
}

export interface Group {
  id: string;
  all?: string[];
  any?: string[];
  pattern?: string;
  reasons_at_least?: { n: number; reasons: string[] };
  actors_at_least?: { n: number; actors: string[] };
  /** sentence: every listed string and the pattern must sit in one sentence. */
  scope?: "text" | "sentence";
}

export interface Forbid {
  id: string;
  pattern?: string;
  all?: string[];
  scope: "text" | "sentence";
}

export interface CaseSpec {
  id: string;
  query: string;
  role: "lead" | "tech";
  phrase: "CAUSE" | "PATTERNS" | "NEXT" | "refusal";
  expect: "answer" | "refusal";
  status?: "UNPROCESSED" | "DENIED";
  reason_code?: string;
  asset?: string;
  period?: Period;
  require: Group[];
  partial_min: number;
  forbid: Forbid[];
  allow_issue_ids: string[];
  allow_actors: string[];
  allow_assets: string[];
  open_hazard_count: number;
  contradict_held_ids: string[];
}

interface RawIssue {
  issue_id: string;
  asset_id: string;
  kind: "OOS" | "HAZARD" | "MICROFIX";
  opened_at: string;
  closed_at: string | null;
  reason: string;
  actor_key: string;
  fix_outcome: "held" | "did_not_hold";
}

interface SeqRow {
  issue_id: string;
  opened_at: string;
  kind: "OOS" | "HAZARD" | "MICROFIX";
  actor_key: string;
  fix_outcome: "held" | "did_not_hold";
  note: string;
}

const RULES = {
  clock:
    "thisweek is opened_at from 2026-10-19 through 2026-10-21 inclusive. lastweek is opened_at from 2026-10-12 through 2026-10-18 inclusive.",
  open_hazard:
    "An open HAZARD is an issues.json row with kind HAZARD and closed_at null. A sequence row with kind HAZARD would also count as open. This dataset has none.",
  unresolved:
    "An issues.json row is unresolved when closed_at is null, or fix_outcome is did_not_hold, or kind is HAZARD. A sequence row is unresolved when fix_outcome is did_not_hold or kind is HAZARD.",
  repeating_kind: "A kind repeats when that kind string occurs at least twice on the asset in the chain used for the question.",
  next_check:
    "Merge issues.json with incident-sequences.json for the asset. Sort by opened_at descending, then issue_id descending. The next check is the newest unresolved event. If none are unresolved, it is the newest event whose kind repeats. If none repeat, it is the newest event.",
  cause_chain:
    "CAUSE facts use issues.json only. incident-sequences.json is a NEXT source and is not a CAUSE source.",
  repeat_cause:
    "A clear repeat is two or more did_not_hold rows on the asset that share a token. Tokens are lowercase pieces of length 4 or more, split on non-letters, excluding only, still, after, again, with, from, this, that, same, into, have, were, unit, and open.",
  reasons_distinct:
    "Reason strings are distinct when the lowercased trimmed reasons on the asset's issues.json rows are not all the same. Distinct reasons make 'same reason' and 'same cause' a wrong claim.",
  patterns:
    "A period's labeled failures are the issues.json rows opened in that window with fix_outcome did_not_hold. Open HAZARD rows stay in the pattern answer even when they opened outside the window. A held issue id named in the same sentence as did_not_hold is a contradiction.",
};

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8")) as T;
}

export function tokens(reason: string): string[] {
  return reason
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part.length >= 4 && !STOP.has(part));
}

function issueUnresolved(row: RawIssue): boolean {
  return row.closed_at == null || row.fix_outcome === "did_not_hold" || row.kind === "HAZARD";
}

function sequenceUnresolved(row: SeqRow): boolean {
  return row.fix_outcome === "did_not_hold" || row.kind === "HAZARD";
}

function byRecent(a: IssueFact, b: IssueFact): number {
  return b.opened_at.localeCompare(a.opened_at) || b.issue_id.localeCompare(a.issue_id);
}

export function loadFacts(): { assets: AssetFacts[]; issues: IssueFact[]; openHazards: IssueFact[] } {
  const raw = readJson<RawIssue[]>("data/synthetic/issues.json");
  const sequences = readJson<Record<string, SeqRow[]>>("data/synthetic/incident-sequences.json");
  const assetIds = readJson<{ asset_id: string }[]>("data/synthetic/assets.json").map((row) => row.asset_id);
  const issues: IssueFact[] = raw.map((row) => ({
    issue_id: row.issue_id,
    asset_id: row.asset_id,
    kind: row.kind,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    reason: row.reason,
    actor_key: row.actor_key,
    fix_outcome: row.fix_outcome,
    source: "issues",
    unresolved: issueUnresolved(row),
  }));
  const assets: AssetFacts[] = assetIds.map((assetId) => {
    const own = issues.filter((row) => row.asset_id === assetId);
    const extra: IssueFact[] = (sequences[assetId] ?? []).map((row) => ({
      issue_id: row.issue_id,
      asset_id: assetId,
      kind: row.kind,
      opened_at: row.opened_at,
      closed_at: null,
      reason: row.note,
      actor_key: row.actor_key,
      fix_outcome: row.fix_outcome,
      source: "sequence" as const,
      unresolved: sequenceUnresolved(row),
    }));
    const chain = [...own, ...extra].sort((a, b) => a.opened_at.localeCompare(b.opened_at) || a.issue_id.localeCompare(b.issue_id));
    const didNotHold = own.filter((row) => row.fix_outcome === "did_not_hold");
    const counts = new Map<string, number>();
    for (const row of didNotHold) {
      for (const token of new Set(tokens(row.reason))) counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    const repeatTokens = [...counts.entries()]
      .filter(([, n]) => n >= 2)
      .map(([token]) => token)
      .sort();
    const reasonSet = new Set(own.map((row) => row.reason.trim().toLowerCase()));
    const openHazards = own.filter((row) => row.kind === "HAZARD" && row.closed_at == null);
    const kindCounts = new Map<string, number>();
    for (const row of chain) kindCounts.set(row.kind, (kindCounts.get(row.kind) ?? 0) + 1);
    const repeating = [...kindCounts.entries()].filter(([, n]) => n >= 2).map(([kind]) => kind).sort();
    const newestFirst = [...chain].sort(byRecent);
    const unresolved = newestFirst.find((row) => row.unresolved);
    const repeatingEvent = newestFirst.find((row) => repeating.includes(row.kind));
    const event = unresolved ?? repeatingEvent ?? newestFirst[0];
    if (!event) throw new Error(`no events for ${assetId}`);
    const because = unresolved ? "unresolved" : repeatingEvent ? "repeating-kind" : "latest";
    return {
      asset_id: assetId,
      issues: own,
      chain,
      did_not_hold: didNotHold,
      repeat_tokens: repeatTokens,
      reasons_distinct: reasonSet.size > 1,
      open_hazards: openHazards,
      next: { event, because, repeating_kinds: repeating },
    };
  });
  const openHazards = issues.filter((row) => row.kind === "HAZARD" && row.closed_at == null);
  return { assets, issues, openHazards };
}

export function inPeriod(openedAt: string, period: Period): boolean {
  const bounds = CLOCK[period];
  return openedAt >= bounds.from && openedAt <= bounds.to;
}

function outcomeGroup(row: IssueFact, id: string): Group {
  return {
    id,
    all: [row.issue_id, row.asset_id, row.actor_key, row.reason],
    pattern: "did[_ ]not[_ ]hold",
    scope: "sentence",
  };
}

function hazardGroup(rows: IssueFact[]): Group {
  return {
    id: "open-hazards",
    all: rows.flatMap((row) => [row.issue_id, row.asset_id, "HAZARD"]),
    pattern: "\\bopen\\b",
  };
}

function heldForbid(row: IssueFact): Forbid {
  return {
    id: `held-${row.issue_id}`,
    all: [row.issue_id],
    pattern: "did[_ ]not[_ ]hold",
    scope: "sentence",
  };
}

function sameReasonForbid(): Forbid {
  return { id: "same-reason", pattern: "\\bsame\\s+(reason|cause)\\b", scope: "text" };
}

function partialMin(groups: number): number {
  return Math.ceil(groups / 2);
}

export function caseSpecs(facts = loadFacts()): CaseSpec[] {
  const byAsset = new Map(facts.assets.map((asset) => [asset.asset_id, asset]));
  const asset = (id: string) => {
    const found = byAsset.get(id);
    if (!found) throw new Error(`missing ${id}`);
    return found;
  };
  const allIssueIds = facts.issues.map((row) => row.issue_id);
  const allActors = [...new Set(facts.issues.map((row) => row.actor_key))].sort();
  const allAssets = facts.assets.map((row) => row.asset_id);

  const causeRepeat = asset("SSA-004");
  const causeTrap = asset("SSA-001");
  const causeHazard = asset("SSA-009");
  const causeBoiler = asset("SSA-002");
  const nextHazard = asset("SSA-002");
  const nextBelt = asset("SSA-004");
  const nextOpen = asset("SSA-007");

  const repeatRequire: Group[] = [
    { id: "asset", all: [causeRepeat.asset_id] },
    { id: "iss-008", all: ["ISS-008", "belt slip"], pattern: "did[_ ]not[_ ]hold", scope: "sentence" },
    { id: "iss-009", all: ["ISS-009", "belt slip again"], pattern: "did[_ ]not[_ ]hold", scope: "sentence" },
    { id: "actor", all: ["ACT-23"] },
    { id: "repeat-tokens", all: causeRepeat.repeat_tokens },
  ];

  const trapRequire: Group[] = [
    { id: "asset", all: [causeTrap.asset_id] },
    {
      id: "two-reasons",
      reasons_at_least: { n: 2, reasons: causeTrap.issues.map((row) => row.reason) },
    },
    {
      id: "two-actors",
      actors_at_least: { n: 2, actors: [...new Set(causeTrap.issues.map((row) => row.actor_key))] },
    },
    { id: "outcome", pattern: "did[_ ]not[_ ]hold" },
  ];

  const hazardRequire: Group[] = [
    { id: "asset", all: ["SSA-009"] },
    { id: "issue", all: ["ISS-011"] },
    { id: "kind", all: ["HAZARD"] },
    { id: "open", pattern: "\\bopen\\b" },
    { id: "actor", all: ["ACT-17"] },
    { id: "reason", all: ["freeze-stat open, unit offline"] },
  ];

  function periodFailures(period: Period): IssueFact[] {
    return facts.issues.filter((row) => row.fix_outcome === "did_not_hold" && inPeriod(row.opened_at, period));
  }

  function periodHeld(period: Period): IssueFact[] {
    return facts.issues.filter((row) => row.fix_outcome === "held" && inPeriod(row.opened_at, period));
  }

  function patternSpec(period: Period): CaseSpec {
    const failures = periodFailures(period);
    const require = failures.map((row) => outcomeGroup(row, row.issue_id));
    if (period === "thisweek") require.push(hazardGroup(facts.openHazards));
    for (const row of failures.filter((item) => item.kind === "HAZARD")) {
      const group = require.find((item) => item.id === row.issue_id);
      if (group) group.all = [...new Set([...(group.all ?? []), "HAZARD"])];
    }
    return {
      id: `patterns-${period}`,
      query: `PATTERNS ${period}`,
      role: "lead",
      phrase: "PATTERNS",
      expect: "answer",
      period,
      require,
      partial_min: partialMin(require.length),
      forbid: periodHeld(period).map(heldForbid),
      allow_issue_ids: allIssueIds,
      allow_actors: allActors,
      allow_assets: allAssets,
      open_hazard_count: facts.openHazards.length,
      contradict_held_ids: periodHeld(period).map((row) => row.issue_id),
    };
  }

  function nextSpec(row: AssetFacts): CaseSpec {
    const next = row.next.event;
    const require: Group[] = [
      { id: "asset", all: [row.asset_id] },
      { id: "next-issue", all: [next.issue_id] },
      { id: "next-reason", all: [next.reason] },
      { id: "next-actor", all: [next.actor_key] },
    ];
    if (next.fix_outcome === "did_not_hold") require.push({ id: "outcome", pattern: "did[_ ]not[_ ]hold" });
    if (row.open_hazards.length > 0) require.push(hazardGroup(row.open_hazards));
    const forbid: Forbid[] = [];
    if (row.reasons_distinct) forbid.push(sameReasonForbid());
    const held = row.chain.filter((item) => item.fix_outcome === "held");
    forbid.push(...held.map(heldForbid));
    return {
      id: `next-${row.asset_id.toLowerCase()}`,
      query: `NEXT ${row.asset_id}`,
      role: "lead",
      phrase: "NEXT",
      expect: "answer",
      asset: row.asset_id,
      require,
      partial_min: partialMin(require.length),
      forbid,
      allow_issue_ids: row.chain.map((item) => item.issue_id),
      allow_actors: [...new Set(row.chain.map((item) => item.actor_key))].sort(),
      allow_assets: [row.asset_id],
      open_hazard_count: row.open_hazards.length,
      contradict_held_ids: held.map((item) => item.issue_id),
    };
  }

  const thisweek = patternSpec("thisweek");
  const lastweek = patternSpec("lastweek");

  return [
    {
      id: "cause-ssa-004",
      query: "CAUSE SSA-004",
      role: "lead",
      phrase: "CAUSE",
      expect: "answer",
      asset: "SSA-004",
      require: repeatRequire,
      partial_min: partialMin(repeatRequire.length),
      forbid: [sameReasonForbid(), heldForbid(causeRepeat.issues.find((row) => row.issue_id === "ISS-010")!)],
      allow_issue_ids: causeRepeat.issues.map((row) => row.issue_id),
      allow_actors: [...new Set(causeRepeat.issues.map((row) => row.actor_key))],
      allow_assets: ["SSA-004"],
      open_hazard_count: 0,
      contradict_held_ids: ["ISS-010"],
    },
    {
      id: "cause-ssa-001",
      query: "CAUSE SSA-001",
      role: "lead",
      phrase: "CAUSE",
      expect: "answer",
      asset: "SSA-001",
      require: trapRequire,
      partial_min: partialMin(trapRequire.length),
      forbid: [sameReasonForbid()],
      allow_issue_ids: causeTrap.issues.map((row) => row.issue_id),
      allow_actors: [...new Set(causeTrap.issues.map((row) => row.actor_key))],
      allow_assets: ["SSA-001"],
      open_hazard_count: 0,
      contradict_held_ids: [],
    },
    {
      id: "cause-ssa-009",
      query: "CAUSE SSA-009",
      role: "lead",
      phrase: "CAUSE",
      expect: "answer",
      asset: "SSA-009",
      require: hazardRequire,
      partial_min: partialMin(hazardRequire.length),
      forbid: [],
      allow_issue_ids: causeHazard.issues.map((row) => row.issue_id),
      allow_actors: [...new Set(causeHazard.issues.map((row) => row.actor_key))],
      allow_assets: ["SSA-009"],
      open_hazard_count: causeHazard.open_hazards.length,
      contradict_held_ids: [],
    },
    {
      id: "cause-ssa-002",
      query: "CAUSE SSA-002",
      role: "lead",
      phrase: "CAUSE",
      expect: "answer",
      asset: "SSA-002",
      require: [
        { id: "asset", all: ["SSA-002"] },
        {
          id: "iss-006",
          all: ["ISS-006", "SSA-002", "ACT-23", "high-limit trip, still open", "HAZARD"],
          pattern: "did[_ ]not[_ ]hold",
          scope: "sentence",
        },
      ],
      partial_min: partialMin(2),
      forbid: [sameReasonForbid(), heldForbid(causeBoiler.issues.find((row) => row.issue_id === "ISS-007")!)],
      allow_issue_ids: causeBoiler.issues.map((row) => row.issue_id),
      allow_actors: [...new Set(causeBoiler.issues.map((row) => row.actor_key))],
      allow_assets: ["SSA-002"],
      open_hazard_count: causeBoiler.open_hazards.length,
      contradict_held_ids: ["ISS-007"],
    },
    thisweek,
    lastweek,
    nextSpec(nextHazard),
    nextSpec(nextBelt),
    nextSpec(nextOpen),
    nextSpec(asset("SSA-009")),
    nextSpec(asset("SSA-003")),
    nextSpec(asset("SSA-001")),
    {
      id: "safety-free-text",
      query: "what should we fix today",
      role: "lead",
      phrase: "refusal",
      expect: "refusal",
      status: "UNPROCESSED",
      reason_code: "unknown-verb",
      require: [],
      partial_min: 1,
      forbid: [],
      allow_issue_ids: [],
      allow_actors: [],
      allow_assets: [],
      open_hazard_count: 0,
      contradict_held_ids: [],
    },
    {
      id: "safety-tech",
      query: "CAUSE SSA-001",
      role: "tech",
      phrase: "refusal",
      expect: "refusal",
      status: "DENIED",
      reason_code: "needs-lead",
      require: [],
      partial_min: 1,
      forbid: [],
      allow_issue_ids: [],
      allow_actors: [],
      allow_assets: [],
      open_hazard_count: 0,
      contradict_held_ids: [],
    },
  ];
}

export function buildAnswerKey() {
  const facts = loadFacts();
  return {
    generated_by: "eval/derive.ts",
    rules: RULES,
    clock: CLOCK,
    open_hazards: facts.openHazards,
    assets: facts.assets.map((asset) => ({
      asset_id: asset.asset_id,
      did_not_hold_count: asset.did_not_hold.length,
      repeat_tokens: asset.repeat_tokens,
      reasons_distinct: asset.reasons_distinct,
      open_hazards: asset.open_hazards,
      issues: asset.issues,
      next: asset.next,
    })),
    cases: caseSpecs(facts),
  };
}

function writeCases(cases: CaseSpec[]): void {
  const listed = cases.map((spec) => ({
    id: spec.id,
    query: spec.query,
    role: spec.role,
    phrase: spec.phrase,
    expect: spec.expect,
    asset: spec.asset ?? null,
    period: spec.period ?? null,
    status: spec.status ?? null,
    reason_code: spec.reason_code ?? null,
    note: caseNote(spec.id),
  }));
  fs.writeFileSync(path.join(PROJECT_ROOT, "eval", "cases.json"), `${JSON.stringify(listed, null, 2)}\n`);
}

function caseNote(id: string): string {
  const notes: Record<string, string> = {
    "cause-ssa-004": "Clear repeat. Two did_not_hold belt failures under ACT-23. The reason strings differ, so same-reason is wrong.",
    "cause-ssa-001": "Conflation trap. Five did_not_hold rows share the token filter, and the full reason strings differ.",
    "cause-ssa-009": "Open HAZARD and no second issue. The hazard stays open.",
    "cause-ssa-002": "Open HAZARD ISS-006 plus held ISS-007. The reason strings differ, so same-reason is wrong. Sequence ids are not a CAUSE source.",
    "patterns-thisweek": "Did-not-hold rows opened 2026-10-19 through 2026-10-21, plus both open HAZARD rows.",
    "patterns-lastweek": "Did-not-hold rows opened 2026-10-12 through 2026-10-18, including both open HAZARD rows.",
    "next-ssa-002": "Open HAZARD on the asset. Next check is the newest unresolved event on the merged chain.",
    "next-ssa-004": "No open HAZARD. Next check is the newest unresolved belt failure.",
    "next-ssa-007": "No open HAZARD. Next check is the open OOS row.",
    "next-ssa-009": "The only event is the open HAZARD. It stays open.",
    "next-ssa-003": "No open HAZARD. Next check is the newest unresolved event on the merged chain.",
    "next-ssa-001": "No open HAZARD. Next check is the newest unresolved event on the merged chain.",
    "safety-free-text": "Free text must be UNPROCESSED. No model call.",
    "safety-tech": "A tech running CAUSE must be DENIED needs-lead. No model call.",
  };
  return notes[id] ?? "";
}

const isMain = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
);

if (isMain) {
  const key = buildAnswerKey();
  fs.mkdirSync(path.join(PROJECT_ROOT, "eval"), { recursive: true });
  fs.writeFileSync(path.join(PROJECT_ROOT, "eval", "answer-key.json"), `${JSON.stringify(key, null, 2)}\n`);
  writeCases(key.cases);
  process.stderr.write(`wrote eval/answer-key.json and eval/cases.json (${key.cases.length} cases)\n`);
}
