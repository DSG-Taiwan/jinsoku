import fs from "node:fs";
import { runRequest } from "./orchestrator.ts";
import { resolveRunInput } from "./sample-input.ts";

const file = process.argv[2];
if (!file) {
  process.stderr.write("usage: npm run run -- input.json\n");
  process.exit(1);
}
const req = JSON.parse(fs.readFileSync(resolveRunInput(file), "utf8")) as {
  request_id: string;
  user_query: string;
  context?: { track?: string; role?: string };
};
const out = await runRequest(req);
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
