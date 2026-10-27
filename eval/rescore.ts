import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT } from "../src/config.ts";
import { publish } from "./publish.ts";
import { gradeRuns, summarize, type SavedRun } from "./score.ts";

function loadRuns(): SavedRun[] {
  const file = path.join(PROJECT_ROOT, "eval", "results", "runs.jsonl");
  return fs
    .readFileSync(file, "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as SavedRun);
}

const isMain = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
);

if (isMain) {
  const runs = loadRuns();
  const grades = gradeRuns(runs);
  const summary = summarize(runs, grades);
  fs.writeFileSync(path.join(PROJECT_ROOT, "eval", "results", "score.json"), `${JSON.stringify(summary, null, 2)}\n`);
  publish(runs, summary, { evalDoc: true, readme: false, handoff: false, pack: false });
  process.stderr.write(`rescored ${summary.strict} resolved ${summary.resolved_only}\n`);
}
