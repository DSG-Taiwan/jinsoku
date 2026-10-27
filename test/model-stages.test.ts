import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, test } from "node:test";
import { resetRateLimit } from "../src/ingest.ts";
import { resetModelClientForTests, setModelClientForTests } from "../src/llm/client.ts";
import { runRequest } from "../src/orchestrator.ts";
import { badClaim, goodClaim, type ModelPayload } from "./structured-helpers.ts";

/** ICR-1: collaboration.model_stages states what each model stage actually did, so a screen can say so truthfully. */

afterEach(() => {
  delete process.env.MODEL_ANALYSIS;
  delete process.env.FAULT_INJECT;
  delete process.env.FAULT_PERSIST;
  resetModelClientForTests();
});

type Evaluator = "approve" | "reject" | "reject-once" | "down";
interface Script {
  headline?: string | number;
  analyst?: "good" | "bad" | "empty" | number;
  /** HTTP 200 with {"claims":[]} for every "Revise the analysis" call. */
  reviseEmpty?: boolean;
  /** HTTP status returned for every "Revise the analysis" call; the first Analyst call still follows `analyst`. */
  revise?: number;
  evaluator?: Evaluator;
}

function stub(script: Script) {
  const calls = { model: 0 };
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: async (_url, init) => {
      calls.model += 1;
      const body = JSON.parse(String((init as RequestInit).body)) as { messages: { content: string }[] };
      const text = body.messages.map((message) => message.content).join("\n");
      const user = JSON.parse(body.messages.at(-1)?.content ?? "{}") as ModelPayload;
      const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
      if (/Revise the analysis|You are the Analyst/.test(text)) {
        if (script.reviseEmpty && /Revise the analysis/.test(text)) return reply({ claims: [] });
        if (typeof script.revise === "number" && /Revise the analysis/.test(text)) return new Response("", { status: script.revise });
        if (script.analyst === "empty") return reply({ claims: [] });
        if (typeof script.analyst === "number") return new Response("", { status: script.analyst });
        return reply({ claims: [script.analyst === "bad" ? badClaim(user) : goodClaim(user)] });
      }
      if (/You are the Evaluator/.test(text)) {
        if (script.evaluator === "down") return new Response("unavailable", { status: 503 });
        if (script.evaluator === "reject") return reply({ approve: false, requires_revision: true, issues: ["goes beyond the cited rows"], missing_evidence: [], confidence: 0.4 });
        if (script.evaluator === "reject-once" && !rejectedOnce.value) {
          rejectedOnce.value = true;
          return reply({ approve: false, requires_revision: true, issues: ["goes beyond the cited rows"], missing_evidence: [], confidence: 0.4 });
        }
        return reply({ approve: true, requires_revision: false, issues: [], missing_evidence: [], confidence: 0.8 });
      }
      if (typeof script.headline === "number") return new Response("", { status: script.headline });
      return reply({ headline: script.headline ?? "CAUSE SSA-004 cited rows, human decides" });
    },
  });
  return calls;
}
const rejectedOnce = { value: false };

async function run(query = "CAUSE SSA-004", role: "lead" | "tech" = "lead") {
  resetRateLimit();
  rejectedOnce.value = false;
  return runRequest({ request_id: `stages-${randomUUID()}`, user_query: query, context: { role } });
}

test("analysis OFF: the stages say off, the headline is built by code, the model Evaluator was consulted", async () => {
  delete process.env.MODEL_ANALYSIS;
  stub({});
  const out = await run();
  const stages = out.collaboration.model_stages;
  assert.ok(stages, "model_stages is present: " + out.status + " " + JSON.stringify(out.collaboration));
  assert.equal(stages.analysis, "off");
  assert.equal(stages.headline, "code", "the headline is always built by code from the call");
  assert.equal(stages.evaluator, "model", "a code-built core is not an assembled draft, so the model Evaluator is consulted");
  assert.equal(stages.revisions, 0);
  assert.equal(stages.synthetic_fault, "none");
});

test("analysis produced with an approving Evaluator: produced, model Evaluator, zero revisions", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ analyst: "good", evaluator: "approve" });
  const stages = (await run()).collaboration.model_stages;
  assert.ok(stages);
  assert.equal(stages.analysis, "produced");
  assert.equal(stages.evaluator, "model");
  assert.equal(stages.revisions, 0);
});

test("analysis repaired by one real revision: produced, one revision", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ analyst: "good", evaluator: "reject-once" });
  const out = await run();
  const stages = out.collaboration.model_stages;
  assert.ok(stages);
  assert.equal(stages.analysis, "produced");
  assert.equal(stages.revisions, 1);
  assert.equal(stages.revisions, out.collaboration.revision_count);
});

test("analysis that stays bad after two revisions: withheld", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ analyst: "bad", evaluator: "approve" });
  const out = await run();
  const stages = out.collaboration.model_stages;
  assert.ok(stages);
  assert.equal(stages.analysis, "withheld");
  assert.equal(stages.revisions, 2);
});

test("Evaluator unavailable: deterministic Evaluator and withheld analysis", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ analyst: "good", evaluator: "down" });
  const stages = (await run()).collaboration.model_stages;
  assert.ok(stages);
  assert.equal(stages.evaluator, "deterministic");
  assert.equal(stages.analysis, "withheld");
});

test("a headline the guard rejects is reported as code-built", async () => {
  delete process.env.MODEL_ANALYSIS;
  stub({ headline: "Three open HAZARDs need resolution" });
  const out = await run();
  assert.equal(out.collaboration.model_stages?.headline, "code");
  assert.equal(/hazard/i.test(out.result.headline ?? ""), false);
});

test("headline model call failing is reported as code-built", async () => {
  delete process.env.MODEL_ANALYSIS;
  stub({ headline: 500 });
  const stages = (await run()).collaboration.model_stages;
  assert.equal(stages?.headline, "code");
});

test("analysis call failing is reported as skipped", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ analyst: 500, evaluator: "approve" });
  const stages = (await run()).collaboration.model_stages;
  assert.equal(stages?.analysis, "skipped");
});

test("an injected synthetic fault is named in the stages and nowhere else it is not", async () => {
  process.env.MODEL_ANALYSIS = "on";
  process.env.FAULT_INJECT = "invented_asset";
  stub({ analyst: "good", evaluator: "approve" });
  const faulted = (await run()).collaboration.model_stages;
  assert.equal(faulted?.synthetic_fault, "invented_asset");
  delete process.env.FAULT_INJECT;
  stub({ analyst: "good", evaluator: "approve" });
  assert.equal((await run()).collaboration.model_stages?.synthetic_fault, "none");
});

/** R11-01: a configured scenario is reported only when it was injected. */
test("a fault configured for NEXT, where the analysis does not run, is reported as none", async () => {
  process.env.MODEL_ANALYSIS = "on";
  process.env.FAULT_INJECT = "invented_asset";
  stub({ analyst: "good", evaluator: "approve" });
  const out = await run("NEXT SSA-002");
  assert.equal(out.collaboration.model_stages?.analysis, "n/a");
  assert.equal(out.collaboration.model_stages?.synthetic_fault, "none");
});

test("a fault configured while the Analyst is down is reported as none", async () => {
  process.env.MODEL_ANALYSIS = "on";
  process.env.FAULT_INJECT = "invented_asset";
  stub({ analyst: 503, evaluator: "approve" });
  const stages = (await run()).collaboration.model_stages;
  assert.equal(stages?.analysis, "skipped");
  assert.equal(stages?.synthetic_fault, "none");
});

test("a fault that was injected is still reported after the analysis is later withheld", async () => {
  process.env.MODEL_ANALYSIS = "on";
  process.env.FAULT_INJECT = "invented_asset";
  process.env.FAULT_PERSIST = "on";
  stub({ analyst: "good", evaluator: "approve" });
  const stages = (await run()).collaboration.model_stages;
  assert.equal(stages?.analysis, "withheld");
  assert.equal(stages?.synthetic_fault, "invented_asset");
});

/** R11-02: produced means checked analysis is in the released answer. */
test("analysis dropped when every revision call fails is reported as dropped, with a note", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ analyst: "bad", revise: 503, evaluator: "approve" });
  const out = await run();
  const stages = out.collaboration.model_stages;
  assert.equal(stages?.analysis, "dropped");
  assert.equal(stages?.revisions, 1);
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith("Analysis:")), false, "no analysis finding in the answer");
  assert.match(String(out.collaboration.note), /analysis dropped/i);
});

test("a valid but empty Analyst response is reported as empty, not produced", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ analyst: "empty", evaluator: "approve" });
  const out = await run();
  const stages = out.collaboration.model_stages;
  assert.equal(stages?.analysis, "empty");
  assert.match(String(out.collaboration.note), /analysis empty/i);
});

test("produced is reported only when an analysis finding is in the answer", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ analyst: "good", evaluator: "reject-once" });
  const out = await run();
  assert.equal(out.collaboration.model_stages?.analysis, "produced");
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith("Analysis:")), true);
});

/** R13-01: when the answer is rebuilt from records, the stages describe the records-only answer, not the discarded draft. */
test("a records-only rebuild with the analysis off reports analysis off, not produced", async () => {
  delete process.env.MODEL_ANALYSIS;
  stub({ headline: "Bearer abc shows the belt", evaluator: "approve" });
  const out = await run();
  const stages = out.collaboration.model_stages;
  assert.equal(stages?.analysis, "off");
  assert.equal(stages?.headline, "code");
});

/** R14-01. */
test("a revision that succeeds with no claims is reported as empty, not as a failed revision", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ analyst: "bad", reviseEmpty: true, evaluator: "approve" });
  const out = await run();
  const stages = out.collaboration.model_stages;
  assert.equal(stages?.analysis, "empty");
  assert.equal(stages?.revisions, 1);
  assert.doesNotMatch(String(out.collaboration.note), /revision failed/i);
  assert.match(String(out.collaboration.note), /no claims/i);
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith("Analysis:")), false);
});

test("nothing released after a secret-shaped retrieved row: no findings, and the code-written stages say code (unresolved path; control, not the R14-01c terminal-error path)", async () => {
  process.env.MODEL_ANALYSIS = "on";
  stub({ headline: "CAUSE SSA-001 cited rows, human decides", analyst: "good", evaluator: "approve" });
  const realFetch = globalThis.fetch;
  let poisoned = false;
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const response = await realFetch(input, init);
    if (!String(input).includes("/sql-editor/sqls/run")) return response;
    const text = await response.text();
    const changed = text.replace(/reset only/, "reset only sk-test");
    poisoned ||= changed !== text;
    return new Response(changed, { status: response.status, headers: response.headers });
  }) as typeof fetch;
  try {
    const out = await run("CAUSE SSA-001");
    assert.ok(poisoned, "the retrieval result was altered in memory");
    assert.ok(out.status === "error" || out.status === "unresolved", `nothing is released: ${out.status}`);
    assert.equal(out.result.findings.length, 0);
    assert.equal(out.collaboration.model_stages?.headline, "code");
    assert.equal(out.collaboration.model_stages?.analysis, "withheld");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a draft assembled from records after every Executor call failed gets no model-written analysis", async () => {
  process.env.MODEL_ANALYSIS = "on";
  process.env.CAUSE_DRAFT = "model";
  const calls = { analyst: 0, evaluator: 0 };
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { messages: { content: string }[] };
      const text = body.messages.map((message) => message.content).join(" ");
      const user = JSON.parse(body.messages.at(-1)?.content ?? "{}") as { allowed_evidence_ids?: string[] };
      const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
      if (/You are the Analyst/.test(text)) {
        calls.analyst += 1;
        return reply({ claims: [{ claim: "The same belt repair recurred under different actors, so the repair itself may be the issue.", evidence_ids: (user.allowed_evidence_ids ?? []).slice(0, 1) }] });
      }
      if (/You are the Evaluator/.test(text)) {
        calls.evaluator += 1;
        return reply({ approve: true, requires_revision: false, issues: [], missing_evidence: [], confidence: 0.8 });
      }
      return new Response("unavailable", { status: 503 });
    },
  });
  resetRateLimit();
  const out = await runRequest({ request_id: `stages-${randomUUID()}`, user_query: "CAUSE SSA-001", context: { role: "lead" } });
  delete process.env.CAUSE_DRAFT;
  assert.equal(out.result.headline?.includes("assembled from records"), true, "the draft was assembled from records");
  assert.equal(out.result.findings.some((finding) => finding.claim.startsWith("Analysis:")), false, "no model-written analysis on a records-only draft");
  assert.equal(out.collaboration.model_stages?.analysis, "skipped");
  assert.equal(calls.analyst, 0, "the Analyst is not called on a records-only draft");
});

for (const withProse of [false, true]) {
  test(`CAUSE_DRAFT=model: model-written headline and next check are replaced, ${withProse ? "a prose finding withholds the draft" : "a code-built finding is kept"} (audit F-001 and F-002)`, async () => {
    process.env.CAUSE_DRAFT = "model";
    setModelClientForTests({
      minSpacingMs: 0,
      random: () => 0,
      sleep: async () => {},
      transport: async (_url, init) => {
        const body = JSON.parse(String((init as RequestInit).body)) as { messages: { content: string }[] };
        const text = body.messages.map((message) => message.content).join(" ");
        const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
        if (/You are the Evaluator/.test(text)) return reply({ approve: true, requires_revision: false, issues: [], missing_evidence: [], confidence: 0.8 });
        const ids = [...new Set(text.match(/(?:zetaris|hmem|worldmodel):[A-Za-z0-9:_-]+/g) ?? [])].slice(0, 12);
        const findings = [{ claim: "zetaris record was read.", evidence_ids: ids }];
        if (withProse) findings.push({ claim: "it may be the wiring fault, ask jane doe", evidence_ids: ids });
        return reply({ headline: "It was the wiring, ask jane doe", findings, recommended_next_check: "Replace the wiring and ask jane doe", needs_human_decision: true, not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 });
      },
    });
    resetRateLimit();
    try {
      const out = await runRequest({ request_id: `model-draft-${randomUUID()}`, user_query: "CAUSE SSA-004", context: { role: "lead" } });
      assert.equal(/wiring|jane doe/i.test(JSON.stringify(out.result)), false, "no model-written text is released");
      if (withProse) {
        assert.equal(out.status, "unresolved");
        assert.deepEqual(out.result.findings, []);
      } else {
        assert.equal(out.status, "ok", "the draft reached release");
        assert.equal(out.result.headline, "CAUSE SSA-004: cited rows, human decides");
        assert.equal(out.collaboration.model_stages?.headline, "code");
      }
    } finally {
      delete process.env.CAUSE_DRAFT;
    }
  });
}

test("a revised model draft gets the code-built headline and next check too (QA r31-01)", async () => {
  process.env.CAUSE_DRAFT = "model";
  let executorCalls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { messages: { content: string }[] };
      const text = body.messages.map((message) => message.content).join(" ");
      const reply = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
      if (/You are the Evaluator/.test(text)) return reply({ approve: true, requires_revision: false, issues: [], missing_evidence: [], confidence: 0.8 });
      executorCalls += 1;
      const ids = [...new Set(text.match(/(?:zetaris|hmem|worldmodel):[A-Za-z0-9:_-]+/g) ?? [])].slice(0, 12);
      // the first draft carries an unsupported finding (forces a revision); the revision is clean except for its headline and next check
      const findings = [{ claim: executorCalls === 1 ? "it may be the wiring fault" : "zetaris record was read.", evidence_ids: ids }];
      return reply({ headline: "it was the wiring ask jane doe", findings, recommended_next_check: "ask jane doe to replace the wiring", needs_human_decision: true, not_checked: ["Anything not in the retrieved sources"], confidence: 0.5 });
    },
  });
  resetRateLimit();
  try {
    const out = await runRequest({ request_id: `model-revise-${randomUUID()}`, user_query: "CAUSE SSA-004", context: { role: "lead" } });
    assert.ok(executorCalls >= 2, "the draft was revised");
    assert.equal(/wiring|jane doe/i.test(JSON.stringify(out.result)), false, "no model-written text is released after a revision");
    assert.equal(out.status, "ok");
    assert.equal(out.result.headline, "CAUSE SSA-004: cited rows, human decides");
    assert.equal(out.collaboration.model_stages?.headline, "code");
  } finally {
    delete process.env.CAUSE_DRAFT;
  }
});

test("a refusal reports every stage as n/a and makes zero model calls", async () => {
  process.env.MODEL_ANALYSIS = "on";
  const calls = stub({ analyst: "good", evaluator: "approve" });
  const out = await run("CAUSE SSA-004", "tech");
  assert.equal(out.status, "DENIED");
  assert.equal(calls.model, 0);
  assert.deepEqual(out.collaboration.model_stages, { headline: "n/a", analysis: "n/a", evaluator: "n/a", revisions: 0, synthetic_fault: "none" });
});

test("the response differs from before only by the new field: existing collaboration keys are unchanged", async () => {
  delete process.env.MODEL_ANALYSIS;
  stub({});
  const out = await run();
  const keys = Object.keys(out.collaboration).sort();
  assert.deepEqual(keys, ["evaluator_findings", "fallback_rate", "feedback_loop_completed", "model_stages", "note", "revision_count"]);
  assert.equal(typeof out.collaboration.revision_count, "number");
  assert.equal(typeof out.collaboration.note, "string");
});
