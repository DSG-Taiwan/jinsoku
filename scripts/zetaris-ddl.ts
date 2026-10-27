import { randomUUID } from "node:crypto";
import { config } from "../src/config.ts";

const sql = process.argv[2];
if (!sql) {
  process.stderr.write("usage: tsx scripts/zetaris-ddl.ts <sql>\n");
  process.exit(1);
}
const base = config.zetarisRestUrl.replace(/\/+$/, "");
const res = await fetch(`${base}/sql-editor/sqls/run`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${config.zetarisApiKey}`,
    "X-Org-ID": config.zetarisOrgId,
    "X-Request-ID": randomUUID(),
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit: 50 }),
});
const text = await res.text();
process.stdout.write(`${res.status}\n${text.slice(0, 1200)}\n`);
if (!res.ok) process.exitCode = 1;
