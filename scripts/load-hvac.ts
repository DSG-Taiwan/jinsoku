import { randomUUID } from "node:crypto";
import { config } from "../src/config.ts";

const base = config.zetarisRestUrl.replace(/\/+$/, "");
const endpoint = "http://host.docker.internal:8765";

async function ddl(sql: string): Promise<void> {
  const res = await fetch(`${base}/sql-editor/sqls/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.zetarisApiKey}`,
      "X-Org-ID": config.zetarisOrgId,
      "X-Request-ID": randomUUID(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ queryId: randomUUID(), sql, source: "SqlEditor", limit: 5 }),
  });
  const text = await res.text();
  process.stdout.write(`${res.status} ${sql.slice(0, 72)}\n${text.slice(0, 300)}\n`);
  if (!res.ok && !/already exists/i.test(text)) process.exitCode = 1;
}

function rest(table: string, file: string): string {
  return `CREATE LIGHTNING REST TABLE ${table} FROM hvac_synth REQUEST(endpoint '${endpoint}/${file}', method 'get', response_type 'json', http_encoding 'URLENCODED') HEADER () BODY ()`;
}

await ddl("CREATE SCHEMASTORE CONTAINER hvac");
await ddl(rest("assets_full", "assets.json"));
await ddl(rest("issues_doc", "issues.json"));
await ddl(rest("presence_doc", "presence.json"));
await ddl(
  "CREATE SCHEMASTORE VIEW assets WITH CONTAINER hvac AS SELECT row.asset_id AS asset_id, row.model AS model, row.location AS location, row.zone AS zone FROM hvac_synth.assets_full LATERAL VIEW explode(rows) AS row",
);
await ddl(
  "CREATE SCHEMASTORE VIEW issues WITH CONTAINER hvac AS SELECT row.issue_id AS issue_id, row.asset_id AS asset_id, row.kind AS kind, row.opened_at AS opened_at, row.closed_at AS closed_at, row.reason AS reason, row.actor_key AS actor_key, row.fix_outcome AS fix_outcome FROM hvac_synth.issues_doc LATERAL VIEW explode(rows) AS row",
);
await ddl(
  "CREATE SCHEMASTORE VIEW presence_events WITH CONTAINER hvac AS SELECT row.actor_key AS actor_key, row.state AS state, row.ts AS ts FROM hvac_synth.presence_doc LATERAL VIEW explode(rows) AS row",
);
await ddl("CACHE TABLE hvac.assets");
await ddl("CACHE TABLE hvac.issues");
await ddl("CACHE TABLE hvac.presence_events");
await ddl("SELECT COUNT(*) AS n FROM hvac.assets");
await ddl("SELECT COUNT(*) AS n FROM hvac.issues");
await ddl("SELECT COUNT(*) AS n FROM hvac.presence_events");
