import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJson } from "../src/llm/client.ts";

test("extractJson takes the first balanced object and ignores trailing text", () => {
  const v = extractJson('{"headline":"ok","confidence":0.2}\nnote: extra');
  assert.equal((v as { headline: string }).headline, "ok");
});

test("extractJson drops an inline reasoning block through the think tag", () => {
  const v = extractJson('thinking about ids\n</think>\n{"headline":"kept","confidence":0.2}');
  assert.equal((v as { headline: string }).headline, "kept");
});

test("extractJson keeps a brace inside a string and drops a second object", () => {
  const braced = extractJson('{"headline":"brace { inside","confidence":0.2} trailing } junk');
  assert.equal((braced as { headline: string }).headline, "brace { inside");
  const first = extractJson('{"ok":true}{"ok":false}');
  assert.equal((first as { ok: boolean }).ok, true);
});
