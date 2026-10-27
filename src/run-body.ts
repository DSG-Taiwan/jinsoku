import type { RunRequest } from "./schemas.ts";

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,80}$/;

export class RunBodyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunBodyError";
  }
}

/** Accept a run body. null, arrays, and non-objects are invalid input, not server faults. */
export function parseRunBody(raw: string): RunRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RunBodyError("invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RunBodyError("request_id and user_query required");
  }
  const body = parsed as RunRequest;
  if (typeof body.request_id !== "string" || !REQUEST_ID.test(body.request_id)) {
    throw new RunBodyError("request_id and user_query required");
  }
  if (typeof body.user_query !== "string") {
    throw new RunBodyError("request_id and user_query required");
  }
  return body;
}
