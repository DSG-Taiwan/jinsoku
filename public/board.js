const historyEl = document.querySelector("#history");
const emptyEl = document.querySelector("#empty");
const loadingEl = document.querySelector("#loading");
const gateEl = document.querySelector("#gate");
const answerEl = document.querySelector("#answer");
const bannerEl = document.querySelector("#banner");
const skyButton = document.querySelector("#sky");
const form = document.querySelector("#command");
const assetEl = document.querySelector("#asset");
const roleEl = document.querySelector("#role");
const periodEl = document.querySelector("#period");
const rangeEl = document.querySelector("#range");
const fromEl = document.querySelector("#from");
const toEl = document.querySelector("#to");
const windowEl = document.querySelector("#window");
const nowEl = document.querySelector("#now");
const fleetCountEl = document.querySelector("#fleet-count");
const fleetUnitsEl = document.querySelector("#fleet-units");
const freeEl = document.querySelector("#free");
const workingEl = document.querySelector("#working");

const stations = {
  planner: document.querySelector('[data-events="planner"]'),
  executor: document.querySelector('[data-events="executor"]'),
  evaluator: document.querySelector('[data-events="evaluator"]'),
};

let tailTimer = 0;
let tailGen = 0;
let tailTrace = "";
let knownEvents = 0;
let viewToken = 0;
let followToken = 0;
let requestBusy = false;
let handlingFree = false;
let ignoreHash = "";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function stationFor(event) {
  if (event.agent_name === "evaluator" || event.action === "critique" || event.action === "approval" || event.action === "exhaust") {
    return "evaluator";
  }
  if (event.agent_name === "planner" || event.agent_name === "final-pass" || event.action === "plan" || event.action === "final" || event.action === "assemble") return "planner";
  if (event.agent_name === "ingest") return "ingest";
  return "executor";
}

function showBanner(text) {
  if (!text) {
    bannerEl.hidden = true;
    bannerEl.textContent = "";
    return;
  }
  bannerEl.hidden = false;
  bannerEl.textContent = text;
}

let workingTimer = 0;
let workingStart = 0;
let workingStage = "";
let historyShowAll = false;
const HISTORY_LIMIT = 100;

function clockLabel(date) {
  return date.toTimeString().slice(0, 8);
}

function workingText() {
  const seconds = (Date.now() - workingStart) / 1000;
  const stage = workingStage ? ` Now: ${workingStage}.` : "";
  const slow = seconds > 15 ? " Still working: the model service can be slow. Nothing is frozen." : "";
  return `Request received at ${clockLabel(new Date(workingStart))}. Working, ${seconds.toFixed(1)} s.${stage}${slow}`;
}

function startWorking() {
  workingStart = Date.now();
  workingStage = "";
  workingEl.hidden = false;
  workingEl.textContent = workingText();
  clearInterval(workingTimer);
  workingTimer = setInterval(() => {
    workingEl.textContent = workingText();
  }, 250);
}

function stopWorking(note) {
  clearInterval(workingTimer);
  workingTimer = 0;
  const seconds = (Date.now() - workingStart) / 1000;
  workingEl.textContent = note ? `${note} (${seconds.toFixed(1)} s)` : `Finished in ${seconds.toFixed(1)} s.`;
  const shown = workingEl.textContent;
  setTimeout(() => {
    if (!workingTimer && workingEl.textContent === shown) workingEl.hidden = true;
  }, 4000);
}

function setBusy(busy) {
  requestBusy = busy;
  form.setAttribute("aria-busy", busy ? "true" : "false");
  for (const button of form.querySelectorAll("button")) button.disabled = busy;
}

function nextView() {
  viewToken += 1;
  return viewToken;
}

function setHash(traceId) {
  const next = `#${traceId}`;
  if (location.hash === next) return;
  ignoreHash = next;
  location.hash = traceId;
}

async function loadCatalog() {
  const res = await fetch("/catalog");
  if (!res.ok) throw new Error("catalog unavailable");
  const body = await res.json();
  assetEl.innerHTML = body.assets.map((id) => `<option value="${esc(id)}">${esc(id)}</option>`).join("");
  if (!body.assets.length) assetEl.innerHTML = `<option value="">No assets</option>`;
  renderPills(assetEl);
  if (body.window && windowEl) windowEl.textContent = `Data ${body.window.from} to ${body.window.to}`;
  if (body.window && fromEl && toEl) {
    for (const el of [fromEl, toEl]) {
      el.min = body.window.from;
      el.max = body.window.to;
    }
    if (!fromEl.value) fromEl.value = body.window.from;
    if (!toEl.value) toEl.value = body.window.to;
  }
}

function statusTone(status) {
  const value = String(status || "").toLowerCase();
  if (value === "ok") return "ok";
  if (value === "unresolved" || value === "running" || value === "incomplete") return "hold";
  if (value === "denied" || value === "unprocessed" || value === "rejected" || value === "error") return "bad";
  return "";
}

function chipFor(event) {
  const status = String(event.status || "").toLowerCase();
  const action = String(event.action || "").toLowerCase();
  if (action === "fault-injected") return "synthetic";
  if (status === "fallback" || action === "fallback") return "fallback";
  if (action === "revise" || action === "revision" || action === "critique") return "revise";
  if (action === "refuse" || status === "denied" || status === "unprocessed" || status === "rejected") return "refused";
  if (status === "ok" || action === "approval") return "ok";
  return status || "hold";
}

function readable(text) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map((item) => (typeof item === "string" ? item : readable(JSON.stringify(item)))).join(" ");
      if (parsed && typeof parsed === "object") {
        if (parsed.verb) return [parsed.verb, parsed.asset || parsed.period, parsed.role].filter(Boolean).join(" ");
        return Object.entries(parsed)
          .map(([key, value]) => `${key} ${typeof value === "string" ? value : ""}`.trim())
          .join(". ");
      }
    } catch {
      /* the log line is text, not JSON */
    }
  }
  return raw;
}

function plainStatus(status) {
  const names = {
    ok: "Released",
    unresolved: "Not released",
    running: "Running",
    incomplete: "Incomplete",
    denied: "Denied",
    unprocessed: "Not a phrase",
    rejected: "Rejected",
    error: "Error",
    hold: "On hold",
    fallback: "Fallback",
    revise: "Review",
    refused: "Refused",
    retry: "Again",
    synthetic: "Synthetic",
  };
  const value = String(status || "").toLowerCase();
  return names[value] || String(status || "");
}

function plainAction(action) {
  const names = {
    accept: "Accepted",
    refuse: "Refused",
    plan: "Plan",
    progress: "Progress",
    "zetaris-query": "Issue log",
    "markov-query": "Recent chain",
    approval: "Approved",
    critique: "Review",
    revise: "Rewrite",
    revision: "Rewrite",
    assemble: "Assembled",
    final: "Final",
    draft: "Draft",
    "repair-retry": "Tried again",
    fallback: "Fallback",
    exhaust: "Stopped",
    block: "Blocked",
    error: "Error",
    "fault-injected": "Injected test fault",
  };
  const value = String(action || "").toLowerCase();
  return names[value] || String(action || "");
}

function plainQuery(query) {
  const text = String(query || "").trim();
  const phrase = /^(CAUSE|PATTERNS|NEXT)\s+(\S+)$/.exec(text);
  if (!phrase) return text;
  const verb = phrase[1] === "CAUSE" ? "Diagnose" : phrase[1] === "PATTERNS" ? "All units" : "Latest";
  const range = /^(\d{4})-(\d{2})-(\d{2})\.\.(\d{4})-(\d{2})-(\d{2})$/.exec(phrase[2]);
  const target = phrase[2] === "thisweek" ? "This week" : phrase[2] === "lastweek" ? "Last week" : range ? `${range[2]}/${range[3]}/${range[1].slice(2)} to ${range[5]}/${range[6]}/${range[4].slice(2)}` : phrase[2];
  return `${verb} · ${target}`;
}

function sourceLabel(kind) {
  if (kind === "zetaris") return "Issue log";
  if (kind === "hmem") return "Memory";
  if (kind === "worldmodel") return "Unit graph";
  if (kind === "markov") return "Recent chain";
  return kind;
}

function kindLabel(kind) {
  const value = String(kind || "").toUpperCase();
  if (value === "OOS") return "Out of service";
  if (value === "HAZARD") return "Hazard";
  if (value === "MICROFIX") return "Small fix";
  return String(kind || "");
}

function outcomeLabel(outcome) {
  if (outcome === "held") return "Held";
  if (outcome === "did_not_hold") return "Did not hold";
  if (outcome === "open") return "Open";
  return String(outcome || "");
}

function splitClaim(claim) {
  const raw = String(claim || "").trim();
  if (!raw) return [];
  return raw
    .split(/\n+/)
    .flatMap((line) => line.split(/;\s*(?=ISS-\d+)|\.\s+(?=ISS-\d+)/))
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseIncident(line) {
  const text = String(line || "").trim();
  const packed = /^(ISS-\d+)\s+(SSA-\d+)\s+(OOS|HAZARD|MICROFIX)\s+(\d{4}-\d{2}-\d{2})\s+(ACT-\d+)\s+(held|did_not_hold|open)\s+(.+)$/i.exec(text);
  if (packed) {
    return {
      id: packed[1],
      sub: `Unit ${packed[2]} · Actor ${packed[5]}`,
      kindLabel: kindLabel(packed[3]),
      when: packed[4],
      outcomeLabel: outcomeLabel(packed[6].toLowerCase()),
      note: packed[7].replace(/\.$/, ""),
      tone: packed[3].toUpperCase() === "HAZARD" ? "hazard" : packed[6].toLowerCase() === "held" ? "ok" : "hold",
    };
  }
  const chain = /^(ISS-\d+)\s+(\d{4}-\d{2}-\d{2})\s+(OOS|HAZARD|MICROFIX)\s+(ACT-\d+)\s+(held|did_not_hold|open)\s+note\s+(.+)$/i.exec(text);
  if (chain) {
    return {
      id: chain[1],
      sub: `Actor ${chain[4]}`,
      kindLabel: kindLabel(chain[3]),
      when: chain[2],
      outcomeLabel: outcomeLabel(chain[5].toLowerCase()),
      note: chain[6].replace(/\.$/, ""),
      tone: chain[3].toUpperCase() === "HAZARD" ? "hazard" : chain[5].toLowerCase() === "held" ? "ok" : "hold",
    };
  }
  const chopped = /^(\d{4}-\d{2}-\d{2})\s+(OOS|HAZARD|MICROFIX)\s+(ACT-\d+)\s+(held|did_not_hold|open)\s+note\s+(.+)$/i.exec(text);
  if (chopped) {
    return {
      id: "",
      sub: `Actor ${chopped[3]}`,
      kindLabel: kindLabel(chopped[2]),
      when: chopped[1],
      outcomeLabel: outcomeLabel(chopped[4].toLowerCase()),
      note: chopped[5].replace(/\.$/, ""),
      tone: chopped[2].toUpperCase() === "HAZARD" ? "hazard" : chopped[4].toLowerCase() === "held" ? "ok" : "hold",
    };
  }
  const memory = /^(?:[A-Za-z0-9]+\s+synthetic incident\s+)?(ISS-\d+)\s+on\s+(SSA-\d+):\s+kind\s+(OOS|HAZARD|MICROFIX),\s+opened\s+(\d{4}-\d{2}-\d{2}),\s+actor\s+(ACT-\d+),\s+fix_outcome\s+(held|did_not_hold|open),\s+reason\s+(.+)$/i.exec(text);
  if (memory) {
    return {
      id: memory[1],
      sub: `Unit ${memory[2]} · Actor ${memory[5]} · Memory`,
      kindLabel: kindLabel(memory[3]),
      when: memory[4],
      outcomeLabel: outcomeLabel(memory[6].toLowerCase()),
      note: memory[7].replace(/\.$/, ""),
      tone: memory[3].toUpperCase() === "HAZARD" ? "hazard" : memory[6].toLowerCase() === "held" ? "ok" : "hold",
    };
  }
  return null;
}

function parseUnit(line) {
  const text = String(line || "").trim();
  const full = /^Unit\s+(SSA-\d+)\s+model\s+(\S+)\s+zone\s+(\S+)\s+location\s+([^.]+)\.\s+Open HAZARD count\s+(\d+)/i.exec(text);
  if (full) return { unit: full[1], model: full[2], zone: full[3], location: full[4].trim(), open: full[5], countOnly: false };
  const count = /^Open HAZARD count\s+(\d+)\.?$/i.exec(text);
  if (count) return { unit: "", model: "", zone: "", location: "", open: count[1], countOnly: true };
  return null;
}

function eventLead(text) {
  const raw = readable(text);
  const named = {
    planFromCall: "Plan from the phrase",
    draftFromRetrieved: "Draft from the retrieved rows",
    "model timeout": "The model timed out",
    approve: "Approved",
  };
  if (named[raw]) return named[raw];
  const findings = /^findings=(\d+)$/.exec(raw);
  if (findings) return `${findings[1]} findings`;
  const sources = /^sources=(\d+)\s+ids=(.+)$/.exec(raw);
  if (sources) return `${sources[1]} sources`;
  const chain = /^id=(markov:\S+)\s+steps=(\d+)\b/.exec(raw);
  if (chain) return `${chain[2]} steps · ${chain[1].slice("markov:".length)}`;
  if (/\bSELECT\b/i.test(raw)) {
    const tables = [...raw.matchAll(/\bFROM\s+([a-z0-9_.]+)/gi)].map((match) => match[1]);
    const unique = [...new Set(tables)];
    return unique.length ? `Read ${unique.join(", ")}` : "Read from the issue log";
  }
  return raw;
}

function elapsedLabel(events) {
  if (!events || events.length < 2) return "elapsed not in the log";
  const start = Date.parse(events[0].timestamp);
  const end = Date.parse(events[events.length - 1].timestamp);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "elapsed not in the log";
  const ms = end - start;
  return ms < 1000 ? `${ms} ms from the log` : `${(ms / 1000).toFixed(1)} s from the log`;
}

function renderHistory(runs, selected) {
  if (loadingEl) loadingEl.hidden = true;
  emptyEl.hidden = runs.length > 0;
  let shownRuns = runs;
  if (!historyShowAll && runs.length > HISTORY_LIMIT) {
    shownRuns = runs.slice(0, HISTORY_LIMIT);
    const picked = runs.find((run) => run.trace_id === selected);
    if (picked && !shownRuns.includes(picked)) shownRuns.push(picked);
  }
  const moreHtml = shownRuns.length < runs.length ? `<li class="more"><button type="button" data-more="1">Show all ${esc(runs.length)} runs</button></li>` : "";
  historyEl.innerHTML = shownRuns
    .map(
      (run) => `<li><button type="button" data-trace="${esc(run.trace_id)}"${run.trace_id === selected ? ' aria-current="true"' : ""}>
        <span class="query">${esc(plainQuery(run.query))}</span>
        <span class="meta ${statusTone(run.status)}">${esc(plainStatus(run.status))} · ${esc(run.started_at.slice(11, 19) || run.started_at)}</span>
      </button></li>`,
    )
    .join("") + moreHtml;
}

function renderEvents(events, animate) {
  const buckets = { planner: [], executor: [], evaluator: [] };
  const ingest = events.find((event) => event.agent_name === "ingest");
  gateEl.textContent = ingest
    ? `${plainAction(ingest.action)} · ${plainStatus(ingest.status)} · ${plainQuery(ingest.input_summary)}`
    : "Nothing has arrived yet.";
  for (const event of events) {
    const station = stationFor(event);
    if (buckets[station]) buckets[station].push(event);
  }
  for (const [name, list] of Object.entries(buckets)) {
    stations[name].innerHTML = list.length
      ? list
          .map((event, index) => {
            const hazard = /\bHAZARD\b/.test(String(event.output_summary));
            const fresh = animate && index === list.length - 1 ? " fresh" : "";
            const chip = chipFor(event);
            return `<li class="event card${hazard ? " hazard" : ""}${fresh}"><span class="chip ${esc(chip)}">${esc(plainStatus(chip))}</span><b>${esc(plainAction(event.action))}</b><p>${esc(eventLead(event.output_summary))}</p></li>`;
          })
          .join("")
      : `<li class="quiet">No events yet.</li>`;
  }
}

function evidenceGroups(detail) {
  const fromLog = detail.events.find((event) => event.retrieval)?.retrieval;
  if (!fromLog) return "";
  const groups = { zetaris: [], hmem: [], worldmodel: [], markov: [] };
  for (const id of fromLog.evidence_ids) {
    const kind = id.startsWith("hmem:")
      ? "hmem"
      : id.startsWith("worldmodel:")
        ? "worldmodel"
        : id.startsWith("markov:")
          ? "markov"
          : "zetaris";
    groups[kind].push(id);
  }
  const rows = Object.entries(groups).filter(([, ids]) => ids.length);
  if (!rows.length) return "";
  return `<div class="retrieved"><h3>Retrieved</h3>${rows
    .map(([kind, ids]) => `<p class="source"><b>${esc(sourceLabel(kind))}</b> ${ids.map((id) => `<span class="cite">${esc(id)}</span>`).join("")}</p>`)
    .join("")}</div>`;
}

const stageWords = {
  headline: { model: "model-written", code: "built from the records", "n/a": "not run" },
  analysis: { off: "off", produced: "model-written, checked", withheld: "withheld", skipped: "skipped", dropped: "dropped after a failed revision", empty: "model returned no claims", "n/a": "not run" },
  evaluator: { model: "model", deterministic: "rule check only (model not used)", "n/a": "not run" },
};

function stageWord(key, value) {
  return Object.prototype.hasOwnProperty.call(stageWords[key], value) ? stageWords[key][value] : value;
}

function stageHtml(collaboration) {
  const stages = collaboration && collaboration.model_stages;
  const noteHtml = collaboration && collaboration.note ? `<p class="stage-note">${esc(collaboration.note)}</p>` : "";
  if (!stages) return `<p class="stages">Model stages: not reported</p>` + noteHtml;
  const faultHtml = stages.synthetic_fault && stages.synthetic_fault !== "none" ? `<span class="synthetic-note">Synthetic fault: ${esc(stages.synthetic_fault)}</span>` : "";
  return (
    `<p class="stages"><span>Headline: ${esc(stageWord("headline", stages.headline))}</span><span>Analysis: ${esc(stageWord("analysis", stages.analysis))}</span><span>Evaluator: ${esc(stageWord("evaluator", stages.evaluator))}</span>` +
    faultHtml +
    "</p>" +
    noteHtml
  );
}

function stillRunning(detail) {
  if (detail.result) return false;
  return !detail.status || detail.status === "running";
}

/* ---- Decision card: five plain sections built from the answer the page already received. No new claims. ---- */
function plainOutcome(outcome) {
  if (outcome === "held") return "Fix held";
  if (outcome === "did_not_hold") return "Fix did not hold";
  if (outcome === "open") return "Open";
  return String(outcome || "");
}

function plainWords(text) {
  return String(text || "")
    .replace(/fix_outcome\s+did_not_hold/gi, "the fix did not hold")
    .replace(/fix_outcome\s+held/gi, "the fix held")
    .replace(/did_not_hold/gi, "did not hold");
}

const OPEN_SUFFIX = /\s*(?:and|\.\s*This HAZARD)?\s*stays open for a human\.?$/i;

function makeRecord(id, unit, kind, when, actor, outcome, note) {
  const raw = String(note || "").replace(/\.$/, "");
  return { id, unit: unit || "", kind: kind.toUpperCase(), when, actor, outcome: outcome.toLowerCase(), note: raw.replace(OPEN_SUFFIX, "").replace(/\.$/, ""), openHazard: OPEN_SUFFIX.test(raw) || (kind.toUpperCase() === "HAZARD" && outcome.toLowerCase() === "open") };
}

function recordOf(line) {
  const text = String(line || "").trim();
  let m = /^(ISS-\d+)\s+(SSA-\d+)\s+(OOS|HAZARD|MICROFIX)\s+opened\s+(\d{4}-\d{2}-\d{2})\s+actor\s+(ACT-\d+)\s+(held|did_not_hold|open)\s+reason\s+(.+)$/i.exec(text);
  if (m) return makeRecord(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  m = /^(ISS-\d+)\s+(SSA-\d+)\s+(OOS|HAZARD|MICROFIX)\s+(\d{4}-\d{2}-\d{2})\s+(ACT-\d+)\s+(held|did_not_hold|open)\s+(.+)$/i.exec(text);
  if (m) return makeRecord(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  m = /^(?:[A-Za-z0-9]+\s+synthetic incident\s+)?(ISS-\d+)\s+on\s+(SSA-\d+):\s+kind\s+(OOS|HAZARD|MICROFIX),\s+opened\s+(\d{4}-\d{2}-\d{2}),\s+actor\s+(ACT-\d+),\s+fix_outcome\s+(held|did_not_hold|open),\s+reason\s+(.+)$/i.exec(text);
  if (m) return makeRecord(m[1], m[2], m[3], m[4], m[5], m[6], m[7]);
  m = /^(ISS-\d+)\s+(\d{4}-\d{2}-\d{2})\s+(OOS|HAZARD|MICROFIX)\s+(ACT-\d+)\s+(held|did_not_hold|open)\s+note\s+(.+)$/i.exec(text);
  if (m) return makeRecord(m[1], "", m[3], m[2], m[4], m[5], m[6]);
  return null;
}

function sameValue(a, b) {
  const norm = (value) => String(value || "").toLowerCase().replace(/[\s.]+$/g, "").trim();
  return !a || !b || norm(a) === norm(b);
}

function compatible(a, b) {
  return ["unit", "kind", "when", "actor", "outcome", "note"].every((field) => sameValue(a[field], b[field]));
}

function cardFacts(result) {
  const findings = result.result?.findings ?? [];
  const versions = new Map();
  const order = [];
  const units = [];
  const countOnly = [];
  const flags = [];
  const analysisLines = [];
  const uncertain = [];
  for (const finding of findings) {
    const modelSelected = /^Analysis:\s*/.test(String(finding.claim || ""));
    const claim = String(finding.claim || "").replace(/^Analysis:\s*/, "");
    for (const line of splitClaim(claim)) {
      // provenance first: every line of a model-selected analysis stays in the labeled path, whatever its shape.
      // Nothing parsed from it (records, unit lines, counts) feeds the card's own figures.
      if (modelSelected) {
        analysisLines.push(plainWords(line));
        continue;
      }
      const record = recordOf(line);
      if (record) {
        const list = versions.get(record.id) || [];
        if (!list.length) order.push(record.id);
        const same = list.find((v) => compatible(v.record, record));
        if (same) {
          // the same incident seen in another format: fill what is missing, keep an explicit open flag, never invent a conflict
          for (const field of ["unit", "kind", "when", "actor", "outcome", "note"]) if (!same.record[field]) same.record[field] = record[field];
          same.record.openHazard = same.record.openHazard || record.openHazard;
        } else {
          list.push({ record });
        }
        versions.set(record.id, list);
        continue;
      }
      const unit = parseUnit(line);
      if (unit && !unit.countOnly) {
        units.push(unit);
        continue;
      }
      if (unit && unit.countOnly) {
        countOnly.push(Number(unit.open));
        continue;
      }
      if (/^(\w+ record was read)/.test(line)) continue;
      if (modelSelected) analysisLines.push(plainWords(line));
      else if (/^Data quality:|conflict/i.test(line)) uncertain.push(plainWords(line));
      else flags.push(plainWords(line));
    }
  }
  const records = [];
  const conflicted = [];
  for (const id of order) {
    const list = versions.get(id);
    if (list.length > 1) conflicted.push(id);
    for (const v of list) records.push({ ...v.record, conflicting: list.length > 1 });
  }
  return { records, conflicted, units, countOnly, flags, analysisLines, uncertain };
}

function openHazardSummary(facts, unitIds) {
  const perUnit = new Map();
  for (const u of facts.units) perUnit.set(u.unit, Math.max(perUnit.get(u.unit) ?? 0, Number(u.open || 0)));
  // one open hazard per incident id, decided across ALL versions of that id: open if any version says so,
  // on the first unit any version names (a version without the flag or without the unit never hides the other's)
  const byId = new Map();
  for (const r of facts.records) {
    const entry = byId.get(r.id) || { open: false, hazard: false, unit: "" };
    entry.open = entry.open || r.openHazard;
    entry.hazard = entry.hazard || r.kind === "HAZARD";
    if (!entry.unit && r.unit) entry.unit = r.unit;
    byId.set(r.id, entry);
  }
  const floorIds = new Map();
  for (const [id, entry] of byId) if (entry.open && entry.hazard) floorIds.set(id, entry.unit);
  const known = new Map();
  const unknown = [];
  let slack = 0;
  // every unit the answer names counts: units that only the unit graph mentions are not skipped
  const universe = [...new Set([...unitIds, ...facts.units.map((u) => u.unit)])];
  for (const unit of universe) {
    const fromFloor = [...floorIds.values()].filter((u) => u === unit).length;
    const count = perUnit.has(unit) ? perUnit.get(unit) : null;
    if (count === null && fromFloor === 0) {
      unknown.push(unit);
      continue;
    }
    known.set(unit, Math.max(count ?? 0, fromFloor));
    slack += Math.max(0, (count ?? 0) - fromFloor);
  }
  // an open incident with no unit may be one the graph already counts: it fills a graph slot before it adds a hazard
  const unattached = [...floorIds.entries()].filter(([, u]) => !u).length;
  const unitBased = [...known.values()].reduce((a, b) => a + b, 0) + Math.max(0, unattached - slack);
  // a count-only graph line is a count for the whole answer: a total, never one more per-unit contribution
  if (!facts.countOnly.length) return { total: unitBased, unknown, atLeast: false };
  const whole = Math.max(...facts.countOnly);
  if (whole >= unitBased) return { total: whole, unknown: [], atLeast: false };
  return { total: unitBased, unknown, atLeast: true };
}

function decisionCard(detail) {
  const result = detail.result;
  const status = result.status || "ok";
  const facts = cardFacts(result);
  const stages = result.collaboration?.model_stages || {};
  const notChecked = result.result?.not_checked ?? [];
  const nextCheck = plainWords(String(result.result?.recommended_next_check || "").replace(/^\s*Propose only\.\s*A human decides\.\s*/i, "").replace(/\s*A human inspects the unit\.\s*Agents propose only\.?/i, "").trim());
  const revisions = result.collaboration?.revision_count ?? 0;
  const released = status === "ok" || status === "released";
  const all = facts.records.slice().sort((a, b) => a.when.localeCompare(b.when));
  const counted = all.filter((r) => !r.conflicting);
  const unitIds = [...new Set(all.map((r) => r.unit).filter(Boolean))];
  const bad = counted.filter((r) => r.outcome === "did_not_hold").length;
  const hazards = openHazardSummary(facts, unitIds);
  const hazardNoun = hazards.total === 1 ? "hazard" : "hazards";
  const hazardLead = `${hazards.atLeast ? "at least " : ""}${hazards.total}`;
  const unitCard = unitIds.length === 1 ? facts.units.find((u) => u.unit === unitIds[0]) : null;
  const rewrites = `${revisions} ${Number(revisions) === 1 ? "rewrite" : "rewrites"}`;
  const hazardText = hazards.unknown.length ? (hazards.total > 0 ? `${hazardLead} found in this answer (count not stated for ${hazards.unknown.join(", ")})` : `not stated in this answer for ${hazards.unknown.join(", ")}`) : hazardLead;

  let whatHtml;
  if (!released) {
    whatHtml = `<p>No answer was released for this request: ${esc(plainStatus(status))}.</p>`;
  } else if (all.length) {
    const who = unitIds.length === 1 ? (unitCard ? `${unitIds[0]} (model ${unitCard.model}, ${unitCard.zone} zone, ${unitCard.location})` : unitIds[0]) : unitIds.length > 1 ? `${unitIds.length} units (${unitIds.join(", ")})` : "The records in this answer";
    const latest = all[all.length - 1].when;
    const callWord = counted.length === 1 ? "call" : "calls";
    const repairWord = counted.length === 1 ? "repair" : "repairs";
    const conflictNote = facts.conflicted.length ? ` ${facts.conflicted.length} ${facts.conflicted.length === 1 ? "incident has" : "incidents have"} conflicting versions (${facts.conflicted.join(", ")}) and ${facts.conflicted.length === 1 ? "is" : "are"} not counted.` : "";
    // a long unit list and the "count not stated" detail are folded away; the headline figures stay in the line
    const manyUnits = unitIds.length > 1;
    const shortWho = manyUnits ? `${unitIds.length} units` : who;
    const shortHazard = manyUnits && hazards.unknown.length && hazards.total > 0 ? `${hazardLead} found in this answer` : hazardText;
    const moreItems = manyUnits ? [`Units: ${unitIds.join(", ")}.`, hazards.unknown.length ? `Open hazard count not stated for ${hazards.unknown.join(", ")}.` : ""].filter(Boolean) : [];
    const moreHtml = moreItems.length ? `<details class="card-more"><summary>Which units</summary><p>${esc(moreItems.join(" "))}</p></details>` : "";
    whatHtml = `<p><b>${esc(shortWho)}</b>: ${esc(counted.length)} service ${esc(callWord)} in the retrieved records, latest ${esc(latest)}. ${esc(bad)} of ${esc(counted.length)} ${esc(repairWord)} did not hold. Open hazards: ${esc(shortHazard)}.${esc(conflictNote)}</p>${moreHtml}`;
  } else if (hazards.total > 0) {
    const names = facts.units.map((u) => u.unit).join(", ") || "The unit graph";
    whatHtml = `<p><b>${esc(names)}</b>: ${esc(hazardLead)} open ${esc(hazardNoun)} according to the unit graph. No incident records in this answer.</p>`;
  } else {
    whatHtml = `<p>${esc(result.result?.headline || result.result?.summary || "No incident records in this answer.")}</p>`;
  }

  let verdict;
  if (!released) {
    verdict = `No answer released. ${plainStatus(status)}.`;
  } else if (!all.length) {
    verdict = hazards.total > 0 ? `${hazardLead} open ${hazardNoun} per the unit graph.` : "No incident records in this answer.";
  } else {
    const parts = [];
    if (hazards.total > 0) parts.push(`${hazardLead} open ${hazardNoun}.`);
    parts.push(`${bad} of ${counted.length} ${counted.length === 1 ? "repair" : "repairs"} did not hold.`);
    if (facts.conflicted.length) parts.push(`${facts.conflicted.length} ${facts.conflicted.length === 1 ? "incident is" : "incidents are"} in conflict and not counted.`);
    verdict = parts.join(" ");
  }
  const verdictHtml = `<p class="card-verdict">${esc(verdict)}</p>`;

  const multi = unitIds.length > 1;
  const unitHeadHtml = multi ? "<th>Unit</th>" : "";
  const tableHtml = all.length
    ? `<table class="card-table"><thead><tr><th>Date</th>${unitHeadHtml}<th>What was reported</th><th>Result</th><th>Technician</th></tr></thead><tbody>${all
        .map((r) => {
          const tone = r.conflicting ? "hold" : r.kind === "HAZARD" ? "hazard" : r.outcome === "held" ? "ok" : "hold";
          const unitCellHtml = multi ? `<td>${esc(r.unit)}</td>` : "";
          const tag = (r.kind === "HAZARD" ? " (hazard)" : "") + (r.conflicting ? " (conflicting version)" : "");
          return `<tr class="${esc(tone)}"><td>${esc(r.when)}</td>${unitCellHtml}<td>${esc(r.note + tag)}</td><td>${esc(plainOutcome(r.outcome))}</td><td>${esc(r.actor)}</td></tr>`;
        })
        .join("")}</tbody></table>`
    : "";
  // text that came from a model-selected analysis is always marked on the card; code-built lines never are
  // The historical did-not-hold line is dropped only when every incident it names is already a row of the table above; otherwise it is the only place that count appears.
  const tableIds = new Set(all.map((r) => String(r.id || "").toUpperCase()));
  const coveredByTable = (f) => {
    if (!/^Historical did not hold rows/i.test(f)) return false;
    const named = f.match(/ISS-\d+/gi) || [];
    return named.length > 0 && named.every((id) => tableIds.has(id.toUpperCase()));
  };
  const flagItems = [...facts.flags.filter((f) => !coveredByTable(f)).map((f) => `<li>${esc(f)}</li>`), ...facts.analysisLines.map((f) => `<li><span class="model-mark">Model-selected, checked by code</span> ${esc(f)}</li>`)];
  const flagHtml = flagItems.length ? `<ul>${flagItems.join("")}</ul>` : all.length ? "" : "<p>No findings were released.</p>";

  const uncertainItems = [...facts.uncertain];
  if (facts.conflicted.length) uncertainItems.push(`Conflicting versions: ${facts.conflicted.join(", ")}. Both are shown; neither is counted.`);
  if (!released) uncertainItems.push("The answer was withheld or refused; nothing here is a conclusion.");
  if (notChecked.length) uncertainItems.push(`Not checked: ${notChecked.join("; ")}`);
  if (stages.analysis === "off") uncertainItems.push("Model analysis: off.");
  if (stages.analysis === "withheld") uncertainItems.push("Model analysis: withheld.");
  if (stages.analysis === "produced") uncertainItems.push("Model analysis: on. The model selected it; code checked it and wrote the words.");
  const uncertainHtml = uncertainItems.length ? `<ul>${uncertainItems.map((u) => `<li>${esc(u)}</li>`).join("")}</ul>` : "<p>Nothing flagged.</p>";

  const next = [];
  // A next check that is only a run of incident records is history, not an action: the table above already shows it.
  const nextIsRecords = nextCheck.split(/(?<=[.!?])\s+|\n/).filter((part) => part.trim()).every((part) => /^\s*ISS-\d+\s+\d{4}-\d{2}-\d{2}\b/.test(part));
  if (nextCheck && !nextIsRecords) next.push(nextCheck);
  for (const flag of facts.flags) {
    const action = /\bPropose\b[^.]*\./.exec(flag);
    // the flag's own proposal is added only when the next check does not already say it
    if (action && !next.some((n) => n.includes(action[0].trim()))) next.push(action[0]);
  }
  if (!next.length && hazards.total === 0) next.push("No action is proposed from these records.");
  if (hazards.total > 0) next.push("The hazard stays open until a person closes it.");
  const nextHtml = `<ul>${next.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;

  const evaluatorWord = stages.evaluator === "model" ? "model review" : stages.evaluator === "deterministic" ? "rule check only (model not used)" : "not run";
  const counts = { zetaris: 0, hmem: 0, worldmodel: 0, markov: 0 };
  const seenIds = new Set();
  for (const event of detail.events) {
    for (const id of event.retrieval?.evidence_ids ?? []) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const kind = id.startsWith("hmem:") ? "hmem" : id.startsWith("worldmodel:") ? "worldmodel" : id.startsWith("markov:") ? "markov" : "zetaris";
      counts[kind] += 1;
    }
  }
  const sources = Object.entries(counts).filter(([, n]) => n).map(([kind, n]) => `${sourceLabel(kind)}: ${n}`).join(" · ");
  const distinctIds = new Set(all.map((r) => r.id)).size;
  const recordWord = distinctIds === 1 ? "record" : "records";
  const trustHtml = released
    ? `<p>Released after the code checks. ${esc(distinctIds)} incident ${esc(recordWord)} shown. Evaluator: ${esc(evaluatorWord)}. ${esc(rewrites)}.</p><p class="card-sources">Sources: ${esc(sources || "none recorded")}. Source ids are under Technical details.</p>`
    : `<p>Evaluator: ${esc(evaluatorWord)}. ${esc(rewrites)}. Details are under Technical details.</p>`;

  return `<section class="decision-card" aria-label="Plain summary">
    <div class="card-sec verdict">${verdictHtml}</div>
    <div class="card-sec"><h3>What happened</h3>${whatHtml}</div>
    <div class="card-sec"><h3>Evidence</h3>${flagHtml}${tableHtml}</div>
    <div class="card-sec"><h3>Not covered</h3>${uncertainHtml}</div>
    <div class="card-sec"><h3>What to do next</h3>${nextHtml}</div>
    <div class="card-sec"><h3>Why you can trust it</h3>${trustHtml}</div>
  </section>`;
}

function renderAnswer(detail) {
  const result = detail.result;
  if (stillRunning(detail)) {
    answerEl.innerHTML = `<h2>Result</h2><p class="empty">Events are still arriving. The answer is not released yet.</p>`;
    return;
  }
  if (!result) {
    const status = detail.status || "error";
    answerEl.innerHTML = `<h2>Result</h2><p class="status ${esc(statusTone(status) || "hold")}">${esc(plainStatus(status))}</p><p class="release">The answer was not released.</p>`;
    return;
  }
  const status = result.status || "ok";
  const findings = result.result?.findings ?? [];
  const notChecked = result.result?.not_checked ?? [];
  const revisions = result.collaboration?.revision_count ?? 0;
  const headline = result.result?.headline || result.result?.summary || "";
  const note = result.result?.human_message && result.result.human_message !== headline ? result.result.human_message : "";
  const nextCheck = String(result.result?.recommended_next_check || "");
  const extra = nextCheck && !nextCheck.startsWith("Propose only") && nextCheck !== headline ? nextCheck : note;
  const claims = findings
    .map((finding) => {
      const modelWritten = String(finding.claim || "").startsWith("Analysis: ");
      const claimText = modelWritten ? String(finding.claim).slice("Analysis: ".length) : finding.claim;
      // core behavior as audited: the hazard marker reads the original claim; claimText below is for display only
      const hazardMark = splitClaim(finding.claim).some((line) => {
        const row = parseIncident(line);
        if (row) return row.tone === "hazard";
        return /\bHAZARD\b/.test(line) && !/^Open HAZARD count\b/i.test(line) && !/^Unit\b/i.test(line);
      })
        ? `<span class="hazard-mark">Hazard</span>`
        : "";
      const modelMark = modelWritten ? `<span class="model-mark">Model-written</span>` : "";
      // the labels shown before the claim: hazard, and model-written
      const hazard = hazardMark + modelMark;
      return `<article class="finding">${hazard}${splitClaim(claimText).map((line) => {
        const row = parseIncident(line);
        if (row) {
          return `<div class="row ${esc(row.tone)}"><div><span class="row-id">${esc(row.id)}</span><span class="row-note">${esc(row.note)}</span><span class="row-sub">${esc(row.sub)}</span></div><div class="row-meta"><span>${esc(row.kindLabel)}</span><span>${esc(row.when)}</span><span>${esc(row.outcomeLabel)}</span></div></div>`;
        }
        const unit = parseUnit(line);
        if (unit && unit.countOnly) return `<div class="spec"><p><b>Open hazards</b><span>${esc(unit.open)}</span></p></div>`;
        if (unit) {
          return `<div class="spec"><p><b>Unit</b><span>${esc(unit.unit)}</span></p><p><b>Model</b><span>${esc(unit.model)}</span></p><p><b>Zone</b><span>${esc(unit.zone)}</span></p><p><b>Location</b><span>${esc(unit.location)}</span></p><p><b>Open hazards</b><span>${esc(unit.open)}</span></p></div>`;
        }
        return `<p class="prose">${esc(line)}</p>`;
      }).join("")}<p class="ids">${(finding.evidence_ids || []).map((id) => `<span class="cite">${esc(id)}</span>`).join("")}</p></article>`;
    })
    .join("");
  const fallbackChip = result.result?.fallback_used ? "fallback" : "ok";
  const fallbackLabel = result.result?.fallback_used ? "Fallback used" : "No fallback";
  const revisionLabel = `${revisions} ${Number(revisions) === 1 ? "rewrite" : "rewrites"}`;
  answerEl.innerHTML = `<h2>Result</h2>
    ${decisionCard(detail)}
    <details class="technical"><summary>Technical details</summary>
    <div class="strip">
      <span class="chip ${esc(chipFor({ status, action: "" }))}">${esc(plainStatus(status))}</span>
      <span class="chip ${esc(fallbackChip)}">${esc(fallbackLabel)}</span>
      <span class="meta-note">${esc(revisionLabel)}</span>
      <span class="meta-note">${esc(elapsedLabel(detail.events))}</span>
    </div>
    ` +
    stageHtml(result.collaboration) +
    `
    <p class="headline">${esc(headline)}</p>
    ${extra ? `<p class="extra">${esc(extra)}</p>` : ""}
    ${evidenceGroups(detail)}
    <h3>Findings</h3>
    ${claims || `<p class="empty">No findings were released.</p>`}
    <p class="not-checked">Not checked: ${esc(notChecked.length ? notChecked.join("; ") : "Anything outside the retrieved sources")}</p>
    </details>`;
}

async function refreshHistory() {
  const res = await fetch("/runs");
  if (!res.ok) throw new Error("run list unavailable");
  const body = await res.json();
  const selected = location.hash.replace("#", "");
  renderHistory(body.runs || [], selected);
  return body.runs || [];
}

function stopTail() {
  tailGen += 1;
  tailTrace = "";
  if (tailTimer) clearInterval(tailTimer);
  tailTimer = 0;
}

function startTail(traceId, token) {
  if (tailTimer && tailTrace === traceId) return;
  stopTail();
  tailTrace = traceId;
  const gen = tailGen;
  tailTimer = setInterval(() => {
    if (gen !== tailGen || token !== viewToken) return;
    openTrace(traceId, true, token).catch((err) => showBanner(err.message));
  }, 700);
}

async function openTrace(traceId, animate, token = viewToken) {
  const res = await fetch(`/runs/${encodeURIComponent(traceId)}`);
  if (token !== viewToken) return;
  if (!res.ok) {
    showBanner("That run is not in the logs.");
    return;
  }
  const detail = await res.json();
  if (token !== viewToken) return;
  const grew = detail.events.length > knownEvents;
  knownEvents = detail.events.length;
  renderEvents(detail.events, animate && grew);
  renderAnswer(detail);
  const last = detail.events[detail.events.length - 1];
  if (last && stillRunning(detail)) workingStage = { planner: "Planner", executor: "Executor", evaluator: "Evaluator", ingest: "Checking the request" }[stationFor(last)] || "";
  // the run list is reloaded when a run settles or is opened, not on every poll while it is still running
  if (!animate || !stillRunning(detail)) await refreshHistory();
  if (token !== viewToken) return;
  if (stillRunning(detail)) startTail(traceId, token);
  else stopTail();
}

async function issue(query) {
  showBanner("");
  setBusy(true);
  startWorking();
  answerEl.innerHTML = `<h2>Result</h2><p class="empty">Waiting for this run.</p>`;
  const requestId = crypto.randomUUID();
  const token = nextView();
  followToken = token;
  stopTail();
  knownEvents = 0;
  const watch = setInterval(async () => {
    if (followToken !== token) return;
    const active = await fetch(`/runs/active?request_id=${encodeURIComponent(requestId)}`);
    if (followToken !== token || !active.ok) return;
    const body = await active.json();
    if (followToken !== token || !body.trace_id) return;
    setHash(body.trace_id);
    await openTrace(body.trace_id, true, token);
  }, 500);
  try {
    const res = await fetch("/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_id: requestId,
        user_query: query,
        context: { role: roleEl.value, track: "Wildcard [Tinkerer]" },
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "request failed");
    if (followToken !== token) return;
    setHash(body.trace_id);
    await openTrace(body.trace_id, false, token);
    stopWorking();
  } catch (err) {
    if (followToken !== token) return;
    showBanner(err.message || "The board could not finish the run.");
    stopWorking("The run did not finish");
  } finally {
    clearInterval(watch);
    if (followToken === token) followToken = 0;
    if (workingTimer) stopWorking("Stopped");
    setBusy(false);
  }
}

// Pills stand in for the native dropdowns: the hidden select stays the value source, so the commands are built as before.
function paintPills(select) {
  if (!select || !select.parentElement || !select.parentElement.querySelector) return;
  const box = select.parentElement.querySelector(".pills");
  if (!box) return;
  for (const pill of box.children) pill.setAttribute("aria-pressed", pill.dataset.value === select.value ? "true" : "false");
}
function renderPills(select) {
  if (!select || !select.options || !select.parentElement || typeof select.parentElement.querySelector !== "function" || typeof document.createElement !== "function") return;
  let box = select.parentElement.querySelector(".pills");
  if (!box) {
    box = document.createElement("div");
    box.className = "pills";
    box.setAttribute("role", "group");
    box.addEventListener("click", (event) => {
      const pill = event.target.closest(".pill");
      if (!pill) return;
      select.value = pill.dataset.value;
      paintPills(select);
      if (select === periodEl && rangeEl) rangeEl.dataset.active = "false";
    });
    select.parentElement.appendChild(box);
    select.hidden = true;
  }
  box.textContent = "";
  // the custom range is the far-left control on the period line, the quick pills follow it
  if (select === periodEl && rangeEl) box.appendChild(rangeEl);
  for (const option of select.options) {
    if (select === periodEl && option.value === "custom") continue;
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "pill";
    pill.dataset.value = option.value;
    pill.textContent = option.textContent;
    box.appendChild(pill);
  }
  paintPills(select);
}

function queryFor(phrase) {
  if (phrase === "CAUSE" || phrase === "NEXT") return `${phrase} ${assetEl.value}`;
  if (phrase === "PATTERNS" && periodEl.value === "custom") return fromEl.value && toEl.value ? `PATTERNS ${fromEl.value}..${toEl.value}` : "";
  if (phrase === "PATTERNS") return `PATTERNS ${periodEl.value}`;
  return freeEl.value.trim();
}

function submitPhrase(phrase) {
  if (requestBusy) return;
  const query = queryFor(phrase);
  if (!query) {
    showBanner(phrase === "PATTERNS" ? "Pick a start date and an end date." : "Free text is empty.");
    return;
  }
  showBanner("");
  issue(query);
}

freeEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.repeat || event.isComposing) return;
  event.preventDefault();
  if (handlingFree) return;
  handlingFree = true;
  submitPhrase("FREE");
  queueMicrotask(() => {
    handlingFree = false;
  });
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (handlingFree) return;
  const phrase = event.submitter?.dataset.phrase;
  if (!phrase) return;
  submitPhrase(phrase);
});

historyEl.addEventListener("click", (event) => {
  const more = event.target.closest("button[data-more]");
  if (more) {
    historyShowAll = true;
    refreshHistory().catch((err) => showBanner(err.message));
    return;
  }
  const button = event.target.closest("button[data-trace]");
  if (!button) return;
  followToken = 0;
  stopTail();
  const token = nextView();
  knownEvents = 0;
  setHash(button.dataset.trace);
  openTrace(button.dataset.trace, false, token).catch((err) => showBanner(err.message));
});

window.addEventListener("hashchange", () => {
  if (ignoreHash && location.hash === ignoreHash) {
    ignoreHash = "";
    return;
  }
  ignoreHash = "";
  const traceId = location.hash.replace("#", "");
  if (!traceId) return;
  followToken = 0;
  stopTail();
  const token = nextView();
  knownEvents = 0;
  openTrace(traceId, false, token).catch((err) => showBanner(err.message));
});

function skyBand(date) {
  const hour = date.getHours();
  if (hour < 5 || hour >= 20) return "night";
  if (hour < 8) return "dawn";
  if (hour < 17) return "day";
  return "dusk";
}

let skyTimer = 0;

function applySky(active) {
  document.body.dataset.sky = active ? "active" : "static";
  skyButton.setAttribute("aria-pressed", active ? "true" : "false");
  skyButton.textContent = active ? "Ambient" : "Static";
  if (skyTimer) clearInterval(skyTimer);
  skyTimer = 0;
  if (!active) {
    delete document.body.dataset.band;
    return;
  }
  const paint = () => {
    document.body.dataset.band = skyBand(new Date());
  };
  paint();
  skyTimer = setInterval(paint, 60000);
}

skyButton.addEventListener("click", () => {
  const next = document.body.dataset.sky !== "active";
  applySky(next);
  localStorage.setItem("board-sky", next ? "active" : "static");
});

applySky(localStorage.getItem("board-sky") === "active");

loadCatalog()
  .then(refreshHistory)
  .then((runs) => {
    const selected = location.hash.replace("#", "");
    if (selected) return openTrace(selected, false);
    if (runs[0]) location.hash = runs[0].trace_id;
  })
  .catch((err) => {
    if (loadingEl) loadingEl.hidden = true;
    showBanner(err.message || "The board could not load.");
  });
renderPills(roleEl);
renderPills(periodEl);
for (const el of [fromEl, toEl]) {
  if (el && typeof el.addEventListener === "function") {
    el.addEventListener("input", () => {
      periodEl.value = "custom";
      paintPills(periodEl);
      rangeEl.dataset.active = "true";
    });
  }
}

// Fleet strip: the real date and time here, and which units need a look (same rules as the answers).
function tickClock() {
  if (!nowEl) return;
  nowEl.textContent = new Date().toLocaleString([], { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}
async function loadFleet() {
  if (!fleetCountEl || typeof fetch !== "function") return;
  try {
    const res = await fetch("/fleet");
    if (!res.ok) return;
    const fleet = await res.json();
    const n = fleet.needs_a_look.length;
    fleetCountEl.textContent = `${n} of ${fleet.units} units need a look`;
    fleetUnitsEl.textContent = "";
    for (const unit of fleet.needs_a_look) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "fleet-chip";
      chip.title = "Diagnose this unit";
      chip.textContent = `${unit.asset}${unit.open_hazards ? " · open hazard" : ""}${unit.failed >= fleet.escalation_rule ? ` · ${unit.failed} failed repairs` : ""}`;
      chip.addEventListener("click", () => {
        // a flagged unit opens its diagnosis: select it and run Diagnose
        assetEl.value = unit.asset;
        paintPills(assetEl);
        submitPhrase("CAUSE");
      });
      fleetUnitsEl.appendChild(chip);
    }
  } catch {
    // the strip is informational; the board works without it
  }
}
if (nowEl) {
  tickClock();
  setInterval(tickClock, 1000);
  loadFleet();
}
