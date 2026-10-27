import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../src/config.ts";
import { completeJson, resetModelClientForTests, setModelClientForTests } from "../src/llm/client.ts";

async function main(): Promise<void> {
  let calls = 0;
  let rateLimited = 0;
  let ok = 0;
  setModelClientForTests({ minSpacingMs: 0, maxConcurrency: 4 });
  const one = async (index: number) => {
    calls += 1;
    try {
      await completeJson([{ role: "user", content: `Reply with {"n":${index}} only.` }], {
        timeoutMs: 40_000,
        attemptMs: 30_000,
        maxTokens: 200,
        onAttempt: (message) => {
          if (message.includes("http-429")) rateLimited += 1;
        },
      });
      ok += 1;
    } catch (err) {
      const message = (err as Error).message;
      if (/429/.test(message)) rateLimited += 1;
      process.stderr.write(`burst ${index} ${message}\n`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, (_item, index) => one(index)));
  resetModelClientForTests();
  const body = {
    calls,
    ok,
    http_429: rateLimited,
    spacing_ms: 0,
    concurrency: 4,
  };
  fs.writeFileSync(path.join(PROJECT_ROOT, "eval", "results", "burst.json"), `${JSON.stringify(body, null, 2)}\n`);
  const section = `## Burst test

Separate from the paced 120. Six model calls at once, no spacing, concurrency 4.

HTTP 429: ${rateLimited} of ${calls}. Succeeded: ${ok} of ${calls}.

This burst is not part of the fallback claim.
`;
  fs.appendFileSync(path.join(PROJECT_ROOT, "docs", "EVAL.md"), `\n${section}`);
  process.stderr.write(`burst 429 ${rateLimited} of ${calls}\n`);
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("eval/burst.ts");
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${(err as Error).stack ?? (err as Error).message}\n`);
    process.exit(1);
  });
}
