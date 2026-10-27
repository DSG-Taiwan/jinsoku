import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { completeJson, modelSelection, setModelSelection, setReceiptLogger, type ModelReceipt } from "../src/llm/client.ts";
import { runRequest } from "../src/orchestrator.ts";

const MODES = ["meterless/fast", "meterless/deep", "meterless/auto"] as const;
const DIRECT = ["nvidia/nemotron-3.5-lightning-30b-a3b", "nvidia/nemotron-3-ultra-550b-a55b"] as const;
const PHRASES = [
  "CAUSE SSA-002",
  "CAUSE SSA-001",
  "CAUSE SSA-004",
  "CAUSE SSA-009",
  "PATTERNS thisweek",
  "PATTERNS lastweek",
  "NEXT SSA-002",
  "NEXT SSA-004",
  "NEXT SSA-009",
  "NEXT SSA-001",
];

function refused(err: unknown): boolean {
  const cause = (err as { cause?: { code?: string }; code?: string })?.cause?.code || (err as { code?: string })?.code;
  return cause === "ECONNREFUSED" || String((err as Error)?.message || "").includes("ECONNREFUSED");
}

async function probeMode(mode: string): Promise<Record<string, unknown>> {
  const started = Date.now();
  let receipt: ModelReceipt | null = null;
  setReceiptLogger((item) => {
    receipt = item;
  });
  try {
    setModelSelection({ route: "nightshift", model: mode });
    const text = await completeJson([{ role: "user", content: 'Reply with one JSON object {"ok":true} only.' }], {
      timeoutMs: 40_000,
      maxTokens: 400,
    });
    return {
      mode,
      http: "200",
      latency_ms: Date.now() - started,
      routed_model: receipt?.routed_model ?? null,
      receipt_id: receipt?.receipt_id ?? null,
      provider: receipt?.provider ?? null,
      parsed: text.includes('"ok":true'),
    };
  } catch (err) {
    if (refused(err)) throw err;
    return {
      mode,
      error: String((err as Error).message || err).slice(0, 180),
      latency_ms: Date.now() - started,
      routed_model: receipt?.routed_model ?? null,
      receipt_id: receipt?.receipt_id ?? null,
      provider: receipt?.provider ?? null,
    };
  } finally {
    setReceiptLogger(null);
  }
}

async function directSample(model: string): Promise<Record<string, unknown>> {
  setModelSelection({ route: "direct", model });
  const probeStarted = Date.now();
  try {
    await completeJson([{ role: "user", content: 'Reply with {"ok":true} only.' }], { timeoutMs: 40_000, maxTokens: 200 });
  } catch (err) {
    const message = String((err as Error).message || err);
    if (/404|400|not found|excluded|unknown model|model not/i.test(message)) {
      return { model, served: false, error: message.slice(0, 180), latency_ms: Date.now() - probeStarted };
    }
  }
  const rows = [];
  for (let index = 0; index < 30; index += 1) {
    const query = PHRASES[index % PHRASES.length];
    const started = Date.now();
    const out = await runRequest({
      request_id: `model-${index}-${randomUUID()}`,
      user_query: query,
      context: { role: "lead", track: "Wildcard [Tinkerer]" },
    });
    const failed = out.result.fallback_used || out.status !== "ok";
    rows.push({
      query,
      status: out.status,
      fallback: out.result.fallback_used,
      reason: out.result.fallback_reason,
      elapsed_ms: Date.now() - started,
      failed,
      trace_id: out.trace_id,
    });
    process.stderr.write(`${model} ${index + 1}/30 ${out.status} ${Date.now() - started}ms\n`);
  }
  const times = rows.map((row) => row.elapsed_ms).sort((a, b) => a - b);
  const pick = (p: number) => times[Math.min(times.length - 1, Math.floor(p * (times.length - 1)))];
  const failures = rows.filter((row) => row.failed);
  return {
    model,
    served: true,
    calls: rows.length,
    failures: failures.length,
    availability: rows.filter((row) => row.status === "ok").length,
    median_ms: pick(0.5),
    p95_ms: pick(0.95),
    slowest_ms: times[times.length - 1],
    failure_traces: failures.map((row) => `${row.trace_id} ${row.query} ${row.reason ?? row.status}`),
  };
}

async function main(): Promise<void> {
  const report: Record<string, unknown> = { nightshift: [], direct: [] };
  try {
    for (const mode of MODES) {
      const batch = [];
      for (let n = 0; n < 5; n += 1) {
        process.stderr.write(`probe ${mode} ${n + 1}/5\n`);
        batch.push(await probeMode(mode));
      }
      (report.nightshift as unknown[]).push({ mode, calls: batch });
    }
  } catch (err) {
    if (refused(err)) {
      report.nightshift_connection = "refused";
    } else {
      throw err;
    }
  }
  for (const model of DIRECT) {
    process.stderr.write(`direct ${model}\n`);
    (report.direct as unknown[]).push(await directSample(model));
  }
  setModelSelection({ route: "direct", model: null });
  const file = path.join(PROJECT_ROOT, "eval", "results", "model-experiment.json");
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`wrote ${file}\nselection ${JSON.stringify(modelSelection())}\n`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/model-experiment.ts");
if (isMain) {
  main().catch((err) => {
    if (refused(err)) {
      process.stderr.write("connection_refused\n");
      process.exit(2);
    }
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  });
}
