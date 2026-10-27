import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const files = ["agents", "orchestrator.ts", "server.ts", "cli.ts", "ingest.ts", "final-pass.ts"];

function sourceText(): string {
  const chunks: string[] = [];
  for (const name of files) {
    const full = path.join(root, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      for (const file of fs.readdirSync(full)) {
        if (file.endsWith(".ts")) chunks.push(fs.readFileSync(path.join(full, file), "utf8"));
      }
    } else {
      chunks.push(fs.readFileSync(full, "utf8"));
    }
  }
  return chunks.join("\n");
}

test("agent layer has no write path to SQL, Redis, or tickets", () => {
  const text = sourceText();
  assert.doesNotMatch(text, /\b(insert|update|delete|drop|alter|merge)\b/i);
  assert.doesNotMatch(text, /\bredis\b/i);
  assert.doesNotMatch(text, /createIssue|octokit|github\.com\/.*issues/i);
});
