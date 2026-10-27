import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "./config.ts";
import type { RunRequest, RunResponse } from "./schemas.ts";

interface CacheEntry {
  fingerprint: string;
  pendingAt?: string;
  pendingTrace?: string;
  response?: RunResponse;
}

const file = path.join(PROJECT_ROOT, "data", "idempotency.json");
const lockDir = path.join(PROJECT_ROOT, "data", "idempotency.lock");
const PENDING_MS = 120_000;

export function requestFingerprint(req: RunRequest): string {
  const role = String(req.context?.role ?? "").trim().toLowerCase();
  const query = String(req.user_query ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return `${role}\n${query}`;
}

function readDisk(): Record<string, CacheEntry> {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, CacheEntry>;
  } catch {
    return {};
  }
}

function writeDisk(data: Record<string, CacheEntry>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function withLock<T>(fn: () => T): T {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let last: NodeJS.ErrnoException | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      fs.mkdirSync(lockDir);
      try {
        return fn();
      } finally {
        fs.rmSync(lockDir, { recursive: true, force: true });
      }
    } catch (err) {
      // EEXIST: another writer holds the lock. Windows reports a lock directory that another process is removing as EPERM or EBUSY.
      // Those are "busy". Anything else (for example EACCES on a protected folder) is a real failure and is thrown at once.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EPERM" && code !== "EBUSY") throw err;
      last = err as NodeJS.ErrnoException;
      const until = Date.now() + 15;
      while (Date.now() < until) {
        /* wait for the other writer */
      }
    }
  }
  // Out of attempts: a lock that stayed held is "busy"; an error that kept coming back is reported as itself.
  if (last && last.code !== "EEXIST") throw last;
  throw new Error("idempotency lock busy");
}

export type CacheLookup =
  | { kind: "miss" }
  | { kind: "hit"; response: RunResponse }
  | { kind: "conflict" }
  | { kind: "pending" };

/** Same role and same command only. A different role or query never receives this body. */
export function matchingStored(req: RunRequest): RunResponse | undefined {
  const fingerprint = requestFingerprint(req);
  return withLock(() => {
    const entry = readDisk()[req.request_id];
    if (entry?.response && entry.fingerprint === fingerprint) return entry.response;
    return undefined;
  });
}

/** Call only after ingest has authorized the role. Claims the id or returns the prior result. */
export function beginAuthorizedRun(req: RunRequest): CacheLookup {
  const fingerprint = requestFingerprint(req);
  return withLock(() => {
    const disk = readDisk();
    const entry = disk[req.request_id];
    if (!entry) {
      disk[req.request_id] = { fingerprint, pendingAt: new Date().toISOString() };
      writeDisk(disk);
      return { kind: "miss" };
    }
    if (entry.fingerprint !== fingerprint) return { kind: "conflict" };
    if (entry.response) return { kind: "hit", response: entry.response };
    const age = Date.now() - Date.parse(entry.pendingAt ?? "");
    if (Number.isFinite(age) && age < PENDING_MS) return { kind: "pending" };
    disk[req.request_id] = { fingerprint, pendingAt: new Date().toISOString() };
    writeDisk(disk);
    return { kind: "miss" };
  });
}

/** So the board can tail logs while POST /run is still open. */
export function noteTrace(requestId: string, traceId: string): void {
  withLock(() => {
    const disk = readDisk();
    const entry = disk[requestId];
    if (!entry || entry.response) return;
    entry.pendingTrace = traceId;
    writeDisk(disk);
  });
}

export function traceForRequest(requestId: string): { trace_id: string; pending: boolean } | undefined {
  return withLock(() => {
    const entry = readDisk()[requestId];
    if (!entry) return undefined;
    if (entry.response?.trace_id) return { trace_id: entry.response.trace_id, pending: false };
    if (entry.pendingTrace) return { trace_id: entry.pendingTrace, pending: true };
    return undefined;
  });
}

export function finishRun(req: RunRequest, response: RunResponse): void {
  const fingerprint = requestFingerprint(req);
  withLock(() => {
    const disk = readDisk();
    const entry = disk[req.request_id];
    if (entry && entry.fingerprint !== fingerprint) return;
    disk[req.request_id] = { fingerprint, response };
    writeDisk(disk);
  });
}
