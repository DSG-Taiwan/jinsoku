import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { health, runRequest } from "../src/orchestrator.ts";
import { setModelSelection } from "../src/llm/client.ts";
import { caseSpecs } from "./derive.ts";
import { answerText, gradeRuns, summarize, type SavedRun } from "./score.ts";

/**
 * v4 labeled sample: same cases and rubric as v1 to v3, scored by the scorer at this commit.
 * Resumes from eval/results/v4-runs.jsonl. v1 to v3 files and sections are not touched.
 */
const GAP_MS = Number(process.env.V4_GAP_MS ?? 6000);
/** V4_TAG names a separate result set (for example v4b); V4_ONLY keeps the cases whose id starts with it (for example cause). Only the untagged run writes docs/EVAL.md. */
const TAG = process.env.V4_TAG ?? "v4";
const ONLY = process.env.V4_ONLY ?? "";
const CHOSEN = "nvidia/nemotron-3.5-lightning-30b-a3b";
const RESULTS = path.join(PROJECT_ROOT, "eval", "results");

async function oneRun(specId: string, query: string, role: string, runIndex: number): Promise<SavedRun> {
  const response = await runRequest({
    request_id: `${TAG}-${specId}-${runIndex}-${randomUUID()}`,
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

interface Rescored {
  rescored_strict: string;
  rescored_counts: { correct: number; partial: number; wrong: number; miss: number };
  invented_hazard_runs: number;
  hazard_missed_runs: number;
}

function row(name: string, r: Rescored): string {
  const c = r.rescored_counts;
  return `| ${name} | ${r.rescored_strict} | ${c.correct} | ${c.partial} | ${c.wrong} | ${c.miss} | ${r.invented_hazard_runs} | ${r.hazard_missed_runs} |`;
}

async function main(): Promise<void> {
  setModelSelection(process.env.MODEL_ROUTE === "paid" ? { route: "paid", model: null } : { route: "direct", model: CHOSEN });
  const status = await health();
  if (!status.ok) throw new Error("health check failed");
  const out = path.join(RESULTS, `${TAG}-runs.jsonl`);
  const saved: SavedRun[] = fs.existsSync(out)
    ? fs.readFileSync(out, "utf8").split(/\n/).filter((line) => line.trim()).map((line) => JSON.parse(line) as SavedRun)
    : [];
  for (const spec of caseSpecs().filter((item) => item.id.startsWith(ONLY))) {
    const have = saved.filter((run) => run.case_id === spec.id).length;
    for (let index = have; index < 3; index += 1) {
      process.stderr.write(`${TAG} ${spec.id} ${index + 1}/3\n`);
      const record = await oneRun(spec.id, spec.query, spec.role, index);
      fs.appendFileSync(out, `${JSON.stringify(record)}\n`);
      saved.push(record);
      process.stderr.write(`  ${record.status} fallback=${record.fallback_used}\n`);
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }
  }
  const summary = summarize(saved, gradeRuns(saved));
  fs.writeFileSync(path.join(RESULTS, `${TAG}-score.json`), `${JSON.stringify(summary, null, 2)}\n`);
  if (TAG !== "v4") {
    process.stderr.write(`${TAG} strict ${summary.strict}
`);
    return;
  }
  const rescored = JSON.parse(fs.readFileSync(path.join(RESULTS, "rescore-v2-v3.json"), "utf8")) as Record<string, Rescored>;
  const section = [
    "## v4 sample",
    "",
    `Same cases and rubric as v1 to v3, scored with the scorer at this commit. v2 and v3 are rescored with that same scorer (\`eval/results/rescore-v2-v3.json\`). Direct route, model \`${CHOSEN}\`, a ${GAP_MS} ms pause after every run. The code commit is named in the hand-off.`,
    "",
    "| Sample | Strict | Correct | Partial | Wrong | Miss | Invented open HAZARD | Missed open HAZARD |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    row("v2 (rescored)", rescored.v2),
    row("v3 (rescored)", rescored.v3),
    `| v4 | ${summary.strict} | ${summary.correct} | ${summary.partial} | ${summary.wrong} | ${summary.miss} | ${summary.invented_hazard_runs} | ${summary.hazard_missed_runs} |`,
    "",
    "Rows: `eval/results/v4-runs.jsonl`.",
    "",
  ].join("\n");
  const evalPath = path.join(PROJECT_ROOT, "docs", "EVAL.md");
  const current = fs.readFileSync(evalPath, "utf8");
  const at = current.indexOf("## v4 sample");
  const base = (at === -1 ? current : current.slice(0, at)).replace(/\s*$/, "\n\n");
  fs.writeFileSync(evalPath, `${base}${section}`);
  process.stderr.write(`v4 strict ${summary.strict}\n`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/run-v4.ts");
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  });
}
