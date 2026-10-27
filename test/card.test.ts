import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

/**
 * The decision card (public/board.js). The page script is loaded in a stub browser; decisionCard(detail) is called with answers shaped like
 * the server's. Checks: five sections are present and non-empty, raw words and ids stay out of them, uncertainty is shown, and a line the
 * page cannot parse is shown as received.
 */

const source = fs.readFileSync(path.join(import.meta.dirname, "..", "public", "board.js"), "utf8");

type Page = { decisionCard: (detail: unknown) => string; renderHistory: (runs: unknown[], selected: string) => void; startWorking: () => void; stopWorking: (note?: string) => void };
function loadPage(elements: Record<string, Record<string, unknown>> = {}): Page {
  const element: Record<string, unknown> = new Proxy(function () {}, {
    get: (_t, key) => (key === "classList" ? { add() {}, remove() {}, toggle() {} } : key === "dataset" ? {} : key === "style" ? {} : () => element),
    set: () => true,
    apply: () => element,
  }) as never;
  const sandbox: Record<string, unknown> = {
    document: { querySelector: (selector: string) => elements[selector] ?? element, querySelectorAll: () => [], createElement: () => element, addEventListener() {}, body: element, documentElement: element },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }), location: { hash: "" }, history: { replaceState() {} } },
    location: { hash: "", pathname: "/" },
    history: { replaceState() {} },
    fetch: () => new Promise(() => {}),
    setInterval: () => 0,
    setTimeout: () => 0,
    clearInterval() {},
    clearTimeout() {},
    requestAnimationFrame: () => 0,
    localStorage: { getItem: () => null, setItem() {} },
    console,
    Date,
    Math,
    JSON,
    URL,
    EventSource: function () {
      return element;
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`${source}\nglobalThis.__page = { decisionCard, renderHistory, startWorking, stopWorking };`, sandbox);
  return sandbox.__page as Page;
}

const rec = (id: string, unit: string, kind: string, date: string, actor: string, outcome: string, reason: string) => `${id} ${unit} ${kind} opened ${date} actor ${actor} ${outcome} reason ${reason}.`;
const answer = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  result: {
    headline: "CAUSE SSA-001: cited rows, human decides",
    recommended_next_check: "A human inspects the unit. Agents propose only.",
    not_checked: ["Anything not in retrieved sources"],
    findings: [
      { claim: rec("ISS-001", "SSA-001", "OOS", "2026-09-02", "ACT-17", "did_not_hold", "intake filter packed with dust"), evidence_ids: ["zetaris:a"] },
      { claim: rec("ISS-002", "SSA-001", "OOS", "2026-09-16", "ACT-11", "held", "same filter bypass"), evidence_ids: ["zetaris:a"] },
      { claim: "Unit SSA-001 model RTU-12 zone North location roof-n1. Open HAZARD count 0, read from the world-model graph.", evidence_ids: ["worldmodel:u"] },
    ],
    ...((over.result as object) ?? {}),
  },
  collaboration: { revision_count: 0, model_stages: { headline: "code", analysis: "off", evaluator: "model" }, ...((over.collaboration as object) ?? {}) },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== "result" && k !== "collaboration")),
});
const detail = (result: unknown) => ({ status: "ok", result, events: [{ retrieval: { evidence_ids: ["zetaris:a", "hmem:m1", "worldmodel:u"] } }] });
const sections = (html: string) => html.split('<div class="card-sec').slice(2).map((part) => part.replace(/^[^>]*>/, ""));
const verdictOf = (html: string) => /<p class="card-verdict">([^<]*)<\/p>/.exec(html)?.[1] ?? "";

test("a normal answer fills all five sections in plain words", () => {
  const html = loadPage().decisionCard(detail(answer()));
  const parts = sections(html);
  for (const [i, part] of parts.entries()) assert.ok(part.replace(/<[^>]+>/g, "").trim().length > 0, `section ${i + 1} is empty`);
  assert.match(parts[0], /SSA-001 \(model RTU-12, North zone, roof-n1\)/);
  assert.match(parts[0], /2 service calls/);
  assert.match(parts[0], /1 of 2 repairs did not hold/);
  assert.match(parts[0], /Open hazards: 0/);
  assert.match(parts[1], /Fix did not hold/);
  assert.match(parts[1], /Fix held/);
  assert.match(parts[4], /Released after the code checks\. 2 incident records shown/);
});

test("raw outcome words and source ids stay out of the five sections", () => {
  const html = loadPage().decisionCard(detail(answer()));
  const text = sections(html).join(" ");
  assert.equal(/did_not_hold/.test(text), false);
  assert.equal(/zetaris:|hmem:|worldmodel:/.test(text), false);
});

test("an open hazard is stated and the system says it cannot close it", () => {
  const hazard = answer({
    result: {
      findings: [
        { claim: rec("ISS-006", "SSA-002", "HAZARD", "2026-10-15", "ACT-23", "did_not_hold", "high-limit trip, still open"), evidence_ids: ["zetaris:a"] },
        { claim: "Unit SSA-002 model BLR-4 zone East location plant-e1. Open HAZARD count 1, read from the world-model graph.", evidence_ids: ["worldmodel:u"] },
      ],
    },
  });
  const parts = sections(loadPage().decisionCard(detail(hazard)));
  assert.match(parts[0], /Open hazards: 1/);
  assert.match(parts[3], /stays open until a person closes it/);
  assert.match(parts[1], /\(hazard\)/);
});

test("uncertainty is shown: conflicts, not-checked, analysis off, and a withheld answer", () => {
  const conflict = answer({
    result: {
      findings: [
        { claim: rec("ISS-005", "SSA-001", "OOS", "2026-10-20", "ACT-23", "did_not_hold", "reset only"), evidence_ids: ["zetaris:a"] },
        { claim: "Data quality: 1 row was set aside (impossible date).", evidence_ids: ["zetaris:a"] },
        { claim: "ISS-005 has two versions in the retrieved records that conflict (a conflict finding).", evidence_ids: ["zetaris:a"] },
      ],
    },
  });
  const parts = sections(loadPage().decisionCard(detail(conflict)));
  assert.match(parts[2], /Data quality: 1 row was set aside/);
  assert.match(parts[2], /conflict/);
  assert.match(parts[2], /Not checked/);
  assert.match(parts[2], /Model analysis: off/);
  const withheld = loadPage().decisionCard({ status: "unresolved", result: { status: "unresolved", result: { findings: [], not_checked: [] }, collaboration: { revision_count: 2, model_stages: { analysis: "off", evaluator: "deterministic" } } }, events: [] });
  const w = sections(withheld);
  assert.match(w[0], /No answer was released/);
  assert.match(w[2], /withheld or refused/);
});

test("a line the page cannot parse is shown as received, never dropped", () => {
  const odd = answer({ result: { findings: [{ claim: "Some line in a shape the page has never seen.", evidence_ids: ["zetaris:a"] }] } });
  const html = loadPage().decisionCard(detail(odd));
  assert.match(sections(html)[1], /Some line in a shape the page has never seen\./);
});

/** QA r36 findings R36-01 to R36-04. */
const unitLine = (unit: string, model: string, zone: string, loc: string, open: number) => `Unit ${unit} model ${model} zone ${zone} location ${loc}. Open HAZARD count ${open}, read from the world-model graph.`;
const withFindings = (claims: string[], over: Record<string, unknown> = {}) => answer({ result: { findings: claims.map((claim) => ({ claim, evidence_ids: ["zetaris:a"] })), ...over } });
const hazardFloor = (id: string, unit: string, date: string) => `${id} ${unit} HAZARD opened ${date} actor ACT-23 did_not_hold reason high-limit trip and stays open for a human.`;

test("R36-01: open hazards are counted from the whole answer, and missing metadata is not read as zero", () => {
  const two = withFindings([hazardFloor("ISS-006", "SSA-002", "2026-10-15"), hazardFloor("ISS-011", "SSA-009", "2026-10-18"), unitLine("SSA-002", "BLR-4", "East", "plant-e1", 1)]);
  const a = sections(loadPage().decisionCard(detail(two)))[0];
  assert.match(a, /Open hazards: 2/);
  const noUnitLine = withFindings([hazardFloor("ISS-006", "SSA-002", "2026-10-15")]);
  const b = sections(loadPage().decisionCard(detail(noUnitLine)))[0];
  assert.doesNotMatch(b, /Open hazards: 0/);
  assert.match(b, /Open hazards: 1/);
  const unknown = withFindings([rec("ISS-001", "SSA-003", "OOS", "2026-09-02", "ACT-17", "held", "damper stuck")]);
  const c = sections(loadPage().decisionCard(detail(unknown)))[0];
  assert.match(c, /Open hazards: not stated in this answer for SSA-003/);
  assert.doesNotMatch(c, /Open hazards: 0\b/);
});

test("R36-02: every recognized record format appears; nothing is reported as 'no findings' or undercounted", () => {
  const mixed = withFindings([
    "ISS-005 SSA-001 OOS 2026-10-20 ACT-11 did_not_hold reset only",
    "D3 synthetic incident ISS-007 on SSA-001: kind OOS, opened 2026-10-21, actor ACT-23, fix_outcome held, reason ignition lockout.",
    "ISS-008 2026-10-22 OOS ACT-17 did_not_hold note belt noise",
  ]);
  const parts = sections(loadPage().decisionCard(detail(mixed)));
  assert.doesNotMatch(parts[1], /No findings were released/);
  assert.match(parts[1], /reset only/);
  assert.match(parts[1], /ignition lockout/);
  assert.match(parts[1], /belt noise/);
  assert.match(parts[4], /3 incident records shown/);
  const nextAnswer = withFindings([rec("ISS-001", "SSA-001", "OOS", "2026-09-02", "ACT-17", "did_not_hold", "filter")], { recommended_next_check: "Propose only. A human decides. ISS-009 2026-10-20 OOS ACT-11 did_not_hold note reset" });
  assert.doesNotMatch(sections(loadPage().decisionCard(detail(nextAnswer)))[3], /did_not_hold/);
  assert.doesNotMatch(sections(loadPage().decisionCard(detail(nextAnswer)))[3], /human decides|you decide/i);
});

test("R36-02: sources are counted across every retrieval event, not only the first", () => {
  const d = detail(answer());
  d.events = [{ retrieval: { evidence_ids: ["markov:SSA-001"] } }, { retrieval: { evidence_ids: ["zetaris:a", "hmem:m1", "worldmodel:u"] } }] as never;
  const trust = sections(loadPage().decisionCard(d))[4];
  assert.match(trust, /Issue log: 1/);
  assert.match(trust, /Memory: 1/);
  assert.match(trust, /Unit graph: 1/);
  assert.match(trust, /Recent chain: 1/);
});

test("R36-03: conflicting versions of one incident are shown, flagged and not counted, in either order", () => {
  const held = rec("ISS-005", "SSA-001", "OOS", "2026-10-20", "ACT-23", "held", "reset only");
  const notHeld = rec("ISS-005", "SSA-001", "OOS", "2026-10-20", "ACT-23", "did_not_hold", "reset only");
  const other = rec("ISS-001", "SSA-001", "OOS", "2026-09-02", "ACT-17", "did_not_hold", "filter");
  const outputs = [[held, notHeld], [notHeld, held]].map((order) => {
    const parts = sections(loadPage().decisionCard(detail(withFindings([other, ...order]))));
    return { what: parts[0], table: parts[1], unc: parts[2] };
  });
  for (const o of outputs) {
    assert.match(o.what, /1 service call/);
    assert.match(o.what, /1 of 1 repair did not hold/);
    assert.match(o.what, /conflicting versions \(ISS-005\).*not counted/);
    assert.equal((o.table.match(/conflicting version/g) ?? []).length, 2);
    assert.match(o.unc, /Conflicting versions: ISS-005/);
  }
  assert.equal(outputs[0].what, outputs[1].what);
});

test("R36-04: unit details come from the unit line that matches the incident's unit", () => {
  const html = loadPage().decisionCard(
    detail(withFindings([rec("ISS-006", "SSA-002", "HAZARD", "2026-10-15", "ACT-23", "did_not_hold", "high-limit trip"), unitLine("SSA-001", "RTU-12", "North", "roof-n1", 0), unitLine("SSA-002", "BLR-4", "East", "plant-e1", 1)])),
  );
  const what = sections(html)[0];
  assert.match(what, /SSA-002 \(model BLR-4, East zone, plant-e1\)/);
  assert.doesNotMatch(what, /RTU-12/);
  const noMatch = loadPage().decisionCard(detail(withFindings([rec("ISS-006", "SSA-002", "HAZARD", "2026-10-15", "ACT-23", "did_not_hold", "x"), unitLine("SSA-001", "RTU-12", "North", "roof-n1", 0)])));
  assert.doesNotMatch(sections(noMatch)[0], /RTU-12/);
});

/** P0 board responsiveness: the page says what it is doing, never asks for the system busy cursor, and keeps the run list light. */
test("the stylesheet never asks for the system busy cursor", () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, "..", "public", "board.css"), "utf8");
  assert.equal(/cursor:\s*(wait|progress)/.test(css), false);
});

test("working state: the page acknowledges a request at once and reports when it finishes", () => {
  const working: Record<string, unknown> = { hidden: true, textContent: "" };
  const page = loadPage({ "#working": working });
  page.startWorking();
  assert.equal(working.hidden, false);
  assert.match(String(working.textContent), /^Request received at \d\d:\d\d:\d\d\. Working, \d+\.\d s\./);
  page.stopWorking();
  assert.match(String(working.textContent), /^Finished in \d+\.\d s\.$/);
  page.startWorking();
  page.stopWorking("The run did not finish");
  assert.match(String(working.textContent), /^The run did not finish \(\d+\.\d s\)$/);
});

test("the run list renders the latest 100 runs, keeps the selected run, and offers the rest", () => {
  const history: Record<string, unknown> = { innerHTML: "", addEventListener() {} };
  const page = loadPage({ "#history": history, "#empty": { hidden: true }, "#loading": { hidden: true } });
  const runs = Array.from({ length: 1500 }, (_, i) => ({ trace_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, query: "CAUSE SSA-001", status: "ok", started_at: `2026-10-25T20:00:00.${String(i).padStart(3, "0")}Z` }));
  const selected = runs[1200].trace_id;
  page.renderHistory(runs, selected);
  const html = String(history.innerHTML);
  assert.equal((html.match(/<li>/g) ?? []).length, 101);
  assert.ok(html.includes(selected));
  assert.match(html, /Show all 1500 runs/);
  page.renderHistory(runs.slice(0, 40), "");
  assert.equal(/Show all/.test(String(history.innerHTML)), false);
});

/** QA r37 findings R37-01 to R37-03. */
const FULL = "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason high-limit trip, still open.";
const CHAIN = "ISS-006 2026-10-15 HAZARD ACT-23 did_not_hold note high-limit trip, still open.";

test("R37-01: a format that omits the unit does not conflict with the same incident in a format that has it", () => {
  for (const claims of [[FULL, CHAIN], [CHAIN, FULL]]) {
    const parts = sections(loadPage().decisionCard(detail(withFindings(claims))));
    assert.match(parts[0], /1 service call/);
    assert.match(parts[0], /1 of 1 repair did not hold/);
    assert.doesNotMatch(parts[0], /conflicting versions/);
    assert.doesNotMatch(parts[2], /Conflicting versions/);
  }
});

test("R37-02: an explicit open-hazard flag survives whichever order the duplicates arrive in", () => {
  const plain = FULL;
  const floor = "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason high-limit trip, still open and stays open for a human.";
  const results = [[plain, floor], [floor, plain]].map((claims) => sections(loadPage().decisionCard(detail(withFindings(claims)))));
  for (const parts of results) {
    assert.match(parts[0], /Open hazards: 1\b/);
    assert.match(parts[3], /stays open until a person closes it/);
    assert.match(parts[0], /1 service call/);
  }
});

test("R37-03: a recognized chain-only open hazard is counted as open, never as zero", () => {
  const chainOpen = "ISS-006 2026-10-15 HAZARD ACT-23 open note high-limit trip, still open stays open for a human.";
  const parts = sections(loadPage().decisionCard(detail(withFindings([chainOpen]))));
  assert.doesNotMatch(parts[0], /Open hazards: 0\b/);
  assert.match(parts[0], /Open hazards: 1\b/);
  assert.match(parts[3], /stays open until a person closes it/);
  const chainOutcomeOnly = "ISS-007 2026-10-16 HAZARD ACT-23 open note flame sensor fault.";
  assert.match(sections(loadPage().decisionCard(detail(withFindings([chainOutcomeOnly]))))[0], /Open hazards: 1\b/);
});

test("a real conflict (different values) is still flagged after the merge change", () => {
  const a = "ISS-009 SSA-001 OOS opened 2026-10-20 actor ACT-23 held reason reset only.";
  const b = "ISS-009 SSA-001 OOS opened 2026-10-20 actor ACT-23 did_not_hold reason reset only.";
  const parts = sections(loadPage().decisionCard(detail(withFindings([a, b]))));
  assert.match(parts[0], /conflicting versions \(ISS-009\)/);
});

/** Verdict line and plainer wording. */
test("the verdict line states the counts first, and only what the answer supports", () => {
  const load = (a: unknown) => verdictOf(loadPage().decisionCard(detail(a)));
  assert.equal(load(answer()), "1 of 2 repairs did not hold.");
  const hazard = withFindings([hazardFloor("ISS-006", "SSA-002", "2026-10-15"), unitLine("SSA-002", "BLR-4", "East", "plant-e1", 1)]);
  assert.equal(load(hazard), "1 open hazard. 1 of 1 repair did not hold.");
  const conflict = withFindings([rec("ISS-009", "SSA-001", "OOS", "2026-10-20", "ACT-23", "held", "x"), rec("ISS-009", "SSA-001", "OOS", "2026-10-20", "ACT-23", "did_not_hold", "x"), rec("ISS-001", "SSA-001", "OOS", "2026-09-02", "ACT-17", "did_not_hold", "y")]);
  assert.equal(load(conflict), "1 of 1 repair did not hold. 1 incident is in conflict and not counted.");
  assert.match(verdictOf(loadPage().decisionCard({ status: "unresolved", result: { status: "unresolved", result: { findings: [], not_checked: [] }, collaboration: { revision_count: 2, model_stages: { analysis: "off", evaluator: "deterministic" } } }, events: [] })), /^No answer released\./);
  assert.equal(load(withFindings(["Some line in a shape the page has never seen."])), "No incident records in this answer.");
});

test("the card headings are plain questions and the five sections stay in order", () => {
  const html = loadPage().decisionCard(detail(answer()));
  const heads = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(heads, ["What happened", "Evidence", "Not covered", "What to do next", "Why you can trust it"]);
});

/** QA r39 finding R39-01. */
test("R39-01: one incident id is one open hazard, in either order, even when versions disagree on outcome and unit", () => {
  const full = "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason high-limit trip, still open and stays open for a human.";
  const chain = "ISS-006 2026-10-15 HAZARD ACT-23 open note high-limit trip, still open stays open for a human.";
  const graph = unitLine("SSA-002", "BLR-4", "East", "plant-e1", 1);
  for (const claims of [[full, chain, graph], [chain, full, graph], [graph, chain, full]]) {
    const html = loadPage().decisionCard(detail(withFindings(claims)));
    const parts = sections(html);
    assert.match(parts[0], /Open hazards: 1\b/);
    assert.match(verdictOf(html), /^1 open hazard\./);
    assert.match(parts[0], /conflicting versions \(ISS-006\)/);
  }
  const two = withFindings([full, "ISS-011 SSA-009 HAZARD opened 2026-10-18 actor ACT-17 did_not_hold reason freeze-stat open and stays open for a human.", chain, graph]);
  assert.match(sections(loadPage().decisionCard(detail(two)))[0], /Open hazards: 2\b/);
});

/** QA r40 finding R40-01: every format mix, every input order. */
test("R40-01: one incident id is one open hazard across all versions, in all six orders", () => {
  const plain = "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason high-limit trip, still open.";
  const chainOpen = "ISS-006 2026-10-15 HAZARD ACT-23 open note high-limit trip, still open stays open for a human.";
  const graph = unitLine("SSA-002", "BLR-4", "East", "plant-e1", 1);
  const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  assert.equal(perms([plain, chainOpen, graph]).length, 6);
  for (const claims of perms([plain, chainOpen, graph])) {
    const html = loadPage().decisionCard(detail(withFindings(claims)));
    assert.match(sections(html)[0], /Open hazards: 1\b/, claims.map((c) => c.slice(0, 12)).join(" | "));
    assert.match(verdictOf(html), /^1 open hazard\./);
    assert.doesNotMatch(verdictOf(html), /2 open hazard/);
    assert.match(sections(html)[0], /conflicting versions \(ISS-006\)/);
  }
});

/** Sweep for the whole family of R39-01 and R40-01: one hazard incident, every mix of formats, flags and the graph line, every order. */
test("sweep: one hazard incident never counts as two, and an open signal is never read as zero", () => {
  const variants: { text: string; open: boolean }[] = [
    { text: "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason high-limit trip, still open.", open: false },
    { text: "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason high-limit trip, still open and stays open for a human.", open: true },
    { text: "ISS-006 2026-10-15 HAZARD ACT-23 open note high-limit trip, still open stays open for a human.", open: true },
    { text: "ISS-006 2026-10-15 HAZARD ACT-23 did_not_hold note high-limit trip, still open.", open: false },
    { text: "D3 synthetic incident ISS-006 on SSA-002: kind HAZARD, opened 2026-10-15, actor ACT-23, fix_outcome did_not_hold, reason high-limit trip, still open. This HAZARD stays open for a human.", open: true },
    { text: "ISS-006 SSA-002 HAZARD 2026-10-15 ACT-23 did_not_hold high-limit trip, still open", open: false },
    { text: unitLine("SSA-002", "BLR-4", "East", "plant-e1", 1), open: true },
    { text: "Open HAZARD count 1.", open: true },
  ];
  const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  let checked = 0;
  for (let mask = 1; mask < 1 << variants.length; mask++) {
    const chosen = variants.filter((_, i) => mask & (1 << i));
    if (chosen.length > 4) continue;
    const anyOpen = chosen.some((v) => v.open);
    for (const order of perms(chosen.map((v) => v.text))) {
      const html = loadPage().decisionCard(detail(withFindings(order)));
      const count = /Open hazards: (\d+)/.exec(sections(html)[0])?.[1];
      const label = order.map((t) => t.slice(0, 14)).join(" | ");
      if (count !== undefined) {
        assert.ok(Number(count) <= 1, `never two hazards: ${label} -> ${count}`);
        if (anyOpen) assert.equal(count, "1", `an open signal is one hazard: ${label}`);
      } else if (anyOpen) {
        assert.match(verdictOf(html), /^1 open hazard per the unit graph\./, `graph-only answer must state the open hazard: ${label}`);
        assert.match(sections(html)[0], /1 open hazard according to the unit graph/, label);
        assert.match(sections(html)[3], /stays open until a person closes it/, label);
      }
      assert.doesNotMatch(verdictOf(html), /[2-9] open hazards/, label);
      checked++;
    }
  }
  assert.ok(checked > 1000, `only ${checked} combinations checked`);
});

/** QA r41 finding R41-01: a count-only graph line beside unit-less records. */
test("R41-01: an explicit graph count is never turned into zero, or a smaller number, by the records beside it", () => {
  const run = (claims: string[]) => {
    const html = loadPage().decisionCard(detail(withFindings(claims)));
    return { what: sections(html)[0], verdict: verdictOf(html), next: sections(html)[3] };
  };
  const three = run(["Open HAZARD count 3.", "ISS-007 2026-10-16 OOS ACT-23 held note repaired."]);
  assert.match(three.what, /Open hazards: 3\b/);
  assert.match(three.verdict, /^3 open hazards\. 0 of 1 repair did not hold\./);
  assert.match(three.next, /stays open until a person closes it/);
  const withChain = run(["Open HAZARD count 3.", "ISS-006 2026-10-15 HAZARD ACT-23 open note trip."]);
  assert.match(withChain.what, /Open hazards: 3\b/);
  assert.match(withChain.verdict, /^3 open hazards\./);
  assert.doesNotMatch(withChain.verdict, /^1 open hazard\./);
  const both = run(["ISS-007 2026-10-16 OOS ACT-23 held note repaired.", "Open HAZARD count 3."]);
  assert.match(both.what, /Open hazards: 3\b/);
  // records that show more than the graph says: say "at least", never the smaller figure
  const more = run(["Open HAZARD count 1.", "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason a and stays open for a human.", "ISS-011 SSA-009 HAZARD opened 2026-10-18 actor ACT-17 did_not_hold reason b and stays open for a human."]);
  assert.match(more.what, /Open hazards: (at least )?2\b/);
  assert.match(more.verdict, /^(at least )?2 open hazards\./);
  assert.equal(run(["Open HAZARD count 0.", "ISS-007 2026-10-16 OOS ACT-23 held note repaired."]).verdict, "0 of 1 repair did not hold.");
});

/** Sweep 2: a whole-answer graph count beside every mix of records. The shown total is exactly the larger of the graph count and the distinct open incidents. */
test("sweep 2: the open-hazard total is the larger of the graph count and the distinct open incidents, in every mix and order", () => {
  const records: { text: string; openId?: string }[] = [
    { text: "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason trip, still open." },
    { text: "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason trip, still open and stays open for a human.", openId: "ISS-006" },
    { text: "ISS-006 2026-10-15 HAZARD ACT-23 open note trip, still open stays open for a human.", openId: "ISS-006" },
    { text: "ISS-006 2026-10-15 HAZARD ACT-23 did_not_hold note trip, still open." },
    { text: "ISS-007 2026-10-16 OOS ACT-23 held note repaired." },
    { text: "ISS-011 SSA-009 HAZARD opened 2026-10-18 actor ACT-17 did_not_hold reason freeze-stat and stays open for a human.", openId: "ISS-011" },
  ];
  const perms = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
  let checked = 0;
  for (const graphCount of [0, 1, 3]) {
    for (let mask = 1; mask < 1 << records.length; mask++) {
      const chosen = records.filter((_, i) => mask & (1 << i));
      if (chosen.length > 3) continue;
      const openIds = new Set(chosen.map((r) => r.openId).filter(Boolean));
      const expected = Math.max(graphCount, openIds.size);
      for (const order of perms([`Open HAZARD count ${graphCount}.`, ...chosen.map((r) => r.text)])) {
        const html = loadPage().decisionCard(detail(withFindings(order)));
        const label = `count ${graphCount}: ${order.map((t) => t.slice(0, 12)).join(" | ")}`;
        const shown = /Open hazards: (?:at least )?(\d+)/.exec(sections(html)[0])?.[1];
        const unknownScope = /Open hazards: [^<]*not stated/.test(sections(html)[0]);
        if (shown !== undefined && !unknownScope) assert.equal(Number(shown), expected, label);
        else if (shown !== undefined) assert.ok(Number(shown) >= expected, label);
        if (expected > 0) assert.ok(shown === undefined ? /^(at least )?\d+ open hazard/.test(verdictOf(html)) : Number(shown) >= expected, label);
        checked++;
      }
    }
  }
  assert.ok(checked > 1000, `only ${checked} combinations checked`);
});

/** QA r42 findings R42-01 and R42-02, and a reference model of the whole rule. */
test("R42-01 and R42-02: a whole-answer count is a total, not one more per-unit contribution", () => {
  const verdictFor = (claims: string[]) => verdictOf(loadPage().decisionCard(detail(withFindings(claims))));
  const whatFor = (claims: string[]) => sections(loadPage().decisionCard(detail(withFindings(claims))))[0];
  const graphOnly = ["Open HAZARD count 3.", unitLine("SSA-003", "BLR-4", "East", "plant-e1", 1)];
  assert.equal(verdictFor(graphOnly), "3 open hazards per the unit graph.");
  assert.equal(verdictFor([...graphOnly].reverse()), "3 open hazards per the unit graph.");
  const withOos = [...graphOnly, "ISS-007 SSA-002 OOS opened 2026-10-16 actor ACT-23 held reason repaired."];
  assert.match(whatFor(withOos), /Open hazards: 3\b/);
  assert.match(verdictFor(withOos), /^3 open hazards\. 0 of 1 repair did not hold\./);
  assert.doesNotMatch(verdictFor(withOos), /4/);
  // two open ids with a graph count of zero: the figure is the open incidents, and it says "at least"
  const two = ["Open HAZARD count 0.", "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason a and stays open for a human.", "ISS-011 SSA-009 HAZARD opened 2026-10-18 actor ACT-17 did_not_hold reason b and stays open for a human."];
  assert.match(verdictFor(two), /^at least 2 open hazards\./);
  // a plain CAUSE-shaped answer: count-only zero beside one unit's records reads zero
  assert.match(whatFor(["Open HAZARD count 0.", rec("ISS-001", "SSA-001", "OOS", "2026-09-02", "ACT-17", "held", "x")]), /Open hazards: 0\b/);
});

test("reference model: every mix of unit lines, count-only lines and records gives the figure the rule defines", () => {
  type Unit = { u: string; n: number };
  const unitLines: Unit[][] = [[], [{ u: "SSA-002", n: 1 }], [{ u: "SSA-003", n: 1 }], [{ u: "SSA-002", n: 0 }, { u: "SSA-003", n: 1 }]];
  const wholes: number[][] = [[], [0], [1], [3], [1, 3]];
  const recs: { text: string; id: string; unit: string; open: boolean }[] = [
    { text: "ISS-007 SSA-002 OOS opened 2026-10-16 actor ACT-23 held reason repaired.", id: "ISS-007", unit: "SSA-002", open: false },
    { text: "ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 did_not_hold reason trip and stays open for a human.", id: "ISS-006", unit: "SSA-002", open: true },
    { text: "ISS-008 2026-10-17 HAZARD ACT-23 open note leak stays open for a human.", id: "ISS-008", unit: "", open: true },
    { text: "ISS-011 SSA-009 HAZARD opened 2026-10-18 actor ACT-17 did_not_hold reason freeze and stays open for a human.", id: "ISS-011", unit: "SSA-009", open: true },
  ];
  let checked = 0;
  for (const units of unitLines) for (const whole of wholes) for (let mask = 0; mask < 1 << recs.length; mask++) {
    const chosen = recs.filter((_, i) => mask & (1 << i));
    if (!units.length && !whole.length && !chosen.length) continue;
    // the rule, written out independently of the page code
    const openOn = (u: string) => chosen.filter((r) => r.open && r.unit === u).length;
    const unattached = chosen.filter((r) => r.open && !r.unit).length;
    const unitNames = new Set([...units.map((x) => x.u), ...chosen.filter((r) => r.unit).map((r) => r.unit)]);
    let sum = 0;
    let slack = 0;
    for (const name of unitNames) {
      const given = units.find((x) => x.u === name);
      if (!given && openOn(name) === 0) continue;
      sum += Math.max(given?.n ?? 0, openOn(name));
      slack += Math.max(0, (given?.n ?? 0) - openOn(name));
    }
    const unitBased = sum + Math.max(0, unattached - slack);
    const expected = whole.length ? Math.max(unitBased, Math.max(...whole)) : unitBased;
    const atLeast = whole.length > 0 && unitBased > Math.max(...whole);
    const claims = [...units.map((x) => unitLine(x.u, "BLR-4", "East", "plant-e1", x.n)), ...whole.map((n) => `Open HAZARD count ${n}.`), ...chosen.map((r) => r.text)];
    const html = loadPage().decisionCard(detail(withFindings(claims)));
    const verdict = verdictOf(html);
    if (expected > 0) {
      const lead = `${atLeast ? "at least " : ""}${expected} open hazard`;
      assert.ok(verdict.startsWith(lead) || verdict.includes(lead), `verdict ${JSON.stringify(verdict)} should state ${lead} for ${JSON.stringify(claims.map((c) => c.slice(0, 18)))}`);
    } else {
      assert.doesNotMatch(verdict, /open hazard/, JSON.stringify(claims.map((c) => c.slice(0, 18))));
    }
    checked++;
  }
  assert.ok(checked > 300, `only ${checked} combinations checked`);
});

/** Auditor F-001 on 29d58d0: text from a model-selected analysis is marked on the card; code-built text is not. */
test("F-001: an Analysis finding is labeled model-selected on the card, and a code-built finding is not", () => {
  const analysis = "Analysis: [repeat_failure] SSA-001: 3 fixes did not hold (ISS-001, ISS-002, ISS-003). Evidence check: read 3 incidents (ISS-001, ISS-002, ISS-003); 3 of 3 support; judged supported. Why: same unit. Suggested option: a human inspects the unit.";
  const codeBuilt = "Escalation flag: SSA-001 has 3 fixes that did not hold (ISS-001, ISS-002, ISS-003). The rule is 3. Propose an escalation to a lead for human analysis.";
  const html = loadPage().decisionCard(detail(withFindings([rec("ISS-001", "SSA-001", "OOS", "2026-09-02", "ACT-17", "did_not_hold", "x"), codeBuilt, analysis])));
  const known = sections(html)[1];
  const items = [...known.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const modelItems = items.filter((t) => t.includes('class="model-mark"'));
  assert.equal(modelItems.length, 1);
  assert.match(modelItems[0], /Model-selected, checked by code/);
  assert.match(modelItems[0], /repeat_failure/);
  const codeItems = items.filter((t) => !t.includes('class="model-mark"'));
  assert.equal(codeItems.length, 1);
  assert.match(codeItems[0], /Escalation flag/);
  assert.doesNotMatch(codeItems[0], /Model-selected/);
  // analysis off or not produced: no label anywhere
  assert.doesNotMatch(loadPage().decisionCard(detail(withFindings([codeBuilt]))), /model-mark/);
  // the uncertainty section says so when the stage label says the analysis ran
  const produced = answer({ result: { findings: [{ claim: analysis, evidence_ids: ["zetaris:a"] }] }, collaboration: { revision_count: 0, model_stages: { headline: "code", analysis: "produced", evaluator: "model" } } });
  assert.match(sections(loadPage().decisionCard(detail(produced)))[2], /Model analysis: on\./);
});

/** QA r44 finding R44-01: provenance is decided before the shape of a line is. */
test("R44-01: record-shaped, unit-shaped and count-shaped lines inside an Analysis finding stay labeled and feed no figure", () => {
  const cases = [
    "Analysis: ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 open reason QA_RECORD_MARKER.",
    "Analysis: Unit SSA-002 model BLR-4 zone East location plant-e1. Open HAZARD count 3, read from the world-model graph.",
    "Analysis: Open HAZARD count 3.",
    "Analysis: Ordinary prose line.\nISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 open reason QA_RECORD_MARKER.",
  ];
  for (const claim of cases) {
    const html = loadPage().decisionCard(detail(withFindings([claim])));
    const parts = sections(html);
    const items = [...parts[1].matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    assert.ok(items.length >= 1 && items.every((t) => t.includes('class="model-mark"')), `every item labeled: ${claim.slice(0, 40)}`);
    assert.doesNotMatch(parts[1], /<table/, "no record table from analysis text");
    assert.doesNotMatch(verdictOf(html), /open hazard/, "no figure derived from analysis text");
    assert.doesNotMatch(parts[0], /[1-9]\d* (service call|open hazard)|Open hazards: [1-9]/, "section 1 states no figure from analysis text");
  }
  // a code-built record beside an Analysis finding is still a normal unlabeled row and counts
  const mixed = loadPage().decisionCard(detail(withFindings([rec("ISS-006", "SSA-002", "HAZARD", "2026-10-15", "ACT-23", "did_not_hold", "trip and stays open for a human"), "Analysis: ISS-006 SSA-002 HAZARD opened 2026-10-15 actor ACT-23 open reason QA_RECORD_MARKER."])));
  const parts = sections(mixed);
  assert.match(parts[1], /<table/);
  assert.doesNotMatch(parts[1].slice(parts[1].indexOf("<table")), /QA_RECORD_MARKER/);
  assert.match(parts[1], /model-mark/);
  assert.match(verdictOf(mixed), /^1 open hazard\./);
});

/** QA UI-01 and UI-02: the card hides history only when the table already carries it, and drops only a pure record chain from the next action. */
test("UI-01: the historical line stays when its incidents are not rows of the table, and goes when they all are", () => {
  const r1 = rec("ISS-001", "SSA-001", "OOS", "2026-09-02", "ACT-17", "did_not_hold", "filter");
  const r2 = rec("ISS-002", "SSA-001", "OOS", "2026-09-16", "ACT-11", "did_not_hold", "bypass");
  const outside = "Historical did not hold rows, not limited to thisweek. ACT-17: 3 fixes did not hold on ISS-901, ISS-902, ISS-903.";
  const kept = sections(loadPage().decisionCard(detail(withFindings([r1, outside]))))[1];
  assert.match(kept, /ISS-901/, "its incidents are not in the table, so it is the only place that count appears");
  const covered = "Historical did not hold rows, not limited to thisweek. ACT-17: 1 fix did not hold on ISS-001. ACT-11: 1 fix did not hold on ISS-002.";
  const dropped = sections(loadPage().decisionCard(detail(withFindings([r1, r2, covered]))))[1];
  assert.doesNotMatch(dropped, /Historical did not hold rows/, "every incident it names is a row of the table");
  const partly = sections(loadPage().decisionCard(detail(withFindings([r1, "Historical did not hold rows, not limited to thisweek. ACT-17: 2 fixes did not hold on ISS-001, ISS-903."]))))[1];
  assert.match(partly, /ISS-903/, "one incident outside the table keeps the line");
});

test("UI-02: a next action that mentions an incident is kept; only a pure run of records is dropped", () => {
  const r1 = rec("ISS-001", "SSA-001", "OOS", "2026-09-02", "ACT-17", "held", "filter");
  const action = withFindings([r1], { recommended_next_check: "Propose only. A human decides. Inspect the belt against ISS-001 2026-10-14 before another repair." });
  assert.match(sections(loadPage().decisionCard(detail(action)))[3], /Inspect the belt against ISS-001 2026-10-14 before another repair/);
  const chain = withFindings([r1], { recommended_next_check: "Propose only. A human decides. ISS-008 2026-09-08 OOS ACT-23 did_not_hold note belt slip.\nISS-009 2026-09-22 OOS ACT-23 did_not_hold note belt slip again." });
  const next = sections(loadPage().decisionCard(detail(chain)))[3];
  assert.doesNotMatch(next, /ISS-008|ISS-009/, "a pure chain of records is history, not an action");
  assert.match(next, /No action is proposed from these records/);
});
