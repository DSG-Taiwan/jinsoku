import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { health, runRequest } from "../src/orchestrator.ts";
import { modelQuietMs } from "../src/llm/client.ts";
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
const PLAN = CASES.flatMap((caseId) => Array.from({ length: 12 }, () => caseId));

interface Row {
  case_id: string;
  query: string;
  request_id: string;
  trace_id: string;
  status: string;
  fallback_used: boolean;
  fallback_reason: string | null;
  reason_code: string | null;
  human_message: string | null;
  note: string;
  unsupported: string[];
  invented_hazard: boolean;
  hazard_missed: boolean;
  http_429_attempts: number;
  elapsed_ms: number;
}

const REASONS = ["http-5xx", "timeout", "invalid-json", "empty-completion", "http-429", "rejected"] as const;
const REASON_LABEL: Record<(typeof REASONS)[number], string> = {
  "http-5xx": "HTTP 5xx",
  timeout: "timeout",
  "invalid-json": "truncated or invalid JSON",
  "empty-completion": "empty completion",
  "http-429": "HTTP 429",
  rejected: "gate rejection",
};

function logHas(traceId: string, needle: string): boolean {
  const file = path.join(PROJECT_ROOT, "logs", `${traceId}.jsonl`);
  if (!fs.existsSync(file)) return false;
  return fs.readFileSync(file, "utf8").includes(needle);
}

function attempts429(traceId: string): number {
  const file = path.join(PROJECT_ROOT, "logs", `${traceId}.jsonl`);
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, "utf8").split(/\n/).filter((line) => line.includes("http-429")).length;
}

function publish(rows: Row[]): void {
  const failures = rows.filter((row) => row.fallback_used);
  const bound = fallbackUpperBound(failures.length, rows.length);
  const rate = failures.length / rows.length;
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const counts = REASONS.map((reason) => {
    const items = rows.filter((row) => row.fallback_reason === reason);
    const ids = items.length === 0 ? "none" : items.map((row) => `\`${row.trace_id}\` ${row.query}`).join("; ");
    return `- ${REASON_LABEL[reason]}: ${items.length}. ${ids}`;
  });
  const other = failures.filter((row) => !REASONS.includes(row.fallback_reason as (typeof REASONS)[number]));
  const released = rows.filter((row) => row.status === "ok");
  const deadlines = rows.filter((row) => row.status === "error" && logHas(row.trace_id, "request deadline"));
  const invented = rows.filter((row) => row.status === "ok" && row.invented_hazard);
  const missed = rows.filter((row) => row.status === "ok" && row.hazard_missed);
  const hallucinations = rows.filter((row) => row.status === "ok" && row.unsupported.length > 0);
  const rejected = rows.filter((row) => row.fallback_reason === "rejected");
  const gateMet = rejected.length === 0 && hallucinations.length === 0 && invented.length === 0 && missed.length === 0;
  const claim =
    failures.length === 0
      ? `Observed fallbacks: 0 of ${rows.length}. The 95% upper bound is ${pct(bound)}. This sample supports a fallback rate of 2.5% or lower at 95% confidence.`
      : `Observed fallbacks: ${failures.length} of ${rows.length} (${pct(rate)}). The 95% upper bound is ${pct(bound)}. This sample does not support a 2.5% claim.`;
  const list = (items: Row[]) => (items.length === 0 ? "none" : items.map((row) => `\`${row.trace_id}\` ${row.query}`).join("; "));
  const times = rows.map((row) => row.elapsed_ms).filter((ms) => Number.isFinite(ms)).sort((a, b) => a - b);
  const atPct = (p: number) => (times.length === 0 ? 0 : times[Math.min(times.length - 1, Math.floor(p * (times.length - 1)))]);
  const phraseOf = (query: string) => (query.startsWith("NEXT") ? "NEXT" : query.startsWith("PATTERNS") ? "PATTERNS" : "CAUSE");
  const ceilings: Record<string, number> = { NEXT: 10_000, CAUSE: 15_000, PATTERNS: 25_000 };
  const phraseLine = (name: string) => {
    const items = rows.filter((row) => phraseOf(row.query) === name);
    const sorted = items.map((row) => row.elapsed_ms).sort((a, b) => a - b);
    const pick = (p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]);
    const over = items.filter((row) => row.elapsed_ms > ceilings[name] || row.reason_code === "phrase-ceiling");
    return `- ${name}: n ${items.length}, median ${pick(0.5)} ms, p95 ${pick(0.95)} ms, slowest ${sorted[sorted.length - 1] ?? 0} ms, ceiling ${ceilings[name]} ms, over ceiling ${over.length}`;
  };
  const section = `## Fallback claim

Date: 2026-10-23. ${rows.length} fresh lead runs, distinct request ids, paced. Twelve each of CAUSE SSA-002, CAUSE SSA-001, CAUSE SSA-004, CAUSE SSA-009, PATTERNS thisweek, PATTERNS lastweek, NEXT SSA-002, NEXT SSA-004, NEXT SSA-009, and NEXT SSA-001.

${gateMet ? "Gate-rejection fallbacks, released hallucinations, missed open HAZARDs, and invented open HAZARDs are 0." : "The gate is not met."}

${claim}

Availability: ${released.length} of ${rows.length} runs released an answer.

Request latency, measured inside the request after the harness wait: p50 ${atPct(0.5)} ms, p95 ${atPct(0.95)} ms, slowest ${times[times.length - 1] ?? 0} ms.

Latency by phrase:

${phraseLine("NEXT")}
${phraseLine("CAUSE")}
${phraseLine("PATTERNS")}

The plan is \`planFromCall\`. The normal path is the draft (NEXT: a code-built core, then a short narrative) and the model Evaluator. A revision starts only when more than 8 seconds remain. A run that passes its phrase ceiling ends unresolved with reason \`phrase-ceiling\` and counts against availability. PATTERNS writes a \`progress\` log while retrieval is in hand; the board tails that log.

Deadline ends: ${deadlines.length}. ${list(deadlines)}

The prior paced sample hit the request deadline on 8 runs. That finding is what changed the spacing. Each trace is \`request deadline\`, and the released answer was not sent:
- \`40686226-c075-4c60-b19c-6dcd01b35b66\` CAUSE SSA-004
- \`553956d1-72e3-4982-b77c-39796846bea1\` PATTERNS thisweek
- \`c33316a3-d0a8-407d-8a41-7b2594c456d9\` PATTERNS thisweek
- \`25bdb0d5-fd8e-45b7-82eb-e83cd0399203\` PATTERNS thisweek
- \`7caac41f-2b89-4207-a737-1088404d6603\` PATTERNS lastweek
- \`6d9add53-5375-460f-bd6f-ff9988ad8ffd\` PATTERNS lastweek
- \`531c8cca-6a40-464d-84d1-13ba93ff0685\` NEXT SSA-004
- \`604d2093-5b50-4198-8ad8-2995d6af30d7\` NEXT SSA-001

The 50-second wait lived in the product model client, \`MODEL_MIN_SPACING_MS\` in \`src/llm/client.ts\`. \`releaseSlot\` set the next call 50 seconds after the previous call finished, and \`acquireSlot\` slept that long inside the request. The harness also waits \`modelQuietMs()\` before \`runRequest\`, which is outside the deadline. The product spacing is now 2 seconds. HTTP 429 and 5xx still use the jittered backoff, and Retry-After still wins. A user no longer waits 50 seconds between calls.

Self-inflicted HTTP 429 attempts in this paced sample: ${rows.reduce((sum, row) => sum + row.http_429_attempts, 0)}.

Gate-rejection fallbacks: ${rejected.length}.

Fallback count by reason:

${counts.join("\n")}
${other.length === 0 ? "" : `- other: ${other.map((row) => `${row.fallback_reason} \`${row.trace_id}\``).join("; ")}`}

Released hallucinations: ${hallucinations.length}. ${list(hallucinations)}
Invented open HAZARDs: ${invented.length}. ${list(invented)}
Missed open HAZARDs: ${missed.length}. ${list(missed)}
Unresolved: ${rows.filter((row) => row.status === "unresolved").length}. Errors: ${rows.filter((row) => row.status === "error" || row.status === "thrown").length}.

The model Evaluator call is back in the loop. A model-authored critique is logged as \`evaluator\` \`model-attempt\`, then \`approval\`, \`critique\`, or \`exhaust\`. A required revision is logged as \`executor\` \`revision\` and the Evaluator runs again. Trace \`f3077601-42e0-47f9-8ac3-385cbcc92035\` logged \`evaluator\` \`model-attempt\` and \`approval\`.

Scorer rule, applied after the original samples were frozen: a sentence that states an open HAZARD count of 0, "of 0", or "is zero" is not an invented open HAZARD. The cases and the rubric are unchanged. The original v1 and v2 counts above stay as published.

Exact text that the previous rule flagged in the prior 120:
- \`ed9a5232-d65c-414d-82d9-de52bdfd4df0\` CAUSE SSA-001: "World model identifies SSA-001 as RTU-12 in the North zone at roof-n1 with an open hazard count of 0." The code block also said "Open HAZARD count 0."
- \`09f4014e-57a9-4391-9e9f-e69ca0658531\` NEXT SSA-004: "SSA-004 shows repeated belt-slip failures with one held tension tweak; open hazard count is zero."

Re-score of the frozen runs with this rule: v1 invented open HAZARD 0 (was 2) and missed open HAZARD 3 (unchanged). Grades become correct 19, partial 1, wrong 3, miss 7. v2 invented open HAZARD 0 (was 1) and missed open HAZARD 0 (unchanged). Grades become correct 39, partial 1, wrong 1, miss 1. The two v1 changes are next-ssa-004 \`c95331a3-792c-410d-8a87-45645eef3c8e\` and \`5315a198-7e20-4b69-a250-346f4cf1c299\`, both "open HAZARD count is zero". The v2 change is next-ssa-004 \`c695db54-15a1-42e2-872b-84486c960b73\`, "open HAZARD count is 0".

Rows: \`eval/results/claim-120.jsonl\`.
`;
  const evalPath = path.join(PROJECT_ROOT, "docs", "EVAL.md");
  const current = fs.readFileSync(evalPath, "utf8");
  const marker = "## Fallback claim";
  const at = current.indexOf(marker);
  const next = current.slice(0, at === -1 ? current.length : at).replace(/\s*$/, "\n\n");
  fs.writeFileSync(evalPath, `${next}${section}`);
  process.stderr.write(`${claim}\n`);
}

async function main(): Promise<void> {
  const status = await health();
  if (!status.ok) throw new Error("health check failed");
  const specs = new Map(caseSpecs().map((spec) => [spec.id, spec]));
  const facts = loadFacts();
  const out = path.join(PROJECT_ROOT, "eval", "results", "claim-120.jsonl");
  const saved: Row[] = fs.existsSync(out)
    ? fs.readFileSync(out, "utf8").split(/\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as Row)
    : [];
  for (let index = saved.length; index < PLAN.length; index += 1) {
    const caseId = PLAN[index];
    const spec = specs.get(caseId);
    if (!spec) throw new Error(`unknown case ${caseId}`);
    const requestId = `claim-${index}-${randomUUID()}`;
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
      human_message: response.result.human_message ?? null,
      note: response.collaboration.note,
      unsupported: grade.unsupported,
      invented_hazard: grade.invented_hazard,
      hazard_missed: grade.hazard_missed,
      http_429_attempts: attempts429(response.trace_id),
      elapsed_ms: Date.now() - started,
    };
    fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
    saved.push(row);
    process.stderr.write(`  ${row.status} ${row.fallback_reason ?? "none"} 429s ${row.http_429_attempts} ${row.trace_id}\n`);
    const elapsed = Date.now() - started;
    if (elapsed < 2_100) await new Promise((resolve) => setTimeout(resolve, 2_100 - elapsed));
  }
  publish(saved);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/claim-120.ts");
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  });
}
