import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { publicFile } from "../src/public-files.ts";
import { parseRunBody, RunBodyError } from "../src/run-body.ts";
import { isTraceId, listRuns, readRun } from "../src/runs.ts";
import { resolveRunInput } from "../src/sample-input.ts";
import { formatLogLine } from "../src/tracing.ts";
import { EXECUTOR_SYSTEM } from "../src/agents/executor.ts";
import { DRAFT_SCHEMA, draftSchema } from "../src/agents/model-json.ts";

test("executor prompt stays short and caps findings", () => {
  assert.ok(EXECUTOR_SYSTEM.includes("at most 5"));
  assert.ok(EXECUTOR_SYSTEM.includes("verbatim reason"));
  assert.ok(EXECUTOR_SYSTEM.includes("Do not write the word HAZARD"));
  assert.ok(EXECUTOR_SYSTEM.length < 900);
  assert.equal(DRAFT_SCHEMA.properties.findings.maxItems, 5);
  const scoped = draftSchema(["zetaris:q1", "hmem:m1"]);
  const items = scoped.properties as {
    findings: { maxItems: number; items: { properties: { evidence_ids: { items: { enum?: string[] } } } } };
  };
  assert.equal(items.findings.maxItems, 5);
  assert.deepEqual(items.findings.items.properties.evidence_ids.items.enum, ["zetaris:q1", "hmem:m1"]);
});

test("retrieval log keeps evidence ids and redacts secrets", () => {
  const line = formatLogLine({
    timestamp: "2026-10-21T00:00:00.000Z",
    trace_id: "11111111-1111-4111-8111-111111111111",
    agent_name: "executor",
    action: "zetaris-query",
    input_summary: "SELECT 1",
    output_summary: "FAKE-KEY-FOR-TEST ids",
    target_agent: "evaluator",
    confidence: null,
    retry_count: 0,
    status: "ok",
    retrieval: {
      evidence_ids: ["zetaris:q1", "hmem:m1"],
      queries: [
        { source: "zetaris", text: "SELECT issue_id FROM hvac.issues" },
        { source: "hmem", text: "Bearer FAKE-KEY-FOR-TEST" },
      ],
    },
  });
  const parsed = JSON.parse(line);
  assert.deepEqual(parsed.retrieval.evidence_ids, ["zetaris:q1", "hmem:m1"]);
  assert.equal(parsed.retrieval.queries[1].text.includes("nvapi" + "-"), false);
  assert.equal(parsed.output_summary.includes("nvapi" + "-"), false);
});

test("run index reads real log files and rejects path tricks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "board-"));
  const traceId = "22222222-2222-4222-8222-222222222222";
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "logs", `${traceId}.jsonl`),
    JSON.stringify({
      timestamp: "2026-10-21T01:00:00.000Z",
      trace_id: traceId,
      agent_name: "ingest",
      action: "refuse",
      input_summary: "hello there",
      output_summary: "UNPROCESSED unknown-verb",
      target_agent: null,
      confidence: 1,
      retry_count: 0,
      status: "UNPROCESSED",
    }) + "\n",
  );
  fs.writeFileSync(
    path.join(root, "data", "idempotency.json"),
    JSON.stringify({
      req: {
        response: {
          request_id: "req",
          trace_id: traceId,
          status: "UNPROCESSED",
          agents_used: ["ingest"],
          result: { summary: "Unprocessed.", findings: [], confidence: 1, fallback_used: false },
          collaboration: { feedback_loop_completed: false, revision_count: 0, evaluator_findings: [], note: "Ingest only." },
          log_path: "C:\\secret\\logs\\x.jsonl",
        },
      },
    }),
  );
  const listed = listRuns(root);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].query, "hello there");
  assert.equal(listed[0].status, "UNPROCESSED");
  const openId = "33333333-3333-4333-8333-333333333333";
  fs.writeFileSync(
    path.join(root, "logs", `${openId}.jsonl`),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      trace_id: openId,
      agent_name: "planner",
      action: "plan",
      input_summary: "CAUSE SSA-001",
      output_summary: "plan",
      target_agent: "executor",
      confidence: null,
      retry_count: 0,
      status: "ok",
    }) + "\n",
  );
  const openRun = listRuns(root).find((run) => run.trace_id === openId);
  assert.equal(openRun?.status, "running");
  const detail = readRun(traceId, root);
  assert.ok(detail);
  assert.equal("log_path" in (detail.result ?? {}), false);
  assert.equal(readRun("../package", root), null);
  assert.equal(isTraceId("not-a-trace"), false);
});

test("a terminal log with no stored result is an error, not a live run", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "board-terminal-"));
  const traceId = "44444444-4444-4444-8444-444444444444";
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "idempotency.json"), "{}\n");
  fs.writeFileSync(
    path.join(root, "logs", `${traceId}.jsonl`),
    JSON.stringify({
      timestamp: "2026-10-21T02:00:00.000Z",
      trace_id: traceId,
      agent_name: "ingest",
      action: "refuse",
      input_summary: "NEXT SSA-002",
      output_summary: "request-id-conflict",
      target_agent: null,
      confidence: null,
      retry_count: 0,
      status: "error",
    }) + "\n",
  );
  const detail = readRun(traceId, root);
  assert.ok(detail);
  assert.equal(detail.status, "error");
  assert.equal(detail.result?.status, "error");
  assert.equal(detail.result?.result.reason_code, "request-id-conflict");
  assert.deepEqual(detail.result?.result.findings, []);
  assert.match(detail.result?.result.summary ?? "", /different command or role/);
  assert.equal(listRuns(root)[0].status, "error");
  assert.equal(fs.readFileSync(path.join(root, "data", "idempotency.json"), "utf8"), "{}\n");
  const board = fs.readFileSync(path.join(process.cwd(), "public", "board.js"), "utf8");
  assert.match(board, /function stillRunning/);
  assert.match(board, /detail\.status === "running"/);
});

test("JSON null is a bad request, not an internal error", () => {
  assert.throws(() => parseRunBody("null"), (err: unknown) => err instanceof RunBodyError && err.message.includes("required"));
  assert.throws(() => parseRunBody("[]"), RunBodyError);
  assert.throws(() => parseRunBody("{"), (err: unknown) => err instanceof RunBodyError && err.message === "invalid JSON");
  assert.throws(() => parseRunBody("{}"), RunBodyError);
  const body = parseRunBody('{"request_id":"req-1","user_query":"CAUSE SSA-001"}');
  assert.equal(body.request_id, "req-1");
  assert.equal(body.user_query, "CAUSE SSA-001");
});

test("static files stay inside the public directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "public-"));
  fs.writeFileSync(path.join(root, "index.html"), "<p>board</p>");
  assert.equal(publicFile(root, "/"), path.join(root, "index.html"));
  assert.equal(publicFile(root, "/../package.json"), null);
  assert.equal(publicFile(root, "/nope.html"), null);
});

test("SAMPLE_MODE loads input examples only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sample-"));
  fs.mkdirSync(path.join(root, "input_examples"));
  fs.mkdirSync(path.join(root, "output_examples"));
  const input = path.join(root, "input_examples", "cause.json");
  const output = path.join(root, "output_examples", "cause.json");
  fs.writeFileSync(input, "{}");
  fs.writeFileSync(output, "{}");
  assert.equal(resolveRunInput(input, { sampleMode: true, root }), input);
  assert.throws(() => resolveRunInput(output, { sampleMode: true, root }), /never loaded/);
  assert.throws(() => resolveRunInput(path.join(root, "other.json"), { sampleMode: true, root }), /input_examples/);
  assert.throws(() => resolveRunInput(output, { sampleMode: false, root }), /never loaded/);
});
