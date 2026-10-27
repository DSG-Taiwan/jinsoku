import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import { PROJECT_ROOT } from "../src/config.ts";

/**
 * ICR-2: the board must show model-written text, withheld analysis, degraded model stages and synthetic faults as what they are.
 * The real public/board.js runs against stub page elements; we read what it writes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const noop: Any = new Proxy(function () {}, { get: (_t, p) => (p === Symbol.toPrimitive ? () => "" : noop), apply: () => noop });

function loadBoard(): { board: Any; el: (selector: string) => Any } {
  const els = new Map<string, Any>();
  const makeEl = (): Any =>
    new Proxy({ innerHTML: "", textContent: "", hidden: false, dataset: {}, value: "" } as Any, {
      get: (t, p) => (p in t ? t[p as string] : noop),
      set: (t, p, v) => {
        t[p as string] = v;
        return true;
      },
    });
  const el = (selector: string): Any => {
    if (!els.has(selector)) els.set(selector, makeEl());
    return els.get(selector);
  };
  const sandbox: Any = {
    document: { querySelector: el, body: { dataset: {} }, createElement: makeEl },
    window: { addEventListener() {} },
    location: { hash: "" },
    history: { replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async () => {
      throw new Error("offline");
    },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    clearTimeout() {},
    console,
    Date,
    URL,
    encodeURIComponent,
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(PROJECT_ROOT, "public", "board.js"), "utf8");
  vm.runInContext(source, sandbox, { filename: "board.js" });
  return { board: sandbox, el };
}

const STAGES_OK = { headline: "model", analysis: "produced", evaluator: "model", revisions: 0, synthetic_fault: "none" };

function detail(findings: { claim: string; evidence_ids: string[] }[], collaboration: Record<string, unknown>, extra: Record<string, unknown> = {}): Any {
  return {
    status: "ok",
    events: [],
    result: {
      status: "ok",
      trace_id: "t-1",
      result: {
        summary: "CAUSE SSA-004: cited rows, human decides",
        headline: "CAUSE SSA-004: cited rows, human decides",
        findings,
        confidence: 0.4,
        recommended_next_check: "A human inspects the unit. Agents propose only.",
        not_checked: [],
        fallback_used: false,
        fallback_reason: null,
        ...extra,
      },
      collaboration: { feedback_loop_completed: true, revision_count: 0, evaluator_findings: [], note: "Evaluator approved first draft.", ...collaboration },
    },
  };
}

const CORE = { claim: "Memory notes ISS-010 and ISS-011 on SSA-004.", evidence_ids: ["hmem:m"] };
const ANALYSIS = { claim: "Analysis: The same belt fix did not hold under two actors, so the fix itself may be the issue.", evidence_ids: ["zetaris:q"] };

function answerFor(d: Any): string {
  const { board, el } = loadBoard();
  board.renderAnswer(d);
  return String(el("#answer").innerHTML);
}

test("L1: a model-written Analysis claim is labeled Model-written, with the prefix removed and its citation kept", () => {
  const html = answerFor(detail([CORE, ANALYSIS], { model_stages: STAGES_OK }));
  assert.equal((html.match(/Model-written/g) ?? []).length >= 1, true);
  assert.equal(html.includes("Analysis: The same belt fix"), false, "the raw prefix is not shown as ordinary prose");
  assert.ok(html.includes("The same belt fix did not hold under two actors"));
  assert.ok(html.includes("zetaris:q"), "the citation is still shown");
});

test("L1: a code-built finding is never labeled Model-written", () => {
  const html = answerFor(detail([CORE], { model_stages: { ...STAGES_OK, analysis: "off" } }));
  assert.equal(html.includes('class="model-mark"'), false);
  assert.ok(html.includes("Memory notes ISS-010"));
});

test("L2: a withheld analysis shows the engine's note and the withheld stage", () => {
  const note = "Analysis withheld: the model Evaluator was unavailable. Evidence core released.";
  const html = answerFor(detail([CORE], { note, model_stages: { headline: "code", analysis: "withheld", evaluator: "deterministic", revisions: 0, synthetic_fault: "none" } }));
  assert.ok(html.includes(note));
  assert.match(html, /Analysis:\s*withheld/i);
});

test("R11-02: dropped and empty analysis are shown as such, never as model-written, checked", () => {
  for (const [analysis, words] of [["dropped", /dropped after a failed revision/i], ["empty", /model returned no claims/i]] as const) {
    const html = answerFor(detail([CORE], { model_stages: { headline: "model", analysis, evaluator: "model", revisions: 1, synthetic_fault: "none" } }));
    assert.match(html, words);
    assert.equal(/model-written, checked/i.test(html), false);
  }
});

test("L3: degraded model stages are stated next to the answer, not only in the timeline", () => {
  const html = answerFor(detail([CORE], { note: "Model Evaluator unavailable; the deterministic check was applied.", model_stages: { headline: "code", analysis: "off", evaluator: "deterministic", revisions: 0, synthetic_fault: "none" } }));
  assert.match(html, /Headline:\s*built from the records/i);
  assert.match(html, /Evaluator:\s*rule check only/i);
});

test("a healthy run says the model stages were used", () => {
  const html = answerFor(detail([CORE, ANALYSIS], { model_stages: STAGES_OK }));
  assert.match(html, /Headline:\s*model-written/i);
  assert.match(html, /Analysis:\s*model-written, checked/i);
  assert.match(html, /Evaluator:\s*model/i);
});

test("a response without model_stages says so instead of implying all is well", () => {
  const html = answerFor(detail([CORE], {}));
  assert.match(html, /Model stages:\s*not reported/i);
});

test("a refusal's n/a stages read as not run", () => {
  const html = answerFor(detail([CORE], { model_stages: { headline: "n/a", analysis: "n/a", evaluator: "n/a", revisions: 0, synthetic_fault: "none" } }));
  assert.match(html, /Evaluator:\s*not run/i);
});

test("an injected synthetic fault named by the engine is shown as synthetic", () => {
  const html = answerFor(detail([CORE, ANALYSIS], { model_stages: { ...STAGES_OK, revisions: 1, synthetic_fault: "invented_asset" } }));
  assert.match(html, /Synthetic fault:\s*invented_asset/i);
});

test("markup in a model-written claim, the note and the stage values is escaped, never inserted as a tag", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const html = answerFor(
    detail([CORE, { claim: `Analysis: ${evil} may be the issue.`, evidence_ids: ["zetaris:q"] }], {
      note: evil,
      model_stages: { headline: evil, analysis: evil, evaluator: evil, revisions: 0, synthetic_fault: evil },
    }),
  );
  assert.equal(html.includes("<img"), false);
  assert.ok(html.includes("&lt;img"));
});

test("L4: a fault-injected event is a Synthetic card, not a Released card", () => {
  const { board, el } = loadBoard();
  board.renderEvents(
    [
      { timestamp: "2026-10-24T20:00:00.000Z", agent_name: "executor", action: "fault-injected", input_summary: "synthetic fault: invented_asset", output_summary: "first output only", status: "ok" },
      { timestamp: "2026-10-24T20:00:01.000Z", agent_name: "executor", action: "draft", input_summary: "x", output_summary: "findings=5", status: "ok" },
    ],
    false,
  );
  const html = String(el('[data-events="executor"]').innerHTML);
  const faultCard = html.split("</li>").find((card) => card.includes("fault")) ?? "";
  assert.match(faultCard, /class="chip synthetic"/);
  assert.match(faultCard, /Injected test fault/);
  assert.equal(/Released/.test(faultCard), false);
  const draftCard = html.split("</li>").find((card) => card.includes("Draft")) ?? "";
  assert.match(draftCard, /Released/, "ordinary events keep their wording");
});

test("existing behavior is unchanged: fallback chip, rewrite count and citations still render", () => {
  const html = answerFor(detail([CORE], { revision_count: 2, model_stages: STAGES_OK }, { fallback_used: true, fallback_reason: "rejected" }));
  assert.ok(html.includes("Fallback used"));
  assert.ok(html.includes("2 rewrites"));
  assert.ok(html.includes("hmem:m"));
});

// Core behavior stays exactly as audited: the hazard marker reads the ORIGINAL claim text. A model-written label never changes it.
test("core: the hazard marker reads the original claim, so a model-written label cannot hide or add a hazard mark", () => {
  const plain = { claim: "Open HAZARD count stays one on this unit.", evidence_ids: ["worldmodel:u"] };
  const prefixed = { claim: `Analysis: ${plain.claim}`, evidence_ids: ["zetaris:q"] };
  const plainHtml = answerFor(detail([plain], { model_stages: STAGES_OK }));
  assert.equal(plainHtml.includes('class="hazard-mark"'), false, "audited behavior: a count-only line is not a hazard mark");
  const prefixedHtml = answerFor(detail([prefixed], { model_stages: STAGES_OK }));
  assert.equal(prefixedHtml.includes('class="hazard-mark"'), true, "audited behavior: the same words behind the Analysis prefix are read as written, so the mark shows");
  assert.equal(prefixedHtml.includes("Model-written"), true, "the label still shows");
  assert.equal(prefixedHtml.includes("Analysis: Open HAZARD"), false, "the raw prefix is still not displayed");
});
