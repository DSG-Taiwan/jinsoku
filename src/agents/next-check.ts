import { isAssembledDraft, isFallbackDraft } from "./executor.ts";
import { hazardDowngrade, reasonConflation, truncatedReason } from "../final-pass.ts";
import type { RetrievedSource, SmokeDraft } from "../schemas.ts";

const NAME_SHAPE = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/;
const KINDS = ["zetaris", "hmem", "worldmodel", "markov"] as const;

function sentence(text: string): string {
  const clean = text.trim();
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function unsafe(text: string, retrieved: RetrievedSource[]): boolean {
  return (
    hazardDowngrade(text) ||
    NAME_SHAPE.test(text) ||
    reasonConflation(text, retrieved) != null ||
    truncatedReason(text, retrieved) != null
  );
}

/**
 * NEXT findings are the retrieved summaries, plus the Markovian carryover.
 * The model draft is not copied through. A fallback draft is returned unchanged
 * so the linter still blocks it.
 */
/** Cited rows, the next check, and the open-HAZARD block's inputs. No model call. */
export function codeNextDraft(retrieved: RetrievedSource[]): SmokeDraft {
  const markov = retrieved.find((item) => item.kind === "markov");
  const asset = markov && markov.id.startsWith("markov:") ? markov.id.slice("markov:".length) : "unit";
  const findings: SmokeDraft["findings"] = [];
  for (const kind of KINDS) {
    const source = retrieved.find((item) => item.kind === kind && !unsafe(item.summary, retrieved));
    if (!source) continue;
    findings.push({ claim: sentence(source.summary), evidence_ids: [source.id] });
  }
  const carry = markov ? sentence(markov.summary) : "A human inspects the unit.";
  return {
    headline: `NEXT ${asset}: cited rows, human decides`,
    findings,
    recommended_next_check: sentence(`Propose only. A human decides. ${carry}`),
    needs_human_decision: true,
    not_checked: ["Anything not in retrieved sources"],
    confidence: 0.4,
  };
}

export function prepareNextDraft(draft: SmokeDraft, retrieved: RetrievedSource[]): SmokeDraft {
  const markov = retrieved.find((item) => item.kind === "markov");
  if (isAssembledDraft(draft) || !markov || isFallbackDraft(draft)) return draft;
  const claim = markov.summary.trim();
  const findings: SmokeDraft["findings"] = [];
  for (const kind of KINDS) {
    if (kind === "markov") continue;
    const source = retrieved.find((item) => item.kind === kind && !unsafe(item.summary, retrieved));
    if (!source) continue;
    findings.push({ claim: sentence(source.summary), evidence_ids: [source.id] });
  }
  findings.push({ claim: sentence(claim), evidence_ids: [markov.id] });
  const asset = markov.id.startsWith("markov:") ? markov.id.slice("markov:".length) : "unit";
  return {
    ...draft,
    headline: unsafe(draft.headline, retrieved) ? `NEXT ${asset} check, human decides` : draft.headline,
    findings,
    recommended_next_check: sentence(`Propose only. A human decides. ${claim}`),
  };
}
