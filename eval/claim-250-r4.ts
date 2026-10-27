import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { health, runRequest } from "../src/orchestrator.ts";
import { modelQuietMs, setModelSelection } from "../src/llm/client.ts";
import { fallbackUpperBound } from "./claim-bound.ts";
import { caseSpecs, loadFacts } from "./derive.ts";
import { answerText, gradeAttempt } from "./score.ts";

const CASES = [
  "cause-ssa-002",
  "cause-ssa-001",
  "cause-ssa-004",
  "cause-ssa-009",
  "patterns-thisweek",
  "patterns-lastweek",
  "next-ssa-002",
  "next-ssa-004",
  "next-ssa-009",
  "next-ssa-001",
];
const PLAN = CASES.flatMap((caseId) => Array.from({ length: 25 }, () => caseId));
const TAG = process.env.R4_TAG ?? "r4";
const GAP_MS = Number(process.env.R4_GAP_MS ?? 6000);
const CHOSEN = "nvidia/nemotron-3.5-lightning-30b-a3b";

interface Row {
  case_id: string;
  query: string;
  request_id: string;
  trace_id: string;
  status: string;
  fallback_used: boolean;
  fallback_reason: string | null;
  reason_code: string | null;
  unsupported: string[];
  invented_hazard: boolean;
  hazard_missed: boolean;
  elapsed_ms: number;
}

const CEILING: Record<string, number> = { NEXT: 10_000, CAUSE: 15_000, PATTERNS: 25_000 };

function phraseOf(query: string): string {
  if (query.startsWith("NEXT")) return "NEXT";
  if (query.startsWith("PATTERNS")) return "PATTERNS";
  return "CAUSE";
}

function failed(row: Row): boolean {
  return row.fallback_used || row.status !== "ok";
}

function publish(rows: Row[]): void {
  const failures = rows.filter(failed);
  const bound = fallbackUpperBound(failures.length, rows.length);
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const claim =
    failures.length <= 2
      ? `Failures: ${failures.length} of ${rows.length}. This sample supports a failure rate of 2.5% or lower.`
      : `Failures: ${failures.length} of ${rows.length} (${pct(failures.length / rows.length)}). The 95% upper bound is ${pct(bound)}. This sample does not support a 2.5% claim.`;
  const times = (items: Row[]) => items.map((row) => row.elapsed_ms).sort((a, b) => a - b);
  const pick = (sorted: number[], p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]);
  const phraseLine = (name: string) => {
    const items = rows.filter((row) => phraseOf(row.query) === name);
    const sorted = times(items);
    const under = items.filter((row) => row.elapsed_ms <= CEILING[name]).length;
    return `- ${name}: n ${items.length}, median ${pick(sorted, 0.5)} ms, p95 ${pick(sorted, 0.95)} ms, slowest ${sorted[sorted.length - 1] ?? 0} ms, under ceiling ${under} of ${items.length}`;
  };
  const reasons = ["http-5xx", "timeout", "invalid-json", "empty-completion", "http-429", "rejected"] as const;
  const reasonLines = reasons.map((reason) => {
    const items = rows.filter((row) => row.fallback_reason === reason);
    return `- ${reason}: ${items.length}`;
  });
  const invented = rows.filter((row) => row.status === "ok" && row.invented_hazard);
  const missed = rows.filter((row) => row.status === "ok" && row.hazard_missed);
  const hallucinations = rows.filter((row) => row.status === "ok" && row.unsupported.length > 0);
  const list = (items: Row[]) => (items.length === 0 ? "none" : items.map((row) => `\`${row.trace_id}\` ${row.query}`).join("; "));
  const section = `## Final measurement ${TAG}

Date: 2026-10-24. 250 fresh lead runs on the direct route, a ${GAP_MS} ms pause after every request, model \`${CHOSEN}\`. Twenty-five each of the ten phrase cases. Distinct request ids. The clock counts wall time. Spacing is adaptive: no fixed gap between the two calls of one request.

Model choice, from the probe before this sample. Nightshift \`meterless/fast\` routed all 5 calls to the lightning model (median about 0.4 s, one call 5.8 s). \`meterless/deep\` and \`meterless/auto\` changed models across the 5 calls. On real phrases, direct lightning failed 6 of 30 and direct ultra failed 8 of 30. Lightning had the lower failure rate and the lower median (7.0 s versus 8.6 s), so the final route is direct and the model is lightning. \`meterless/auto\` may vary the model; it was not selected. Receipts from the probe are in \`eval/results/model-experiment.json\`.

${claim}

Availability: ${rows.filter((row) => row.status === "ok").length} of ${rows.length} released an answer. Unresolved: ${rows.filter((row) => row.status === "unresolved").length}. Errors: ${rows.filter((row) => row.status === "error" || row.status === "thrown").length}.

Latency by phrase. The prior paced sample, with a fixed 2 second gap, had NEXT median 3621 ms, CAUSE 6373 ms, PATTERNS 8907 ms.

${phraseLine("NEXT")}
${phraseLine("CAUSE")}
${phraseLine("PATTERNS")}

Gate-rejection fallbacks: ${rows.filter((row) => row.fallback_reason === "rejected").length}.

Fallback count by reason:

${reasonLines.join("\n")}

Released hallucinations: ${hallucinations.length}. ${list(hallucinations)}
Invented open HAZARDs: ${invented.length}. ${list(invented)}
Missed open HAZARDs: ${missed.length}. ${list(missed)}

Failure traces: ${list(failures)}

Rows: \`eval/results/claim-250-${TAG}.jsonl\`.
`;
  const evalPath = path.join(PROJECT_ROOT, "docs", "EVAL.md");
  const current = fs.readFileSync(evalPath, "utf8");
  const marker = `## Final measurement ${TAG}`;
  const at = current.indexOf(marker);
  const base = (at === -1 ? current : current.slice(0, at)).replace(/\s*$/, "\n\n");
  fs.writeFileSync(evalPath, `${base}${section}`);
  process.stderr.write(`${claim}\n`);
}

async function main(): Promise<void> {
  setModelSelection({ route: "direct", model: CHOSEN });
  const status = await health();
  if (!status.ok) throw new Error("health check failed");
  const specs = new Map(caseSpecs().map((spec) => [spec.id, spec]));
  const facts = loadFacts();
  const out = path.join(PROJECT_ROOT, "eval", "results", `claim-250-${TAG}.jsonl`);
  const saved: Row[] = fs.existsSync(out)
    ? fs.readFileSync(out, "utf8").split(/\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as Row)
    : [];
  for (let index = saved.length; index < PLAN.length; index += 1) {
    const caseId = PLAN[index];
    const spec = specs.get(caseId);
    if (!spec) throw new Error(`unknown case ${caseId}`);
    const requestId = `m250-${index}-${randomUUID()}`;
    process.stderr.write(`run ${index + 1}/${PLAN.length} ${spec.query}\n`);
    const quiet = modelQuietMs();
    if (quiet > 0) await new Promise((resolve) => setTimeout(resolve, quiet));
    const started = Date.now();
    const response = await runRequest({
      request_id: requestId,
      user_query: spec.query,
      context: { role: "lead", track: "Wildcard [Tinkerer]" },
    });
    const grade = gradeAttempt(
      {
        case_id: caseId,
        status: response.status,
        agents_used: response.agents_used,
        text: answerText(response.result),
        reason_code: response.result.reason_code ?? null,
      },
      spec,
      facts.openHazards,
    );
    const row: Row = {
      case_id: caseId,
      query: spec.query,
      request_id: requestId,
      trace_id: response.trace_id,
      status: response.status,
      fallback_used: response.result.fallback_used,
      fallback_reason: response.result.fallback_reason,
      reason_code: response.result.reason_code ?? null,
      unsupported: grade.unsupported,
      invented_hazard: grade.invented_hazard,
      hazard_missed: grade.hazard_missed,
      elapsed_ms: Date.now() - started,
    };
    fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
    saved.push(row);
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    process.stderr.write(`  ${row.status} ${row.fallback_reason ?? "none"} ${row.elapsed_ms}ms\n`);
  }
  publish(saved);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/claim-250-r4.ts");
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  });
}
