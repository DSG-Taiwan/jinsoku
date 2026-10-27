import { confirmedOpenHazards, rowsOf, type IssueRecord } from "./hazard-block.ts";
import { isIssueSource, sameRecord } from "./precursors.ts";
import type { RetrievedSource, StructuredClaim } from "../schemas.ts";

/**
 * Structured analysis claims. The model never writes a sentence: it selects a template from a closed set, names the incident ids
 * it read, weighs each one against the template, judges the claim, gives reasons from a closed list and recommends one option
 * from a closed list. Code verifies every selection against the typed rows and renders the words itself.
 */
export const TEMPLATES = ["repeat_failure", "same_actor_repeat", "recurrence_after_fix", "open_hazard_pending", "inspect_unit"] as const;
export const VERDICTS = ["supports", "contradicts", "insufficient"] as const;
export const JUDGMENTS = ["supported", "not_supported", "insufficient_evidence"] as const;
export const REASONS = ["same_unit", "same_actor", "repeated_after_fix", "open_hazard_on_unit", "no_other_pattern"] as const;
export const LIMITS = { reasons: 3, ids: 8 } as const;
export const OPTIONS = ["inspect_unit", "escalate_to_lead", "coaching_conversation", "hold_for_human_analysis"] as const;

const REASON_WORDS: Record<string, string> = {
  same_unit: "same unit",
  same_actor: "same actor",
  repeated_after_fix: "repeated after a fix",
  open_hazard_on_unit: "open HAZARD on the unit",
  no_other_pattern: "no other pattern found",
};
const OPTION_WORDS: Record<string, string> = {
  inspect_unit: "a human inspects the unit",
  escalate_to_lead: "escalate to a lead for human analysis",
  coaching_conversation: "propose a coaching conversation for the lead",
  hold_for_human_analysis: "hold for human analysis",
};

interface Indexed {
  row: IssueRecord;
  sourceIds: string[];
  conflicted: boolean;
}

/** Every incident id in the retrieved rows, with the sources that carry it. An id whose rows differ is marked conflicted. */
function indexIncidents(retrieved: RetrievedSource[]): Map<string, Indexed> {
  const index = new Map<string, Indexed>();
  for (const source of retrieved) {
    if (!isIssueSource(source)) continue;
    for (const row of rowsOf(source)) {
      const seen = index.get(row.issue_id);
      if (!seen) index.set(row.issue_id, { row, sourceIds: [source.id], conflicted: false });
      else {
        if (!seen.sourceIds.includes(source.id)) seen.sourceIds.push(source.id);
        if (!sameRecord(seen.row, row)) seen.conflicted = true;
      }
    }
  }
  return index;
}

export interface Verification {
  issues: string[];
  expected: { weigh: { id: string; verdict: string }[]; judge: string };
  sourceIds: string[];
}

const dateOf = (row: IssueRecord): string => row.opened_at;

/** The patterns the four non-inspect templates look for, evaluated over every incident on the unit. */
function patternsOnUnit(unit: string, index: Map<string, Indexed>, hazardOnUnit: boolean): string[] {
  const unitRows = [...index.values()].filter((entry) => entry.row.asset_id === unit).map((entry) => entry.row);
  const failed = unitRows.filter((row) => row.fix_outcome === "did_not_hold");
  const found: string[] = [];
  if (failed.length >= 2) found.push("repeat_failure");
  // same_actor_repeat is verified on any outcome, so the negative statement must use the same definition: one actor key on two incidents
  if (unitRows.some((a) => unitRows.some((b) => b !== a && a.actor_key === b.actor_key))) found.push("same_actor_repeat");
  if (failed.some((first) => unitRows.some((later) => dateOf(later) > dateOf(first)))) found.push("recurrence_after_fix");
  if (hazardOnUnit) found.push("open_hazard_pending");
  return found;
}

/** Recompute everything the model selected from the rows. Nothing the model said is trusted beyond its choice of template and ids. */
export function verifyClaim(claim: StructuredClaim, retrieved: RetrievedSource[]): Verification {
  const issues: string[] = [];
  const index = indexIncidents(retrieved);
  const out = (): Verification => ({ issues, expected: { weigh: [], judge: "insufficient_evidence" }, sourceIds: [] });

  if (!(TEMPLATES as readonly string[]).includes(claim.template)) {
    issues.push(`template ${claim.template} is not in the closed set`);
    return out();
  }
  if (!/^SSA-\d+$/.test(claim.unit)) issues.push("unit is not an SSA id");
  const unitKnown = [...index.values()].some((entry) => entry.row.asset_id === claim.unit);
  if (/^SSA-\d+$/.test(claim.unit) && !unitKnown) issues.push(`unit ${claim.unit} is not in the retrieved rows`);
  for (const reason of claim.reasons) if (!(REASONS as readonly string[]).includes(reason)) issues.push(`reason ${reason} is not in the closed list`);
  if (!(OPTIONS as readonly string[]).includes(claim.recommend)) issues.push(`recommended option ${claim.recommend} is not in the closed list`);
  if (!(JUDGMENTS as readonly string[]).includes(claim.judge)) issues.push(`judgment ${claim.judge} is not in the closed list`);
  for (const entry of claim.weigh) if (!(VERDICTS as readonly string[]).includes(entry.verdict)) issues.push(`verdict ${entry.verdict} is not in the closed list`);

  // size and duplicate limits are enforced here, not only in the model's JSON schema
  if (claim.reasons.length > LIMITS.reasons) issues.push(`more than ${LIMITS.reasons} reasons given`);
  if (new Set(claim.reasons).size !== claim.reasons.length) issues.push("a reason is given more than once");
  if (claim.ids.length > LIMITS.ids) issues.push(`more than ${LIMITS.ids} incident ids given`);
  if (new Set(claim.ids).size !== claim.ids.length) issues.push("an incident id is listed more than once");
  if (claim.weigh.length > LIMITS.ids) issues.push(`more than ${LIMITS.ids} weighing entries given`);
  if (new Set(claim.weigh.map((entry) => entry.id)).size !== claim.weigh.length) issues.push("an incident is weighed more than once");

  const ids = [...new Set(claim.ids)];
  const rows: IssueRecord[] = [];
  for (const id of ids) {
    const entry = index.get(id);
    if (!entry) issues.push(`${id} is not in the retrieved rows`);
    else if (entry.row.asset_id !== claim.unit) issues.push(`${id} is not on ${claim.unit}`);
    else rows.push(entry.row);
  }
  const needsTwo = claim.template === "repeat_failure" || claim.template === "same_actor_repeat" || claim.template === "recurrence_after_fix";
  if (needsTwo && ids.length < 2) issues.push(`${claim.template} needs at least two incident ids`);

  // what each incident does for this template
  const verdictFor = (row: IssueRecord): string => {
    const entry = index.get(row.issue_id);
    if (entry?.conflicted) return "insufficient";
    switch (claim.template) {
      case "repeat_failure":
        return row.fix_outcome === "did_not_hold" ? "supports" : "contradicts";
      case "same_actor_repeat":
        return row.actor_key === rows[0]?.actor_key ? "supports" : "contradicts";
      case "recurrence_after_fix": {
        const ordered = [...rows].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
        const first = ordered[0];
        if (!first || first.fix_outcome !== "did_not_hold") return "contradicts";
        return row.issue_id === first.issue_id || dateOf(row) > dateOf(first) ? "supports" : "contradicts";
      }
      case "open_hazard_pending":
        return confirmedOpenHazards(retrieved).some((fact) => fact.issue_id === row.issue_id) ? "supports" : "contradicts";
      default:
        return "supports";
    }
  };
  const expectedWeigh = rows.map((row) => ({ id: row.issue_id, verdict: verdictFor(row) }));

  let preconditionOk = true;
  if (claim.template === "open_hazard_pending") {
    preconditionOk = confirmedOpenHazards(retrieved).some((fact) => fact.asset_id === claim.unit);
    if (!preconditionOk) issues.push(`${claim.unit} has no confirmed open HAZARD`);
  }
  if (claim.template === "recurrence_after_fix") {
    const dates = new Set(rows.map(dateOf));
    if (rows.length >= 2 && dates.size < 2) issues.push("recurrence_after_fix needs incidents on different dates");
  }
  // each reason the model gives must be true of the rows
  const sameActor = rows.length >= 2 && rows.every((row) => row.actor_key === rows[0].actor_key);
  const orderedRows = [...rows].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  const recurred = rows.length >= 2 && orderedRows[0].fix_outcome === "did_not_hold" && dateOf(orderedRows[orderedRows.length - 1]) > dateOf(orderedRows[0]);
  const hazardOnUnit = confirmedOpenHazards(retrieved).some((fact) => fact.asset_id === claim.unit);
  for (const reason of claim.reasons) {
    if (reason === "same_actor" && !sameActor) issues.push("reason same_actor: the incidents do not share one actor key");
    if (reason === "repeated_after_fix" && !recurred) issues.push("reason repeated_after_fix: no later incident follows a fix that did not hold");
    if (reason === "open_hazard_on_unit" && !hazardOnUnit) issues.push(`reason open_hazard_on_unit: ${claim.unit} has no confirmed open HAZARD`);
    if (reason === "no_other_pattern" && claim.reasons.length > 1) issues.push("reason no_other_pattern cannot be combined with another reason");
    if (reason === "no_other_pattern") {
      // "no other pattern" is a statement about the whole unit: it is true only if none of the four patterns holds on any of its rows
      const found = patternsOnUnit(claim.unit, index, hazardOnUnit);
      if (claim.template !== "inspect_unit") issues.push("reason no_other_pattern is only allowed with inspect_unit");
      if (found.length > 0) issues.push(`reason no_other_pattern: the rows on ${claim.unit} show ${found.join(", ")}`);
    }
  }
  const allSupport = expectedWeigh.every((entry) => entry.verdict === "supports") && (rows.length > 0 || claim.template === "inspect_unit" || claim.template === "open_hazard_pending");
  const anyContradict = expectedWeigh.some((entry) => entry.verdict === "contradicts");
  const expectedJudge = !issues.length && preconditionOk && allSupport ? "supported" : anyContradict ? "not_supported" : "insufficient_evidence";

  // the model's weighing and judgment must match what the rows say
  for (const expected of expectedWeigh) {
    const said = claim.weigh.find((entry) => entry.id === expected.id);
    if (!said) issues.push(`${expected.id} was not weighed`);
    else if (said.verdict !== expected.verdict) issues.push(`${expected.id} was weighed as ${said.verdict}; the rows say ${expected.verdict}`);
  }
  for (const said of claim.weigh) if (!ids.includes(said.id)) issues.push(`${said.id} was weighed but is not one of the incident ids read`);
  if (claim.judge !== expectedJudge) issues.push(`judged ${claim.judge}; the rows say ${expectedJudge}`);
  if (expectedJudge !== "supported") issues.push(`the claim is ${expectedJudge.replace(/_/g, " ")} by the rows`);

  const sourceIds = new Set<string>();
  for (const row of rows) for (const sid of index.get(row.issue_id)?.sourceIds ?? []) sourceIds.add(sid);
  if (claim.template === "open_hazard_pending") for (const fact of confirmedOpenHazards(retrieved)) if (fact.asset_id === claim.unit) { sourceIds.add(fact.zetaris_id); sourceIds.add(fact.world_id); }
  if (claim.template === "inspect_unit" || sourceIds.size === 0) {
    for (const entry of index.values()) if (entry.row.asset_id === claim.unit) entry.sourceIds.forEach((sid) => sourceIds.add(sid));
  }
  if (sourceIds.size === 0) issues.push("no retrieved source supports this claim");
  return { issues, expected: { weigh: expectedWeigh, judge: expectedJudge }, sourceIds: [...sourceIds] };
}

const idList = (ids: string[]): string => (ids.length <= 1 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`);

/** The words, written by code from the verified rows. Only call after verifyClaim reports no issues. */
export function renderClaim(claim: StructuredClaim, retrieved: RetrievedSource[]): string {
  const index = indexIncidents(retrieved);
  const ids = [...new Set(claim.ids)];
  const rows = ids.map((id) => index.get(id)!.row);
  let lead: string;
  switch (claim.template) {
    case "repeat_failure":
      lead = `${claim.unit}: ${rows.length} fixes did not hold (${ids.join(", ")}).`;
      break;
    case "same_actor_repeat":
      lead = `${claim.unit}: ${rows[0].actor_key} appears on ${idList(ids)}, all did not hold or recurred.`.replace(", all did not hold or recurred", rows.every((r) => r.fix_outcome === "did_not_hold") ? ", all did not hold" : "");
      break;
    case "recurrence_after_fix": {
      const ordered = [...rows].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
      const first = ordered[0];
      const later = ordered.slice(1).map((r) => r.issue_id);
      lead = `${claim.unit}: ${idList(later)} recurred after ${first.issue_id} (opened ${first.opened_at}).`;
      break;
    }
    case "open_hazard_pending":
      lead = `${claim.unit}: open HAZARD, a human decides.`;
      break;
    default:
      lead = `A human inspects ${claim.unit} next.`;
  }
  const support = new Set(claim.weigh.filter((entry) => entry.verdict === "supports" && ids.includes(entry.id)).map((entry) => entry.id)).size;
  const read = ids.length > 0 ? `read ${ids.length === 1 ? "1 incident" : `${ids.length} incidents`} (${ids.join(", ")}); ${support} of ${ids.length} support` : "read the unit's rows";
  const why = claim.reasons.length > 0 ? ` Why: ${claim.reasons.map((r) => REASON_WORDS[r] ?? r).join(", ")}.` : "";
  return `[${claim.template}] ${lead} Evidence check: ${read}; judged ${claim.judge.replace(/_/g, " ")}.${why} Suggested option: ${OPTION_WORDS[claim.recommend] ?? claim.recommend}.`;
}

export function renderOption(option: string): string {
  return OPTION_WORDS[option] ?? option;
}

/** The typed rows the model reads: id, unit, kind, date, actor key, outcome. No free text, so the model reasons over fields. */
export function incidentRowsForModel(retrieved: RetrievedSource[]): { id: string; unit: string; kind: string; date: string; actor: string; outcome: string }[] {
  const rows: { id: string; unit: string; kind: string; date: string; actor: string; outcome: string }[] = [];
  for (const [id, entry] of indexIncidents(retrieved)) {
    rows.push({ id, unit: entry.row.asset_id, kind: entry.row.kind, date: entry.row.opened_at, actor: entry.row.actor_key, outcome: entry.row.fix_outcome });
  }
  return rows;
}
