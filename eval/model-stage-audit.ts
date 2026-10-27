import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { logPathFor } from "../src/tracing.ts";

/**
 * Counts what the model stages did in a saved sample, apart from whether the answer was released.
 * A request can release a correct answer built in code while its narrative call was skipped and its
 * Evaluator call fell back. This reports those separately so the answer count is not read as model recovery.
 * Usage: tsx eval/model-stage-audit.ts [rows.jsonl] [out.json]
 */
interface Event {
  agent_name: string;
  action: string;
  input_summary: string;
  output_summary: string;
}

type Narrative = "ok" | "skipped" | "not-attempted";
type Evaluator = "model-approved" | "deterministic-fallback" | "deterministic-only";

function events(traceId: string): Event[] {
  try {
    return fs
      .readFileSync(logPathFor(traceId), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Event);
  } catch {
    return [];
  }
}

function phraseOf(query: string): string {
  if (query.startsWith("NEXT")) return "NEXT";
  if (query.startsWith("PATTERNS")) return "PATTERNS";
  return "CAUSE";
}

const rowsFile = process.argv[2] ?? path.join(PROJECT_ROOT, "eval", "results", "claim-250-r4.jsonl");
const outFile = process.argv[3] ?? path.join(PROJECT_ROOT, "eval", "results", "model-stage-audit.json");
const rows = fs
  .readFileSync(rowsFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as { query: string; trace_id: string; status: string; fallback_used: boolean });

const tally = {
  requests: rows.length,
  answers_released_ok: 0,
  answer_fallback_flag: 0,
  narrative: { ok: 0, skipped: 0, skipped_http_429: 0, skipped_timeout: 0, skipped_other: 0, not_attempted: 0 },
  evaluator: { model_approved: 0, deterministic_fallback: 0, deterministic_only: 0 },
  attempts: { http_429: 0, timeout: 0, invalid_json: 0 },
  tokens: { prompt: 0, completion: 0, cached: 0 },
  requests_with_retry: 0,
  requests_with_a_degraded_model_stage: 0,
  requests_with_all_model_stages_ok: 0,
};
const byPhrase: Record<string, { n: number; narrative_ok: number; evaluator_model_approved: number; degraded: number }> = {};
const degradedTraces: string[] = [];
const cacheSplit = {
  cached: { requests: 0, latency: {} as Record<string, number[]> },
  uncached: { requests: 0, latency: {} as Record<string, number[]> },
};
const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length / 2;
  return sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
};

for (const row of rows) {
  const ev = events(row.trace_id);
  if (row.status === "ok") tally.answers_released_ok += 1;
  if (row.fallback_used) tally.answer_fallback_flag += 1;

  let narrative: Narrative = "not-attempted";
  const narrAttempts = ev.filter((e) => e.agent_name === "executor" && e.action === "model-attempt" && e.input_summary === "narrative");
  const skipped = ev.find((e) => e.action === "progress" && e.input_summary === "narrative skipped");
  if (narrAttempts.some((e) => /\bok status 200\b/.test(e.output_summary))) narrative = "ok";
  else if (skipped) narrative = "skipped";
  tally.narrative[narrative === "not-attempted" ? "not_attempted" : narrative] += 1;
  if (narrative === "skipped") {
    const why = skipped?.output_summary ?? "";
    if (/429/.test(why)) tally.narrative.skipped_http_429 += 1;
    else if (/timeout/i.test(why)) tally.narrative.skipped_timeout += 1;
    else tally.narrative.skipped_other += 1;
  }

  let evaluator: Evaluator = "deterministic-only";
  const evalFallback = ev.some((e) => e.agent_name === "evaluator" && e.action === "fallback");
  const evalOk = ev.some((e) => e.agent_name === "evaluator" && e.action === "model-attempt" && /\bok status 200\b/.test(e.output_summary));
  if (evalFallback) evaluator = "deterministic-fallback";
  else if (evalOk) evaluator = "model-approved";
  tally.evaluator[evaluator.replace(/-/g, "_") as keyof typeof tally.evaluator] += 1;

  const text = ev.map((e) => e.output_summary).join("\n");
  let requestCached = 0;
  for (const match of text.matchAll(/ok status 200 tokens (\d+)\/(\d+)(?: cached (\d+))?/g)) {
    tally.tokens.prompt += Number(match[1]);
    tally.tokens.completion += Number(match[2]);
    requestCached += Number(match[3] ?? 0);
  }
  tally.tokens.cached += requestCached;
  const bucket = requestCached > 0 ? cacheSplit.cached : cacheSplit.uncached;
  bucket.requests += 1;
  (bucket.latency[phraseOf(row.query)] ??= []).push((row as { elapsed_ms?: number }).elapsed_ms ?? 0);
  const a429 = (text.match(/attempt \d+ http-429/g) ?? []).length;
  const aTo = (text.match(/attempt \d+ timeout/g) ?? []).length;
  const aJs = (text.match(/attempt \d+ invalid-json/g) ?? []).length;
  tally.attempts.http_429 += a429;
  tally.attempts.timeout += aTo;
  tally.attempts.invalid_json += aJs;
  if (a429 + aTo + aJs > 0) tally.requests_with_retry += 1;

  const degraded = narrative !== "ok" || evaluator !== "model-approved";
  if (degraded) {
    tally.requests_with_a_degraded_model_stage += 1;
    degradedTraces.push(row.trace_id);
  } else {
    tally.requests_with_all_model_stages_ok += 1;
  }
  const p = (byPhrase[phraseOf(row.query)] ??= { n: 0, narrative_ok: 0, evaluator_model_approved: 0, degraded: 0 });
  p.n += 1;
  if (narrative === "ok") p.narrative_ok += 1;
  if (evaluator === "model-approved") p.evaluator_model_approved += 1;
  if (degraded) p.degraded += 1;
}

const split = (bucket: typeof cacheSplit.cached) => ({
  requests: bucket.requests,
  median_ms_by_phrase: Object.fromEntries(Object.entries(bucket.latency).map(([phrase, values]) => [phrase, { n: values.length, median_ms: median(values) }])),
});
const result = {
  source: path.relative(PROJECT_ROOT, rowsFile),
  ...tally,
  by_phrase: byPhrase,
  latency_by_cache_status: { requests_touching_the_cache: split(cacheSplit.cached), requests_with_no_cached_tokens: split(cacheSplit.uncached) },
  degraded_traces: degradedTraces,
};
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...result, degraded_traces: `${degradedTraces.length} trace ids in ${path.basename(outFile)}` }, null, 2)}\n`);
