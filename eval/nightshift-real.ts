import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { logPathFor } from "../src/tracing.ts";
import { modelSelection, setModelSelection } from "../src/llm/client.ts";
import { runRequest } from "../src/orchestrator.ts";
import { summarizeMode } from "./nightshift-summary.ts";

/**
 * Nightshift modes on the real eval phrases, 30 runs each. A request that touched the cache is
 * recorded but left out of the latency and reliability numbers. The token is never written.
 * Progress goes to nightshift-real.progress.json for the tray launcher; the answer goes to nightshift-real.json.
 */
const MODES = (process.env.NS_MODES ?? "meterless/fast,meterless/deep").split(",");
const RUNS = Number(process.env.NS_RUNS ?? 30);
const PHRASES = [
  "CAUSE SSA-002", "CAUSE SSA-001", "CAUSE SSA-004", "CAUSE SSA-009",
  "PATTERNS thisweek", "PATTERNS lastweek",
  "NEXT SSA-002", "NEXT SSA-004", "NEXT SSA-009", "NEXT SSA-001",
];
const RESULTS = path.join(PROJECT_ROOT, "eval", "results");
const PROGRESS = path.join(RESULTS, "nightshift-real.progress.json");
const REPORT = path.join(RESULTS, "nightshift-real.json");

type State = "running" | "needs-hitl" | "done" | "failed";

function progress(state: State, message: string, done: number, total: number): void {
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(PROGRESS, `${JSON.stringify({ state, message, done, total, at: new Date().toISOString() })}\n`);
}

function base(): string {
  return (process.env.NIGHTSHIFT_BASE_URL ?? "").replace(/\/+$/, "");
}

/** The runtime answers any HTTP status when it is up. A refused connection means it needs a human to start it. */
async function runtimeUp(): Promise<boolean> {
  try {
    await fetch(`${base()}/models`, { signal: AbortSignal.timeout(5_000) });
    return true;
  } catch {
    return false;
  }
}

async function waitForRuntime(done: number, total: number): Promise<void> {
  const started = Date.now();
  while (!(await runtimeUp())) {
    progress("needs-hitl", "Nightshift runtime is not answering. Start it, then this run continues by itself.", done, total);
    if (Date.now() - started > 60 * 60_000) throw new Error("Nightshift runtime stayed down for 60 minutes");
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
}

function receiptsFor(traceId: string): { routed_model: string | null; receipt_id: string | null; from_cache: boolean | null }[] {
  try {
    return fs
      .readFileSync(logPathFor(traceId), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { meterless?: { routed_model?: string; receipt_id?: string; from_cache?: boolean } })
      .filter((event) => event.meterless)
      .map((event) => ({
        routed_model: event.meterless?.routed_model ?? null,
        receipt_id: event.meterless?.receipt_id ?? null,
        from_cache: typeof event.meterless?.from_cache === "boolean" ? event.meterless.from_cache : null,
      }));
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  if (!base() || !process.env.NIGHTSHIFT_TOKEN) {
    progress("failed", "NIGHTSHIFT_BASE_URL or NIGHTSHIFT_TOKEN is missing from .env", 0, 0);
    process.exit(1);
  }
  const total = MODES.length * RUNS;
  let done = 0;
  const report: Record<string, unknown>[] = [];
  for (const mode of MODES) {
    setModelSelection({ route: "nightshift", model: mode });
    const rows = [];
    for (let index = 0; index < RUNS; index += 1) {
      await waitForRuntime(done, total);
      const query = PHRASES[index % PHRASES.length];
      progress("running", `${mode} ${index + 1}/${RUNS}`, done, total);
      const started = Date.now();
      const out = await runRequest({
        request_id: `ns-${mode.split("/")[1]}-${index}-${randomUUID()}`,
        user_query: query,
        context: { role: "lead", track: "Wildcard [Tinkerer]" },
      });
      const receipts = receiptsFor(out.trace_id);
      rows.push({
        query,
        status: out.status,
        fallback: out.result.fallback_used,
        reason: out.result.fallback_reason,
        failed: out.result.fallback_used || out.status !== "ok",
        elapsed_ms: Date.now() - started,
        trace_id: out.trace_id,
        cache_hit: receipts.some((r) => r.from_cache === true),
        cache_known: receipts.length > 0 && receipts.every((r) => r.from_cache !== null),
        routed_models: [...new Set(receipts.map((r) => r.routed_model))],
        receipt_ids: receipts.map((r) => r.receipt_id),
      });
      done += 1;
    }
    report.push(summarizeMode(mode, rows));
    fs.writeFileSync(REPORT, `${JSON.stringify({ selection_after: modelSelection(), summary_version: 2, modes: report }, null, 2)}\n`);
  }
  progress("done", `Finished ${total} runs. Results: eval\\results\\nightshift-real.json`, done, total);
}

main().catch((err) => {
  progress("failed", String((err as Error).message ?? err).slice(0, 200), 0, 0);
  process.exit(1);
});
