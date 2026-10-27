import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { health, runRequest } from "../src/orchestrator.ts";
import { setModelSelection } from "../src/llm/client.ts";
import { caseSpecs } from "./derive.ts";
import { answerText, gradeRuns, summarize, type SavedRun } from "./score.ts";

const CHOSEN = "nvidia/nemotron-3.5-lightning-30b-a3b";

async function oneRun(specId: string, query: string, role: string, runIndex: number): Promise<SavedRun> {
  const requestId = `v3-${specId}-${runIndex}-${randomUUID()}`;
  const response = await runRequest({
    request_id: requestId,
    user_query: query,
    context: { role, track: "Wildcard [Tinkerer]" },
  });
  return {
    case_id: specId,
    run_index: runIndex,
    request_id: response.request_id,
    trace_id: response.trace_id,
    status: response.status,
    agents_used: response.agents_used,
    fallback_used: Boolean(response.result.fallback_used),
    revision_count: response.collaboration.revision_count,
    reason_code: response.result.reason_code ?? null,
    human_message: response.result.human_message ?? null,
    evaluator_findings: response.collaboration.evaluator_findings ?? [],
    evaluator_critiques: [],
    evaluator_exhaust: null,
    text: answerText(response.result),
    idempotency: "miss",
    error: null,
    response: { ...response, log_path: `logs/${response.trace_id}.jsonl` },
  };
}

async function main(): Promise<void> {
  setModelSelection({ route: "direct", model: CHOSEN });
  const status = await health();
  if (!status.ok) throw new Error("health check failed");
  const specs = caseSpecs();
  const out = path.join(PROJECT_ROOT, "eval", "results", "v3-runs.jsonl");
  const saved: SavedRun[] = fs.existsSync(out)
    ? fs.readFileSync(out, "utf8").split(/\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as SavedRun)
    : [];
  for (const spec of specs) {
    const have = saved.filter((run) => run.case_id === spec.id).length;
    for (let index = have; index < 3; index += 1) {
      process.stderr.write(`v3 ${spec.id} ${index + 1}/3\n`);
      const record = await oneRun(spec.id, spec.query, spec.role, index);
      fs.appendFileSync(out, `${JSON.stringify(record)}\n`);
      saved.push(record);
      process.stderr.write(`  ${record.status} fallback=${record.fallback_used}\n`);
    }
  }
  const summary = summarize(saved, gradeRuns(saved));
  fs.writeFileSync(path.join(PROJECT_ROOT, "eval", "results", "v3-score.json"), `${JSON.stringify(summary, null, 2)}\n`);
  const v1 = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "eval", "results", "score.json"), "utf8")) as { strict: string };
  const v2 = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "eval", "results", "v2-score.json"), "utf8")) as { strict: string };
  const section = `## v3 sample

Same cases and rubric as v1 and v2. Direct route, model \`${CHOSEN}\`. The original v1 and v2 tables above are unchanged.

| Sample | Strict | Correct | Partial | Wrong | Miss | Invented open HAZARD | Missed open HAZARD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v1 | ${v1.strict} | 17 | 1 | 5 | 7 | 2 | 3 |
| v2 | ${v2.strict} | 38 | 1 | 2 | 1 | 1 | 0 |
| v3 | ${summary.strict} | ${summary.correct} | ${summary.partial} | ${summary.wrong} | ${summary.miss} | ${summary.invented_hazard_runs} | ${summary.hazard_missed_runs} |

Rows: \`eval/results/v3-runs.jsonl\`.
`;
  const evalPath = path.join(PROJECT_ROOT, "docs", "EVAL.md");
  const current = fs.readFileSync(evalPath, "utf8");
  const marker = "## v3 sample";
  const at = current.indexOf(marker);
  const base = (at === -1 ? current : current.slice(0, at)).replace(/\s*$/, "\n\n");
  fs.writeFileSync(evalPath, `${base}${section}`);
  process.stderr.write(`v3 strict ${summary.strict}\n`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/run-v3.ts");
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  });
}
