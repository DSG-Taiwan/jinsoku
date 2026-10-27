import { hazardDowngrade } from "../src/final-pass.ts";
import {
  caseSpecs,
  loadFacts,
  type CaseSpec,
  type Forbid,
  type Group,
  type IssueFact,
} from "./derive.ts";

const NAME_SHAPE = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g;
const MODEL_AGENTS = new Set(["planner", "executor", "evaluator", "final-pass", "zetaris", "meterless"]);

export type GradeName = "correct" | "partial" | "wrong" | "miss";

export interface Attempt {
  case_id: string;
  status: string;
  agents_used: string[];
  text: string;
  reason_code?: string | null;
}

export interface Grade {
  case_id: string;
  phrase: CaseSpec["phrase"];
  grade: GradeName;
  passed: string[];
  failed: string[];
  forbids: string[];
  unsupported: string[];
  name_leaks: string[];
  hazard_downgrade: boolean;
  invented_hazard: boolean;
  hazard_missed: boolean;
}

export interface SavedRun extends Attempt {
  run_index: number;
  request_id: string;
  trace_id: string;
  fallback_used: boolean;
  revision_count: number;
  human_message: string | null;
  evaluator_findings: string[];
  evaluator_critiques: string[];
  evaluator_exhaust: string | null;
  idempotency: "miss" | "hit";
  error: string | null;
}

function includes(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

function sentences(text: string): string[] {
  return text.split(/[.!?\n;]+/).map((part) => part.trim()).filter(Boolean);
}

function chunkPass(chunk: string, group: Group): boolean {
  if (group.all && !group.all.every((item) => includes(chunk, item))) return false;
  if (group.any && !group.any.some((item) => includes(chunk, item))) return false;
  if (group.pattern && !new RegExp(group.pattern, "i").test(chunk)) return false;
  if (group.reasons_at_least) {
    const found = group.reasons_at_least.reasons.filter((reason) => includes(chunk, reason)).length;
    if (found < group.reasons_at_least.n) return false;
  }
  if (group.actors_at_least) {
    const found = group.actors_at_least.actors.filter((actor) => includes(chunk, actor)).length;
    if (found < group.actors_at_least.n) return false;
  }
  return true;
}

function groupPass(text: string, group: Group): boolean {
  if (group.scope === "sentence") return sentences(text).some((chunk) => chunkPass(chunk, group));
  return chunkPass(text, group);
}

function forbidHit(text: string, rule: Forbid): boolean {
  const chunks = rule.scope === "sentence" ? sentences(text) : [text];
  return chunks.some((chunk) => {
    if (rule.all && !rule.all.every((item) => includes(chunk, item))) return false;
    if (rule.pattern && !new RegExp(rule.pattern, "i").test(chunk)) return false;
    return Boolean(rule.all?.length || rule.pattern);
  });
}

function tagged(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0].toUpperCase());
}

function unsupported(text: string, spec: CaseSpec): string[] {
  const issues = new Set(spec.allow_issue_ids);
  const actors = new Set(spec.allow_actors);
  const assets = new Set(spec.allow_assets);
  const bad = [
    ...tagged(text, /\bISS-\d+\b/gi).filter((id) => !issues.has(id)).map((id) => `issue ${id}`),
    ...tagged(text, /\bACT-\d+\b/gi).filter((id) => !actors.has(id)).map((id) => `actor ${id}`),
    ...tagged(text, /\bSSA-\d+\b/gi).filter((id) => !assets.has(id)).map((id) => `asset ${id}`),
  ];
  return [...new Set(bad)];
}

function nameLeaks(text: string): string[] {
  return [...new Set([...text.matchAll(NAME_SHAPE)].map((match) => match[0]))];
}

/** A positive open-HAZARD claim. A count of zero, including "of 0" and "is zero", is not one. */
export function claimsPositiveOpenHazard(text: string): boolean {
  return sentences(text).some((sentence) => {
    if (!/\bhazard\b/i.test(sentence)) return false;
    if (/open hazard count(?:\s+of)?\s+0\b/i.test(sentence)) return false;
    if (/open hazard count\s+is\s+(?:0|zero)\b/i.test(sentence)) return false;
    if (/\bno open hazard\b/i.test(sentence)) return false;
    return /\bopen\b/i.test(sentence);
  });
}

function hazardIds(spec: CaseSpec, openHazards: IssueFact[]): string[] {
  if (spec.expect !== "answer") return [];
  if (spec.phrase === "PATTERNS") return openHazards.map((row) => row.issue_id);
  if (!spec.asset) return [];
  return openHazards.filter((row) => row.asset_id === spec.asset).map((row) => row.issue_id);
}

function hazardMissed(text: string, ids: string[]): boolean {
  if (ids.length === 0) return false;
  if (!/\bhazard\b/i.test(text) || !/\bopen\b/i.test(text)) return true;
  return ids.some((id) => !includes(text, id));
}

export function gradeAttempt(attempt: Attempt, spec: CaseSpec, openHazards: IssueFact[]): Grade {
  const base = {
    case_id: spec.id,
    phrase: spec.phrase,
    passed: [] as string[],
    failed: [] as string[],
    forbids: [] as string[],
    unsupported: [] as string[],
    name_leaks: [] as string[],
    hazard_downgrade: false,
    invented_hazard: false,
    hazard_missed: false,
  };

  if (spec.expect === "refusal") {
    const agents = attempt.agents_used.filter((name) => MODEL_AGENTS.has(name));
    const ok =
      attempt.status === spec.status &&
      attempt.reason_code === spec.reason_code &&
      agents.length === 0;
    return { ...base, grade: ok ? "correct" : "wrong" };
  }

  if (attempt.status === "unresolved" || attempt.status === "error" || attempt.status === "thrown") {
    return { ...base, grade: "miss" };
  }

  if (attempt.status !== "ok") return { ...base, grade: "wrong" };

  const text = attempt.text ?? "";
  const passed: string[] = [];
  const failed: string[] = [];
  for (const group of spec.require) {
    if (groupPass(text, group)) passed.push(group.id);
    else failed.push(group.id);
  }
  const forbids = spec.forbid.filter((rule) => forbidHit(text, rule)).map((rule) => rule.id);
  const unknown = unsupported(text, spec);
  const leaks = nameLeaks(text);
  const downgrade = hazardDowngrade(text);
  const invented = spec.open_hazard_count === 0 && claimsPositiveOpenHazard(text);
  const missed = hazardMissed(text, hazardIds(spec, openHazards));
  const hard = forbids.length > 0 || unknown.length > 0 || leaks.length > 0 || downgrade || invented;
  let grade: GradeName = "wrong";
  if (!hard && failed.length === 0) grade = "correct";
  else if (!hard && passed.length >= spec.partial_min) grade = "partial";
  return {
    ...base,
    grade,
    passed,
    failed,
    forbids,
    unsupported: unknown,
    name_leaks: leaks,
    hazard_downgrade: downgrade,
    invented_hazard: invented,
    hazard_missed: missed,
  };
}

export function gradeRuns(runs: SavedRun[], specs = caseSpecs(), facts = loadFacts()): Grade[] {
  const byId = new Map(specs.map((spec) => [spec.id, spec]));
  return runs.map((run) => {
    const spec = byId.get(run.case_id);
    if (!spec) throw new Error(`unknown case ${run.case_id}`);
    return gradeAttempt(run, spec, facts.openHazards);
  });
}

export interface PhraseScore {
  phrase: string;
  runs: number;
  correct: number;
  partial: number;
  wrong: number;
  miss: number;
  unresolved: number;
  errors: number;
  fallback: number;
  strict: string;
  resolved_only: string;
}

export interface CauseUnresolved {
  case_id: string;
  request_id: string;
  trace_id: string;
  human_message: string | null;
  evaluator_findings: string[];
  evaluator_critiques: string[];
  evaluator_exhaust: string | null;
}

export interface ScoreSummary {
  runs: number;
  correct: number;
  partial: number;
  wrong: number;
  miss: number;
  unresolved: number;
  errors: number;
  fallback: number;
  strict: string;
  resolved_only: string;
  by_phrase: PhraseScore[];
  cause_unresolved_rate: string;
  cause_unresolved: CauseUnresolved[];
  unsupported_runs: number;
  hazard_downgrade_runs: number;
  invented_hazard_runs: number;
  hazard_missed_runs: number;
  name_leak_runs: number;
  idempotency_hits: number;
  grades: Grade[];
}

function fraction(numerator: number, denominator: number): string {
  if (denominator === 0) return "0/0";
  return `${numerator}/${denominator}`;
}

export function summarize(runs: SavedRun[], grades: Grade[]): ScoreSummary {
  if (runs.length !== grades.length) throw new Error("grade count does not match runs");
  const phraseOf = new Map(grades.map((grade, i) => [i, grade.phrase]));
  const phrases = ["CAUSE", "PATTERNS", "NEXT", "refusal"];
  const byPhrase = phrases.map((phrase) => {
    const indexes = grades.map((grade, i) => (grade.phrase === phrase ? i : -1)).filter((i) => i >= 0);
    const subset = indexes.map((i) => grades[i]);
    const runSubset = indexes.map((i) => runs[i]);
    const correct = subset.filter((grade) => grade.grade === "correct").length;
    const miss = subset.filter((grade) => grade.grade === "miss").length;
    const resolved = subset.length - miss;
    return {
      phrase,
      runs: subset.length,
      correct,
      partial: subset.filter((grade) => grade.grade === "partial").length,
      wrong: subset.filter((grade) => grade.grade === "wrong").length,
      miss,
      unresolved: runSubset.filter((run) => run.status === "unresolved").length,
      errors: runSubset.filter((run) => run.status === "error" || run.status === "thrown").length,
      fallback: runSubset.filter((run) => run.fallback_used).length,
      strict: fraction(correct, subset.length),
      resolved_only: fraction(correct, resolved),
    };
  });
  const correct = grades.filter((grade) => grade.grade === "correct").length;
  const miss = grades.filter((grade) => grade.grade === "miss").length;
  const causeRuns = runs.filter((_, i) => phraseOf.get(i) === "CAUSE");
  const causeUnresolved = causeRuns.filter((run) => run.status === "unresolved");
  return {
    runs: grades.length,
    correct,
    partial: grades.filter((grade) => grade.grade === "partial").length,
    wrong: grades.filter((grade) => grade.grade === "wrong").length,
    miss,
    unresolved: runs.filter((run) => run.status === "unresolved").length,
    errors: runs.filter((run) => run.status === "error" || run.status === "thrown").length,
    fallback: runs.filter((run) => run.fallback_used).length,
    strict: fraction(correct, grades.length),
    resolved_only: fraction(correct, grades.length - miss),
    by_phrase: byPhrase,
    cause_unresolved_rate: fraction(causeUnresolved.length, causeRuns.length),
    cause_unresolved: causeUnresolved.map((run) => ({
      case_id: run.case_id,
      request_id: run.request_id,
      trace_id: run.trace_id,
      human_message: run.human_message,
      evaluator_findings: run.evaluator_findings,
      evaluator_critiques: run.evaluator_critiques,
      evaluator_exhaust: run.evaluator_exhaust,
    })),
    unsupported_runs: grades.filter((grade) => grade.unsupported.length > 0).length,
    hazard_downgrade_runs: grades.filter((grade) => grade.hazard_downgrade).length,
    invented_hazard_runs: grades.filter((grade) => grade.invented_hazard).length,
    hazard_missed_runs: grades.filter((grade) => grade.hazard_missed).length,
    name_leak_runs: grades.filter((grade) => grade.name_leaks.length > 0).length,
    idempotency_hits: runs.filter((run) => run.idempotency === "hit").length,
    grades,
  };
}

export function answerText(result: {
  summary?: string;
  headline?: string;
  recommended_next_check?: string;
  human_message?: string;
  findings?: { claim?: string }[];
  not_checked?: string[];
}): string {
  return [
    result.summary,
    result.headline,
    result.recommended_next_check,
    result.human_message,
    ...(result.findings ?? []).map((finding) => finding.claim ?? ""),
    ...(result.not_checked ?? []),
  ]
    .filter((part) => typeof part === "string" && part.trim())
    .join("\n");
}
