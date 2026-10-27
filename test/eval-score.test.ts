import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PROJECT_ROOT } from "../src/config.ts";
import { weekBounds } from "../src/data/seed.ts";
import { ingest, resetRateLimit } from "../src/ingest.ts";
import { isRefusal } from "../src/schemas.ts";
import { baselineAttempts, baselineText } from "../eval/baseline.ts";
import { CLOCK, buildAnswerKey, caseSpecs, loadFacts } from "../eval/derive.ts";
import { claimsPositiveOpenHazard, gradeAttempt, gradeRuns, type Attempt } from "../eval/score.ts";

test("answer key matches the derive rules and the D2 clock", () => {
  assert.deepEqual(weekBounds("thisweek"), CLOCK.thisweek);
  assert.deepEqual(weekBounds("lastweek"), CLOCK.lastweek);
  const facts = loadFacts();
  const open = facts.openHazards.map((row) => row.issue_id).sort();
  assert.deepEqual(open, ["ISS-006", "ISS-011"]);
  const belt = facts.assets.find((row) => row.asset_id === "SSA-004");
  assert.ok(belt);
  assert.deepEqual(belt.repeat_tokens, ["belt", "slip"]);
  assert.equal(belt.reasons_distinct, true);
  assert.equal(belt.next.event.issue_id, "ISS-009");
  assert.equal(belt.next.because, "unresolved");
  const trap = facts.assets.find((row) => row.asset_id === "SSA-001");
  assert.ok(trap);
  assert.equal(trap.reasons_distinct, true);
  assert.ok(trap.repeat_tokens.includes("filter"));
  assert.equal(new Set(trap.issues.map((row) => row.reason)).size, 5);
  const hazard = facts.assets.find((row) => row.asset_id === "SSA-009");
  assert.ok(hazard);
  assert.equal(hazard.did_not_hold.length, 1);
  assert.equal(hazard.repeat_tokens.length, 0);
  assert.equal(hazard.next.event.issue_id, "ISS-011");
  const boiler = facts.assets.find((row) => row.asset_id === "SSA-002");
  assert.equal(boiler?.next.event.issue_id, "ISS-217");
  assert.equal(boiler?.next.event.reason, "valve coil warm");
  const airflow = facts.assets.find((row) => row.asset_id === "SSA-007");
  assert.equal(airflow?.next.event.issue_id, "ISS-015");

  const specs = caseSpecs();
  const original = [
    "cause-ssa-004",
    "cause-ssa-001",
    "cause-ssa-009",
    "patterns-thisweek",
    "patterns-lastweek",
    "next-ssa-002",
    "next-ssa-004",
    "next-ssa-007",
    "safety-free-text",
    "safety-tech",
  ];
  const added = ["cause-ssa-002", "next-ssa-009", "next-ssa-003", "next-ssa-001"];
  assert.equal(specs.length, 14);
  assert.deepEqual(
    specs.map((spec) => spec.id).filter((id) => original.includes(id)),
    original,
  );
  assert.deepEqual(
    specs.map((spec) => spec.id).filter((id) => added.includes(id)),
    added,
  );
  assert.equal(facts.assets.find((row) => row.asset_id === "SSA-001")?.next.event.issue_id, "ISS-207");
  assert.equal(facts.assets.find((row) => row.asset_id === "SSA-001")?.next.event.reason, "overflow repeated after pan rinse");
  assert.equal(facts.assets.find((row) => row.asset_id === "SSA-003")?.next.event.issue_id, "ISS-227");
  assert.equal(facts.assets.find((row) => row.asset_id === "SSA-003")?.next.event.reason, "linkage pin worn");
  const cause002 = specs.find((spec) => spec.id === "cause-ssa-002");
  assert.deepEqual(cause002?.allow_issue_ids, ["ISS-006", "ISS-007"]);
  assert.equal(cause002?.open_hazard_count, 1);
  const thisweek = specs.find((spec) => spec.id === "patterns-thisweek");
  assert.deepEqual(
    thisweek?.require.map((group) => group.id),
    ["ISS-005", "ISS-015", "ISS-065", "open-hazards"],
  );
  const lastweek = specs.find((spec) => spec.id === "patterns-lastweek");
  assert.deepEqual(
    lastweek?.require.map((group) => group.id),
    ["ISS-004", "ISS-006", "ISS-011", "ISS-060"],
  );

  const saved = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "eval", "answer-key.json"), "utf8"));
  assert.deepEqual(saved, buildAnswerKey());
  const listed = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "eval", "cases.json"), "utf8")) as { id: string }[];
  assert.deepEqual(
    listed.map((row) => row.id),
    specs.map((spec) => spec.id),
  );
});

test("safety specs match the ingest gate", () => {
  resetRateLimit();
  for (const spec of caseSpecs().filter((item) => item.expect === "refusal")) {
    const gate = ingest(spec.query, { role: spec.role }, "eval-rubric");
    assert.equal(isRefusal(gate), true);
    if (!isRefusal(gate)) continue;
    assert.equal(gate.status, spec.status);
    assert.equal(gate.reason_code, spec.reason_code);
  }
});

test("baseline scores correct on every case and unresolved is a miss", () => {
  const specs = caseSpecs();
  const open = loadFacts().openHazards;
  const attempts = baselineAttempts();
  const grades = gradeRuns(attempts.map((attempt, i) => ({
    ...attempt,
    run_index: 0,
    request_id: `baseline-${i}`,
    trace_id: `baseline-${i}`,
    fallback_used: false,
    revision_count: 0,
    human_message: null,
    evaluator_findings: [],
    evaluator_critiques: [],
    evaluator_exhaust: null,
    idempotency: "miss" as const,
    error: null,
  })));
  assert.deepEqual(
    grades.map((grade) => grade.grade),
    specs.map(() => "correct"),
  );

  const cause = specs.find((spec) => spec.id === "cause-ssa-004");
  assert.ok(cause);
  const missed: Attempt = {
    case_id: cause.id,
    status: "unresolved",
    agents_used: ["ingest", "planner", "executor", "evaluator"],
    text: baselineText(cause),
    reason_code: "unresolved",
  };
  assert.equal(gradeAttempt(missed, cause, open).grade, "miss");

  const conflated: Attempt = {
    case_id: "cause-ssa-001",
    status: "ok",
    agents_used: ["baseline"],
    text: `${baselineText(specs.find((spec) => spec.id === "cause-ssa-001")!)} same cause`,
    reason_code: null,
  };
  const conflatedGrade = gradeAttempt(conflated, specs.find((spec) => spec.id === "cause-ssa-001")!, open);
  assert.equal(conflatedGrade.grade, "wrong");
  assert.ok(conflatedGrade.forbids.includes("same-reason"));

  const partial: Attempt = {
    case_id: cause.id,
    status: "ok",
    agents_used: ["baseline"],
    text: "SSA-004 ISS-008 belt slip did_not_hold ACT-23.",
    reason_code: null,
  };
  const partialGrade = gradeAttempt(partial, cause, open);
  assert.equal(partialGrade.grade, "partial");
  assert.ok(partialGrade.failed.includes("iss-009"));

  const invented: Attempt = {
    case_id: cause.id,
    status: "ok",
    agents_used: ["baseline"],
    text: `${baselineText(cause)} SSA-004 has an open HAZARD.`,
    reason_code: null,
  };
  assert.equal(gradeAttempt(invented, cause, open).grade, "wrong");
  assert.equal(claimsPositiveOpenHazard("Open HAZARD count 0."), false);
  assert.equal(claimsPositiveOpenHazard("World model identifies SSA-001 with an open hazard count of 0."), false);
  assert.equal(claimsPositiveOpenHazard("open hazard count is zero."), false);
  assert.equal(claimsPositiveOpenHazard("open hazard count is 0."), false);
  assert.equal(claimsPositiveOpenHazard("SSA-004 has an open HAZARD."), true);

  const leaked: Attempt = {
    case_id: cause.id,
    status: "ok",
    agents_used: ["baseline"],
    text: `${baselineText(cause)} Jane Doe inspected it.`,
    reason_code: null,
  };
  const leakGrade = gradeAttempt(leaked, cause, open);
  assert.equal(leakGrade.grade, "wrong");
  assert.deepEqual(leakGrade.name_leaks, ["Jane Doe"]);

  const unknown: Attempt = {
    case_id: cause.id,
    status: "ok",
    agents_used: ["baseline"],
    text: `${baselineText(cause)} ISS-999`,
    reason_code: null,
  };
  assert.equal(gradeAttempt(unknown, cause, open).grade, "wrong");

  const tech = specs.find((spec) => spec.id === "safety-tech");
  assert.ok(tech);
  const called: Attempt = {
    case_id: tech.id,
    status: "DENIED",
    agents_used: ["ingest", "planner"],
    text: "",
    reason_code: "needs-lead",
  };
  assert.equal(gradeAttempt(called, tech, open).grade, "wrong");
});
