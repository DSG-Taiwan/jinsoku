import assert from "node:assert/strict";
import { test } from "node:test";
import { canWrite } from "../src/http-util.ts";
import { ZETARIS_RETRY_TIMEOUT_MS, ZETARIS_TIMEOUT_MS } from "../src/adapters/zetaris.ts";

test("canWrite is false after headers sent, destroy, or end", () => {
  assert.equal(canWrite({ headersSent: false, destroyed: false, writableEnded: false }), true);
  assert.equal(canWrite({ headersSent: true, destroyed: false, writableEnded: false }), false);
  assert.equal(canWrite({ headersSent: false, destroyed: true, writableEnded: false }), false);
  assert.equal(canWrite({ headersSent: false, destroyed: false, writableEnded: true }), false);
});

test("Zetaris retry has its own bounded timeout", () => {
  assert.equal(ZETARIS_TIMEOUT_MS, 10_000);
  assert.equal(ZETARIS_RETRY_TIMEOUT_MS, 5_000);
  assert.ok(ZETARIS_RETRY_TIMEOUT_MS < ZETARIS_TIMEOUT_MS);
});
