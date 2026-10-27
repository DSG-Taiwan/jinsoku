import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { PROJECT_ROOT } from "./config.ts";
import { ASSET_IDS, dataWindow } from "./data/seed.ts";
import { fleetStatus } from "./fleet.ts";
import { BodyTooLargeError, canWrite, readBody } from "./http-util.ts";
import { traceForRequest } from "./idempotency.ts";
import { health, runRequest } from "./orchestrator.ts";
import { contentType, publicFile } from "./public-files.ts";
import { parseRunBody, RunBodyError } from "./run-body.ts";
import { isTraceId, listRuns, readRun } from "./runs.ts";
import { PERIODS } from "./schemas.ts";
import { redact } from "./tracing.ts";

const PORT = Number(process.env.PORT ?? 8000);

function send(res: http.ServerResponse, status: number, body: unknown): void {
  if (!canWrite(res)) return;
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,80}$/;

function sendFile(res: http.ServerResponse, file: string): void {
  if (!canWrite(res)) return;
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    "Content-Type": contentType(file),
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, await health());
      return;
    }
    if (req.method === "GET" && url.pathname === "/catalog") {
      send(res, 200, { assets: ASSET_IDS, periods: PERIODS, window: dataWindow(), roles: ["lead", "tech"] });
      return;
    }
    if (req.method === "GET" && url.pathname === "/fleet") {
      send(res, 200, fleetStatus());
      return;
    }
    if (req.method === "GET" && url.pathname === "/runs") {
      send(res, 200, { runs: listRuns() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/runs/active") {
      const requestId = url.searchParams.get("request_id") ?? "";
      if (!REQUEST_ID.test(requestId)) {
        send(res, 400, { status: "error", error: "request_id required" });
        return;
      }
      const active = traceForRequest(requestId);
      if (!active) {
        send(res, 404, { status: "error", error: "not started" });
        return;
      }
      send(res, 200, active);
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/runs/")) {
      const traceId = decodeURIComponent(url.pathname.slice("/runs/".length));
      if (!isTraceId(traceId)) {
        send(res, 404, { status: "error", error: "not found" });
        return;
      }
      const detail = readRun(traceId);
      if (!detail) {
        send(res, 404, { status: "error", error: "not found" });
        return;
      }
      send(res, 200, detail);
      return;
    }
    if (req.method === "GET") {
      const file = publicFile(path.join(PROJECT_ROOT, "public"), url.pathname);
      if (file) {
        sendFile(res, file);
        return;
      }
    }
    if (req.method === "POST" && url.pathname === "/run") {
      const raw = await readBody(req);
      let parsed;
      try {
        parsed = parseRunBody(raw);
      } catch (err) {
        if (err instanceof RunBodyError) {
          send(res, 400, { status: "error", error: err.message });
          return;
        }
        throw err;
      }
      const result = await runRequest(parsed);
      send(res, 200, result);
      return;
    }
    send(res, 404, { status: "error", error: "not found" });
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      send(res, 413, { status: "error", error: "body too large" });
    } else if (canWrite(res)) {
      send(res, 500, { status: "error", error: "internal error" });
    }
    process.stderr.write(`${redact((err as Error).message)}\n`);
  }
});

server.listen(PORT, () => {
  process.stdout.write(`listening on :${PORT}\n`);
});
