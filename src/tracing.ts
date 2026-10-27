import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./config.ts";

export interface RetrievalQuery {
  source: "zetaris" | "hmem" | "worldmodel" | "markov";
  text: string;
}

export interface RetrievalRecord {
  evidence_ids: string[];
  queries: RetrievalQuery[];
}

export interface LogEvent {
  timestamp: string;
  trace_id: string;
  agent_name: string;
  action: string;
  input_summary: string;
  output_summary: string;
  target_agent: string | null;
  confidence: number | null;
  retry_count: number;
  status: string;
  retrieval?: RetrievalRecord;
  fallback_reason?: { hop: string; cause: string; retry_count: number; trace_id: string };
  meterless?: { receipt_id: string | null; routed_model: string | null; provider: string | null };
}

const SECRET_SHAPE = /(nvapi-[A-Za-z0-9_-]+|Bearer\s+\S+|sk-[A-Za-z0-9_-]+)/gi;

export function redact(text: string): string {
  return text.replace(SECRET_SHAPE, "[redacted]");
}

export function logPathFor(traceId: string): string {
  return path.join(PROJECT_ROOT, "logs", `${traceId}.jsonl`);
}

function redactRetrieval(record: RetrievalRecord): RetrievalRecord {
  return {
    evidence_ids: record.evidence_ids.slice(0, 40).map((id) => redact(id).slice(0, 120)),
    queries: record.queries.slice(0, 12).map((query) => ({
      source: query.source,
      text: redact(query.text).slice(0, 400),
    })),
  };
}

export function formatLogLine(event: LogEvent): string {
  const line: Record<string, unknown> = {
    timestamp: event.timestamp,
    trace_id: event.trace_id,
    agent_name: event.agent_name,
    action: event.action,
    input_summary: redact(event.input_summary).slice(0, 500),
    output_summary: redact(event.output_summary).slice(0, 500),
    target_agent: event.target_agent,
    confidence: event.confidence,
    retry_count: event.retry_count,
    status: event.status,
  };
  if (event.retrieval) line.retrieval = redactRetrieval(event.retrieval);
  if (event.fallback_reason) line.fallback_reason = event.fallback_reason;
  if (event.meterless) line.meterless = event.meterless;
  return JSON.stringify(line);
}

export function writeLog(event: LogEvent): void {
  const dir = path.join(PROJECT_ROOT, "logs");
  fs.mkdirSync(dir, { recursive: true });
  const line = formatLogLine(event);
  fs.appendFileSync(logPathFor(event.trace_id), line + "\n", "utf8");
  process.stdout.write(line + "\n");
}
