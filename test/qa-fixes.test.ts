import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resetSqlCallCount, sqlCallCount } from "../src/adapters/zetaris.ts";
import { withCoachingSource } from "../src/agents/executor.ts";
import { finishRun } from "../src/idempotency.ts";
import { resetRateLimit } from "../src/ingest.ts";
import { modelCallCount, resetModelCallCount } from "../src/llm/client.ts";
import { exhaustedRelease, runRequest } from "../src/orchestrator.ts";
import type { RunResponse, SmokeDraft } from "../src/schemas.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function canned(traceId: string): RunResponse {
  return {
    request_id: "f1-lead-tech",
    trace_id: traceId,
    status: "ok",
    agents_used: ["ingest", "planner"],
    result: {
      summary: "cached lead answer",
      findings: [{ claim: "cached", evidence_ids: ["zetaris:cached"] }],
      confidence: 0.4,
      fallback_used: false,
    },
    collaboration: {
      feedback_loop_completed: true,
      revision_count: 0,
      evaluator_findings: [],
      note: "test fixture",
    },
    log_path: "logs/cached.jsonl",
  };
}

test("a cached lead result is not returned to a tech", async () => {
  resetRateLimit();
  resetModelCallCount();
  resetSqlCallCount();
  const lead = { request_id: "f1-lead-tech", user_query: "CAUSE SSA-001", context: { role: "lead" } };
  finishRun(lead, canned("cached-trace"));
  const tech = await runRequest({ request_id: "f1-lead-tech", user_query: "CAUSE SSA-001", context: { role: "tech" } });
  assert.equal(tech.status, "DENIED");
  assert.notEqual(tech.trace_id, "cached-trace");
  assert.equal(tech.result.findings.length, 0);
  const again = await runRequest(lead);
  assert.equal(again.trace_id, "cached-trace");
  const changed = await runRequest({ request_id: "f1-lead-tech", user_query: "CAUSE SSA-004", context: { role: "lead" } });
  assert.equal(changed.status, "error");
  assert.equal(changed.result.reason_code, "request-id-conflict");
  assert.equal(modelCallCount, 0);
  assert.equal(sqlCallCount, 0);
});

test("the same request id survives a second process", () => {
  const req = { request_id: "f1-cross-proc", user_query: "CAUSE SSA-001", context: { role: "lead" } };
  finishRun(req, { ...canned("cached-cross"), request_id: "f1-cross-proc" });
  const script = [
    'import { runRequest } from "./src/orchestrator.ts";',
    'const out = await runRequest({ request_id: "f1-cross-proc", user_query: "CAUSE SSA-001", context: { role: "lead" } });',
    "process.stdout.write(out.trace_id);",
  ].join("\n");
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
    timeout: 20_000,
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), "cached-cross");
});

test("an exhausted draft is not released", () => {
  const draft: SmokeDraft = {
    headline: "Close the HAZARD",
    findings: [{ claim: "FAKE-KEY-FOR-TEST", evidence_ids: ["missing"] }],
    recommended_next_check: "downgrade it",
    needs_human_decision: true,
    not_checked: ["secret note"],
    confidence: 0.9,
  };
  const released = exhaustedRelease(draft, [
    "HAZARD downgrade/close",
    'Rejected claim: "unapproved-marker"',
    "unknown id unapproved-marker",
    "unknown id FAKE-KEY-FOR-TEST",
    "dual-citation: missing unapproved marker",
    "dual-citation: missing zetaris, hmem",
  ]);
  assert.deepEqual(released.findings, []);
  const body = JSON.stringify(released);
  assert.equal(body.includes("nvapi" + "-"), false);
  assert.equal(body.includes("Close the HAZARD"), false);
  assert.equal(body.includes("secret note"), false);
  assert.equal(body.includes("unapproved-marker"), false);
  assert.equal(body.includes("unapproved marker"), false);
  assert.deepEqual(released.diagnostics, [
    "hazard-downgrade",
    "evaluator-rejected",
    "unknown-evidence-id",
    "dual-citation-missing",
  ]);
});

test("inherited property names stay inside the diagnostic code set", () => {
  const draft: SmokeDraft = {
    headline: "held",
    findings: [],
    recommended_next_check: "held",
    needs_human_decision: true,
    not_checked: [],
    confidence: 0,
  };
  for (const name of ["__proto__", "constructor", "toString"]) {
    const released = exhaustedRelease(draft, [name]);
    assert.deepEqual(released.diagnostics, ["evaluator-rejected"]);
    assert.equal(released.human_message, "evaluator-rejected");
    assert.equal(JSON.stringify(released).includes("function"), false);
    assert.equal(JSON.stringify(released).includes("[object Object]"), false);
  }
});

test("coaching rows keep the historical query id", () => {
  const week = [{ id: "zetaris:week-id", kind: "zetaris" as const, summary: "ISS-015 SSA-007 OOS 2026-10-21" }];
  const out = withCoachingSource(week, {
    queryId: "hist-id",
    period: "thisweek",
    lines: ["ACT-17: fixes did not hold on ISS-001 SSA-001 opened 2026-09-02."],
  });
  assert.equal(out[0].id, "zetaris:week-id");
  assert.equal(out[0].summary.includes("ISS-001"), false);
  assert.equal(out[1].id, "zetaris:hist-id");
  assert.match(out[1].summary, /not limited to thisweek/);
  assert.match(out[1].summary, /2026-09-02/);
});
