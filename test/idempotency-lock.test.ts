import assert from "node:assert/strict";
import fs from "node:fs";
import { afterEach, test } from "node:test";
import { matchingStored } from "../src/idempotency.ts";
import type { RunRequest } from "../src/schemas.ts";

/** The idempotency lock: busy errors are retried, real errors are reported as themselves (QA r34). */

const request = { request_id: "lock-test", user_query: "CAUSE SSA-001", context: { role: "lead" } } as RunRequest;
const realMkdir = fs.mkdirSync;

afterEach(() => {
  fs.mkdirSync = realMkdir;
});

function failLockMkdir(code: string, times: number): { calls: () => number } {
  let calls = 0;
  fs.mkdirSync = ((target: fs.PathLike, options?: unknown) => {
    if (String(target).endsWith("idempotency.lock")) {
      calls += 1;
      if (calls <= times) throw Object.assign(new Error(`${code}: simulated`), { code });
    }
    return realMkdir(target, options as never);
  }) as typeof fs.mkdirSync;
  return { calls: () => calls };
}

test("a permission error on the lock folder is thrown at once as itself, not retried or called busy", () => {
  const probe = failLockMkdir("EACCES", Infinity);
  assert.throws(() => matchingStored(request), (err: NodeJS.ErrnoException) => err.code === "EACCES");
  assert.equal(probe.calls(), 1);
});

test("a lock directory another process is removing (EPERM) is retried and then succeeds", () => {
  const probe = failLockMkdir("EPERM", 3);
  assert.doesNotThrow(() => matchingStored(request));
  assert.equal(probe.calls() >= 4, true);
});

test("an EPERM that never clears is reported as EPERM after the retries, not as busy", () => {
  const probe = failLockMkdir("EPERM", Infinity);
  assert.throws(() => matchingStored(request), (err: NodeJS.ErrnoException) => err.code === "EPERM");
  assert.equal(probe.calls(), 100);
});

test("a lock that stays held is reported as busy", () => {
  failLockMkdir("EEXIST", Infinity);
  assert.throws(() => matchingStored(request), /idempotency lock busy/);
});
