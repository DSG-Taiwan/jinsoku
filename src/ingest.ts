import { randomUUID } from "node:crypto";
import { ASSET_IDS, dataWindow } from "./data/seed.ts";
import {
  ALL_ROLES,
  ALLOWED_ROLES,
  MAX_INPUT_CHARS,
  PERIODS,
  parseDateRange,
  type CallObject,
  type Refusal,
  type Role,
  type Verb,
} from "./schemas.ts";

const VERBS: Verb[] = ["CAUSE", "PATTERNS", "NEXT"];
const rateBuckets = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;

function refuse(status: Refusal["status"], reason_code: string, human_message: string): Refusal {
  return { status, reason_code, human_message };
}

function normalize(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}

function parseRole(value: unknown): Role | null {
  if (typeof value !== "string") return null;
  const role = value.trim().toLowerCase();
  return (ALL_ROLES as readonly string[]).includes(role) ? (role as Role) : null;
}

function rateLimited(role: string): boolean {
  const now = Date.now();
  const prior = (rateBuckets.get(role) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prior.length >= RATE_MAX) {
    rateBuckets.set(role, prior);
    return true;
  }
  prior.push(now);
  rateBuckets.set(role, prior);
  return false;
}

export function resetRateLimit(): void {
  rateBuckets.clear();
}

export function ingest(
  userQuery: unknown,
  context: { role?: unknown } | undefined,
  traceId = randomUUID(),
): CallObject | Refusal {
  if (typeof userQuery !== "string") {
    return refuse("REJECTED", "not-text", "Send a text command. Example: CAUSE SSA-001");
  }
  if (userQuery.length > MAX_INPUT_CHARS) {
    return refuse("REJECTED", "too-long", "Command is too long. Keep it under 500 characters.");
  }
  const text = normalize(userQuery);
  if (!text) {
    return refuse("REJECTED", "empty", "Empty command. Allowed: CAUSE <asset>, PATTERNS thisweek|lastweek|FROM..TO, NEXT <asset>.");
  }

  const role = parseRole(context?.role);
  if (!role) {
    return refuse(
      "DENIED",
      "unknown-role",
      "Role is missing or not recognized. Need lead or admin. Example: CAUSE SSA-001",
    );
  }
  if (role === "tech" || !(ALLOWED_ROLES as readonly string[]).includes(role)) {
    return refuse("DENIED", "needs-lead", "This command needs lead or higher. A tech cannot run it.");
  }
  if (rateLimited(role)) {
    return refuse("DENIED", "rate-limit", "Too many commands in one minute. Wait and retry.");
  }

  const parts = text.split(" ");
  const verb = parts[0].toUpperCase();
  if (!VERBS.includes(verb as Verb)) {
    return refuse(
      "UNPROCESSED",
      "unknown-verb",
      "Unprocessed. Allowed phrases: CAUSE <asset>, PATTERNS thisweek|lastweek|FROM..TO, NEXT <asset>. Example: CAUSE SSA-001",
    );
  }

  if (verb === "PATTERNS") {
    const period = (parts[1] ?? "").toLowerCase();
    const range = parseDateRange(period);
    if (parts.length !== 2 || !((PERIODS as readonly string[]).includes(period) || range)) {
      return refuse(
        "REJECTED",
        "bad-period",
        "PATTERNS needs thisweek, lastweek, or a date range. Example: PATTERNS 2026-10-01..2026-10-21",
      );
    }
    const window = dataWindow();
    if (range && (range.to < window.from || range.from > window.to)) {
      return refuse(
        "REJECTED",
        "no-data-in-range",
        `There is no data in that range. The data runs from ${window.from} to ${window.to}.`,
      );
    }
    return {
      verb: "PATTERNS",
      period: period as CallObject["period"],
      role,
      trace_id: traceId,
    };
  }

  if (parts.length !== 2) {
    return refuse(
      "REJECTED",
      "bad-args",
      `${verb} needs one asset id. Example: ${verb} SSA-001`,
    );
  }
  const asset = parts[1].toUpperCase();
  if (!ASSET_IDS.includes(asset)) {
    return refuse(
      "REJECTED",
      "unknown-asset",
      `Asset ${asset} is not on the synthetic list. Example: CAUSE SSA-001`,
    );
  }
  return { verb: verb as "CAUSE" | "NEXT", asset, role, trace_id: traceId };
}
