import { randomUUID } from "node:crypto";
import { runRequest } from "../src/orchestrator.ts";

const total = 10;
let unresolved = 0;
let fallback = 0;
const rows: { trace_id: string; status: string; fallback_used: boolean; fallback_rate: number | undefined; revision_count: number }[] = [];

for (let i = 0; i < total; i++) {
  const response = await runRequest({
    request_id: randomUUID(),
    user_query: "PATTERNS thisweek",
    context: { role: "lead", track: "Wildcard [Tinkerer]" },
  });
  if (response.status === "unresolved") unresolved += 1;
  if (response.result.fallback_used) fallback += 1;
  const row = {
    trace_id: response.trace_id,
    status: response.status,
    fallback_used: response.result.fallback_used,
    fallback_rate: response.collaboration.fallback_rate,
    revision_count: response.collaboration.revision_count,
  };
  rows.push(row);
  process.stdout.write(`${JSON.stringify(row)}\n`);
}

process.stdout.write(
  `${JSON.stringify({
    runs: total,
    unresolved,
    unresolved_rate: Number((unresolved / total).toFixed(2)),
    fallback,
    fallback_rate: Number((fallback / total).toFixed(2)),
    rows,
  })}\n`,
);
