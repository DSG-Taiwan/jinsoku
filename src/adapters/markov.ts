import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT } from "../config.ts";
import { ISSUES } from "../data/seed.ts";
import { RequestDeadlineError } from "../deadline.ts";
import { writeLog } from "../tracing.ts";

// Reference API (vendor/markovian/reference/src): Markovian.run({ goal, stepFn,
// stopWhen, reflect, abortSignal }). stopWhen receives { step, carryover }
// after CarryoverService.next. Each chunk ends with [STATE_CHECKPOINT] of whole
// incident lines that fit carryoverTokens. The marker level accepts that block
// when it is at least 24 characters and within the budget. reflect stays false.
// historyDir stays unset. chunkSize 2000 satisfies framing + carryover + output.

const CARRYOVER_TOKENS = 128;
const CHUNK_SIZE = 2000;

interface SeqExtra {
  issue_id: string;
  opened_at: string;
  kind: "OOS" | "HAZARD" | "MICROFIX";
  actor_key: string;
  fix_outcome: "held" | "did_not_hold";
  note: string;
}

interface ChainEvent {
  issue_id: string;
  opened_at: string;
  kind: "OOS" | "HAZARD" | "MICROFIX";
  actor_key: string;
  fix_outcome: string;
  note: string;
  openHazard: boolean;
}

type EstimateTokens = (text: string) => number;

type MarkovianEngine = {
  run(options: {
    goal: string;
    stepFn: () => { content: string };
    stopWhen: (args: { step: number; carryover: string }) => boolean;
    reflect: false;
    abortSignal?: AbortSignal;
  }): Promise<{ status: string; error?: string; chunks: { id: number }[] }>;
};

let engineCtor: (new (opts: {
  chunkConfig: { chunkSize: number; maxChunks: number; carryoverTokens: number; overlapTokens: number };
}) => MarkovianEngine) | null = null;
let estimateTokens: EstimateTokens = (text) => Math.ceil(text.length / 4);

function eventLine(ev: ChainEvent): string {
  if (ev.openHazard) {
    return `${ev.issue_id} ${ev.opened_at} HAZARD ${ev.actor_key} open note ${ev.note} stays open for a human.`;
  }
  return `${ev.issue_id} ${ev.opened_at} ${ev.kind} ${ev.actor_key} ${ev.fix_outcome} note ${ev.note}.`;
}

function historyText(events: ChainEvent[]): string {
  const lines = events.map(eventLine);
  const pinned = events.filter((ev) => ev.openHazard).map(eventLine);
  return pinned.length ? [...lines, ...pinned].join("\n") : lines.join("\n");
}

function extrasFor(assetId: string): SeqExtra[] {
  const file = path.join(PROJECT_ROOT, "data", "synthetic", "incident-sequences.json");
  const all = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, SeqExtra[]>;
  return all[assetId] ?? [];
}

export function chainFor(assetId: string): ChainEvent[] {
  const base: ChainEvent[] = ISSUES.filter((row) => row.asset_id === assetId).map((row) => ({
    issue_id: row.issue_id,
    opened_at: row.opened_at,
    kind: row.kind,
    actor_key: row.actor_key,
    fix_outcome: row.fix_outcome,
    note: row.reason,
    openHazard: row.kind === "HAZARD" && row.closed_at === null,
  }));
  const more: ChainEvent[] = extrasFor(assetId).map((row) => ({
    issue_id: row.issue_id,
    opened_at: row.opened_at,
    kind: row.kind,
    actor_key: row.actor_key,
    fix_outcome: row.fix_outcome,
    note: row.note,
    openHazard: row.kind === "HAZARD",
  }));
  const events = [...base, ...more].sort(
    (a, b) => a.opened_at.localeCompare(b.opened_at) || a.issue_id.localeCompare(b.issue_id),
  );
  if (events.length === 0) throw new Error(`No synthetic incident chain for ${assetId}`);
  if (events.length > 32) throw new Error(`Incident chain for ${assetId} exceeds Markovian maxChunks`);
  return events;
}

export function incidentHistoryChunk(assetId: string): string {
  return historyText(chainFor(assetId));
}

/** Whole lines only. Newest non-hazard lines, then open HAZARD lines, inside the reference token budget. */
export function foldChain(events: ChainEvent[], estimate: EstimateTokens = (text) => estimateTokens(text)): string {
  const hazards = events.filter((ev) => ev.openHazard).map(eventLine);
  const rest = events.filter((ev) => !ev.openHazard).map(eventLine);
  let start = rest.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    const text = [...rest.slice(i), ...hazards].join("\n");
    if (estimate(text) <= CARRYOVER_TOKENS) start = i;
    else break;
  }
  return [...rest.slice(start), ...hazards].join("\n");
}

async function loadEngine(): Promise<NonNullable<typeof engineCtor>> {
  if (engineCtor) return engineCtor;
  const entry = path.join(PROJECT_ROOT, "vendor", "markovian", "reference", "src", "index.ts");
  if (!fs.existsSync(entry)) {
    throw new Error("Markovian engine not found. Run npm run setup.");
  }
  const loaded = await import(pathToFileURL(entry).href);
  engineCtor = loaded.Markovian;
  if (typeof loaded.estimateTokens === "function") estimateTokens = loaded.estimateTokens as EstimateTokens;
  return engineCtor;
}

export async function compressNext(
  assetId: string,
  traceId: string,
  signal?: AbortSignal,
): Promise<{ id: string; content: string; query: string; steps: number }> {
  if (signal?.aborted) throw new RequestDeadlineError();
  const events = chainFor(assetId);
  const goal = `Compress the synthetic incident chain for ${assetId} into the next check.`;
  const Markovian = await loadEngine();
  const engine = new Markovian({
    chunkConfig: {
      chunkSize: CHUNK_SIZE,
      maxChunks: events.length,
      carryoverTokens: CARRYOVER_TOKENS,
      overlapTokens: 0,
    },
  });
  let cursor = 0;
  let carryover = "";
  const run = await engine.run({
    goal,
    reflect: false,
    abortSignal: signal,
    stepFn: () => {
      cursor += 1;
      const prefix = events.slice(0, cursor);
      const line = eventLine(prefix[prefix.length - 1]);
      const state = foldChain(prefix);
      return { content: `${line}\n\n[STATE_CHECKPOINT]\n${state}` };
    },
    stopWhen: ({ step, carryover: next }) => {
      carryover = next;
      return step >= events.length;
    },
  });
  if (signal?.aborted || run.status === "aborted") throw new RequestDeadlineError();
  if (run.status !== "completed" || !carryover.trim()) {
    throw new Error(run.error || `Markovian run for ${assetId} ended ${run.status}`);
  }
  const id = `markov:${assetId}`;
  const content = carryover.trim();
  writeLog({
    timestamp: new Date().toISOString(),
    trace_id: traceId,
    agent_name: "executor",
    action: "markov-query",
    input_summary: goal,
    output_summary: `id=${id} steps=${run.chunks.length} ${content.split("\n").slice(-2).join(" ")}`,
    target_agent: "evaluator",
    confidence: null,
    retry_count: 0,
    status: "ok",
    retrieval: {
      evidence_ids: [id],
      queries: [{ source: "markov", text: goal }],
    },
  });
  return { id, content, query: goal, steps: run.chunks.length };
}
