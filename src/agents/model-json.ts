import { RequestDeadlineError } from "../deadline.ts";
import { completeJson, extractJson, type ChatMessage, type ModelLane } from "../llm/client.ts";
import { DRAFT_LIMITS } from "../schemas.ts";

export const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "findings", "recommended_next_check", "needs_human_decision", "not_checked", "confidence"],
  properties: {
    headline: { type: "string", maxLength: DRAFT_LIMITS.headline },
    findings: {
      type: "array",
      maxItems: DRAFT_LIMITS.findings,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "evidence_ids"],
        properties: {
          claim: { type: "string", maxLength: DRAFT_LIMITS.claim },
          evidence_ids: { type: "array", items: { type: "string" } },
        },
      },
    },
    recommended_next_check: { type: "string" },
    needs_human_decision: { type: "boolean" },
    not_checked: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
} as const;

export const CRITIQUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["approve", "requires_revision", "issues", "missing_evidence", "confidence"],
  properties: {
    approve: { type: "boolean" },
    requires_revision: { type: "boolean" },
    issues: { type: "array", maxItems: 4, items: { type: "string", maxLength: 160 } },
    missing_evidence: { type: "array", maxItems: 4, items: { type: "string", maxLength: 160 } },
    confidence: { type: "number" },
  },
} as const;

/** Evidence ids are constrained to the ids this call retrieved. The linter still checks the draft. */
export function draftSchema(evidenceIds: string[]): Record<string, unknown> {
  const base = structuredClone(DRAFT_SCHEMA) as Record<string, unknown>;
  if (evidenceIds.length === 0) return base;
  const properties = base.properties as {
    findings: { items: { properties: { evidence_ids: { items: Record<string, unknown> } } } };
  };
  properties.findings.items.properties.evidence_ids.items.enum = evidenceIds;
  return base;
}

export async function callSchema<T>(
  system: string,
  payload: unknown,
  parse: (value: unknown) => T,
  timeoutMs: number,
  logRetry?: (message: string) => void,
  signal?: AbortSignal,
  maxTokens = 1200,
  schema?: Record<string, unknown>,
  remaining?: () => number,
  clock?: { hold(): void; resume(): void },
  repairMaxTokens?: number,
  lane?: ModelLane,
): Promise<T> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: JSON.stringify(payload) },
  ];
  const started = Date.now();
  const text = await completeJson(messages, { timeoutMs, maxTokens, maxTokensCap: repairMaxTokens, lane, signal, schema, onAttempt: logRetry, remaining, clock });
  try {
    return parse(extractJson(text));
  } catch (err) {
    if (err instanceof RequestDeadlineError) throw err;
    const left = timeoutMs - (Date.now() - started);
    if (left < 1_000) throw err;
    logRetry?.((err as Error).message);
    const repair: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: `Previous output failed validation (${(err as Error).message}). Reply with one valid JSON object only. No trailing text.`,
      },
    ];
    return parse(
      extractJson(await completeJson(repair, { timeoutMs: left, maxTokens: repairMaxTokens ?? Math.max(maxTokens, 1200), maxTokensCap: repairMaxTokens, lane, signal, schema, onAttempt: logRetry, remaining, clock })),
    );
  }
}
