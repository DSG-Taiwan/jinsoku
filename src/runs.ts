import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./config.ts";
import type { RunResponse } from "./schemas.ts";
import type { LogEvent } from "./tracing.ts";

const TRACE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TERMINAL_ACTIONS = new Set(["refuse", "final", "error", "exhaust", "block"]);
const STALE_MS = 120_000;
const REASON_TEXT: Record<string, string> = {
  "request-id-conflict": "This request_id was already used for a different command or role.",
  "request-in-progress": "This request_id is already running.",
};

export interface RunSummary {
  trace_id: string;
  started_at: string;
  status: string;
  query: string;
}

export interface RunDetail {
  trace_id: string;
  status: string;
  events: LogEvent[];
  result: Omit<RunResponse, "log_path"> | null;
}

export function isTraceId(value: string): boolean {
  return TRACE_ID.test(value);
}

function resultsByTrace(root: string): Map<string, RunResponse> {
  const found = new Map<string, RunResponse>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "idempotency.json"), "utf8")) as Record<
      string,
      { response?: RunResponse }
    >;
    for (const entry of Object.values(raw)) {
      const response = entry?.response;
      if (response?.trace_id && isTraceId(response.trace_id)) found.set(response.trace_id, response);
    }
  } catch {
    /* no stored runs yet */
  }
  return found;
}

export function readEvents(file: string): LogEvent[] {
  const text = fs.readFileSync(file, "utf8");
  const events: LogEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as LogEvent;
      if (parsed && typeof parsed.action === "string" && typeof parsed.trace_id === "string") events.push(parsed);
    } catch {
      /* skip a torn line while a run is still writing */
    }
  }
  return events;
}

function publicResult(response: RunResponse): RunDetail["result"] {
  const { log_path: _path, ...rest } = response;
  return rest;
}

export function runStatus(events: LogEvent[], storedStatus?: string): string {
  if (storedStatus) return storedStatus;
  if (events.length === 0) return "running";
  const last = events[events.length - 1];
  if (TERMINAL_ACTIONS.has(last.action)) return last.status || "error";
  const ageMs = Date.now() - Date.parse(last.timestamp);
  if (!Number.isFinite(ageMs) || ageMs > STALE_MS) return "incomplete";
  return "running";
}

function logOnlyResult(traceId: string, events: LogEvent[], status: string): RunDetail["result"] {
  const last = events[events.length - 1];
  const code = last?.output_summary || status;
  const summary =
    status === "incomplete" ? "This run stopped before an answer was stored." : (REASON_TEXT[code] ?? code);
  return {
    request_id: "",
    trace_id: traceId,
    status,
    agents_used: [...new Set(events.map((event) => event.agent_name))],
    result: {
      summary,
      findings: [],
      confidence: 0,
      human_message: summary,
      reason_code: code,
      fallback_used: false,
      fallback_reason: null,
    },
    collaboration: {
      feedback_loop_completed: false,
      revision_count: 0,
      evaluator_findings: [],
      note: "No stored result. Status is read from the log.",
    },
  };
}

export function listRuns(root = PROJECT_ROOT): RunSummary[] {
  const dir = path.join(root, "logs");
  if (!fs.existsSync(dir)) return [];
  const stored = resultsByTrace(root);
  const runs: RunSummary[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".jsonl")) continue;
    const traceId = name.slice(0, -".jsonl".length);
    if (!isTraceId(traceId)) continue;
    const events = readEvents(path.join(dir, name));
    if (events.length === 0) continue;
    const result = stored.get(traceId);
    const status = runStatus(events, result?.status);
    runs.push({
      trace_id: traceId,
      started_at: events[0].timestamp,
      status,
      query: events[0].input_summary || result?.result.summary || traceId,
    });
  }
  return runs.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export function readRun(traceId: string, root = PROJECT_ROOT): RunDetail | null {
  if (!isTraceId(traceId)) return null;
  const file = path.join(root, "logs", `${traceId}.jsonl`);
  if (!fs.existsSync(file)) return null;
  const events = readEvents(file);
  const stored = resultsByTrace(root).get(traceId);
  const status = runStatus(events, stored?.status);
  return {
    trace_id: traceId,
    status,
    events,
    result: stored ? publicResult(stored) : status === "running" ? null : logOnlyResult(traceId, events, status),
  };
}
