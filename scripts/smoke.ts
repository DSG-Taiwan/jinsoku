import { randomUUID } from "node:crypto";
import { runRequest } from "../src/orchestrator.ts";

const out = await runRequest({
  request_id: randomUUID(),
  user_query: "CAUSE SSA-001",
  context: { track: "Wildcard [Tinkerer]", role: "lead" },
});
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
if (out.status !== "ok") process.exitCode = 1;
