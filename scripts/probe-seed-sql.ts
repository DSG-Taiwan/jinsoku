import { runSql } from "../src/adapters/zetaris.ts";
import { issuesSelect } from "../src/data/seed.ts";

const sql = issuesSelect({ assetId: "SSA-001" });
const result = await runSql(sql, 20);
process.stdout.write(JSON.stringify({ headers: result.headers, rows: result.data.length, sample: result.data[0] }, null, 2) + "\n");
