import { randomUUID } from "node:crypto";
import { missingEnv } from "../src/config.ts";
import { runRequest } from "../src/orchestrator.ts";

/** Live run of the given phrases, in rounds, with an optional pause between requests. Usage: tsx eval/probe-phrases.ts "CAUSE SSA-001|PATTERNS thisweek" 9 [gapMs] */
const missing: string[] = missingEnv();
if (process.env.MODEL_ROUTE === "paid") {
  for (const name of ["PAID_BASE_URL", "PAID_API_KEY", "PAID_MODEL"]) if (!process.env[name]) missing.push(name);
}
if (missing.length > 0) {
  console.error(`STOP: these settings are empty in .env: ${missing.join(", ")}`);
  process.exit(2);
}
if (process.env.MODEL_ROUTE === "paid") console.error(`route: paid, model: ${process.env.PAID_MODEL}, host: ${new URL(process.env.PAID_BASE_URL ?? "https://invalid").host}`);
const phrases = (process.argv[2] ?? "CAUSE SSA-001").split("|");
const rounds = Number(process.argv[3] ?? 5);
const gapMs = Number(process.argv[4] ?? 0);
for (let round = 0; round < rounds; round += 1) {
  for (const query of phrases) {
    const started = Date.now();
    const out = await runRequest({
      request_id: randomUUID(),
      user_query: query,
      context: { track: "Wildcard [Tinkerer]", role: "lead" },
    });
    console.error(
      `RESULT ${query} status=${out.status} fb=${out.result.fallback_used} ${out.result.fallback_reason ?? ""} ms=${Date.now() - started} trace=${out.trace_id}`,
    );
    if (gapMs > 0) await new Promise((resolve) => setTimeout(resolve, gapMs));
  }
}
