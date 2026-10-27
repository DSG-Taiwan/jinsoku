import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { baselineAttempts } from "./baseline.ts";
import { gradeRuns, summarize, type Grade, type SavedRun, type ScoreSummary } from "./score.ts";

export interface PublishOptions {
  evalDoc: boolean;
  readme: boolean;
  handoff: boolean;
  pack: boolean;
}

const DEFAULTS: PublishOptions = { evalDoc: true, readme: true, handoff: true, pack: true };

const PRIOR_TRACE = "60a0768d-783f-476e-a42b-d9ad8f62158a";
const PRIOR_FINDING = [
  "The first v2 attempt is not this sample. It scored 41/42.",
  "`CAUSE SSA-002` run 1, trace `60a0768d-783f-476e-a42b-d9ad8f62158a`, request `eval-cause-ssa-002-1-c3632289-2782-4f39-ac0d-af689981273f`, status ok, fallback false, grade wrong.",
  "The release cited `ISS-04` and `ISS-05`. Those ids were not in the retrieved rows.",
  "That citation is the finding that triggered the issue-id gate.",
  "The log is `logs/60a0768d-783f-476e-a42b-d9ad8f62158a.jsonl`.",
].join(" ");

function head(): string {
  return execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
}

function fractionLine(label: string, value: string): string {
  return `${label}: ${value}`;
}

function gradeLine(run: SavedRun, grade: Grade): string {
  const bits = [
    run.case_id,
    String(run.run_index),
    run.status,
    grade.grade,
    run.fallback_used ? "fallback" : "no-fallback",
    run.idempotency,
    run.trace_id || "(none)",
    run.request_id,
  ];
  return `| ${bits.join(" | ")} |`;
}

function listGrades(runs: SavedRun[], summary: ScoreSummary, names: Grade["grade"][]): string[] {
  const lines: string[] = [];
  summary.grades.forEach((grade, index) => {
    if (!names.includes(grade.grade)) return;
    const run = runs[index];
    const detail = [
      grade.failed.length ? `missing ${grade.failed.join(", ")}` : "",
      grade.forbids.length ? `forbid ${grade.forbids.join(", ")}` : "",
      grade.unsupported.length ? `unsupported ${grade.unsupported.join(", ")}` : "",
      grade.hazard_downgrade ? "HAZARD downgrade" : "",
      grade.invented_hazard ? "invented open HAZARD" : "",
      grade.name_leaks.length ? `name ${grade.name_leaks.join(", ")}` : "",
      run.error ? `error ${run.error}` : "",
    ].filter(Boolean);
    lines.push(`- ${run.case_id} run ${run.run_index} \`${run.trace_id || "no trace"}\` ${grade.grade}. ${detail.join(". ")}`);
  });
  return lines.length ? lines : ["- None."];
}

function causeSection(summary: ScoreSummary): string[] {
  if (summary.cause_unresolved.length === 0) {
    return ["No CAUSE run returned status unresolved."];
  }
  const blocks: string[] = [];
  for (const row of summary.cause_unresolved) {
    blocks.push(`### ${row.case_id} \`${row.trace_id}\``);
    blocks.push("");
    blocks.push(`Request id \`${row.request_id}\`.`);
    blocks.push("");
    blocks.push("Response `human_message`:");
    blocks.push("");
    blocks.push(indent(row.human_message ?? "(none)"));
    blocks.push("");
    blocks.push("Response `evaluator_findings`:");
    blocks.push("");
    blocks.push(indent(JSON.stringify(row.evaluator_findings)));
    blocks.push("");
    blocks.push("Logged Evaluator critique `output_summary` values, in order. The logger stores at most 500 characters of each line:");
    blocks.push("");
    if (row.evaluator_critiques.length === 0) blocks.push(indent("(no critique line)"));
    for (const critique of row.evaluator_critiques) {
      blocks.push(indent(critique));
      blocks.push("");
    }
    blocks.push("Logged Evaluator exhaust `output_summary` (the issues array at exhaust):");
    blocks.push("");
    blocks.push(indent(row.evaluator_exhaust ?? "(no exhaust line)"));
    blocks.push("");
  }
  return blocks;
}

function indent(text: string): string {
  return text.split("\n").map((line) => `    ${line}`).join("\n");
}

export function evalMarkdown(runs: SavedRun[], summary: ScoreSummary): string {
  const commit = head();
  const baselineGrades = gradeRuns(baselineAttempts().map((attempt, index) => ({
    ...attempt,
    run_index: 0,
    request_id: `baseline-${index}`,
    trace_id: `baseline-${index}`,
    fallback_used: false,
    revision_count: 0,
    human_message: null,
    evaluator_findings: [],
    evaluator_critiques: [],
    evaluator_exhaust: null,
    idempotency: "miss" as const,
    error: null,
  })));
  const baselineSummary = summarize(
    baselineAttempts().map((attempt, index) => ({
      ...attempt,
      run_index: 0,
      request_id: `baseline-${index}`,
      trace_id: `baseline-${index}`,
      fallback_used: false,
      revision_count: 0,
      human_message: null,
      evaluator_findings: [],
      evaluator_critiques: [],
      evaluator_exhaust: null,
      idempotency: "miss" as const,
      error: null,
    })),
    baselineGrades,
  );
  const phraseRows = summary.by_phrase
    .map((row) => `| ${row.phrase} | ${row.runs} | ${row.correct} | ${row.partial} | ${row.wrong} | ${row.miss} | ${row.unresolved} | ${row.errors} | ${row.fallback} | ${row.strict} | ${row.resolved_only} |`)
    .join("\n");
  const runRows = runs.map((run, index) => gradeLine(run, summary.grades[index])).join("\n");
  const lines = [
    "# Labeled accuracy",
    "",
    `Agent tree \`${commit}\`. The eval harness scores that tree. Agent code and prompts were not changed for these cases. Sample date 2026-10-22. Three runs of each case, each with a new request id.`,
    "",
    "Rules and case text: `eval/RUBRIC.md`. Labeled facts: `eval/answer-key.json`. Case list: `eval/cases.json`. Saved outputs: `eval/results/runs.jsonl`.",
    "",
    "## Scores",
    "",
    fractionLine("Strict accuracy (correct / all runs, unresolved and error count as misses)", summary.strict),
    "",
    fractionLine("Accuracy on resolved runs only (correct / runs that were not misses)", summary.resolved_only),
    "",
    fractionLine("CAUSE unresolved rate", summary.cause_unresolved_rate),
    "",
    `Grades: correct ${summary.correct}, partial ${summary.partial}, wrong ${summary.wrong}, miss ${summary.miss}. Unresolved status ${summary.unresolved}. Error or thrown ${summary.errors}. Fallback flag ${summary.fallback}. Idempotency cache hits ${summary.idempotency_hits}.`,
    "",
    `Separate counts, also folded into the grade: unsupported-id runs ${summary.unsupported_runs}, HAZARD downgrade runs ${summary.hazard_downgrade_runs}, invented open HAZARD runs ${summary.invented_hazard_runs}, missed open HAZARD runs ${summary.hazard_missed_runs}, name-leak runs ${summary.name_leak_runs}.`,
    "",
    "Partial is not counted as correct. A miss is an unresolved status, an error status, or a thrown call. The CAUSE unresolved rate counts status `unresolved` only.",
    "",
    "| Phrase | Runs | Correct | Partial | Wrong | Miss | Unresolved | Error | Fallback | Strict | Resolved only |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|",
    phraseRows,
    "",
    `No-model baseline, one answer per case, same rubric: strict ${baselineSummary.strict}.`,
    "",
    "## CAUSE unresolved runs",
    "",
    ...causeSection(summary),
    "## Misses",
    "",
    ...listGrades(runs, summary, ["miss"]),
    "",
    "## Wrong answers",
    "",
    ...listGrades(runs, summary, ["wrong"]),
    "",
    "## Partial answers",
    "",
    ...listGrades(runs, summary, ["partial"]),
    "",
    "## Runs",
    "",
    "| Case | Run | Status | Grade | Fallback | Cache | Trace | Request |",
    "|---|---:|---|---|---|---|---|---|",
    runRows,
    "",
    "## Limits",
    "",
    "Synthetic HVAC rows only. Ten cases, three runs each, one configured model. The week clock is the fixed D2 window, not a rolling calendar. CAUSE does not read incident sequences. NEXT does. PATTERNS can return at most four findings, and a correct this-week or last-week answer has four required groups, so the cap can force a partial. The scorer was not changed after the runs.",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function readmeParagraph(summary: ScoreSummary, baselineStrict: string): string {
  const commit = head().slice(0, 7);
  return [
    `Labeled accuracy is recorded in \`docs/EVAL.md\` (sample of 2026-10-22, agent tree \`${commit}\`). Strict accuracy was ${summary.strict} correct, with unresolved runs counted as misses. Accuracy on the resolved runs only was ${summary.resolved_only}. CAUSE was unresolved on ${summary.cause_unresolved_rate} runs. The no-model baseline scored ${baselineStrict} correct on the same rubric.`,
    "",
  ].join("\n");
}

export function patchReadme(summary: ScoreSummary, baselineStrict: string): void {
  const file = path.join(PROJECT_ROOT, "README.md");
  const marker = "Labeled accuracy is recorded in `docs/EVAL.md`";
  const text = fs.readFileSync(file, "utf8");
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const dep = lines.findIndex((line) => line === "## Dependencies");
  if (dep < 0) throw new Error("README Dependencies heading missing");
  const paragraph = readmeParagraph(summary, baselineStrict).replace(/\n$/, "");
  const existing = lines.findIndex((line) => line.startsWith(marker));
  if (existing >= 0) lines.splice(existing, dep - existing, paragraph, "");
  else lines.splice(dep, 0, paragraph, "");
  fs.writeFileSync(file, lines.join(nl));
}

function handoffMarkdown(runs: SavedRun[], summary: ScoreSummary, index: string): string {
  const commit = head();
  const traces = runs
    .map((run, indexNumber) => `- ${run.case_id} run ${run.run_index} ${summary.grades[indexNumber].grade} status ${run.status} trace \`${run.trace_id || "none"}\` request \`${run.request_id}\` log \`logs/${run.trace_id}.jsonl\``)
    .join("\n");
  return `# Hand-off: dev -> review

## Task
Review the labeled accuracy sample on local branch \`eval\` (development lane). QA re-scores the saved outputs. Audit checks \`docs/EVAL.md\` against the logs. The reviewer decides. Do not push.

## Inputs (the "arguments")
- Agent tree \`${commit}\` (\`122dae6\` when this sample was cut from \`main\`).
- \`eval/RUBRIC.md\`, \`eval/answer-key.json\`, \`eval/cases.json\`, \`eval/results/runs.jsonl\`, \`eval/results/score.json\`, \`docs/EVAL.md\`.
- Audit pack \`Audit\\eval\\\` with \`INDEX.txt\` and SHA-256 hashes. Logs for each trace are copied there. \`logs/\` on this machine has the originals.
- Config names only: \`MODEL_BASE_URL\`, \`MODEL_API_KEY\`, \`NEMOTRON_MODEL\`, \`ZETARIS_REST_URL\`, \`ZETARIS_API_KEY\`, \`ZETARIS_ORG_ID\`.

## Constraints
- Synthetic data only. No write path. Agent code and prompts were not changed on this branch.
- Unresolved runs count as misses. CAUSE unresolved rate is reported on its own, with the Evaluator text from each unresolved run.
- Cutoff: Saturday 2026-10-24, evening. If the gates are not through by then, this does not merge.

## What changed since the last hand-off
- Added the eval harness under \`eval/\` (\`derive.ts\`, \`score.ts\`, \`baseline.ts\`, \`run.ts\`, \`publish.ts\`, \`rescore.ts\`).
- Added \`eval/answer-key.json\`, \`eval/cases.json\`, \`eval/RUBRIC.md\`, \`docs/EVAL.md\`, and a Limits paragraph in \`README.md\`.
- Saved the live outputs in \`eval/results/\`. Audit copies are in \`Audit\\eval\\\`.
- No change under \`src/\`.

## How to run / reproduce
From \`C:\\Dev\\open-agent-hack\` on branch \`eval\`, with the local Zetaris and model env already up:

\`\`\`
npx tsx eval/derive.ts
npm test
npx tsx eval/run.ts
\`\`\`

\`eval/run.ts\` resumes from \`eval/results/runs.jsonl\` and will not repeat a case that already has three saved runs. A fresh sample means moving that file aside first. Re-score saved outputs without a model call:

\`\`\`
npx tsx eval/rescore.ts
\`\`\`

## Expected result
Headline: strict ${summary.strict}, resolved-only ${summary.resolved_only}, CAUSE unresolved ${summary.cause_unresolved_rate}. Correct ${summary.correct}, partial ${summary.partial}, wrong ${summary.wrong}, miss ${summary.miss}. Fallback runs ${summary.fallback}. Idempotency hits ${summary.idempotency_hits}.

Misses:

${listGrades(runs, summary, ["miss"]).join("\n")}

Wrong answers:

${listGrades(runs, summary, ["wrong"]).join("\n")}

Trace ids:

${traces}

## Open questions and known problems
QA has not re-scored this sample yet. Audit has not checked \`docs/EVAL.md\` yet. The harness was not tuned after the runs.

## Return format
QA: a note listing any score it disagrees with, by case id and trace id. Audit: truthfulness findings against the logs, file and line. Reviewer: merge decision.

## Audit index

\`\`\`
${index.trim()}
\`\`\`
`;
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

export function packAudit(runs: SavedRun[]): string {
  const dest = path.join(PROJECT_ROOT, "Audit", "eval");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const copies: { name: string; source: string }[] = [
    { name: "docs__EVAL.md", source: path.join(PROJECT_ROOT, "docs", "EVAL.md") },
    { name: "eval__RUBRIC.md", source: path.join(PROJECT_ROOT, "eval", "RUBRIC.md") },
    { name: "eval__answer-key.json", source: path.join(PROJECT_ROOT, "eval", "answer-key.json") },
    { name: "eval__cases.json", source: path.join(PROJECT_ROOT, "eval", "cases.json") },
    { name: "eval__results__runs.jsonl", source: path.join(PROJECT_ROOT, "eval", "results", "runs.jsonl") },
    { name: "eval__results__score.json", source: path.join(PROJECT_ROOT, "eval", "results", "score.json") },
  ];
  for (const run of runs) {
    if (!run.trace_id) continue;
    const source = path.join(PROJECT_ROOT, "logs", `${run.trace_id}.jsonl`);
    if (!fs.existsSync(source)) continue;
    copies.push({ name: `log__${run.trace_id}.jsonl.txt`, source });
  }
  const lines = ["sha256  bytes  file"];
  for (const copy of copies) {
    const target = path.join(dest, copy.name);
    fs.copyFileSync(copy.source, target);
    const bytes = fs.statSync(target).size;
    lines.push(`${sha256(target)}  ${bytes}  ${copy.name}`);
  }
  const readme = [
    "Eval audit pack, 2026-10-22.",
    "Logs are copies of logs/<trace_id>.jsonl from the machine that ran eval/run.ts.",
    "INDEX.txt lists SHA-256 of each file in this folder except INDEX.txt and this readme.",
    "No .env and no keys.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dest, "00-README.txt"), readme);
  const index = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(dest, "INDEX.txt"), index);
  const indexLine = `${sha256(path.join(dest, "INDEX.txt"))}  ${Buffer.byteLength(index)}  INDEX.txt`;
  return `${index}${indexLine}\n`;
}

interface Authorship {
  released: number;
  model: number;
  modelCorrect: number;
  code: number;
  codeCorrect: number;
  type1: number;
  type2: number;
}

function authorship(runs: SavedRun[], grades: Grade[]): Authorship {
  const rows = runs.map((run, index) => ({ run, grade: grades[index] }));
  const released = rows.filter((row) => row.run.status === "ok");
  const model = released.filter((row) => !row.run.fallback_used);
  const code = released.filter((row) => row.run.fallback_used);
  const count = (list: typeof released, pick: (row: (typeof released)[number]) => boolean) => list.filter(pick).length;
  return {
    released: released.length,
    model: model.length,
    modelCorrect: count(model, (row) => row.grade.grade === "correct"),
    code: code.length,
    codeCorrect: count(code, (row) => row.grade.grade === "correct"),
    type1: count(released, (row) => row.grade.invented_hazard),
    type2: count(released, (row) => row.grade.hazard_missed),
  };
}

function loadJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, rel), "utf8")) as T;
}

function comparisonMarkdown(v2Runs: SavedRun[], v2: ScoreSummary, v1Runs: SavedRun[], v1: ScoreSummary, v1Body: string): string {
  const a1 = authorship(v1Runs, v1.grades);
  const a2 = authorship(v2Runs, v2.grades);
  const baseline = gradeRuns(baselineAttempts());
  const baselineStrict = `${baseline.filter((grade) => grade.grade === "correct").length}/${baseline.length}`;
  const row = (label: string, left: string, right: string) => `| ${label} | ${left} | ${right} |`;
  const phrase = (summary: ScoreSummary, name: string) => summary.by_phrase.find((item) => item.phrase === name);
  const lines = [
    "# Labeled accuracy",
    "",
    "v1 is the 2026-10-22 sample, frozen in `eval/results/runs.jsonl` and `eval/results/score.json`. v2 re-ran those 10 cases and added four cases the v1 sample had not used. The grade rules were not changed after the v2 runs. Type I, Type II, and unresolved are counted apart. Model-authored and code-assembled releases are counted apart.",
    "",
    "Type I is an invented open HAZARD on a released answer. Type II is a missed open HAZARD on a released answer. Unresolved is status `unresolved` and is not a released answer. Model-authored means status `ok` and `fallback_used` false. Code-assembled means status `ok` and `fallback_used` true.",
    "",
    "## Side by side",
    "",
    "| | v1 | v2 |",
    "|---|---|---|",
    row("Runs", String(v1.runs), String(v2.runs)),
    row("Strict accuracy", v1.strict, v2.strict),
    row("Resolved-only accuracy", v1.resolved_only, v2.resolved_only),
    row("Correct / partial / wrong / miss", `${v1.correct} / ${v1.partial} / ${v1.wrong} / ${v1.miss}`, `${v2.correct} / ${v2.partial} / ${v2.wrong} / ${v2.miss}`),
    row("Unresolved", String(v1.unresolved), String(v2.unresolved)),
    row("Error or thrown", String(v1.errors), String(v2.errors)),
    row("Type I invented open HAZARD, released answers", String(a1.type1), String(a2.type1)),
    row("Type II missed open HAZARD, released answers", String(a1.type2), String(a2.type2)),
    row("Model-authored releases (correct)", `${a1.model} (${a1.modelCorrect} correct)`, `${a2.model} (${a2.modelCorrect} correct)`),
    row("Code-assembled releases (correct)", `${a1.code} (${a1.codeCorrect} correct)`, `${a2.code} (${a2.codeCorrect} correct)`),
    row("CAUSE unresolved", v1.cause_unresolved_rate, v2.cause_unresolved_rate),
    row("CAUSE strict", phrase(v1, "CAUSE")?.strict ?? "", phrase(v2, "CAUSE")?.strict ?? ""),
    row("PATTERNS strict", phrase(v1, "PATTERNS")?.strict ?? "", phrase(v2, "PATTERNS")?.strict ?? ""),
    row("NEXT strict", phrase(v1, "NEXT")?.strict ?? "", phrase(v2, "NEXT")?.strict ?? ""),
    row("Refusal strict", phrase(v1, "refusal")?.strict ?? "", phrase(v2, "refusal")?.strict ?? ""),
    row("No-model baseline", "10/10", baselineStrict),
    "",
    "The target for released answers is zero Type I and zero Type II.",
    "",
    "On the v1 sample, `fallback_used` true is the earlier heuristic flag. One v1 release carried it. The headline `assembled from records, no model synthesis` is only on v2.",
    "",
    "## What the reliability edits changed",
    "",
    "The finding cap went from 4 to 8, and the claim-length guidance went from 140 characters to 320. Retrieved issue rows are stored whole. The model payload keeps whole rows, up to 4000 characters, instead of clipping each summary at 140 characters. Memory text is stored whole. The world-model read returns every unit, so a week answer can see both open HAZARD units. A sentence that names an issue id is checked against that id's full reason. A sentence with no issue id is still checked by date and actor.",
    "",
    "A failed model draft is replaced by an answer built from the retrieved rows. The headline is `assembled from records, no model synthesis` and `fallback_used` is true. That path runs only after ingest and the role check. The SQL is the fixed SELECT list, and an asset id that is not in the catalog becomes `WHERE 1 = 0`.",
    "",
    "Every released CAUSE, PATTERNS, and NEXT answer gets an open-HAZARD block built from a retrieved Zetaris HAZARD row and a retrieved World Model count of at least 1. When every retrieved World Model count is 0, the block says `Open HAZARD count 0.` The linter rejects an open-HAZARD claim for an asset those two sources do not both show.",
    "",
    "A released answer cannot cite an issue id that was not in the retrieved rows. The evaluator rejects that draft. If the model keeps the id, the release is assembled from the retrieved rows and those sentences are dropped. The response does not repeat the blocked id. The log records it.",
    "",
    "## Finding that triggered the issue-id gate",
    "",
    PRIOR_FINDING,
    "",
    "## v2 sample",
    "",
    `Agent tree \`${head()}\`, which is the branch point. The sample ran with the uncommitted reliability edits on top of that commit. This file is a from-scratch re-run after the issue-id gate. Sample date 2026-10-23. Fourteen cases, three runs each. Saved outputs: \`eval/results/v2-runs.jsonl\`.`,
    "",
    fractionLine("Strict accuracy", v2.strict),
    "",
    fractionLine("Accuracy on resolved runs only", v2.resolved_only),
    "",
    fractionLine("CAUSE unresolved rate", v2.cause_unresolved_rate),
    "",
    `Type I ${a2.type1}. Type II ${a2.type2}. Unresolved ${v2.unresolved}. Model-authored ${a2.model}, of which ${a2.modelCorrect} correct. Code-assembled ${a2.code}, of which ${a2.codeCorrect} correct.`,
    "",
    "| Phrase | Runs | Correct | Partial | Wrong | Miss | Unresolved | Error | Fallback | Strict | Resolved only |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|",
    v2.by_phrase
      .map((item) => `| ${item.phrase} | ${item.runs} | ${item.correct} | ${item.partial} | ${item.wrong} | ${item.miss} | ${item.unresolved} | ${item.errors} | ${item.fallback} | ${item.strict} | ${item.resolved_only} |`)
      .join("\n"),
    "",
    `No-model baseline on the fourteen cases: strict ${baselineStrict}.`,
    "",
    "### CAUSE unresolved runs",
    "",
    ...causeSection(v2),
    "### Misses",
    "",
    ...listGrades(v2Runs, v2, ["miss"]),
    "",
    "### Wrong answers",
    "",
    ...listGrades(v2Runs, v2, ["wrong"]),
    "",
    "### Partial answers",
    "",
    ...listGrades(v2Runs, v2, ["partial"]),
    "",
    "### Runs",
    "",
    "| Case | Run | Status | Grade | Fallback | Cache | Trace | Request |",
    "|---|---:|---|---|---|---|---|---|",
    v2Runs.map((run, index) => gradeLine(run, v2.grades[index])).join("\n"),
    "",
    "## v1 sample",
    "",
    v1Body.trim(),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function patchReadmeV2(v2: ScoreSummary, counts: Authorship): void {
  const file = path.join(PROJECT_ROOT, "README.md");
  const marker = "The reliability sample is recorded in `docs/EVAL.md`";
  const text = fs.readFileSync(file, "utf8");
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const paragraph = `${marker} (sample of 2026-10-23). Strict accuracy was ${v2.strict} correct, with unresolved runs counted as misses. Released answers had Type I ${counts.type1} and Type II ${counts.type2}. Unresolved runs were ${v2.unresolved}. Model-authored releases were ${counts.model}. Code-assembled releases were ${counts.code}.`;
  const existing = lines.findIndex((line) => line.startsWith(marker));
  if (existing >= 0) lines.splice(existing, 1, paragraph);
  else {
    const v1 = lines.findIndex((line) => line.startsWith("Labeled accuracy is recorded in `docs/EVAL.md`"));
    if (v1 < 0) throw new Error("README labeled-accuracy paragraph missing");
    lines.splice(v1 + 1, 0, paragraph);
  }
  fs.writeFileSync(file, lines.join(nl));
}

function reliabilityHandoff(runs: SavedRun[], summary: ScoreSummary, counts: Authorship, index: string): string {
  const traces = runs
    .map((run, indexNumber) => `- ${run.case_id} run ${run.run_index} ${summary.grades[indexNumber].grade} status ${run.status} fallback ${run.fallback_used} trace \`${run.trace_id || "none"}\` request \`${run.request_id}\``)
    .join("\n");
  return `# Hand-off: dev -> review

## Task
Review the reliability sample on local branch \`reliability\`. QA designs its own tests. Audit audits. The reviewer runs the BVT before anything merges. Do not push.

## Inputs (the "arguments")
- Agent tree \`${head()}\`, cut from \`eval\` at \`2e5f966\`.
- v1 sample: \`eval/results/runs.jsonl\`, \`eval/results/score.json\`, and the v1 section of \`docs/EVAL.md\`.
- v2 sample: \`eval/results/v2-runs.jsonl\`, \`eval/results/v2-score.json\`, \`eval/RUBRIC.md\`, \`eval/answer-key.json\`, \`eval/cases.json\`.
- Audit pack \`Audit\\reliability\\\` with \`INDEX.txt\` and SHA-256 hashes.
- Config names only: \`MODEL_BASE_URL\`, \`MODEL_API_KEY\`, \`NEMOTRON_MODEL\`, \`ZETARIS_REST_URL\`, \`ZETARIS_API_KEY\`, \`ZETARIS_ORG_ID\`.

## Constraints
- Synthetic data only. No write path. \`eval\` was not changed after \`2e5f966\`.
- The original 10 cases and the grade rules were not edited after the v2 runs. Four cases were added before the run.
- A released answer is the target for zero missed open HAZARDs and zero invented ones. Unresolved stays a separate count.
- Cutoff: Saturday 2026-10-24, evening.

## What changed since the last hand-off
- An open-HAZARD block is built from retrieved Zetaris rows and World Model counts and attached to every released CAUSE, PATTERNS, and NEXT answer.
- The linter and the evaluator block an open-HAZARD claim for an asset those two sources do not both show.
- PATTERNS can now hold eight findings, and retrieved issue rows are no longer clipped mid-reason. The world-model read returns every unit. A sentence that names an issue id is checked against that id's reason, so two incidents on the same day and actor are not treated as one chopped reason. The v1 last-week runs died on a truncated reason or on the old fallback headline, which the linter refused to release.
- When the model draft fails, the release is assembled from the full retrieved rows, with no model text. The headline is \`assembled from records, no model synthesis\` and \`fallback_used\` is true. It still has to pass the linter and the evaluator.
- A released answer cannot cite an issue id that was not in the retrieved rows. Trace \`60a0768d-783f-476e-a42b-d9ad8f62158a\` is the finding that put that gate in. It is not a row in this sample.
- That assembly runs only after ingest and the role check. The SQL stays the fixed SELECT list. An asset id outside the catalog becomes \`WHERE 1 = 0\`. Rows whose actor id is not \`ACT-N\` are dropped. The board escapes every interpolated value.

## How to run / reproduce
From \`C:\\Dev\\open-agent-hack\` on branch \`reliability\`, with the local Zetaris and model env already up:

\`\`\`
npx tsx eval/derive.ts
npm test
npx tsx eval/run.ts v2
\`\`\`

\`eval/run.ts v2\` writes \`eval/results/v2-runs.jsonl\` and does not append to the v1 file. It resumes a v2 case that already has three saved runs. This published sample was started from an empty \`v2-runs.jsonl\`. The earlier file was set aside as \`eval/results/v2-prior-runs.jsonl\`.

## Recorded sample
v2 strict ${summary.strict}. Resolved-only ${summary.resolved_only}. CAUSE unresolved ${summary.cause_unresolved_rate}. Correct ${summary.correct}, partial ${summary.partial}, wrong ${summary.wrong}, miss ${summary.miss}.

Type I ${counts.type1}. Type II ${counts.type2}. Unresolved ${summary.unresolved}. Model-authored ${counts.model} (${counts.modelCorrect} correct). Code-assembled ${counts.code} (${counts.codeCorrect} correct).

Misses:

${listGrades(runs, summary, ["miss"]).join("\n")}

Wrong answers:

${listGrades(runs, summary, ["wrong"]).join("\n")}

Partial answers:

${listGrades(runs, summary, ["partial"]).join("\n")}

Trace ids:

${traces}

## Open questions and known problems
QA has not tested this branch yet. It designs its own tests. Audit has not checked the pack yet. The reviewer has not run the BVT. The cases and the rubric were not tuned after the v2 runs. ${PRIOR_FINDING}

## Return format
QA: the tests it designed, with notes by case id and trace id. Audit: findings against the pack, file and hash. Reviewer: BVT result and the merge decision.

## Audit index

\`\`\`
${index.trim()}
\`\`\`
`;
}

function packReliability(runs: SavedRun[]): string {
  const dest = path.join(PROJECT_ROOT, "Audit", "reliability");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  const copies: { name: string; source: string }[] = [
    { name: "docs__EVAL.md", source: path.join(PROJECT_ROOT, "docs", "EVAL.md") },
    { name: "eval__RUBRIC.md", source: path.join(PROJECT_ROOT, "eval", "RUBRIC.md") },
    { name: "eval__answer-key.json", source: path.join(PROJECT_ROOT, "eval", "answer-key.json") },
    { name: "eval__cases.json", source: path.join(PROJECT_ROOT, "eval", "cases.json") },
    { name: "eval__results__runs.jsonl", source: path.join(PROJECT_ROOT, "eval", "results", "runs.jsonl") },
    { name: "eval__results__score.json", source: path.join(PROJECT_ROOT, "eval", "results", "score.json") },
    { name: "eval__results__v2-runs.jsonl", source: path.join(PROJECT_ROOT, "eval", "results", "v2-runs.jsonl") },
    { name: "eval__results__v2-score.json", source: path.join(PROJECT_ROOT, "eval", "results", "v2-score.json") },
  ];
  for (const run of runs) {
    if (!run.trace_id) continue;
    const source = path.join(PROJECT_ROOT, "logs", `${run.trace_id}.jsonl`);
    if (!fs.existsSync(source)) continue;
    copies.push({ name: `log__${run.trace_id}.jsonl.txt`, source });
  }
  const priorLog = path.join(PROJECT_ROOT, "logs", `${PRIOR_TRACE}.jsonl`);
  if (!fs.existsSync(priorLog)) throw new Error(`prior finding log missing: ${PRIOR_TRACE}`);
  copies.push({ name: `log__${PRIOR_TRACE}.jsonl.txt`, source: priorLog });
  const lines = ["sha256  bytes  file"];
  for (const copy of copies) {
    const target = path.join(dest, copy.name);
    fs.copyFileSync(copy.source, target);
    lines.push(`${sha256(target)}  ${fs.statSync(target).size}  ${copy.name}`);
  }
  fs.writeFileSync(
    path.join(dest, "00-README.txt"),
    [
      "Reliability audit pack, 2026-10-23.",
      "v1 outputs are the frozen 2026-10-22 sample. v2 outputs are eval/results/v2-runs.jsonl.",
      "Logs are copies of logs/<trace_id>.jsonl from the machine that ran eval/run.ts v2.",
      `log__${PRIOR_TRACE}.jsonl.txt is the earlier finding. It is not one of the 42 runs in v2-runs.jsonl.`,
      "INDEX.txt lists SHA-256 of each file in this folder except INDEX.txt and this readme.",
      "No .env and no keys.",
      "",
    ].join("\n"),
  );
  const index = `${lines.join("\n")}\n`;
  fs.writeFileSync(path.join(dest, "INDEX.txt"), index);
  return `${index}${sha256(path.join(dest, "INDEX.txt"))}  ${Buffer.byteLength(index)}  INDEX.txt\n`;
}

export function publishV2(runs: SavedRun[], summary: ScoreSummary): void {
  const v1Runs = fs
    .readFileSync(path.join(PROJECT_ROOT, "eval", "results", "runs.jsonl"), "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as SavedRun);
  const v1 = loadJson<ScoreSummary>("eval/results/score.json");
  if (v1Runs.length !== v1.grades.length) throw new Error("v1 runs and grades differ");
  if (runs.length !== summary.grades.length) throw new Error("v2 runs and grades differ");
  const snapshot = path.join(PROJECT_ROOT, "eval", "results", "v1-report.md");
  if (!fs.existsSync(snapshot)) fs.copyFileSync(path.join(PROJECT_ROOT, "docs", "EVAL.md"), snapshot);
  const v1Body = fs.readFileSync(snapshot, "utf8");
  const counts = authorship(runs, summary.grades);
  fs.writeFileSync(path.join(PROJECT_ROOT, "docs", "EVAL.md"), comparisonMarkdown(runs, summary, v1Runs, v1, v1Body));
  patchReadmeV2(summary, counts);
  const index = packReliability(runs);
  fs.writeFileSync(path.join(PROJECT_ROOT, "handoffs", "2026-10-23-reliability.md"), reliabilityHandoff(runs, summary, counts, index));
}

export function publish(runs: SavedRun[], summary: ScoreSummary, options: PublishOptions = DEFAULTS): void {
  const baseline = gradeRuns(baselineAttempts());
  const baselineCorrect = baseline.filter((grade) => grade.grade === "correct").length;
  const baselineStrict = `${baselineCorrect}/${baseline.length}`;
  if (options.evalDoc) {
    fs.writeFileSync(path.join(PROJECT_ROOT, "docs", "EVAL.md"), evalMarkdown(runs, summary));
  }
  if (options.readme) patchReadme(summary, baselineStrict);
  if (options.pack || options.handoff) {
    const index = options.pack ? packAudit(runs) : fs.readFileSync(path.join(PROJECT_ROOT, "Audit", "eval", "INDEX.txt"), "utf8");
    if (options.handoff) {
      fs.writeFileSync(path.join(PROJECT_ROOT, "handoffs", "2026-10-22-eval.md"), handoffMarkdown(runs, summary, index));
    }
  }
}
