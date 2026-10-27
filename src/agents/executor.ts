import { compressNext } from "../adapters/markov.ts";
import { runSql, type SqlResult } from "../adapters/zetaris.ts";
import { queryIncidents, seedIncidents } from "../adapters/meterless.ts";
import { queryUnits } from "../adapters/world-model.ts";
import { blankClosedAt, inventedOpenHazard, rowsOf } from "./hazard-block.ts";
import { isIssueSource, sameRecord } from "./precursors.ts";
import { partitionRows, qualitySummary } from "./row-schema.ts";
import { assetsSelect, coachingLines, ISSUES, issuesSelect, memoryFacts, weekBounds, type IssueRow } from "../data/seed.ts";
import { RequestDeadlineError } from "../deadline.ts";
import { modelCallCause } from "../llm/client.ts";
import type { CallObject, Critique, HopOutcome, Plan, RetrievedSource, SmokeDraft } from "../schemas.ts";
import { DRAFT_LIMITS, parseSmokeDraft } from "../schemas.ts";
import { callSchema, draftSchema } from "./model-json.ts";

export const DRAFT_MAX_TOKENS = 1400;

export const EXECUTOR_SYSTEM = `You are the Executor. Reply with one JSON object only.
Keys: headline, findings[{claim, evidence_ids}], recommended_next_check, needs_human_decision true, not_checked, confidence 0..1.
Write at most ${DRAFT_LIMITS.findings} findings. Headline under ${DRAFT_LIMITS.headline} characters. Each claim is one sentence under ${DRAFT_LIMITS.claim} characters. Then stop.
Copy evidence_ids from allowed_evidence_ids. One finding per kind: zetaris, hmem, worldmodel, markov when present.
Coaching cites the historical zetaris id.
Use only the sources. Name an issue id only with its date, actor, fix_outcome, and verbatim reason. Do not write same reason.
Do not write the word HAZARD. A later block adds the open count, including 0.
No close, clear, resolve, or downgrade. No names. Propose only.
PATTERNS: one finding groups did_not_hold rows by actor_key and says if the unit may be at fault.`;

const SYSTEM = EXECUTOR_SYSTEM;

const REVISE = `Revise the draft. Reply with one JSON object only, same keys.
At most ${DRAFT_LIMITS.findings} findings. Headline under ${DRAFT_LIMITS.headline} characters. Each claim is one sentence under ${DRAFT_LIMITS.claim} characters. Then stop.
Include one finding for every retrieved kind: zetaris, hmem, worldmodel, and markov when that id is present. Paste each named issue's verbatim reason unchanged. Do not write same reason.
If the critique says invented open HAZARD, remove every headline and claim sentence that contains that word. Do not write it again.
If the critique says reason truncated, paste the full verbatim reason for that issue id.
If the critique says dual-citation missing, copy each required_kind_ids id onto a finding. If ${DRAFT_LIMITS.findings} findings are already present, replace one.
Leave a confirmed HAZARD open for a human. Do not use the words close, clear, resolve, or downgrade. No names.`;

function sqlFor(call: CallObject): string {
  if (call.verb === "PATTERNS" && call.period) {
    const { from, to } = weekBounds(call.period);
    return issuesSelect({ from, to });
  }
  return issuesSelect({ assetId: call.asset });
}

export function verbatimReasons(retrieved: RetrievedSource[]): { issue_id: string; reason: string }[] {
  const seen = new Set<string>();
  const reasons: { issue_id: string; reason: string }[] = [];
  for (const source of retrieved) {
    for (const row of rowsOf(source)) {
      const key = `${row.issue_id}|${row.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      reasons.push({ issue_id: row.issue_id, reason: row.reason });
    }
  }
  return reasons;
}

function memoryQuery(call: CallObject): string {
  if (call.verb === "PATTERNS") return `D3 synthetic incidents ${call.period ?? ""}`;
  return call.asset ?? "incident";
}

/** The model never sees open-HAZARD facts. The code-owned block states them, so the model has nothing to restate or smear onto another asset. */
export function modelRetrieved(
  retrieved: RetrievedSource[],
): { id: string; kind: RetrievedSource["kind"]; summary: string }[] {
  return retrieved
    .filter((source) => !source.summary.startsWith("Open HAZARD rows"))
    .map((source) => ({
      id: source.id,
      kind: source.kind,
      summary: modelSummary(
        source.summary
          .replace(/\s*Open HAZARD count \d+, read from the world-model graph\./gi, "")
          .replace(/\bHAZARD\b/g, "flagged"),
      ),
    }));
}

function modelSummary(summary: string, max = 420): string {
  if (summary.length <= max) return summary;
  const parts = summary.split("; ");
  if (parts.length < 2) return summary.slice(0, max);
  const kept: string[] = [];
  let size = 0;
  for (const part of parts) {
    if (kept.length > 0 && size + part.length + 2 > max) break;
    kept.push(part);
    size += part.length + 2;
  }
  return kept.join("; ");
}

export function requiredKindIds(retrieved: RetrievedSource[]): { kind: string; id: string }[] {
  const seen = new Set<string>();
  const ids: { kind: string; id: string }[] = [];
  for (const source of retrieved) {
    if (seen.has(source.kind)) continue;
    seen.add(source.kind);
    ids.push({ kind: source.kind, id: source.id });
  }
  return ids;
}

/** A retrieved kind the draft never cites is attached from that source, so the check still sees the row. */
export function citeMissingKinds(draft: SmokeDraft, retrieved: RetrievedSource[]): SmokeDraft {
  const cited = new Set(draft.findings.flatMap((finding) => finding.evidence_ids));
  const citedKinds = new Set(retrieved.filter((source) => cited.has(source.id)).map((source) => source.kind));
  const additions = requiredKindIds(retrieved)
    .filter((item) => !citedKinds.has(item.kind))
    .map((item) => ({
      claim: `Retrieved ${item.kind} record ${item.id} is in the sources.`,
      evidence_ids: [item.id],
    }));
  if (additions.length === 0) return draft;
  return { ...draft, findings: [...draft.findings, ...additions] };
}

function clip(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).trim();
}

export function graphQueryText(call: CallObject): string {
  return call.asset
    ? `graph neighbors via has_hazard asset ${call.asset}`
    : "graph neighbors via has_hazard open hazards";
}

export function scopeMemoryHits<T extends { content: string }>(hits: T[], asset?: string): T[] {
  const scoped = (asset ? hits.filter((h) => h.content.includes(asset)) : hits).slice();
  const score = (content: string) => (content.includes("D3 synthetic") ? 2 : 0) + (content.includes("ISS-") ? 1 : 0);
  return scoped.sort((a, b) => score(b.content) - score(a.content));
}

/** A memory that cites an issue id or outcome the current issue table does not have stays out of the model payload. */
export function retainCurrentMemories<T extends { content: string }>(
  hits: T[],
  catalog: Pick<IssueRow, "issue_id" | "fix_outcome">[] = ISSUES,
): T[] {
  const outcomes = new Map(catalog.map((row) => [row.issue_id, row.fix_outcome]));
  return hits.filter((hit) => memoryMatchesCatalog(hit.content, outcomes));
}

function memoryMatchesCatalog(content: string, outcomes: Map<string, string>): boolean {
  const ids = [...content.matchAll(/\b(ISS-\d+)\b/gi)].map((match) => match[1].toUpperCase());
  if (ids.length === 0) return true;
  const stated = content.match(/fix_outcome\s+(held|did_not_hold)/i);
  for (const id of ids) {
    const outcome = outcomes.get(id);
    if (!outcome) return false;
    if (stated && stated[1].toLowerCase() !== outcome) return false;
  }
  return true;
}

const typedRow = (row: Record<string, string>) => ({
  issue_id: row.issue_id,
  asset_id: row.asset_id,
  kind: row.kind,
  opened_at: row.opened_at,
  actor_key: row.actor_key,
  fix_outcome: row.fix_outcome,
  reason: row.reason.trim(),
});

function records(result: SqlResult): Record<string, string>[] {
  return result.data.map((row) => {
    const out: Record<string, string> = {};
    result.headers.forEach((header, i) => {
      out[header] = row[i] == null ? "" : String(row[i]);
    });
    return out;
  });
}

export function withCoachingSource(
  retrieved: RetrievedSource[],
  coaching: { queryId: string; lines: string[]; period?: string },
): RetrievedSource[] {
  if (coaching.lines.length === 0) return retrieved;
  const period = coaching.period ?? "the requested period";
  return [
    ...retrieved,
    {
      id: `zetaris:${coaching.queryId}`,
      kind: "zetaris",
      summary: `Historical did_not_hold rows, not limited to ${period}. ${coaching.lines.join(" ")}`.slice(0, 700),
    },
  ];
}

export async function retrieve(
  call: CallObject,
  signal?: AbortSignal,
): Promise<{ sql: string; sqls: string[]; retrieved: RetrievedSource[] }> {
  await seedIncidents(memoryFacts());
  const issueSql = sqlFor(call);
  const assetSql = assetsSelect(call.asset);
  const hazardSql = issuesSelect({ openHazard: true, assetId: call.asset });
  const issues = await runSql(issueSql, 80, signal);
  const assets = await runSql(assetSql, 20, signal);
  const hazards = await runSql(hazardSql, 20, signal);
  const issuePart = partitionRows(records(issues), "issue");
  const hazardPart = partitionRows(records(hazards), "hazard");
  const issueRows = issuePart.valid;
  const openHazards = hazardPart.valid.filter((row) => row.kind === "HAZARD" && blankClosedAt(row.closed_at));
  // Every excluded row is reported, from either query, with its query and position; nothing is merged away.
  const quarantined = [...issuePart.quarantined, ...hazardPart.quarantined];
  const queryTotals = {
    issue: issuePart.valid.length + issuePart.quarantined.length,
    hazard: hazardPart.valid.length + hazardPart.quarantined.length,
  };
  const sqls = [issueSql, assetSql, hazardSql];
  let coachingQuery: { queryId: string; lines: string[] } | null = null;
  if (call.verb === "PATTERNS") {
    const coachingSql = issuesSelect({ outcome: "did_not_hold" });
    const coachingResult = await runSql(coachingSql, 80, signal);
    sqls.push(coachingSql);
    coachingQuery = { queryId: coachingResult.queryId, lines: coachingLines(records(coachingResult)) };
  }
  const hits = retainCurrentMemories(scopeMemoryHits(await queryIncidents(memoryQuery(call)), call.asset)).slice(0, 3);
  const units = await queryUnits(call.asset);
  const picked = call.asset ? units : units.filter((unit) => !/Open HAZARD count 0\b/.test(unit.content)).slice(0, 3);
  const markov = call.verb === "NEXT" && call.asset ? await compressNext(call.asset, call.trace_id, signal) : null;
  const queries = [
    ...sqls.map((text) => ({ source: "zetaris" as const, text })),
    { source: "hmem" as const, text: memoryQuery(call) },
    { source: "worldmodel" as const, text: graphQueryText(call) },
    ...(markov ? [{ source: "markov" as const, text: markov.query }] : []),
  ];
  const retrieved = withCoachingSource(
    [
      {
        id: `zetaris:${issues.queryId}`,
        kind: "zetaris",
        summary: issueRows
          .map((row) => `${row.issue_id} ${row.asset_id} ${row.kind} ${row.opened_at} ${row.actor_key} ${row.fix_outcome} ${row.reason}`)
          .join("; "),
        rows: issueRows.map(typedRow),
      },
      ...(quarantined.length
        ? [{ id: `zetaris:${issues.queryId}:quality`, kind: "zetaris" as const, summary: qualitySummary(quarantined, queryTotals), rows: [] }]
        : []),
      ...(openHazards.length
        ? [
            {
              id: `zetaris:${hazards.queryId}`,
              kind: "zetaris" as const,
              summary: `Open HAZARD rows; ${openHazards
                .map((row) => `${row.issue_id} ${row.asset_id} ${row.kind} ${row.opened_at} ${row.actor_key} ${row.fix_outcome} ${row.reason}`)
                .join("; ")}`,
              rows: openHazards.map(typedRow),
            },
          ]
        : []),
      {
        id: `zetaris:${assets.queryId}`,
        kind: "zetaris",
        summary: records(assets)
          .slice(0, 6)
          .map((row) => `${row.asset_id} ${row.model} ${row.zone} ${row.location}`)
          .join("; ")
          .slice(0, 300),
      },
      ...hits.map((hit) => ({ id: `hmem:${hit.id}`, kind: "hmem" as const, summary: hit.content })),
      ...picked.map((unit) => ({ id: `worldmodel:${unit.id}`, kind: "worldmodel" as const, summary: unit.content })),
      ...(markov ? [{ id: markov.id, kind: "markov" as const, summary: markov.content }] : []),
    ],
    { queryId: coachingQuery?.queryId ?? "", lines: coachingQuery?.lines ?? [], period: call.period },
  );
  return { sql: issueSql, sqls, queries, retrieved };
}

export const FALLBACK_HEADLINE = "evidence retrieved, human decides";
export const ASSEMBLED_LABEL = "assembled from records, no model synthesis";

export function isFallbackDraft(draft: { headline: string }): boolean {
  return draft.headline.includes(FALLBACK_HEADLINE);
}

export function isAssembledDraft(draft: { headline: string }): boolean {
  return draft.headline.includes(ASSEMBLED_LABEL);
}

/** Full retrieved rows, no model text. The headline is the release label. */
export function assembleFromRecords(call: CallObject, retrieved: RetrievedSource[]): SmokeDraft {
  const findings: SmokeDraft["findings"] = [];
  // The listing is chosen by relevance, not by source position: with an asset, only incidents of that asset (and every version of
  // those ids) are listed, and the first source that carries any of them is the main listing.
  const issueSources = retrieved.filter((source) => isIssueSource(source) && rowsOf(source).length > 0);
  const relevantIds = call.asset
    ? new Set(issueSources.flatMap((source) => rowsOf(source)).filter((row) => row.asset_id === call.asset).map((row) => row.issue_id))
    : null;
  const issueSource = call.asset ? issueSources.find((source) => rowsOf(source).some((row) => row.asset_id === call.asset)) : issueSources[0];
  if (issueSource) {
    const listed = rowsOf(issueSource).filter((row) => !relevantIds || relevantIds.has(row.issue_id));
    for (const row of listed) {
      findings.push({
        claim: `${row.issue_id} ${row.asset_id} ${row.kind} opened ${row.opened_at} actor ${row.actor_key} ${row.fix_outcome} reason ${row.reason}.`,
        evidence_ids: [issueSource.id],
      });
    }
    // A row that shares an issue id with a listed row but differs is a version the first source did not carry; state it too, none preferred.
    for (const other of retrieved) {
      if (other === issueSource || !isIssueSource(other)) continue;
      for (const row of rowsOf(other)) {
        const sameId = listed.filter((entry) => entry.issue_id === row.issue_id);
        if (sameId.length === 0 || sameId.some((entry) => sameRecord(entry, row))) continue;
        listed.push(row);
        findings.push({
          claim: `${row.issue_id} ${row.asset_id} ${row.kind} opened ${row.opened_at} actor ${row.actor_key} ${row.fix_outcome} reason ${row.reason}.`,
          evidence_ids: [other.id],
        });
      }
    }
  }
  for (const quality of retrieved.filter((item) => item.summary.startsWith("Data quality:"))) {
    findings.push({ claim: quality.summary, evidence_ids: [quality.id] });
  }
  for (const kind of ["hmem", "worldmodel", "markov"] as const) {
    const source = retrieved.find((item) => item.kind === kind);
    if (!source || !source.summary.trim()) continue;
    const text = source.summary.trim();
    const claim = /[.!?]$/.test(text) ? text : `${text}.`;
    findings.push({
      claim: inventedOpenHazard(claim, retrieved) ? `${kind} record was read.` : claim,
      evidence_ids: [source.id],
    });
  }
  const citedKinds = new Set(
    findings.flatMap((finding) => finding.evidence_ids).map((id) => retrieved.find((source) => source.id === id)?.kind),
  );
  for (const source of retrieved) {
    if (citedKinds.has(source.kind)) continue;
    findings.push({ claim: `${source.kind} record was read.`, evidence_ids: [source.id] });
    citedKinds.add(source.kind);
  }
  const target = call.asset ?? call.period ?? "";
  const markov = retrieved.find((item) => item.kind === "markov");
  const carry = markov?.summary.trim() ?? "";
  return {
    headline: `${call.verb} ${target}: ${ASSEMBLED_LABEL}`,
    findings,
    recommended_next_check: carry
      ? `Propose only. A human decides. ${carry}`
      : "A human inspects the unit. Agents propose only.",
    needs_human_decision: true,
    not_checked: ["Anything not in retrieved sources"],
    confidence: 0.4,
  };
}

export function draftFromRetrieved(call: CallObject, retrieved: RetrievedSource[]): SmokeDraft {
  const findings = (["zetaris", "hmem", "worldmodel", "markov"] as const).flatMap((kind) => {
    const source = retrieved.find((item) => item.kind === kind);
    return source ? [{ claim: clip(source.summary), evidence_ids: [source.id] }] : [];
  });
  if (findings.length === 0) findings.push({ claim: "No sources retrieved", evidence_ids: [] });
  const coaching = retrieved.find((item) => item.kind === "zetaris" && item.summary.includes("may be at fault"));
  const markov = retrieved.find((item) => item.kind === "markov");
  return {
    headline: `${call.verb} ${call.asset ?? call.period ?? ""}: evidence retrieved, human decides`,
    findings,
    recommended_next_check: markov
      ? `Propose only. A human decides. ${markov.summary.trim()}`
      : coaching
        ? "Propose a coaching conversation for the lead. A human inspects the unit."
        : "A human inspects the unit. Agents propose only.",
    needs_human_decision: true,
    not_checked: ["Anything not in retrieved sources"],
    confidence: 0.4,
  };
}

export async function draft(
  call: CallObject,
  planObj: Plan,
  retrieved: RetrievedSource[],
  timeoutMs: number,
  onRepair?: (m: string) => void,
  signal?: AbortSignal,
  remaining?: () => number,
  clock?: { hold(): void; resume(): void },
): Promise<HopOutcome<SmokeDraft>> {
  const ids = retrieved.map((s) => s.id);
  try {
    const value = await callSchema(
      SYSTEM,
      {
        call: { verb: call.verb, asset: call.asset, period: call.period },
        allowed_evidence_ids: ids,
        verbatim_reasons: verbatimReasons(retrieved),
        coaching: retrieved
          .filter((s) => s.summary.startsWith("Historical did_not_hold"))
          .map((s) => ({ id: s.id, summary: clip(s.summary, 320) })),
        max_findings: DRAFT_LIMITS.findings,
        required_kind_ids: requiredKindIds(retrieved),
        retrieved: modelRetrieved(retrieved),
      },
      parseSmokeDraft,
      timeoutMs,
      onRepair,
      signal,
      DRAFT_MAX_TOKENS,
      draftSchema(ids),
      remaining,
      clock,
    );
    return { value, fallbackUsed: false, fallbackName: null };
  } catch (err) {
    if (err instanceof RequestDeadlineError) throw err;
    onRepair?.((err as Error).message);
    return {
      value: assembleFromRecords(call, retrieved),
      fallbackUsed: true,
      fallbackName: "assembleFromRecords",
      fallbackReason: modelCallCause(err),
    };
  }
}

export async function revise(
  call: CallObject,
  planObj: Plan,
  retrieved: RetrievedSource[],
  previous: SmokeDraft,
  critique: Critique,
  timeoutMs: number,
  onRepair?: (m: string) => void,
  signal?: AbortSignal,
  remaining?: () => number,
  clock?: { hold(): void; resume(): void },
): Promise<HopOutcome<SmokeDraft>> {
  const ids = retrieved.map((s) => s.id);
  try {
    const value = await callSchema(
      REVISE,
      {
        call: { verb: call.verb, asset: call.asset, period: call.period, role: call.role },
        allowed_evidence_ids: ids,
        verbatim_reasons: verbatimReasons(retrieved),
        max_findings: DRAFT_LIMITS.findings,
        required_kind_ids: requiredKindIds(retrieved),
        retrieved: modelRetrieved(retrieved),
        previous,
        critique,
        example_draft: {
          headline: "Revised cited summary",
          findings: [{ claim: "Cite real ids", evidence_ids: ids.slice(0, 2) }],
          recommended_next_check: "A human inspects the unit.",
          needs_human_decision: true,
          not_checked: ["Anything not in retrieved sources"],
          confidence: 0.4,
        },
      },
      parseSmokeDraft,
      timeoutMs,
      onRepair,
      signal,
      DRAFT_MAX_TOKENS,
      draftSchema(ids),
      remaining,
      clock,
    );
    return { value, fallbackUsed: false, fallbackName: null };
  } catch (err) {
    if (err instanceof RequestDeadlineError) throw err;
    onRepair?.((err as Error).message);
    return {
      value: assembleFromRecords(call, retrieved),
      fallbackUsed: true,
      fallbackName: "assembleFromRecords",
      fallbackReason: modelCallCause(err),
    };
  }
}
