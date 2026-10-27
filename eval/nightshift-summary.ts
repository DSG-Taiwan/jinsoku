import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";

export interface NightshiftRow {
  query: string;
  status: string;
  failed: boolean;
  reason: string | null;
  elapsed_ms: number;
  trace_id: string;
  cache_hit: boolean;
  cache_known: boolean;
  routed_models: (string | null)[];
}

function pct(sorted: number[], p: number): number | null {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))] : null;
}

/**
 * Reliability counts every request that was not a cache hit, so a failure with no receipt is not dropped.
 * Latency and routing come only from requests whose receipts all state the cache status and say uncached.
 * Requests with unknown cache status are reported apart and never enter the latency numbers.
 */
export function summarizeMode(mode: string, rows: NightshiftRow[]): Record<string, unknown> {
  const notHits = rows.filter((row) => !row.cache_hit);
  const verified = notHits.filter((row) => row.cache_known);
  const unknown = notHits.filter((row) => !row.cache_known);
  const times = verified.map((row) => row.elapsed_ms).sort((a, b) => a - b);
  const routed: Record<string, number> = {};
  for (const row of verified) for (const model of row.routed_models) routed[String(model)] = (routed[String(model)] ?? 0) + 1;
  return {
    mode,
    requests: rows.length,
    cache_hits_excluded: rows.length - notHits.length,
    reliability: {
      denominator: notHits.length,
      failures: notHits.filter((row) => row.failed).length,
      available: notHits.filter((row) => row.status === "ok").length,
    },
    verified_uncached: {
      requests: verified.length,
      failures: verified.filter((row) => row.failed).length,
      median_ms: pct(times, 0.5),
      p95_ms: pct(times, 0.95),
      slowest_ms: times.at(-1) ?? null,
      routed_models: routed,
    },
    cache_unknown: {
      requests: unknown.length,
      failures: unknown.filter((row) => row.failed).length,
      note: "no receipt stating the cache status; counted in reliability, left out of latency and routing",
    },
    failure_traces: notHits.filter((row) => row.failed).map((row) => `${row.trace_id} ${row.query} ${row.reason ?? row.status}`),
    rows,
  };
}

/** Rewrites the summaries of a saved report from its own rows. Usage: tsx eval/nightshift-summary.ts [file] */
function resummarize(file: string): void {
  const saved = JSON.parse(fs.readFileSync(file, "utf8")) as { modes: { mode: string; rows: NightshiftRow[] }[] };
  const next = { ...saved, summary_version: 2, modes: saved.modes.map((item) => summarizeMode(item.mode, item.rows)) };
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/nightshift-summary.ts");
if (isMain) resummarize(process.argv[2] ?? path.join(PROJECT_ROOT, "eval", "results", "nightshift-real.json"));
