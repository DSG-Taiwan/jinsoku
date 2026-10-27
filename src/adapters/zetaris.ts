import { randomUUID } from "node:crypto";
import { config } from "../config.ts";
import { RequestDeadlineError, throwIfRequestDeadline } from "../deadline.ts";

export interface SqlResult {
  headers: string[];
  data: unknown[][];
  queryId: string;
}

const SELECT_ONLY = /^\s*select\b/i;
export const ZETARIS_TIMEOUT_MS = 10_000;
export const ZETARIS_RETRY_TIMEOUT_MS = 5_000;

export function assertReadOnlySql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) throw new Error("empty SQL");
  if (trimmed.includes(";")) throw new Error("one statement per call, no semicolon");
  if (!SELECT_ONLY.test(trimmed)) throw new Error("SELECT only");
  if (/\b(insert|update|delete|drop|alter|merge|create|grant|revoke)\b/i.test(trimmed)) {
    throw new Error("non-SELECT verb rejected");
  }
  return trimmed;
}

export let sqlCallCount = 0;
export function resetSqlCallCount(): void {
  sqlCallCount = 0;
}

export async function runSql(sql: string, limit: number, signal?: AbortSignal): Promise<SqlResult> {
  throwIfRequestDeadline(signal);
  const safe = assertReadOnlySql(sql);
  sqlCallCount += 1;
  const queryId = randomUUID();
  const requestId = randomUUID();
  const base = config.zetarisRestUrl.replace(/\/+$/, "");
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ZETARIS_TIMEOUT_MS);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(`${base}/sql-editor/sqls/run`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.zetarisApiKey}`,
        "X-Org-ID": config.zetarisOrgId,
        "X-Request-ID": requestId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        queryId,
        sql: safe,
        source: "SqlEditor",
        limit,
      }),
      signal: ac.signal,
    });
    const text = await res.text();
    if (res.status >= 500) {
      throwIfRequestDeadline(signal);
      await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 400)));
      const retryQueryId = randomUUID();
      const retryAc = new AbortController();
      const retryTimer = setTimeout(() => retryAc.abort(), ZETARIS_RETRY_TIMEOUT_MS);
      const onRetryAbort = () => retryAc.abort();
      signal?.addEventListener("abort", onRetryAbort, { once: true });
      try {
        const retry = await fetch(`${base}/sql-editor/sqls/run`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.zetarisApiKey}`,
            "X-Org-ID": config.zetarisOrgId,
            "X-Request-ID": randomUUID(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            queryId: retryQueryId,
            sql: safe,
            source: "SqlEditor",
            limit,
          }),
          signal: retryAc.signal,
        });
        const retryText = await retry.text();
        if (!retry.ok) {
          const band = retry.status >= 500 ? "5xx" : "4xx";
          throw new Error(`zetaris ${band} ${retry.status}`);
        }
        return parseSqlBody(retryText, retryQueryId);
      } finally {
        clearTimeout(retryTimer);
        signal?.removeEventListener("abort", onRetryAbort);
      }
    }
    if (!res.ok) {
      const band = res.status >= 500 ? "5xx" : "4xx";
      throw new Error(`zetaris ${band} ${res.status}`);
    }
    return parseSqlBody(text, queryId);
  } catch (err) {
    if (err instanceof RequestDeadlineError) throw err;
    if (signal?.aborted) throw new RequestDeadlineError();
    if ((err as Error).name === "AbortError") throw new Error("zetaris timeout");
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function parseSqlBody(text: string, queryId: string): SqlResult {
  let parsed: { headers?: string[]; data?: unknown[][] };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch {
    throw new Error("zetaris response was not JSON");
  }
  const headers = Array.isArray(parsed.headers) ? parsed.headers.map(String) : [];
  const data = Array.isArray(parsed.data) ? parsed.data : [];
  return { headers, data, queryId };
}
