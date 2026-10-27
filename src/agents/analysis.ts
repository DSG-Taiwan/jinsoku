import { modelRetrieved } from "./executor.ts";
import { callSchema } from "./model-json.ts";
import { incidentRowsForModel, JUDGMENTS, OPTIONS, REASONS, renderClaim, TEMPLATES, VERDICTS, verifyClaim } from "./claims.ts";
import type { CallObject, Finding, RetrievedSource, SmokeDraft, StructuredClaim } from "../schemas.ts";

/**
 * Model analysis on top of the code-built evidence core, as structured claims. The model selects a template from a closed set,
 * names the incident ids it read, weighs each one, judges the claim and recommends one option; it writes no sentence. Code verifies
 * every selection against the typed rows and renders the words. It is additive and fail-closed: the core stays authoritative, a claim
 * the rows do not support is named by the critique and revised, and a rejected analysis is stripped so the answer falls back to the core.
 * Off unless MODEL_ANALYSIS is exactly "on".
 */
export const ANALYSIS_LIMITS = { claims: 3 } as const;
export const ANALYSIS_PREFIX = "Analysis: ";
export const ANALYSIS_MAX_TOKENS = 500;

export function analysisEnabled(): boolean {
  return process.env.MODEL_ANALYSIS === "on";
}

export type AnalysisClaim = StructuredClaim;

const asStrings = (value: unknown, what: string): string[] => {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) throw new Error(`${what} must be a list of strings`);
  return value as string[];
};

/**
 * Shape only. A value outside the closed lists is kept on purpose so the critique can name it and the revision loop can fix it.
 */
export function parseAnalysis(value: unknown): AnalysisClaim[] {
  if (!value || typeof value !== "object") throw new Error("analysis is not an object");
  const claims = (value as { claims?: unknown }).claims;
  if (!Array.isArray(claims)) throw new Error("analysis claims required");
  if (claims.length > ANALYSIS_LIMITS.claims) throw new Error(`too many analysis claims, at most ${ANALYSIS_LIMITS.claims}`);
  return claims.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`analysis claim ${i} invalid`);
    const c = item as Record<string, unknown>;
    if (typeof c.template !== "string") throw new Error(`analysis claim ${i} template required`);
    if (typeof c.unit !== "string") throw new Error(`analysis claim ${i} unit required`);
    if (typeof c.judge !== "string") throw new Error(`analysis claim ${i} judge required`);
    if (typeof c.recommend !== "string") throw new Error(`analysis claim ${i} recommend required`);
    const weighRaw = c.weigh;
    if (!Array.isArray(weighRaw)) throw new Error(`analysis claim ${i} weigh required`);
    const weigh = weighRaw.map((entry) => {
      const w = entry as { id?: unknown; verdict?: unknown };
      if (!w || typeof w.id !== "string" || typeof w.verdict !== "string") throw new Error(`analysis claim ${i} weigh entry invalid`);
      return { id: w.id, verdict: w.verdict };
    });
    return {
      template: c.template,
      unit: c.unit.trim(),
      ids: asStrings(c.ids, `analysis claim ${i} ids`),
      weigh,
      judge: c.judge,
      reasons: asStrings(c.reasons, `analysis claim ${i} reasons`),
      recommend: c.recommend,
    };
  });
}

/**
 * Marked findings, so the board, the logs and the critique can tell analysis claims from code-built rows. A claim the rows support is
 * rendered by code and cites the sources that carry its rows; one they do not support gets a plain placeholder so the critique can
 * name what is wrong, and it is stripped before release if the revision loop cannot fix it.
 */
export function analysisClaims(claims: AnalysisClaim[], retrieved: RetrievedSource[]): Finding[] {
  const fallbackIds = retrieved.filter((source) => source.kind === "zetaris").slice(0, 1).map((source) => source.id);
  return claims.map((item) => {
    const verified = verifyClaim(item, retrieved);
    if (verified.issues.length === 0) {
      return { claim: `${ANALYSIS_PREFIX}${renderClaim(item, retrieved)}`, evidence_ids: verified.sourceIds, analysis: item };
    }
    return { claim: `${ANALYSIS_PREFIX}[${item.template}] selection not verified.`, evidence_ids: fallbackIds, analysis: item };
  });
}

export function hasAnalysis(draft: Pick<SmokeDraft, "findings">): boolean {
  return draft.findings.some((finding) => finding.claim.startsWith(ANALYSIS_PREFIX));
}

export function stripAnalysis(draft: SmokeDraft): SmokeDraft {
  return { ...draft, findings: draft.findings.filter((finding) => !finding.claim.startsWith(ANALYSIS_PREFIX)) };
}

/** Deterministic checks for analysis findings: every selection is recomputed from the rows. The code-built core is not subject to them. */
export function analysisIssues(draft: SmokeDraft, retrieved: RetrievedSource[]): string[] {
  const issues: string[] = [];
  for (const finding of draft.findings) {
    if (!finding.claim.startsWith(ANALYSIS_PREFIX)) continue;
    if (!finding.analysis) {
      issues.push("analysis finding has no structured claim");
      continue;
    }
    for (const issue of verifyClaim(finding.analysis, retrieved).issues) if (!issues.includes(issue)) issues.push(issue);
    if (verifyClaim(finding.analysis, retrieved).issues.length === 0 && finding.claim !== `${ANALYSIS_PREFIX}${renderClaim(finding.analysis, retrieved)}`) {
      issues.push("analysis finding text does not match its structured claim");
    }
  }
  return issues;
}

const ANALYST_SYSTEM = `You are the Analyst. You write no sentences. Reply with one JSON object only:
{"claims":[{"template":string,"unit":string,"ids":string[],"weigh":[{"id":string,"verdict":string}],"judge":string,"reasons":string[],"recommend":string}]}
At most ${ANALYSIS_LIMITS.claims} claims. Use only incident_rows. Read the rows, weigh each incident id you name against the template, then judge.
template is one of: ${TEMPLATES.join(", ")}.
  repeat_failure: two or more incidents on one unit where the fix did not hold. same_actor_repeat: two or more incidents on one unit with the same actor key.
  recurrence_after_fix: a later incident on a unit after an earlier incident whose fix did not hold. open_hazard_pending: the unit has an open HAZARD in the rows. inspect_unit: a human should inspect the unit.
unit is an SSA id from the rows. ids are ISS ids from allowed_issue_ids, all on that unit.
weigh has one entry per id with verdict one of: ${VERDICTS.join(", ")}. judge is one of: ${JUDGMENTS.join(", ")}.
reasons is a short list from: ${REASONS.join(", ")}. recommend is one of: ${OPTIONS.join(", ")}.
Judge only from the rows. Do not assign blame to a person or an actor.`;

const REVISE_ANALYST = `Revise the analysis. Reply with one JSON object only, same shape as before, selections from the same closed lists.
Fix exactly what the critique names: use only ids and units that are in incident_rows, weigh each id as the rows say, and judge as the rows say.`;

function analysisSchema(issueIds: string[]): Record<string, unknown> {
  const id = issueIds.length > 0 ? { type: "string", enum: issueIds } : { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["claims"],
    properties: {
      claims: {
        type: "array",
        maxItems: ANALYSIS_LIMITS.claims,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["template", "unit", "ids", "weigh", "judge", "reasons", "recommend"],
          properties: {
            template: { type: "string", enum: [...TEMPLATES] },
            unit: { type: "string", pattern: "^SSA-[0-9]+$" },
            ids: { type: "array", items: id, maxItems: 8 },
            weigh: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "verdict"],
                properties: { id, verdict: { type: "string", enum: [...VERDICTS] } },
              },
            },
            judge: { type: "string", enum: [...JUDGMENTS] },
            reasons: { type: "array", maxItems: 3, items: { type: "string", enum: [...REASONS] } },
            recommend: { type: "string", enum: [...OPTIONS] },
          },
        },
      },
    },
  };
}

export interface AnalysisContext {
  call: CallObject;
  retrieved: RetrievedSource[];
  core: SmokeDraft;
  timeoutMs: number;
  onRepair?: (message: string) => void;
  signal?: AbortSignal;
  remaining?: () => number;
  clock?: { hold(): void; resume(): void };
}

function payload(context: AnalysisContext, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const rows = incidentRowsForModel(context.retrieved);
  return {
    call: { verb: context.call.verb, asset: context.call.asset, period: context.call.period },
    allowed_issue_ids: rows.map((row) => row.id),
    incident_rows: rows,
    retrieved: modelRetrieved(context.retrieved),
    core_findings: stripAnalysis(context.core).findings.map((finding) => finding.claim),
    ...extra,
  };
}

/** One model call. It throws when the call fails; the caller falls back to the evidence core. */
export async function runAnalysis(context: AnalysisContext): Promise<AnalysisClaim[]> {
  const ids = incidentRowsForModel(context.retrieved).map((row) => row.id);
  return callSchema(
    ANALYST_SYSTEM,
    payload(context),
    parseAnalysis,
    context.timeoutMs,
    context.onRepair,
    context.signal,
    ANALYSIS_MAX_TOKENS,
    analysisSchema(ids),
    context.remaining,
    context.clock,
    ANALYSIS_MAX_TOKENS,
  );
}

export async function reviseAnalysis(context: AnalysisContext, previous: AnalysisClaim[], critique: { issues: string[]; missing_evidence: string[] }): Promise<AnalysisClaim[]> {
  const ids = incidentRowsForModel(context.retrieved).map((row) => row.id);
  return callSchema(
    REVISE_ANALYST,
    payload(context, { previous_analysis: previous, critique }),
    parseAnalysis,
    context.timeoutMs,
    context.onRepair,
    context.signal,
    ANALYSIS_MAX_TOKENS,
    analysisSchema(ids),
    context.remaining,
    context.clock,
    ANALYSIS_MAX_TOKENS,
  );
}

/** The structured claims currently in a draft. */
export function currentAnalysis(draft: SmokeDraft): AnalysisClaim[] {
  return draft.findings.filter((finding) => finding.claim.startsWith(ANALYSIS_PREFIX) && finding.analysis).map((finding) => finding.analysis as AnalysisClaim);
}

/** Labeled synthetic faults, for showing the critique and revision loop working. Active only with MODEL_ANALYSIS=on and a known FAULT_INJECT value. */
export const FAULT_SCENARIOS = ["invented_asset", "hallucinated_issue", "uncited", "closure_language", "person_name"] as const;
export type FaultScenario = (typeof FAULT_SCENARIOS)[number];

export function faultScenario(): FaultScenario | null {
  if (!analysisEnabled()) return null;
  const value = process.env.FAULT_INJECT;
  return (FAULT_SCENARIOS as readonly string[]).includes(value ?? "") ? (value as FaultScenario) : null;
}

/** FAULT_PERSIST=on keeps injecting on every revision, to show the fail-closed path. Otherwise only the first model output is faulted. */
export function faultPersists(): boolean {
  return process.env.FAULT_PERSIST === "on";
}

/** The structured form of each labeled fault: a unit or id that is not in the rows, a missing id, a template or a reason outside the closed lists. */
export function injectFault(claims: AnalysisClaim[], scenario: FaultScenario): AnalysisClaim[] {
  const base: AnalysisClaim = claims[0] ?? { template: "repeat_failure", unit: "SSA-001", ids: [], weigh: [], judge: "supported", reasons: ["same_unit"], recommend: "inspect_unit" };
  const faulty: Record<FaultScenario, AnalysisClaim> = {
    invented_asset: { ...base, unit: "SSA-099" },
    hallucinated_issue: { ...base, ids: ["ISS-9999"], weigh: [{ id: "ISS-9999", verdict: "supports" }] },
    uncited: { ...base, ids: [], weigh: [] },
    closure_language: { ...base, template: "close_hazard" },
    person_name: { ...base, reasons: ["blames_person"] },
  };
  return [faulty[scenario], ...claims.slice(1)];
}
