import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { missingEnv, PROJECT_ROOT } from "../src/config.ts";
import { FAULT_SCENARIOS } from "../src/agents/analysis.ts";
import { logPathFor } from "../src/tracing.ts";
import { setModelSelection, modelSelection } from "../src/llm/client.ts";
import { runRequest } from "../src/orchestrator.ts";

/**
 * Labeled synthetic fault injection through the REAL provider. Each scenario injects one faulty analysis claim into the first model output
 * (the persistent run keeps injecting). The real Evaluator and the real model revision then run. Synthetic data only; nothing is written to Zetaris.
 * Usage: MODEL_ROUTE=paid tsx eval/fault-injection.ts   Output: eval/results/fault-injection.md and live-revision-trace.md
 */
const missing: string[] = missingEnv();
if (missing.length > 0) {
  console.error(`STOP: these settings are empty in .env: ${missing.join(", ")}`);
  process.exit(2);
}
process.env.MODEL_ANALYSIS = "on";
if (process.env.MODEL_ROUTE === "paid") setModelSelection({ route: "paid", model: null });
const selected = modelSelection();

const FAULT_TEXT: Record<string, RegExp> = {
  invented_asset: /SSA-099/,
  hallucinated_issue: /ISS-9999/,
  uncited: /never set correctly/,
  closure_language: /can be closed/,
  person_name: /Jane Doe/,
};

interface Row {
  scenario: string;
  persistent: boolean;
  status: string;
  trace_id: string;
  fault_logged: boolean;
  critiques: string[];
  revisions: number;
  analysis_released: boolean;
  faulty_text_released: boolean;
  outcome: string;
}

function events(traceId: string): { agent_name: string; action: string; input_summary: string; output_summary: string; status: string }[] {
  return fs
    .readFileSync(logPathFor(traceId), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function one(scenario: string, persistent: boolean): Promise<Row> {
  process.env.FAULT_INJECT = scenario;
  if (persistent) process.env.FAULT_PERSIST = "on";
  else delete process.env.FAULT_PERSIST;
  const out = await runRequest({
    request_id: `fault-${scenario}-${persistent ? "persist" : "once"}-${randomUUID()}`,
    user_query: "CAUSE SSA-001",
    context: { role: "lead", track: "Wildcard [Tinkerer]" },
  });
  const ev = events(out.trace_id);
  const released = JSON.stringify(out.result);
  const analysisReleased = out.result.findings.some((finding) => finding.claim.startsWith("Analysis: "));
  const faulty = FAULT_TEXT[scenario].test(released);
  const critiques = ev.filter((e) => e.action === "critique").map((e) => e.output_summary.slice(0, 200));
  const revisions = ev.filter((e) => e.action === "revision").length;
  const outcome = faulty
    ? "FAULT RELEASED"
    : persistent
      ? analysisReleased
        ? "unexpected: analysis released"
        : "caught, analysis withheld, evidence core released"
      : analysisReleased && revisions > 0
        ? "caught, repaired by a real revision, released"
        : "caught, analysis withheld, evidence core released";
  return {
    scenario,
    persistent,
    status: out.status,
    trace_id: out.trace_id,
    fault_logged: ev.some((e) => e.action === "fault-injected"),
    critiques,
    revisions,
    analysis_released: analysisReleased,
    faulty_text_released: faulty,
    outcome,
  };
}

const rows: Row[] = [];
for (const scenario of FAULT_SCENARIOS) {
  console.error(`fault ${scenario} ...`);
  rows.push(await one(scenario, false));
  await new Promise((resolve) => setTimeout(resolve, 6000));
}
console.error("fault uncited (persistent) ...");
rows.push(await one("uncited", true));

const results = path.join(PROJECT_ROOT, "eval", "results");
const lines = [
  "# Labeled synthetic fault injection, live provider",
  "",
  `Route: ${selected.route}. Model: ${selected.model}. Case: CAUSE SSA-001, role lead. Synthetic data only. Faults are injected by FAULT_INJECT into the analysis output and logged as \`fault-injected\`.`,
  "",
  "| Scenario | Persistent | Status | Fault logged | Critiques | Real revisions | Analysis released | Faulty text released | Outcome | Trace |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rows.map(
    (r) =>
      `| ${r.scenario} | ${r.persistent ? "yes" : "no"} | ${r.status} | ${r.fault_logged} | ${r.critiques.length} | ${r.revisions} | ${r.analysis_released} | ${r.faulty_text_released} | ${r.outcome} | \`${r.trace_id}\` |`,
  ),
  "",
  `Faulty text released in any run: ${rows.some((r) => r.faulty_text_released) ? "YES" : "none"}.`,
];
fs.writeFileSync(path.join(results, "fault-injection.md"), `${lines.join("\n")}\n`);

const traceRow = rows.find((r) => r.scenario === "invented_asset" && !r.persistent && r.revisions > 0) ?? rows.find((r) => r.revisions > 0);
if (traceRow) {
  const wanted = new Set(["fault-injected", "analysis", "critique", "revision", "approval", "draft", "model-attempt"]);
  const trace = events(traceRow.trace_id)
    .filter((e) => wanted.has(e.action))
    .map((e) => `- ${e.agent_name} / ${e.action}: ${e.input_summary.slice(0, 70)} | ${e.output_summary.slice(0, 160)} [${e.status}]`);
  fs.writeFileSync(
    path.join(results, "live-revision-trace.md"),
    `# One complete live revision trace\n\nScenario ${traceRow.scenario}, trace \`${traceRow.trace_id}\`, route ${selected.route}, model ${selected.model}.\n\n${trace.join("\n")}\n`,
  );
}
console.log(lines.join("\n"));
