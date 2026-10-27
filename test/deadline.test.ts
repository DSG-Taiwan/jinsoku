import assert from "node:assert/strict";
import { test } from "node:test";
import { Deadline, phraseCeilingMs, RequestDeadlineError } from "../src/deadline.ts";

test("phrase ceilings are NEXT 10s, CAUSE 15s, PATTERNS 25s", () => {
  assert.equal(phraseCeilingMs("NEXT"), 10_000);
  assert.equal(phraseCeilingMs("CAUSE"), 15_000);
  assert.equal(phraseCeilingMs("PATTERNS"), 25_000);
});

test("hop refuses to start when the request ceiling is already under one second", () => {
  const deadline = Deadline.start(500);
  assert.throws(() => deadline.hop(35_000), RequestDeadlineError);
});

test("hop caps a model budget to the time still left", () => {
  const deadline = Deadline.start(10_000);
  const left = deadline.hop(35_000);
  assert.ok(left <= 10_000);
  assert.ok(left >= 1_000);
});

test("a held clock does not spend the request ceiling", async () => {
  const deadline = Deadline.start(80);
  deadline.hold();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(deadline.signal.aborted, false);
  deadline.resume();
  assert.equal(deadline.signal.aborted, false);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(deadline.signal.aborted, true);
});
test("the request signal aborts at the ceiling", async () => {
  const deadline = Deadline.start(40);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(deadline.signal.aborted, true);
  assert.throws(() => deadline.hop(35_000), RequestDeadlineError);
});
