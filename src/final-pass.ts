import { hazardBlockFindings, inventedOpenHazard } from "./agents/hazard-block.ts";
import { ASSEMBLED_LABEL, isFallbackDraft } from "./agents/executor.ts";
import { precursorFindings } from "./agents/precursors.ts";
import { renderClaim, verifyClaim } from "./agents/claims.ts";
import { parseDateRange, type StructuredClaim } from "./schemas.ts";
import type { FinalAnswer, RetrievedSource, SmokeDraft } from "./schemas.ts";

const HAZARD_VERBS =
  /\b(close|closed|closing|downgrade|downgraded|downgrading|clear|cleared|clearing|resolve|resolved|resolving)\b/i;
const SECRET_SHAPE = /(nvapi-|Bearer\s|sk-[A-Za-z0-9])/i;
const NAME_SHAPE = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/;
const MAX_HEADLINE = 240;

export const QUALITY_PREFIX = "Data quality:";

export class LinterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinterError";
  }
}

const STRICT_PREFIX = /\b(?:do\s+not|does\s+not|never)\s+$/i;
const SAME_REASON = /\b(?:for the same reason|same reason|same cause|for the same cause)\b/i;
const ISSUE_ROW = /\b(ISS-\d+)\s+(\S+)\s+(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(ACT-\d+)\s+(\S+)\s+([^;]+)/g;
const MEMORY_ROW =
  /\bincident (ISS-\d+)\s+on\s+\S+:[\s\S]*?opened\s+(\d{4}-\d{2}-\d{2}),\s+actor\s+(ACT-\d+),[\s\S]*?reason\s+([^.]*)/g;

type TypedRow = { issue_id: string; asset_id: string; kind: string; opened_at: string; actor_key: string; fix_outcome: string; reason: string };

interface IncidentRow {
  id: string;
  date: string;
  actor: string;
  reason: string;
  asset?: string;
  kind?: string;
  outcome?: string;
}

function normReason(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/g, "").trim();
}

/**
 * Rows the retrieval text actually carried. An issue id whose rows disagree keeps every distinct variant; no row is
 * preferred over another. Identical repeats are one row.
 */
export function incidentsFromRetrieved(retrieved: { summary: string; rows?: TypedRow[] }[]): IncidentRow[] {
  const found = new Map<string, IncidentRow>();
  for (const source of retrieved) {
    // A source with typed rows is read from them; its summary text is never re-parsed as records.
    if (source.rows) {
      for (const typed of source.rows) {
        const row: IncidentRow = { id: typed.issue_id, asset: typed.asset_id, kind: typed.kind, date: typed.opened_at, actor: typed.actor_key, outcome: typed.fix_outcome, reason: normReason(typed.reason) };
        const key = `${row.id}|${row.asset ?? ""}|${row.date}|${row.actor}|${row.kind ?? ""}|${row.outcome ?? ""}|${row.reason}`;
        if (!found.has(key)) found.set(key, row);
      }
      continue;
    }
    for (const pattern of [ISSUE_ROW, MEMORY_ROW]) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source.summary))) {
        const row: IncidentRow =
          pattern === ISSUE_ROW
            ? { id: match[1], asset: match[2], kind: match[3], date: match[4], actor: match[5], outcome: match[6], reason: normReason(match[7]) }
            : { id: match[1], date: match[2], actor: match[3], reason: normReason(match[4]) };
        const key = `${row.id}|${row.asset ?? ""}|${row.date}|${row.actor}|${row.kind ?? ""}|${row.outcome ?? ""}|${row.reason}`;
        if (!found.has(key)) found.set(key, row);
      }
    }
  }
  return [...found.values()];
}

/**
 * "Same reason" is allowed only when every incident the draft names has the same reason text.
 * A date plus an actor is enough to name an incident. Otherwise the equivalence is unsupported.
 */
export function reasonConflation(text: string, retrieved: { summary: string; rows?: TypedRow[] }[]): string | null {
  if (!SAME_REASON.test(text)) return null;
  const mentioned = incidentsFromRetrieved(retrieved).filter(
    (row) => text.includes(row.id) || (text.includes(row.date) && text.includes(row.actor)),
  );
  const reasons = new Set(mentioned.map((row) => row.reason));
  if (mentioned.length >= 2 && reasons.size === 1) return null;
  if (mentioned.length >= 2) {
    return `reason conflation: ${mentioned.map((row) => `${row.date} ${row.actor} (${row.reason})`).join(" vs ")}`;
  }
  return "reason conflation: same reason is not tied to identical incident reasons";
}

/** A cited issue id that was not retrieved is a hallucination and is not released. */
export function unsupportedIssue(text: string, retrieved: { summary: string }[]): string | null {
  const known = new Set<string>();
  for (const source of retrieved) {
    if (source.summary.startsWith(QUALITY_PREFIX)) continue;
    for (const match of source.summary.matchAll(/\b(ISS-\d+)\b/gi)) known.add(match[1].toUpperCase());
  }
  const cited = [...text.matchAll(/\b(ISS-\d+)\b/gi)].map((match) => match[1].toUpperCase());
  const bad = [...new Set(cited.filter((id) => !known.has(id)))];
  if (bad.length === 0) return null;
  return `unsupported issue ${bad.join(", ")}`;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasToken = (sentence: string, token: string): boolean => new RegExp(`(?<![\\w-])${escapeRegExp(token)}(?![\\w-])`).test(sentence);
const tokensOf = (row: IncidentRow): string[] => [row.date, row.actor].filter((token): token is string => Boolean(token));

/** The exact shape of a released incident claim. Any sentence that has this structure is a record claim and is bound to one retrieved version as a whole. */
const RECORD = /\b(ISS-\d+) (SSA-\d+) (OOS|HAZARD|MICROFIX) opened (\d{4}-\d{2}-\d{2}) actor (ACT-\d+) (held|did_not_hold) reason ([\s\S]+)$/;
const looksLikeRecord = (sentence: string): boolean => /\bISS-\d+ SSA-\d+ \S+ opened\b/i.test(sentence);
const FLOOR_SUFFIX = / and stays open for a human$/i;

/** Case-folded, whitespace-collapsed copy of a text, with the position in the original of every folded character. */
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let lastSpace = false;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!lastSpace) {
        folded += " ";
        map.push(i);
      }
      lastSpace = true;
    } else {
      for (const ch of text[i].toLowerCase()) {
        folded += ch;
        map.push(i);
      }
      lastSpace = false;
    }
  }
  return { folded, map };
}

/**
 * [from, to) spans of the text that are a verbatim retrieved reason. The search is a literal one: the size or content of a reason
 * never reaches a regular expression, and the text itself is not altered.
 */
function reasonSpans(text: string, catalog: IncidentRow[]): [number, number][] {
  const { folded, map } = foldWithMap(text);
  const spans: [number, number][] = [];
  for (const reason of new Set(catalog.map((row) => row.reason))) {
    if (!reason) continue;
    let from = 0;
    for (let at = folded.indexOf(reason, from); at >= 0; at = folded.indexOf(reason, from)) {
      const last = at + reason.length - 1;
      spans.push([map[at], (map[last] ?? text.length - 1) + 1]);
      from = at + Math.max(reason.length, 1);
    }
  }
  // A reason can be a prefix of another ("belt slip", "belt slip again"). Overlapping spans are one span, so a caller that cuts them out cuts each character once.
  spans.sort((x, y) => x[0] - y[0] || y[1] - x[1]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] < last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/** Sentences end at . ! ? ; or a newline, except inside a verbatim retrieved reason, which may itself contain any of those. */
function splitSentences(text: string, catalog: IncidentRow[]): string[] {
  const spans = reasonSpans(text, catalog);
  const protectedAt = (i: number): boolean => spans.some(([from, to]) => i >= from && i < to);
  const pieces: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (/[.!?\n;]/.test(text[i]) && !protectedAt(i)) {
      pieces.push(text.slice(start, i));
      start = i + 1;
    }
  }
  pieces.push(text.slice(start));
  return pieces;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAME = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
function isoOf(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${pad(y, 4)}-${pad(m)}-${pad(d)}` : null;
}

/** Each date a text states, as the ISO dates it could mean (a slash date may be month-first or day-first). An unreadable date stays as its own text, so it matches nothing. */
function datesIn(text: string): string[][] {
  const found: string[][] = [];
  let rest = text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_m, y, mo, d) => {
    found.push([isoOf(Number(y), Number(mo), Number(d)) ?? `${y}-${mo}-${d}`]);
    return " ";
  });
  rest = rest.replace(/\b(\d{1,4})[/.](\d{1,2})[/.](\d{1,4})\b/g, (_m, a: string, b: string, c: string) => {
    const options = new Set<string>();
    if (a.length === 4) {
      const iso = isoOf(Number(a), Number(b), Number(c));
      if (iso) options.add(iso);
    } else {
      const year = c.length === 4 ? Number(c) : c.length === 2 ? 2000 + Number(c) : NaN;
      if (!Number.isNaN(year)) {
        for (const [month, day] of [[Number(a), Number(b)], [Number(b), Number(a)]]) {
          const iso = isoOf(year, month, day);
          if (iso) options.add(iso);
        }
      }
    }
    found.push(options.size ? [...options] : [`${a}/${b}/${c}`]);
    return " ";
  });
  rest = rest.replace(new RegExp(`\\b${MONTH_NAME}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi"), (_m, mon: string, d: string, y: string) => {
    found.push([isoOf(Number(y), MONTHS.indexOf(mon.toLowerCase()) + 1, Number(d)) ?? `${mon} ${d} ${y}`]);
    return " ";
  });
  rest.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_NAME},?\\s+(\\d{4})\\b`, "gi"), (_m, d: string, mon: string, y: string) => {
    found.push([isoOf(Number(y), MONTHS.indexOf(mon.toLowerCase()) + 1, Number(d)) ?? `${d} ${mon} ${y}`]);
    return " ";
  });
  return found;
}

const assetsIn = (text: string): string[] => [...text.matchAll(/\bSSA[ -]?(\d+)\b/gi)].map((m) => `SSA-${Number(m[1])}`);
const actorsIn = (text: string): string[] =>
  [...text.matchAll(/\bACT[ -]?(\d+)((?:-[A-Za-z0-9_]+)*)\b/gi)].map((m) => (m[2] ? `ACT-${Number(m[1])}${m[2]}`.toUpperCase() : `ACT-${Number(m[1])}`));
const kindsIn = (text: string): string[] => [...text.matchAll(/\b(OOS|HAZARD|MICROFIX)\b/gi)].map((m) => m[1].toUpperCase());
const OUTCOME_WORD = (word: string): string => {
  const w = word.toLowerCase().replace(/ /g, "_");
  return w === "did_hold" ? "held" : w;
};
/** Outcomes a text states: a labeled outcome (any word), "did not hold" / "failed to hold" and "held" / "did hold". */
function outcomesIn(text: string): string[] {
  const found: string[] = [];
  let rest = text.replace(/\b(?:fix_)?outcome\s*[:=]?\s*(did[ _]not[ _]hold|did[ _]hold|held|[A-Za-z_]+)/gi, (_m, word: string) => {
    found.push(OUTCOME_WORD(word));
    return " ";
  });
  rest = rest.replace(/\b(?:did[ _]not[ _]hold|failed to hold)\b/gi, () => {
    found.push("did_not_hold");
    return " ";
  });
  rest.replace(/\b(?:did hold|held)\b/gi, () => {
    found.push("held");
    return " ";
  });
  return found;
}

type Version = IncidentRow;
/** The first attribute in `text` that no one of `versions` has, or null. A field the versions do not carry (a memory row has no kind or outcome) is not checked. */
function foreignAttribute(text: string, versions: Version[]): string | null {
  const have = (values: (string | undefined)[], fold: (value: string) => string): Set<string> => new Set(values.filter((v): v is string => Boolean(v)).map(fold));
  const assetsHave = have(versions.map((v) => v.asset), (v) => `SSA-${Number(v.replace(/\D/g, ""))}`);
  const actorsHave = have(versions.map((v) => v.actor), (v) => `ACT-${Number(v.replace(/\D/g, ""))}`);
  const kindsHave = have(versions.map((v) => v.kind), (v) => v.toUpperCase());
  const outcomesHave = have(versions.map((v) => v.outcome), (v) => v.toLowerCase());
  const datesHave = have(versions.map((v) => v.date), (v) => v);
  if (assetsHave.size) for (const asset of assetsIn(text)) if (!assetsHave.has(asset)) return "asset";
  if (actorsHave.size) for (const actor of actorsIn(text)) if (!actorsHave.has(actor)) return "actor";
  if (kindsHave.size) for (const kind of kindsIn(text)) if (!kindsHave.has(kind)) return "kind";
  if (outcomesHave.size) for (const outcome of outcomesIn(text)) if (!outcomesHave.has(outcome)) return "outcome";
  if (datesHave.size) for (const options of datesIn(text)) if (!options.some((iso) => datesHave.has(iso))) return "date";
  return null;
}

/**
 * Every structured attribute a claim states about an incident (asset, date, actor, kind, outcome) must belong to a retrieved
 * version of THAT incident. A claim is read sentence by sentence and, within a sentence, id by id: the text from one incident id
 * to the next is about the first of them, so naming a second incident does not widen what the first may claim. Text that opens a
 * sentence before its first id is about that id. The tail of a clause (after the last comma or "and") may also describe the next id.
 * Display forms are normalized first (Unicode digits, "SSA 004", slash and month-name dates, "outcome <word>"), and a form that
 * is recognized but unreadable matches nothing. Verbatim retrieved reasons are removed, since words inside a reason are not attributes.
 * A sentence that names an id with no retrieved row is not checked here (an id not retrieved at all is rejected by unsupportedIssue).
 */
export function claimBindingProblem(claim: string, retrieved: { summary: string; rows?: TypedRow[] }[]): string | null {
  const catalog = incidentsFromRetrieved(retrieved);
  const normalized = claim.normalize("NFKC");
  const spans = reasonSpans(normalized, catalog).sort((x, y) => y[0] - x[0]);
  let text = normalized;
  for (const [from, to] of spans) text = `${text.slice(0, from)} ${text.slice(to)}`;
  const byId = (id: string): Version[] => catalog.filter((row) => row.id.toUpperCase() === id.toUpperCase());
  let last: Version[] = [];
  for (const sentence of text.split(/[.!?\n;]/)) {
    const ids = [...sentence.matchAll(/\bISS-\d+\b/gi)];
    if (ids.length === 0) {
      // A sentence that refers back to the incident just named ("It was a MICROFIX.") is about that incident.
      if (last.length > 0 && /^\s*(?:it|this|that|they|its|the incident)\b/i.test(sentence)) {
        const bad = foreignAttribute(sentence, last);
        if (bad) return `claim states a ${bad} that no retrieved version of the incident just named has`;
      }
      continue;
    }
    if (ids.some((match) => byId(match[0]).length === 0)) continue;
    last = ids.flatMap((match) => byId(match[0]));
    for (let i = 0; i < ids.length; i++) {
      const own = byId(ids[i][0]);
      const start = i === 0 ? 0 : (ids[i].index ?? 0);
      const end = i + 1 < ids.length ? (ids[i + 1].index ?? sentence.length) : sentence.length;
      const segment = sentence.slice(start, end);
      const cut = Math.max(segment.lastIndexOf(","), segment.toLowerCase().lastIndexOf(" and "));
      const head = cut > 0 && i + 1 < ids.length ? segment.slice(0, cut) : segment;
      const tail = cut > 0 && i + 1 < ids.length ? segment.slice(cut) : "";
      const headBad = foreignAttribute(head, own);
      if (headBad) return `claim states a ${headBad} that no retrieved version of ${ids[i][0].toUpperCase()} has`;
      if (tail) {
        const next = byId(ids[i + 1][0]);
        const tailBad = foreignAttribute(tail, [...own, ...next]);
        if (tailBad) return `claim states a ${tailBad} that no retrieved version of ${ids[i][0].toUpperCase()} or ${ids[i + 1][0].toUpperCase()} has`;
      }
    }
  }
  return null;
}

/** A "with reason ..." sentence has to carry that incident's full reason text, not a chopped prefix. */
export function truncatedReason(text: string, retrieved: { summary: string; rows?: TypedRow[] }[]): string | null {
  const catalog = incidentsFromRetrieved(retrieved);
  for (const sentence of splitSentences(text, catalog)) {
    if (!/\breason\s+\S+/i.test(sentence)) continue;
    if (looksLikeRecord(sentence)) {
      // Positive binding: asset, kind, date, actor, outcome and the whole reason must all come from one retrieved version.
      const record = RECORD.exec(sentence.trim());
      const firstId = /\bISS-\d+\b/.exec(sentence)?.[0] ?? "incident";
      if (!record) return `record claim is not a complete retrieved record: ${firstId}`;
      const reason = normReason(record[7].replace(FLOOR_SUFFIX, ""));
      const bound = catalog.some(
        (row) => row.id === record[1] && row.asset === record[2] && row.kind === record[3] && row.date === record[4] && row.actor === record[5] && row.outcome === record[6] && row.reason === reason,
      );
      if (!bound) return `record claim does not match any retrieved version: ${record[1]}`;
      continue;
    }
    const namedIds = [...sentence.matchAll(/\b(ISS-\d+)\b/g)].map((match) => match[1]);
    const named = catalog.filter((row) =>
      namedIds.length > 0 ? namedIds.includes(row.id) : sentence.includes(row.date) && sentence.includes(row.actor),
    );
    // An id with differing rows is satisfied by quoting one version in full, and the sentence may not mix in the date,
    // actor, kind or outcome that belong only to another version. An id with one version must quote its full reason.
    const byId = new Map<string, typeof named>();
    for (const row of named) byId.set(row.id, [...(byId.get(row.id) ?? []), row]);
    for (const [id, variants] of byId) {
      const matching = variants.filter((row) => normReason(sentence).includes(row.reason));
      if (matching.length === 0) return `reason truncated: ${id} ${variants[0].reason}`;
      if (variants.length > 1) {
        const consistent = matching.some((row) => {
          const own = new Set(tokensOf(row));
          const foreign = variants.filter((other) => other !== row).flatMap(tokensOf).filter((token) => !own.has(token));
          return !foreign.some((token) => hasToken(sentence, token));
        });
        if (!consistent) return `reason mixes versions: ${id}`;
      }
    }
  }
  return null;
}

/** A closure verb in the same sentence as HAZARD blocks, unless do not / does not / never sits immediately in front of that verb. */
export function hazardDowngrade(text: string): boolean {
  return text.split(/[.!?\n;]+/).some((sentence) => sentenceClosesHazard(sentence));
}

function sentenceClosesHazard(sentence: string): boolean {
  if (!/\bhazard\b/i.test(sentence)) return false;
  const verbs = new RegExp(HAZARD_VERBS.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = verbs.exec(sentence))) {
    if (STRICT_PREFIX.test(sentence.slice(0, match.index))) continue;
    return true;
  }
  return false;
}

/** The sentences of a blocked draft that mention HAZARD, so the log shows what the linter saw. */
export function blockedExcerpt(draft: SmokeDraft): string {
  const text = [
    draft.headline,
    ...draft.findings.map((f) => f.claim),
    draft.recommended_next_check,
    ...draft.not_checked,
  ].join("\n");
  return text
    .split(/(?<=[.!?])\s+|\n/)
    .filter((sentence) => /\bhazard\b/i.test(sentence))
    .join(" ")
    .slice(0, 300);
}

export function assertNoHazardDowngrade(text: string): void {
  if (hazardDowngrade(text)) throw new LinterError("HAZARD downgrade/close blocked");
}

export function lintAndAssemble(
  draft: SmokeDraft,
  retrieved: RetrievedSource[],
  traceId: string,
): FinalAnswer {
  const allowed = new Set(retrieved.map((s) => s.id));
  // Release contract: every released claim is code-built, a verbatim retrieved passage, or free of structured attributes.
  // A headline or next check that is none of these is rebuilt from the permitted fixed text, not released.
  const checker = createReleaseChecker(retrieved);
  const headline = checker.headlineOk(draft.headline) ? draft.headline : HEADLINE_FALLBACK;
  const nextCheck = checker.nextCheckOk(draft.recommended_next_check) ? draft.recommended_next_check : NEXT_CHECK_FALLBACK;
  const notChecked = draft.not_checked.filter((item) => checker.notCheckedOk(item));
  // Data-quality findings are code-owned: whatever the draft says about them is dropped here and the retrieved ones are appended below.
  const qualityFindings = retrieved.filter((source) => source.summary.startsWith(QUALITY_PREFIX)).map((source) => ({ claim: source.summary, evidence_ids: [source.id] }));
  const draftFindings0 = draft.findings.filter((f) => !f.claim.startsWith(QUALITY_PREFIX));
  const blob = [
    draft.headline,
    draft.recommended_next_check,
    ...draftFindings0.map((f) => f.claim),
    ...draft.not_checked,
  ].join("\n");

  if (isFallbackDraft(draft)) throw new LinterError("fallback draft was not released");
  const invented = inventedOpenHazard(blob, retrieved);
  if (invented) throw new LinterError(invented);
  if (SECRET_SHAPE.test(blob)) throw new LinterError("secret-like string in draft");
  if (NAME_SHAPE.test(blob)) throw new LinterError("person name in draft");
  assertNoHazardDowngrade(blob);
  const conflated = reasonConflation(blob, retrieved);
  if (conflated) throw new LinterError(conflated);
  const unknown = unsupportedIssue(blob, retrieved);
  if (unknown) throw new LinterError(unknown);
  const truncated = truncatedReason(blob, retrieved);
  if (truncated) throw new LinterError(truncated);
  if (draft.headline.length > MAX_HEADLINE) throw new LinterError("headline too long");
  for (const claim of [draft.headline, draft.recommended_next_check, ...draftFindings0.map((f) => f.claim)]) {
    const unbound = claimBindingProblem(claim, retrieved);
    if (unbound) throw new LinterError(unbound);
  }

  // The floor states each conflicted open HAZARD id once; a draft-level conflict warning for the same ids is dropped.
  const floorConflictIds = new Set(
    hazardBlockFindings(retrieved).flatMap((block) => {
      const id = /^Data conflict: (ISS-\d+)/.exec(block.claim)?.[1];
      return id ? [id] : [];
    }),
  );
  const draftFindings = draftFindings0.filter((f) => {
    const listed = /^Data conflict: ((?:ISS-\d+(?:, )?)+) appears?\b/.exec(f.claim)?.[1]?.split(", ");
    return !(listed && listed.length > 0 && listed.every((id) => floorConflictIds.has(id)));
  });
  const findings = draftFindings.map((f, i) => {
    const ids = f.evidence_ids.filter((id) => allowed.has(id));
    if (ids.length === 0) throw new LinterError(`findings[${i}] has no retrieved evidence id`);
    if (f.evidence_ids.some((id) => !allowed.has(id))) {
      throw new LinterError(`findings[${i}] cites an id that was not retrieved`);
    }
    return { claim: f.claim, evidence_ids: ids, ...(f.analysis ? { analysis: f.analysis } : {}) };
  });
  for (const block of hazardBlockFindings(retrieved)) {
    const ids = block.evidence_ids.filter((id) => allowed.has(id));
    if (ids.length === 0) continue;
    findings.push({ claim: block.claim, evidence_ids: ids });
  }
  findings.push(...qualityFindings);
  // The code-owned data-quality text never repeats a row's own text, so it is checked for secrets and names but not as an incident claim.
  const claimsOnly = findings.filter((f) => !f.claim.startsWith(QUALITY_PREFIX)).map((f) => f.claim);
  const releasedBlob =[headline, nextCheck, ...claimsOnly].join("\n");
  const releasedAll = [headline, nextCheck, ...findings.map((f) => f.claim)].join("\n");
  // Text the floor appended is checked like any other released text.
  if (SECRET_SHAPE.test(releasedAll)) throw new LinterError("secret-like string in released text");
  if (NAME_SHAPE.test(releasedAll)) throw new LinterError("person name in released text");
  for (const claim of claimsOnly) {
    const unbound = claimBindingProblem(claim, retrieved);
    if (unbound) throw new LinterError(unbound);
  }
  const releasedInvented = inventedOpenHazard(releasedBlob, retrieved);
  if (releasedInvented) throw new LinterError(releasedInvented);
  assertNoHazardDowngrade(releasedAll);
  const releasedUnknown = unsupportedIssue(releasedBlob, retrieved);
  if (releasedUnknown) throw new LinterError(releasedUnknown);
  const releasedTruncated = truncatedReason(releasedBlob, retrieved);
  if (releasedTruncated) throw new LinterError(releasedTruncated);

  const retrievedKinds = new Set(retrieved.map((s) => s.kind));
  if (retrieved.length > 0) {
    const cited = new Set(findings.flatMap((f) => f.evidence_ids));
    const citedKinds = new Set(retrieved.filter((s) => cited.has(s.id)).map((s) => s.kind));
    const missing = [...retrievedKinds].filter((kind) => !citedKinds.has(kind));
    if (missing.length > 0) {
      throw new LinterError(`dual-citation: missing ${missing.join(", ")}`);
    }
  }

  // The release contract runs last, so the specific safety checks above report first.
  for (const finding of findings.filter((f) => !f.claim.startsWith(QUALITY_PREFIX))) {
    const contract = checker.finding(finding.claim, finding.evidence_ids, finding.analysis);
    if (contract) throw new LinterError(contract);
  }

  return {
    headline: headline,
    findings,
    recommended_next_check: nextCheck,
    needs_human_decision: true,
    not_checked: notChecked.length ? notChecked : ["Anything not in the retrieved sources"],
    confidence: draft.confidence,
    trace_id: traceId,
  };
}

/* ---------- Release contract (step 8) ----------
 * Every released finding is exactly one of:
 *   (a) a code-built finding: a core record equal to one typed row, or a floor, quality, precursor or "record was read" finding
 *       equal to what code produces from the retrieved rows, or a structured analysis that code re-verifies and renders itself;
 *   (b) a verbatim passage of a retrieved source (for a finding, one of the sources it cites).
 * The headline, the next check and the not-checked list are released only as fixed code text (CODE_* below), a retrieved record, or a
 * verbatim retrieved passage. Attribute-free prose is not a release class for any of them. Nothing is recognized by layout.
 * Known limits: a verbatim passage is the data's own words (a name stored in the data is released as stored).
 */
const KIND_WORD = /\b(?:OOS|HAZARDS?|MICROFIX)\b/i;
const OUTCOME_TERM = /\b(?:held|did[ _]not[ _]hold|did[ _]hold|failed to hold)\b/i;
// "may" is left out: it is a common verb, and a date needs digits, which are rejected anyway.
const MONTH_WORD = /\b(?:january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i;

export const HEADLINE_FALLBACK = "Cited rows, human decides";
export const NEXT_CHECK_FALLBACK = "A human inspects the unit. Agents propose only.";

/** Prose is attribute-free when, apart from issue ids, it has no digit, no kind or outcome word and no month name. */
export function attributeFree(text: string): boolean {
  const body = text.normalize("NFKC").replace(/\bISS-\d+\b/gi, " ");
  return !/\p{Nd}/u.test(body) && !KIND_WORD.test(body) && !OUTCOME_TERM.test(body) && !MONTH_WORD.test(body);
}

/**
 * Text that code itself writes for the headline, the next check and the not-checked list. A model draft is released only if every part
 * of these three is one of these fixed texts, a retrieved record or a verbatim retrieved passage: attribute-free prose is not enough.
 * The producers are executor.ts (assembled and retrieved drafts), next-check.ts, patterns-core.ts and the two fallbacks below.
 */
const CODE_HEADLINE_TAILS = ["cited rows, human decides", "evidence retrieved, human decides", ASSEMBLED_LABEL, "check, human decides"];
const CODE_HEADLINES = ["cited rows, human decides", "next unit check, human decides", "next unit: cited rows, human decides"];
const CODE_SENTENCES = [
  "Agents propose only.",
  "A human inspects the unit.",
  "Propose only.",
  "A human decides.",
  "Propose a coaching conversation for the lead.",
  "Propose an escalation to a lead for human analysis.",
];
const CODE_NOT_CHECKED = ["Anything not in the retrieved sources", "Anything not in retrieved sources"];

const foldPassage = (text: string): string =>
  text.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?\s]+$/, "");

const isOneOf = (text: string, list: string[]): boolean => list.some((item) => foldPassage(item) === foldPassage(text));

const isVerbatim = (text: string, sources: { summary: string }[]): boolean => {
  const folded = foldPassage(text);
  return folded.length > 0 && sources.some((source) => foldPassage(source.summary).includes(folded));
};

export function createReleaseChecker(retrieved: RetrievedSource[]) {
  const catalog = incidentsFromRetrieved(retrieved);
  const codeBuilt = new Set<string>();
  for (const block of hazardBlockFindings(retrieved)) codeBuilt.add(block.claim);
  for (const source of retrieved) {
    if (source.summary.startsWith(QUALITY_PREFIX)) codeBuilt.add(source.summary);
    codeBuilt.add(`${source.kind} record was read.`);
  }
  for (const asset of new Set(catalog.map((row) => row.asset).filter((a): a is string => Boolean(a)))) {
    for (const flag of precursorFindings(retrieved, asset)) codeBuilt.add(flag.claim);
  }

  const knownAssets = new Set<string>(catalog.map((row) => row.asset).filter((a): a is string => Boolean(a)));
  for (const source of retrieved) if (source.id.startsWith("markov:")) knownAssets.add(source.id.slice("markov:".length));

  const isCodeRecord = (text: string): boolean => {
    const record = RECORD.exec(text.trim().replace(/\.$/, ""));
    if (!record) return false;
    const reason = normReason(record[7].replace(FLOOR_SUFFIX, ""));
    return catalog.some(
      (row) => row.id === record[1] && row.asset === record[2] && row.kind === record[3] && row.date === record[4] && row.actor === record[5] && row.outcome === record[6] && row.reason === reason,
    );
  };

  const finding = (claim: string, evidenceIds: string[], analysis?: StructuredClaim): string | null => {
    const text = claim.trim();
    if (!text || codeBuilt.has(text) || isCodeRecord(text)) return null;
    // A structured analysis claim is code-built when code re-verifies it from the rows and the words are exactly what code renders from it.
    if (analysis && text.startsWith("Analysis: ") && verifyClaim(analysis, retrieved).issues.length === 0 && text === `Analysis: ${renderClaim(analysis, retrieved)}`) return null;
    // The model label is removed once, before every class is tried, so a cited passage or attribute-free text is judged the same with or without it.
    const body = text.startsWith("Analysis: ") ? text.slice("Analysis: ".length).trim() : text;
    if (codeBuilt.has(body) || isCodeRecord(body)) return null;
    const cited = retrieved.filter((source) => evidenceIds.includes(source.id));
    if (isVerbatim(body, cited)) return null;
    return "claim is not a code-built finding, a verbatim passage of a cited source, or a verified structured analysis";
  };

  const proseOk = (text: string): boolean =>
    text
      .split(/(?<=[.!?])\s+|\n/)
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .every((sentence) => codeBuilt.has(sentence) || isCodeRecord(sentence) || isVerbatim(sentence, retrieved) || isOneOf(sentence, CODE_SENTENCES));

  return {
    finding,
    /**
     * A headline may open with the verb and target code writes ("CAUSE SSA-001:", "PATTERNS thisweek:"), but only when the target is real:
     * an asset that appears in the retrieved rows or in the Markovian source id, or one of the two weeks. Any other opening is judged as
     * part of the text, so an arbitrary model-supplied target ("CAUSE SSA-999:") is not trusted.
     */
    headlineOk: (headline: string): boolean => {
      const opening = /^\s*(?:(?:CAUSE|NEXT)\s+(SSA-\d+)|PATTERNS\s+(thisweek|lastweek|\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}))(?::|\s)\s*/.exec(headline);
      const known = opening && (opening[2] !== undefined ? opening[2] === "thisweek" || opening[2] === "lastweek" || parseDateRange(opening[2]) !== null : knownAssets.has(opening[1]));
      const tail = known ? headline.slice(opening![0].length) : headline;
      return isOneOf(tail, CODE_HEADLINE_TAILS) || isOneOf(headline, CODE_HEADLINES) || proseOk(tail);
    },
    nextCheckOk: (text: string): boolean => proseOk(text),
    notCheckedOk: (text: string): boolean => isOneOf(text, CODE_NOT_CHECKED) || isVerbatim(text, retrieved),
  };
}
