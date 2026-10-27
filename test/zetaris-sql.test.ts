import assert from "node:assert/strict";
import { test } from "node:test";
import { assertReadOnlySql, ZETARIS_RETRY_TIMEOUT_MS } from "../src/adapters/zetaris.ts";

test("SELECT without semicolon is allowed", () => {
  assert.equal(assertReadOnlySql("  SELECT 1 AS one  "), "SELECT 1 AS one");
});

test("rejects trailing semicolon, writes, and empty", () => {
  assert.throws(() => assertReadOnlySql("SELECT 1;"), /semicolon/);
  assert.throws(() => assertReadOnlySql("SELECT 1; SELECT 2"), /semicolon/);
  assert.throws(() => assertReadOnlySql("DELETE FROM assets"), /SELECT only/);
  assert.throws(() => assertReadOnlySql("DROP TABLE assets"), /SELECT only/);
  assert.throws(() => assertReadOnlySql(""), /empty/);
});

test("retry timeout is a positive bound", () => {
  assert.ok(ZETARIS_RETRY_TIMEOUT_MS > 0);
});
