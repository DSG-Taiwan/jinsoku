import { health } from "../src/orchestrator.ts";

const h = await health();
process.stdout.write(
  JSON.stringify(
    {
      ok: h.ok,
      env: h.env,
      dependencies: h.dependencies,
    },
    null,
    2,
  ) + "\n",
);
if (!h.ok) process.exitCode = 1;
