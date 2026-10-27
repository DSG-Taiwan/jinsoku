import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PROJECT_ROOT } from "../src/config.ts";
import { health, runRequest } from "../src/orchestrator.ts";
import { redact, logPathFor } from "../src/tracing.ts";
import { caseSpecs } from "./derive.ts";
import { publish, publishV2 } from "./publish.ts";
import { answerText, gradeRuns, summarize, type SavedRun } from "./score.ts";

const RUNS_PER_CASE = 3;

function agentTreeDirty(): string {
  return execSync("git diff --name-only HEAD -- src", { cwd: PROJECT_ROOT, encoding: "utf8" }).trim();
}

function readIdempotencyIds(): Set<string> {
  try {
    const raw = fs.readFileSync(path.join(PROJECT_ROOT, "data", "idempotency.json"), "utf8");
    return new Set(Object.keys(JSON.parse(raw) as Record<string, unknown>));
  } catch {
    return new Set();
  }
}

function logNames(): Set<string> {
  const dir = path.join(PROJECT_ROOT, "logs");
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir));
}

function evaluatorNotes(traceId: string): { critiques: string[]; exhaust: string | null } {
  const file = logPathFor(traceId);
  if (!fs.existsSync(file)) return { critiques: [], exhaust: null };
  const critiques: string[] = [];
  let exhaust: string | null = null;
  for (const line of fs.readFileSync(file, "utf8").split(/\n/)) {
    if (!line.trim()) continue;
    const event = JSON.parse(line) as { agent_name?: string; action?: string; output_summary?: string };
    if (event.agent_name !== "evaluator") continue;
    if (event.action === "critique") critiques.push(String(event.output_summary ?? ""));
    if (event.action === "exhaust") exhaust = String(event.output_summary ?? "");
  }
  return { critiques, exhaust };
}

function loadSaved(file: string): SavedRun[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as SavedRun);
}

async function oneRun(specId: string, query: string, role: string, runIndex: number, seenTraces: Set<string>): Promise<SavedRun> {
  for (let tryNumber = 0; tryNumber < 2; tryNumber++) {
    const requestId = `eval-${specId}-${runIndex}-${randomUUID()}`;
    if (requestId.length > 80) throw new Error("request_id longer than 80");
    const knownIds = readIdempotencyIds();
    const knownLogs = logNames();
    if (knownIds.has(requestId)) throw new Error(`request_id already stored ${requestId}`);
    const response = await runRequest({
      request_id: requestId,
      user_query: query,
      context: { role, track: "Wildcard [Tinkerer]" },
    });
    const logName = `${response.trace_id}.jsonl`;
    const cacheHit = knownLogs.has(logName) || seenTraces.has(response.trace_id);
    if (cacheHit && tryNumber === 0) {
      process.stderr.write(`  cache hit ${response.trace_id}, retrying with a new request_id\n`);
      continue;
    }
    seenTraces.add(response.trace_id);
    const notes = evaluatorNotes(response.trace_id);
    const stored = { ...response, log_path: `logs/${response.trace_id}.jsonl` };
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
      evaluator_critiques: notes.critiques,
      evaluator_exhaust: notes.exhaust,
      text: answerText(response.result),
      idempotency: cacheHit ? "hit" : "miss",
      error: null,
      response: stored,
    };
  }
  throw new Error(`no fresh run for ${specId}`);
}

async function main(): Promise<void> {
  const v2 = process.argv[2] === "v2";
  const dirty = agentTreeDirty();
  if (dirty && !v2) throw new Error(`src differs from HEAD:\n${dirty}`);
  if (dirty && v2) process.stderr.write(`src differs from HEAD. The v2 sample includes these reliability edits:\n${dirty}\n`);
  const status = await health();
  if (!status.ok) {
    process.stderr.write(`${redact(JSON.stringify({ ok: status.ok, env: status.env, dependencies: status.dependencies }))}\n`);
    throw new Error("health check failed");
  }
  const specs = caseSpecs();
  const outDir = path.join(PROJECT_ROOT, "eval", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, v2 ? "v2-runs.jsonl" : "runs.jsonl");
  const saved = loadSaved(outFile);
  const seenTraces = new Set(saved.map((run) => run.trace_id));
  for (const spec of specs) {
    const have = saved.filter((run) => run.case_id === spec.id).length;
    for (let index = have; index < RUNS_PER_CASE; index++) {
      const started = Date.now();
      process.stderr.write(`run ${spec.id} ${index + 1}/${RUNS_PER_CASE}\n`);
      let record: SavedRun;
      try {
        record = await oneRun(spec.id, spec.query, spec.role, index, seenTraces);
      } catch (err) {
        record = {
          case_id: spec.id,
          run_index: index,
          request_id: `eval-${spec.id}-${index}-thrown`,
          trace_id: "",
          status: "thrown",
          agents_used: [],
          fallback_used: false,
          revision_count: 0,
          reason_code: null,
          human_message: null,
          evaluator_findings: [],
          evaluator_critiques: [],
          evaluator_exhaust: null,
          text: "",
          idempotency: "miss",
          error: redact((err as Error).message).slice(0, 300),
          response: null,
        };
      }
      fs.appendFileSync(outFile, `${JSON.stringify(record)}\n`);
      saved.push(record);
      process.stderr.write(`  ${record.status} ${record.trace_id} fallback=${record.fallback_used} cache=${record.idempotency}\n`);
      const elapsed = Date.now() - started;
      if (v2 && elapsed < 2100) await new Promise((resolve) => setTimeout(resolve, 2100 - elapsed));
    }
  }
  const grades = gradeRuns(saved);
  const summary = summarize(saved, grades);
  fs.writeFileSync(path.join(outDir, v2 ? "v2-score.json" : "score.json"), `${JSON.stringify(summary, null, 2)}\n`);
  if (v2) publishV2(saved, summary);
  else publish(saved, summary);
  process.stderr.write(`strict ${summary.strict} resolved ${summary.resolved_only} cause unresolved ${summary.cause_unresolved_rate}\n`);
}

const isMain = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href,
);

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${redact((err as Error).stack ?? (err as Error).message)}\n`);
    process.exit(1);
  });
}
