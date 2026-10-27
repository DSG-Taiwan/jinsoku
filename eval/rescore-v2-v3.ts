import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { gradeRuns, summarize, type SavedRun, type ScoreSummary } from "./score.ts";

/**
 * Scores the saved v2 and v3 records with one scorer, the one in eval/score.ts at this commit.
 * The saved v2-score.json and v3-score.json are not touched; they keep the scorer they were made with.
 * Usage: tsx eval/rescore-v2-v3.ts
 */
const RESULTS = path.join(PROJECT_ROOT, "eval", "results");

function load(version: string): { runs: SavedRun[]; saved: ScoreSummary } {
  const runs = fs
    .readFileSync(path.join(RESULTS, `${version}-runs.jsonl`), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SavedRun);
  const saved = JSON.parse(fs.readFileSync(path.join(RESULTS, `${version}-score.json`), "utf8")) as ScoreSummary;
  return { runs, saved };
}

const out: Record<string, unknown> = {};
for (const version of ["v2", "v3"]) {
  const { runs, saved } = load(version);
  const grades = gradeRuns(runs);
  const summary = summarize(runs, grades);
  const split = (pick: (run: SavedRun, phrase: string) => boolean) => {
    const idx = runs.map((run, i) => (pick(run, grades[i].phrase) ? i : -1)).filter((i) => i >= 0);
    return `${idx.filter((i) => grades[i].grade === "correct").length}/${idx.length}`;
  };
  const changed = grades
    .map((grade, i) => ({ i, was: saved.grades[i]?.grade, now: grade.grade, case_id: grade.case_id, run_index: runs[i].run_index }))
    .filter((row) => row.was !== row.now);
  out[version] = {
    rescored_strict: summary.strict,
    saved_strict: saved.strict,
    rescored_counts: { correct: summary.correct, partial: summary.partial, wrong: summary.wrong, miss: summary.miss },
    model_authored_correct: split((run, phrase) => run.status === "ok" && !run.fallback_used && phrase !== "refusal"),
    code_assembled_correct: split((run) => run.status === "ok" && run.fallback_used),
    invented_hazard_runs: summary.invented_hazard_runs,
    hazard_missed_runs: summary.hazard_missed_runs,
    grades_that_differ_from_saved: changed,
  };
}
fs.writeFileSync(path.join(RESULTS, "rescore-v2-v3.json"), `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
