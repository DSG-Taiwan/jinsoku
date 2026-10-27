import { analysisIssues, hasAnalysis } from "./analysis.ts";
import { inventedOpenHazard } from "./hazard-block.ts";
import { isAssembledDraft, isFallbackDraft } from "./executor.ts";
import { RequestDeadlineError } from "../deadline.ts";
import { claimBindingProblem, createReleaseChecker, hazardDowngrade, reasonConflation, truncatedReason, unsupportedIssue } from "../final-pass.ts";
import type { Critique, HopOutcome, Plan, RetrievedSource, SmokeDraft } from "../schemas.ts";
import { parseCritique } from "../schemas.ts";
import { callSchema, CRITIQUE_SCHEMA } from "./model-json.ts";

export const CRITIQUE_MAX_TOKENS = 400;
const CLAIM_CLIP = 200;

/** The Evaluator reads claims and ids, not the full draft: a long draft made the call slow and its JSON unreliable. */
function compactDraft(draft: SmokeDraft): Record<string, unknown> {
  return {
    headline: draft.headline,
    recommended_next_check: draft.recommended_next_check.slice(0, CLAIM_CLIP),
    findings: draft.findings.map((f) => ({ claim: f.claim.slice(0, CLAIM_CLIP), evidence_ids: f.evidence_ids })),
  };
}

const NAME_SHAPE = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/;

const SYSTEM = `You are the Evaluator. Reply with one JSON object only:
{"approve":boolean,"requires_revision":boolean,"issues":string[],"missing_evidence":string[],"confidence":number}
Set requires_revision true only for a finding with no retrieved id, a missing retrieved kind (zetaris, hmem, worldmodel, or markov), or a sentence that closes or downgrades a HAZARD.
An id is not a kind. Do not require every id. Do not ask for more findings or a complete event list.
An open HAZARD count, including zero, stays open. Do not invent sources.`;

export function deterministicCritique(draft: SmokeDraft, retrieved: RetrievedSource[]): Critique {
  const issues: string[] = [];
  const missing: string[] = [];
  const allowed = new Set(retrieved.map((s) => s.id));
  const blob = [draft.headline, draft.recommended_next_check, ...draft.findings.map((f) => f.claim).filter((claim) => !claim.startsWith("Data quality:"))].join("\n");

  if (isFallbackDraft(draft)) issues.push("fallback draft was not released");
  const invented = inventedOpenHazard(blob, retrieved);
  if (invented) issues.push(invented);
  if (hazardDowngrade(blob)) issues.push("HAZARD downgrade/close");
  if (NAME_SHAPE.test(blob)) issues.push("person name");
  const conflated = reasonConflation(blob, retrieved);
  if (conflated) issues.push(conflated);
  const truncated = truncatedReason(blob, retrieved);
  if (truncated) issues.push(truncated);
  for (const claim of [draft.headline, draft.recommended_next_check, ...draft.findings.map((f) => f.claim).filter((c) => !c.startsWith("Data quality:"))]) {
    const unbound = claimBindingProblem(claim, retrieved);
    if (unbound) issues.push(unbound);
  }
  const unknown = unsupportedIssue(blob, retrieved);
  if (unknown) issues.push(unknown);
  const contract = createReleaseChecker(retrieved);
  for (const finding of draft.findings.filter((f) => !f.claim.startsWith("Data quality:"))) {
    const problem = contract.finding(finding.claim, finding.evidence_ids, finding.analysis);
    if (problem) issues.push(problem);
  }
  issues.push(...analysisIssues(draft, retrieved));

  for (const [i, f] of draft.findings.entries()) {
    const ok = f.evidence_ids.filter((id) => allowed.has(id));
    if (ok.length === 0) missing.push(`findings[${i}] has no retrieved id`);
    for (const id of f.evidence_ids) {
      if (!allowed.has(id)) missing.push(`unknown id ${id}`);
    }
  }

  const kinds = new Set(retrieved.map((s) => s.kind));
  if (retrieved.length > 0) {
    const cited = new Set(draft.findings.flatMap((f) => f.evidence_ids));
    const citedKinds = new Set(retrieved.filter((s) => cited.has(s.id)).map((s) => s.kind));
    const absent = [...kinds].filter((kind) => !citedKinds.has(kind));
    if (absent.length > 0) missing.push(`dual-citation: missing ${absent.join(", ")}`);
  }

  const requires = issues.length > 0 || missing.length > 0;
  return {
    approve: !requires,
    requires_revision: requires,
    issues,
    missing_evidence: missing,
    confidence: requires ? 0.4 : 0.8,
  };
}

export async function evaluate(
  plan: Plan,
  draft: SmokeDraft,
  retrieved: RetrievedSource[],
  timeoutMs: number,
  onRepair?: (m: string) => void,
  signal?: AbortSignal,
  remaining?: () => number,
  clock?: { hold(): void; resume(): void },
): Promise<HopOutcome<Critique>> {
  const local = deterministicCritique(draft, retrieved);
  if (local.requires_revision) return { value: local, fallbackUsed: false, fallbackName: null, modelUsed: false };
  if (isAssembledDraft(draft)) return { value: local, fallbackUsed: false, fallbackName: null, modelUsed: false };
  try {
    const modeled = await callSchema(
      SYSTEM,
      {
        plan: { objective: plan.objective, success_criteria: plan.success_criteria },
        draft: compactDraft(draft),
        retrieved_sources: retrieved.map((s) => ({ id: s.id, kind: s.kind })),
      },
      parseCritique,
      timeoutMs,
      onRepair,
      signal,
      CRITIQUE_MAX_TOKENS,
      CRITIQUE_SCHEMA as unknown as Record<string, unknown>,
      remaining,
      clock,
      CRITIQUE_MAX_TOKENS,
      "evaluator",
    );
    if (modeled.requires_revision || !modeled.approve) {
      // The model Evaluator can only force a revision of model-written analysis. A code-built core still follows the deterministic critique.
      if (hasAnalysis(draft)) return { value: { ...modeled, approve: false, requires_revision: true }, fallbackUsed: false, fallbackName: null, modelUsed: true };
      return { value: local, fallbackUsed: false, fallbackName: null, modelUsed: true };
    }
    return { value: modeled, fallbackUsed: false, fallbackName: null, modelUsed: true };
  } catch (err) {
    if (err instanceof RequestDeadlineError) throw err;
    return { value: local, fallbackUsed: true, fallbackName: "deterministicCritique", modelUsed: false };
  }
}
