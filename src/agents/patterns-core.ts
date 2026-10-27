import { assembleFromRecords } from "./executor.ts";
import { isPrecursorFlag, precursorFindings } from "./precursors.ts";
import type { CallObject, RetrievedSource, SmokeDraft } from "../schemas.ts";

function sentence(text: string): string {
  const clean = text.trim();
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

/**
 * PATTERNS and CAUSE core built in code from the retrieved rows, the way NEXT is. The cited rows are the full
 * incident rows, one finding per memory or world-model read, and the historical did_not_hold grouping
 * by pseudonymous actor when retrieval produced it. The model only writes a short headline afterward.
 * The headline is not the assembled-from-records label, so this is not counted as a fallback.
 */
export function codeRowsDraft(call: CallObject, retrieved: RetrievedSource[]): SmokeDraft {
  const base = assembleFromRecords(call, retrieved);
  const findings = [...base.findings];
  const coaching = retrieved.find((source) => source.kind === "zetaris" && source.summary.startsWith("Historical did_not_hold"));
  if (coaching && !findings.some((finding) => finding.evidence_ids.includes(coaching.id))) {
    findings.push({ claim: sentence(coaching.summary), evidence_ids: [coaching.id] });
  }
  const flags = call.verb === "CAUSE" ? precursorFindings(retrieved, call.asset) : [];
  findings.push(...flags);
  return {
    ...base,
    headline: `${call.verb} ${call.asset ?? call.period ?? "week"}: cited rows, human decides`,
    findings,
    recommended_next_check: coaching
      ? "Propose a coaching conversation for the lead. A human inspects the unit. Agents propose only."
      : flags.some(isPrecursorFlag)
        ? "Propose an escalation to a lead for human analysis. A human inspects the unit. Agents propose only."
        : "A human inspects the unit. Agents propose only.",
  };
}

/** Kept for the PATTERNS name used in tests and earlier hand-offs. */
export const codePatternsDraft = codeRowsDraft;

const HEADLINE_BLOCKED = /hazard|resolv|\bclos(?:e|ed|ing|ure)\b|clear|downgrad/i;
const HEADLINE_NAME = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/;

/** A model headline is optional decoration. Anything that talks about hazards, closure or a person falls back to the code headline. */
export function acceptableHeadline(text: string): boolean {
  const clean = text.trim();
  return clean.length > 0 && clean.length <= 160 && !HEADLINE_BLOCKED.test(clean) && !HEADLINE_NAME.test(clean);
}
