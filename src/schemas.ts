export const MAX_INPUT_CHARS = 500;
export const PLACEHOLDER_ASSETS = ["SSA-001", "SSA-002", "SSA-003"] as const;
export const PERIODS = ["thisweek", "lastweek"] as const;
export const ALLOWED_ROLES = ["lead", "admin"] as const;
export const ALL_ROLES = ["tech", "lead", "admin"] as const;

export type Verb = "CAUSE" | "PATTERNS" | "NEXT";
/** A custom range is written FROM..TO with ISO dates (2026-10-01..2026-10-21), both ends inclusive. */
export type DateRange = `${number}-${number}-${number}..${number}-${number}-${number}`;
export type Period = (typeof PERIODS)[number] | DateRange;
export const MAX_RANGE_DAYS = 366;

/** The two dates of a range, or null when the text is not a real range: bad calendar dates, from after to, or longer than a year. */
export function parseDateRange(text: string): { from: string; to: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (!match) return null;
  const day = (iso: string): number | null => {
    const [y, m, d] = iso.split("-").map(Number);
    const at = Date.UTC(y, m - 1, d);
    const back = new Date(at);
    return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? at : null;
  };
  const from = day(match[1]);
  const to = day(match[2]);
  if (from === null || to === null || from > to || (to - from) / 86_400_000 + 1 > MAX_RANGE_DAYS) return null;
  return { from: match[1], to: match[2] };
}
export type Role = (typeof ALL_ROLES)[number];
export type RefusalStatus = "UNPROCESSED" | "DENIED" | "REJECTED";

export interface CallObject {
  verb: Verb;
  asset?: string;
  period?: Period;
  role: "lead" | "admin";
  trace_id: string;
}

export interface Refusal {
  status: RefusalStatus;
  reason_code: string;
  human_message: string;
}

export function isCallObject(value: unknown): value is CallObject {
  if (!value || typeof value !== "object") return false;
  const v = value as CallObject;
  if (v.verb !== "CAUSE" && v.verb !== "PATTERNS" && v.verb !== "NEXT") return false;
  if (v.role !== "lead" && v.role !== "admin") return false;
  if (typeof v.trace_id !== "string" || !v.trace_id) return false;
  if (v.asset !== undefined && typeof v.asset !== "string") return false;
  if (v.period !== undefined && v.period !== "thisweek" && v.period !== "lastweek" && !(typeof v.period === "string" && parseDateRange(v.period))) return false;
  return true;
}

export function isRefusal(value: unknown): value is Refusal {
  if (!value || typeof value !== "object") return false;
  const v = value as Refusal;
  return (
    (v.status === "UNPROCESSED" || v.status === "DENIED" || v.status === "REJECTED") &&
    typeof v.reason_code === "string" &&
    typeof v.human_message === "string"
  );
}

/** An analysis claim as data: the model selects, code verifies and renders. See src/agents/claims.ts. */
export interface StructuredClaim {
  template: string;
  unit: string;
  ids: string[];
  weigh: { id: string; verdict: string }[];
  judge: string;
  reasons: string[];
  recommend: string;
}

export interface Finding {
  claim: string;
  evidence_ids: string[];
  /** Present on analysis findings: the structured claim the words were rendered from. */
  analysis?: StructuredClaim;
}

export interface Plan {
  objective: string;
  subtasks: string[];
  required_data: string[];
  success_criteria: string[];
}

export function parsePlan(value: unknown): Plan {
  if (!value || typeof value !== "object") throw new Error("plan is not an object");
  const v = value as Record<string, unknown>;
  if (typeof v.objective !== "string" || !v.objective.trim()) throw new Error("objective required");
  if (!Array.isArray(v.subtasks) || !v.subtasks.every((x) => typeof x === "string")) throw new Error("subtasks required");
  if (!Array.isArray(v.required_data) || !v.required_data.every((x) => typeof x === "string")) {
    throw new Error("required_data required");
  }
  if (!Array.isArray(v.success_criteria) || !v.success_criteria.every((x) => typeof x === "string")) {
    throw new Error("success_criteria required");
  }
  return {
    objective: v.objective.trim(),
    subtasks: v.subtasks as string[],
    required_data: v.required_data as string[],
    success_criteria: v.success_criteria as string[],
  };
}

export interface HopOutcome<T> {
  value: T;
  fallbackUsed: boolean;
  fallbackName: string | null;
  fallbackReason?: string | null;
  /** Evaluator hops only: true when a model critique was actually obtained for this hop. */
  modelUsed?: boolean;
}

/** What each model stage actually did on this request. Reported by the engine so a screen can say so; it is not a quality score. */
export interface ModelStages {
  headline: "model" | "code" | "n/a";
  analysis: "off" | "produced" | "withheld" | "skipped" | "dropped" | "empty" | "n/a";
  evaluator: "model" | "deterministic" | "n/a";
  revisions: number;
  synthetic_fault: string;
}

export interface Critique {
  approve: boolean;
  requires_revision: boolean;
  issues: string[];
  missing_evidence: string[];
  confidence: number;
}

export function parseCritique(value: unknown): Critique {
  if (!value || typeof value !== "object") throw new Error("critique is not an object");
  const v = value as Record<string, unknown>;
  if (typeof v.approve !== "boolean") throw new Error("approve required");
  if (typeof v.requires_revision !== "boolean") throw new Error("requires_revision required");
  if (!Array.isArray(v.issues) || !v.issues.every((x) => typeof x === "string")) throw new Error("issues required");
  if (!Array.isArray(v.missing_evidence) || !v.missing_evidence.every((x) => typeof x === "string")) {
    throw new Error("missing_evidence required");
  }
  const confidence = Number(v.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error("confidence must be 0..1");
  return {
    approve: v.approve,
    requires_revision: v.requires_revision,
    issues: v.issues as string[],
    missing_evidence: v.missing_evidence as string[],
    confidence,
  };
}

export interface SmokeDraft {
  headline: string;
  findings: Finding[];
  recommended_next_check: string;
  needs_human_decision: boolean;
  not_checked: string[];
  confidence: number;
}

/** Limits on a model-written draft. The model prompt, the JSON schema, and this parser all use them. Code-owned additions are not subject to them. */
export const DRAFT_LIMITS = { headline: 160, findings: 5, claim: 220 } as const;

export function parseSmokeDraft(value: unknown): SmokeDraft {
  if (!value || typeof value !== "object") throw new Error("draft is not an object");
  const v = value as Record<string, unknown>;
  if (typeof v.headline !== "string" || !v.headline.trim()) throw new Error("headline required");
  if (v.headline.trim().length > DRAFT_LIMITS.headline) throw new Error("headline too long");
  if (!Array.isArray(v.findings)) throw new Error("findings required");
  if (v.findings.length > DRAFT_LIMITS.findings) throw new Error(`too many findings, at most ${DRAFT_LIMITS.findings}`);
  const findings: Finding[] = v.findings.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`findings[${i}] invalid`);
    const f = item as Record<string, unknown>;
    if (typeof f.claim !== "string" || !f.claim.trim()) throw new Error(`findings[${i}].claim required`);
    if (f.claim.trim().length > DRAFT_LIMITS.claim) throw new Error(`findings[${i}].claim too long`);
    if (!Array.isArray(f.evidence_ids) || !f.evidence_ids.every((id) => typeof id === "string")) {
      throw new Error(`findings[${i}].evidence_ids required`);
    }
    return { claim: f.claim.trim(), evidence_ids: f.evidence_ids as string[] };
  });
  const recommended =
    typeof v.recommended_next_check === "string" && v.recommended_next_check.trim()
      ? v.recommended_next_check.trim()
      : "A human inspects the unit. Agents propose only.";
  const not_checked = Array.isArray(v.not_checked) && v.not_checked.every((x) => typeof x === "string")
    ? (v.not_checked as string[])
    : ["Anything not in retrieved sources"];
  let confidence = Number(v.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) confidence = 0.3;
  return {
    headline: v.headline.trim(),
    findings,
    recommended_next_check: recommended,
    needs_human_decision: true,
    not_checked,
    confidence,
  };
}

export type SourceKind = "zetaris" | "hmem" | "worldmodel" | "markov";

export interface RetrievedSource {
  id: string;
  kind: SourceKind;
  summary: string;
  /** Typed incident rows as the query returned them, after validation. When present, rows are read from here and never re-parsed from the summary text. */
  rows?: { issue_id: string; asset_id: string; kind: string; opened_at: string; actor_key: string; fix_outcome: string; reason: string }[];
}

export interface FinalAnswer {
  headline: string;
  findings: Finding[];
  recommended_next_check: string;
  needs_human_decision: boolean;
  not_checked: string[];
  confidence: number;
  trace_id: string;
}

export interface RunRequest {
  request_id: string;
  user_query: string;
  context?: {
    track?: string;
    role?: string;
  };
}

export interface RunResponse {
  request_id: string;
  trace_id: string;
  status: string;
  agents_used: string[];
  result: {
    summary: string;
    findings: Finding[];
    confidence: number;
    headline?: string;
    recommended_next_check?: string;
    needs_human_decision?: boolean;
    not_checked?: string[];
    human_message?: string;
    reason_code?: string;
    fallback_used: boolean;
    fallback_reason: string | null;
  };
  collaboration: {
    feedback_loop_completed: boolean;
    revision_count: number;
    evaluator_findings: string[];
    fallback_rate?: number;
    note: string;
    model_stages?: ModelStages;
  };
  log_path: string;
}
