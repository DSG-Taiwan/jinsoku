import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { health, runRequest } from "../src/orchestrator.ts";
import type { RunResponse } from "../src/schemas.ts";

const QUERIES = [
  "CAUSE SSA-002",
  "CAUSE SSA-002",
  "CAUSE SSA-002",
  "CAUSE SSA-002",
  "CAUSE SSA-001",
  "CAUSE SSA-001",
  "CAUSE SSA-001",
  "CAUSE SSA-001",
  "CAUSE SSA-004",
  "CAUSE SSA-004",
  "CAUSE SSA-004",
  "CAUSE SSA-004",
  "PATTERNS thisweek",
  "PATTERNS thisweek",
  "PATTERNS thisweek",
  "PATTERNS thisweek",
  "PATTERNS lastweek",
  "PATTERNS lastweek",
  "PATTERNS lastweek",
  "PATTERNS lastweek",
  "NEXT SSA-002",
  "NEXT SSA-002",
  "NEXT SSA-002",
  "NEXT SSA-002",
];

interface Row {
  query: string;
  request_id: string;
  trace_id: string;
  status: string;
  fallback_used: boolean;
  reason: "model-call" | "rejected" | "none";
  note: string;
}

function reasonOf(response: RunResponse): Row["reason"] {
  if (!response.result.fallback_used) return "none";
  const note = response.collaboration.note;
  if (note.includes("model-call failure")) return "model-call";
  if (note.includes("draft was rejected")) return "rejected";
  return "rejected";
}

function publish(rows: Row[]): void {
  const released = rows.filter((row) => row.status === "ok");
  const assembled = released.filter((row) => row.fallback_used);
  const modelCall = assembled.filter((row) => row.reason === "model-call");
  const rejected = assembled.filter((row) => row.reason === "rejected");
  const pct = (count: number, total: number) => (total === 0 ? "0%" : `${((count / total) * 100).toFixed(1)}%`);
  const list = (items: Row[]) => (items.length === 0 ? "- None." : items.map((row) => `- \`${row.trace_id}\` ${row.query}`).join("\n"));
  const section = [
    "## Assembler sample",
    "",
    "Fresh lead runs after the prompt and schema work. The linter, the Evaluator, and the HAZARD rules were not loosened. `fallback_used` here means the released answer was assembled from the retrieved rows.",
    "",
    `Runs ${rows.length}. Released ${released.length}. Assembled ${assembled.length} (${pct(assembled.length, released.length)} of released answers).`,
    "",
    `Model-call failures, then assembled: ${modelCall.length}.`,
    "",
    list(modelCall),
    "",
    `Evaluator or linter rejections, then assembled: ${rejected.length}.`,
    "",
    list(rejected),
    "",
    "Trace ids:",
    "",
    ...rows.map((row) => `- ${row.query} status ${row.status} assembler ${row.reason} trace \`${row.trace_id}\` request \`${row.request_id}\``),
    "",
  ].join("\n");
  const file = path.join(PROJECT_ROOT, "docs", "EVAL.md");
  const text = fs.readFileSync(file, "utf8");
  const heading = "## Assembler sample";
  const start = text.indexOf(heading);
  const next = start < 0 ? text.replace(/\s*$/, "\n\n") + section : `${text.slice(0, start)}${section}`;
  fs.writeFileSync(file, next.endsWith("\n") ? next : `${next}\n`);
}

async function main(): Promise<void> {
  const status = await health();
  if (!status.ok) throw new Error("health check failed");
  const out = path.join(PROJECT_ROOT, "eval", "results", "fallback-rate.jsonl");
  const saved: Row[] = fs.existsSync(out)
    ? fs
        .readFileSync(out, "utf8")
        .split(/\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Row)
    : [];
  for (let index = saved.length; index < QUERIES.length; index++) {
    const query = QUERIES[index];
    const requestId = `fb-${index}-${randomUUID()}`;
    if (requestId.length > 80) throw new Error("request_id longer than 80");
    process.stderr.write(`run ${index + 1}/${QUERIES.length} ${query}\n`);
    const started = Date.now();
    const response = await runRequest({
      request_id: requestId,
      user_query: query,
      context: { role: "lead", track: "Wildcard [Tinkerer]" },
    });
    const row: Row = {
      query,
      request_id: requestId,
      trace_id: response.trace_id,
      status: response.status,
      fallback_used: response.result.fallback_used,
      reason: reasonOf(response),
      note: response.collaboration.note,
    };
    fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
    saved.push(row);
    process.stderr.write(`  ${row.status} ${row.reason} ${row.trace_id}\n`);
    const elapsed = Date.now() - started;
    if (elapsed < 2100) await new Promise((resolve) => setTimeout(resolve, 2100 - elapsed));
  }
  publish(saved);
  const released = saved.filter((row) => row.status === "ok");
  const assembled = released.filter((row) => row.fallback_used);
  process.stderr.write(
    `assembled ${assembled.length}/${released.length} model-call ${assembled.filter((row) => row.reason === "model-call").length} rejected ${assembled.filter((row) => row.reason === "rejected").length}\n`,
  );
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/fallback-rate.ts");
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  });
}
