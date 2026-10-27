import assert from "node:assert/strict";
import { test } from "node:test";
import { fallbackUpperBound } from "../eval/claim-bound.ts";

test("zero failures in 120 runs is a 2.5% upper bound", () => {
  const bound = fallbackUpperBound(0, 120);
  assert.ok(bound > 0.024 && bound < 0.026, String(bound));
});

test("one failure in 120 runs has an upper bound near 4%", () => {
  const bound = fallbackUpperBound(1, 120);
  assert.ok(bound > 0.035 && bound < 0.045, String(bound));
});
