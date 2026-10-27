import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { health, runRequest } from "../src/orchestrator.ts";
import { caseSpecs, loadFacts } from "./derive.ts";
import { answerText, gradeAttempt } from "./score.ts";

const PLAN = [
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
].flatMap((caseId) => Array.from({ length: 4 }, () => caseId));

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
  text: string;
  agents_used: string[];
  unsupported: string[];
  invented_hazard: boolean;
  hazard_missed: boolean;
}

const MODEL_CAUSES = ["http-5xx", "http-429", "timeout", "invalid-json", "empty-completion"] as const

function publish(rows: Row[]): void {
  const rejected = rows.filter((row) => row.fallback_reason === "rejected");
  const model = rows.filter((row) => row.fallback_reason != null && row.fallback_reason !== "rejected");
  const assembled = rows.filter((row) => row.fallback_used);
  const hallucinations = rows.filter((row) => row.status === "ok" && row.unsupported.length > 0);
  const invented = rows.filter((row) => row.status === "ok" && row.invented_hazard);
  const missed = rows.filter((row) => row.status === "ok" && row.hazard_missed);
  const unresolved = rows.filter((row) => row.status === "unresolved");
  const errors = rows.filter((row) => row.status === "error" || row.status === "thrown");
  const pct = (count: number) => `${((count / rows.length) * 100).toFixed(1)}%`;
  const mark = (ok: boolean) => (ok ? "Met." : "Not met.");
  const rejectionMet = rejected.length === 0;
  const modelMet = model.length / rows.length <= 0.05;
  const overallMet = assembled.length / rows.length <= 0.05;
  const halluMet = hallucinations.length === 0;
  const hazardMet = invented.length === 0 && missed.length === 0;
  const sent = rejectionMet && modelMet && overallMet && halluMet && hazardMet;
  const ids = (items: Row[]) => (items.length === 0 ? "- None." : items.map((row) => `- \`${row.trace_id}\` ${row.query} ${row.fallback_reason ?? row.status}`).join("\n"));
  const causes = MODEL_CAUSES.map((cause) => `${cause} ${model.filter((row) => row.fallback_reason === cause).length}`).join(", ");
  const trouble = (items: Row[]) =>
    items.length === 0
      ? "- None."
      : items
          .map((row) => `- \`${row.trace_id}\` ${row.query} status ${row.status} reason ${row.reason_code ?? "none"} ${row.human_message ?? row.note}`)
          .join("\n");
  const body = `# Hand-off: dev pre-test gate

Date: 2026-10-23
Sample: ${rows.length} fresh lead runs, distinct request ids, on this build.
Independent QA designs its own checks. These numbers are the developer measurement.

## Gate

- Gate-rejection fallbacks: ${rejected.length} of ${rows.length}. ${mark(rejectionMet)}
- Model-call failures: ${model.length} of ${rows.length} (${pct(model.length)}). ${mark(modelMet)} By cause: ${causes}.
- Overall fallback rate: ${assembled.length} of ${rows.length} (${pct(assembled.length)}). ${mark(overallMet)}
- Released hallucinations: ${hallucinations.length}. ${mark(halluMet)}
- Missed open HAZARDs: ${missed.length}. Invented open HAZARDs: ${invented.length}. ${mark(hazardMet)}
- Unresolved: ${unresolved.length}. Errors: ${errors.length}. Reported below.

${sent ? "This sample meets the pre-test gate." : "This sample does not meet the pre-test gate. It does not go to test."}

## Fallback reason

Gate rejections:

${ids(rejected)}

Model-call failures:

${ids(model)}

## Unresolved and errors

${trouble([...unresolved, ...errors])}

## Hallucinations and HAZARD flags

${ids([...hallucinations, ...invented, ...missed])}

## Trace ids

${rows.map((row) => `- ${row.query} status ${row.status} fallback_reason ${row.fallback_reason ?? "none"} trace \`${row.trace_id}\` request \`${row.request_id}\``).join("\n")}
`;
  fs.writeFileSync(path.join(PROJECT_ROOT, "handoffs", "2026-10-23-dev-gate-final.md"), body);
}

async function main(): Promise<void> {
  const status = await health();
  if (!status.ok) throw new Error("health check failed");
  const specs = new Map(caseSpecs().map((spec) => [spec.id, spec]));
  const facts = loadFacts();
  const out = path.join(PROJECT_ROOT, "eval", "results", "gate-40-final.jsonl");
  const saved: Row[] = fs.existsSync(out)
    ? fs
        .readFileSync(out, "utf8")
        .split(/\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Row)
    : [];
  for (let index = saved.length; index < PLAN.length; index++) {
    const caseId = PLAN[index];
    const spec = specs.get(caseId);
    if (!spec) throw new Error(`unknown case ${caseId}`);
    const requestId = `gate-${index}-${randomUUID()}`;
    if (requestId.length > 80) throw new Error("request_id longer than 80");
    process.stderr.write(`run ${index + 1}/${PLAN.length} ${spec.query}\n`);
    const started = Date.now();
    const response = await runRequest({
      request_id: requestId,
      user_query: spec.query,
      context: { role: "lead", track: "Wildcard [Tinkerer]" },
    });
    const text = answerText(response.result);
    const grade = gradeAttempt(
      { case_id: caseId, status: response.status, agents_used: response.agents_used, text, reason_code: response.result.reason_code ?? null },
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
      text,
      agents_used: response.agents_used,
      unsupported: grade.unsupported,
      invented_hazard: grade.invented_hazard,
      hazard_missed: grade.hazard_missed,
    };
    fs.appendFileSync(out, `${JSON.stringify(row)}\n`);
    saved.push(row);
    process.stderr.write(`  ${row.status} ${row.fallback_reason ?? "none"} ${row.trace_id}\n`);
    const elapsed = Date.now() - started;
    if (elapsed < 2100) await new Promise((resolve) => setTimeout(resolve, 2100 - elapsed));
  }
  publish(saved);
  const rejected = saved.filter((row) => row.fallback_reason === "rejected").length;
  const model = saved.filter((row) => row.fallback_reason != null && row.fallback_reason !== "rejected").length;
  process.stderr.write(`rejected ${rejected} model-call ${model} assembled ${saved.filter((row) => row.fallback_used).length}/${saved.length}\n`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/gate-sample.ts");
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  });
}
