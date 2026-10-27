import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Deadline, RequestDeadlineError } from "../src/deadline.ts";
import {
  completeJson,
  resetModelClientForTests,
  setModelClientForTests,
  setModelSelection,
  setEvaluatorKeyForTests,
  setPlannerKeyForTests,
  setReceiptLogger,
  type ChatMessage,
} from "../src/llm/client.ts";

const messages: ChatMessage[] = [{ role: "user", content: "hi" }];

function choice(content: string): string {
  return JSON.stringify({ choices: [{ message: { content } }] });
}

function response(body: string, status = 200, headers?: Record<string, string>): Response {
  return new Response(body, { status, headers });
}

afterEach(() => {
  resetModelClientForTests();
});

test("a forced 429 retries after Retry-After", async () => {
  const attempts: string[] = [];
  const waits: number[] = [];
  let calls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    sleep: async (ms) => {
      waits.push(ms);
    },
    transport: async () => {
      calls += 1;
      if (calls === 1) return response("", 429, { "Retry-After": "2" });
      return response(choice('{"ok":true}'));
    },
  });
  const text = await completeJson(messages, {
    timeoutMs: 20_000,
    onAttempt: (message) => attempts.push(message),
  });
  assert.match(text, /"ok":true/);
  assert.equal(calls, 2);
  // the wait is Retry-After minus the time already spent, so it can be a millisecond or two short of 2000
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 1900 && waits[0] <= 2000, `wait ${waits[0]}`);
  assert.match(attempts[0], /^attempt 1 http-429 status 429 wait (19\d\d|2000)ms$/);
  assert.equal(attempts[1], "attempt 2 ok status 200");
});

test("a forced 5xx retries with exponential backoff", async () => {
  const waits: number[] = [];
  let calls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
    },
    transport: async () => {
      calls += 1;
      if (calls === 1) return response("busy", 500);
      return response(choice('{"ok":true}'));
    },
  });
  const text = await completeJson(messages, { timeoutMs: 20_000 });
  assert.match(text, /"ok":true/);
  assert.equal(calls, 2);
  assert.equal(waits.length, 1);
  assert.ok(waits[0] >= 400 && waits[0] <= 500, `wait ${waits[0]}`);
});

test("a 200 with an empty completion is retried", async () => {
  let calls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: async () => {
      calls += 1;
      if (calls === 1) return response(choice(""));
      return response(choice('{"ok":true}'));
    },
  });
  const text = await completeJson(messages, { timeoutMs: 20_000 });
  assert.match(text, /"ok":true/);
  assert.equal(calls, 2);
});

test("a 200 carrying an error object is retried", async () => {
  const attempts: string[] = [];
  let calls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: async () => {
      calls += 1;
      if (calls === 1) return response(JSON.stringify({ error: { message: "overloaded" } }));
      return response(choice('{"ok":true}'));
    },
  });
  const text = await completeJson(messages, {
    timeoutMs: 20_000,
    onAttempt: (message) => attempts.push(message),
  });
  assert.match(text, /"ok":true/);
  assert.equal(calls, 2);
  assert.match(attempts[0], /error-object/);
});

test("truncated JSON on a 200 is retried", async () => {
  let calls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: async () => {
      calls += 1;
      if (calls === 1) return response('{"choices":');
      return response(choice('{"ok":true}'));
    },
  });
  const text = await completeJson(messages, { timeoutMs: 20_000 });
  assert.match(text, /"ok":true/);
  assert.equal(calls, 2);
});

test("sequential calls do not take a fixed gap", async () => {
  const waits: number[] = [];
  setModelClientForTests({
    minSpacingMs: 5_000,
    sleep: async (ms) => {
      waits.push(ms);
    },
    transport: async () => response(choice('{"ok":true}')),
  });
  await completeJson(messages, { timeoutMs: 20_000 });
  await completeJson(messages, { timeoutMs: 20_000 });
  assert.deepEqual(waits, []);
});

test("a slow call is cut by the wall-clock ceiling", async () => {
  const deadline = Deadline.start(3_200);
  setModelClientForTests({
    minSpacingMs: 0,
    transport: (_url, init) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (init?.signal?.aborted) abort();
        init?.signal?.addEventListener("abort", abort, { once: true });
      }),
  });
  await assert.rejects(
    () =>
      completeJson(messages, {
        timeoutMs: 30_000,
        attemptMs: 30_000,
        signal: deadline.signal,
      }),
    RequestDeadlineError,
  );
  assert.equal(deadline.over(), true);
});

test("nightshift posts the mode and strips a reasoning block", async () => {
  const prevUrl = process.env.NIGHTSHIFT_BASE_URL;
  const prevToken = process.env.NIGHTSHIFT_TOKEN;
  process.env.NIGHTSHIFT_BASE_URL = "http://127.0.0.1:8088/v1";
  process.env.NIGHTSHIFT_TOKEN = "test-token";
  setModelSelection({ route: "nightshift", model: "meterless/fast" });
  const receipts: Array<{ receipt_id: string | null; routed_model: string | null }> = [];
  setReceiptLogger((receipt) => receipts.push(receipt));
  let seenModel = "";
  let seenUrl = "";
  try {
    setModelClientForTests({
      minSpacingMs: 0,
      transport: async (url, init) => {
        seenUrl = String(url);
        seenModel = JSON.parse(String(init?.body)).model;
        return response(
          JSON.stringify({
            choices: [{ message: { content: "planning\n</think>\n{\"ok\":true}" } }],
            meterless: {
              receipt_id: "rcpt_test",
              routed_model: "nvidia/nemotron-3.5-lightning-30b-a3b",
              winning_route: { provider: "nvidia" },
            },
          }),
        );
      },
    });
    const text = await completeJson(messages, { timeoutMs: 5_000 });
    assert.equal(text.includes("</think>"), false);
    assert.match(text, /"ok":true/);
    assert.equal(seenModel, "meterless/fast");
    assert.match(seenUrl, /127\.0\.0\.1:8088/);
    assert.equal(receipts[0]?.receipt_id, "rcpt_test");
    assert.equal(receipts[0]?.routed_model, "nvidia/nemotron-3.5-lightning-30b-a3b");
  } finally {
    if (prevUrl === undefined) delete process.env.NIGHTSHIFT_BASE_URL;
    else process.env.NIGHTSHIFT_BASE_URL = prevUrl;
    if (prevToken === undefined) delete process.env.NIGHTSHIFT_TOKEN;
    else process.env.NIGHTSHIFT_TOKEN = prevToken;
    setModelSelection({ route: "direct", model: null });
    setReceiptLogger(null);
  }
});

test("a timed-out attempt is retried inside the envelope", async () => {
  let calls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async () => {},
    transport: (_url, init) =>
      new Promise((resolve, reject) => {
        calls += 1;
        if (calls > 1) {
          resolve(response(choice('{"ok":true}')));
          return;
        }
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (init?.signal?.aborted) abort();
        init?.signal?.addEventListener("abort", abort, { once: true });
      }),
  });
  const text = await completeJson(messages, { timeoutMs: 25_000, attemptMs: 1_500 });
  assert.match(text, /"ok":true/);
  assert.equal(calls, 2);
});

test("model calls stay one at a time", async () => {
  let entered = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  setModelClientForTests({
    minSpacingMs: 0,
    maxConcurrency: 1,
    transport: async () => {
      entered += 1;
      if (entered === 1) await gate;
      return response(choice('{"ok":true}'));
    },
  });
  const first = completeJson(messages, { timeoutMs: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = completeJson(messages, { timeoutMs: 20_000 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(entered, 1);
  release();
  const both = await Promise.all([first, second]);
  assert.equal(entered, 2);
  assert.match(both[0], /"ok":true/);
  assert.match(both[1], /"ok":true/);
});

test("a 429 with no Retry-After retries after a short backoff, not a fixed 12 seconds", async () => {
  const waits: number[] = [];
  let calls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
    },
    transport: async () => {
      calls += 1;
      if (calls <= 2) return response('{"status":429,"title":"Too Many Requests"}', 429);
      return response(choice('{"ok":true}'));
    },
  });
  const text = await completeJson(messages, { timeoutMs: 20_000 });
  assert.match(text, /"ok":true/);
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
  assert.ok(waits[0] >= 400 && waits[0] <= 500, `first wait ${waits[0]}`);
  assert.ok(waits[1] >= 900 && waits[1] <= 1000, `second wait ${waits[1]}`);
});

test("Evaluator calls use EVALUATOR_API_KEY and their own pacing when it is set", async () => {
  const auth: string[] = [];
  const waits: number[] = [];
  let mainCalls = 0;
  setEvaluatorKeyForTests("EV-TEST-KEY");
  setModelClientForTests({
    minSpacingMs: 0,
    random: () => 0,
    sleep: async (ms) => {
      waits.push(ms);
    },
    transport: async (_url, init) => {
      const header = (init as RequestInit).headers as Record<string, string>;
      auth.push(header.Authorization);
      if (header.Authorization !== "Bearer EV-TEST-KEY") {
        mainCalls += 1;
        if (mainCalls === 1) return response("", 429, { "Retry-After": "2" });
      }
      return response(choice('{"ok":true}'));
    },
  });
  await completeJson(messages, { timeoutMs: 20_000 });
  const before = waits.length;
  await completeJson(messages, { timeoutMs: 20_000, lane: "evaluator" });
  assert.equal(waits.length, before, "the evaluator lane must not wait on the main lane's 429 pacing");
  assert.equal(auth.filter((value) => value === "Bearer EV-TEST-KEY").length, 1);
  assert.ok(auth.filter((value) => value !== "Bearer EV-TEST-KEY").length >= 2);
});

test("with no EVALUATOR_API_KEY the evaluator lane shares the main key and pacing", async () => {
  const auth: string[] = [];
  setEvaluatorKeyForTests(null);
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async (_url, init) => {
      auth.push(((init as RequestInit).headers as Record<string, string>).Authorization);
      return response(choice('{"ok":true}'));
    },
  });
  await completeJson(messages, { timeoutMs: 20_000, lane: "evaluator" });
  await completeJson(messages, { timeoutMs: 20_000 });
  assert.equal(auth[0], auth[1]);
});

test("Planner, Evaluator and Executor calls use their own keys and their own pacing", async () => {
  const seen: Record<string, string> = {};
  setPlannerKeyForTests("PLANNER-KEY");
  setEvaluatorKeyForTests("EVALUATOR-KEY");
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async (_url, init) => {
      const key = ((init as RequestInit).headers as Record<string, string>).Authorization;
      const user = JSON.parse(String((init as RequestInit).body)) as { messages: { content: string }[] };
      seen[user.messages[0].content] = key;
      return response(choice('{"ok":true}'));
    },
  });
  await completeJson([{ role: "user", content: "planner" }], { timeoutMs: 20_000, lane: "planner" });
  await completeJson([{ role: "user", content: "evaluator" }], { timeoutMs: 20_000, lane: "evaluator" });
  await completeJson([{ role: "user", content: "executor" }], { timeoutMs: 20_000 });
  assert.equal(seen.planner, "Bearer PLANNER-KEY");
  assert.equal(seen.evaluator, "Bearer EVALUATOR-KEY");
  assert.notEqual(seen.executor, "Bearer PLANNER-KEY");
  assert.notEqual(seen.executor, "Bearer EVALUATOR-KEY");
});

test("the paid route sends to its own URL, key and model, and MODEL_ROUTE=direct rolls back to NVIDIA", async () => {
  const seen: { url: string; auth: string; model: string }[] = [];
  const saved = { base: process.env.PAID_BASE_URL, key: process.env.PAID_API_KEY, model: process.env.PAID_MODEL };
  process.env.PAID_BASE_URL = "https://paid.example/api/v1/";
  process.env.PAID_API_KEY = "PAID-TEST-KEY";
  process.env.PAID_MODEL = "vendor/paid-model";
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async (url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as { model: string };
      seen.push({ url: String(url), auth: ((init as RequestInit).headers as Record<string, string>).Authorization, model: body.model });
      return response(choice('{"ok":true}'));
    },
  });
  try {
    setModelSelection({ route: "paid", model: null });
    await completeJson(messages, { timeoutMs: 20_000 });
    setModelSelection({ route: "direct", model: null });
    await completeJson(messages, { timeoutMs: 20_000 });
  } finally {
    for (const [name, value] of [["PAID_BASE_URL", saved.base], ["PAID_API_KEY", saved.key], ["PAID_MODEL", saved.model]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.equal(seen[0].url, "https://paid.example/api/v1/chat/completions");
  assert.equal(seen[0].auth, "Bearer PAID-TEST-KEY");
  assert.equal(seen[0].model, "vendor/paid-model");
  assert.notEqual(seen[1].url, seen[0].url);
  assert.notEqual(seen[1].auth, "Bearer PAID-TEST-KEY");
  assert.notEqual(seen[1].model, "vendor/paid-model");
});

test("an unconfigured paid route fails closed and never falls back to the NVIDIA key", async () => {
  const saved = { base: process.env.PAID_BASE_URL, key: process.env.PAID_API_KEY, model: process.env.PAID_MODEL };
  delete process.env.PAID_BASE_URL;
  delete process.env.PAID_API_KEY;
  delete process.env.PAID_MODEL;
  let calls = 0;
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async () => {
      calls += 1;
      return response(choice('{"ok":true}'));
    },
  });
  try {
    setModelSelection({ route: "paid", model: null });
    await assert.rejects(() => completeJson(messages, { timeoutMs: 20_000 }), /paid route is not configured/);
  } finally {
    setModelSelection({ route: "direct", model: null });
    for (const [name, value] of [["PAID_BASE_URL", saved.base], ["PAID_API_KEY", saved.key], ["PAID_MODEL", saved.model]] as const) {
      if (value !== undefined) process.env[name] = value;
    }
  }
  assert.equal(calls, 0);
});

test("a successful attempt records token usage so spend can be computed", async () => {
  const attempts: string[] = [];
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async () =>
      response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1234, completion_tokens: 56 } })),
  });
  await completeJson(messages, { timeoutMs: 20_000, onAttempt: (message) => attempts.push(message) });
  assert.equal(attempts[0], "attempt 1 ok status 200 tokens 1234/56");
});

test("cached prompt tokens are logged when the provider reports them", async () => {
  const attempts: string[] = [];
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async () =>
      response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 1234, completion_tokens: 56, prompt_tokens_details: { cached_tokens: 800 } },
        }),
      ),
  });
  await completeJson(messages, { timeoutMs: 20_000, onAttempt: (message) => attempts.push(message) });
  assert.equal(attempts[0], "attempt 1 ok status 200 tokens 1234/56 cached 800");
});

test("the paid route turns hidden reasoning off, the direct route keeps its own thinking switch", async () => {
  const bodies: Record<string, unknown>[] = [];
  const saved = { base: process.env.PAID_BASE_URL, key: process.env.PAID_API_KEY, model: process.env.PAID_MODEL, mode: process.env.PAID_REASONING };
  process.env.PAID_BASE_URL = "https://paid.example/api/v1";
  process.env.PAID_API_KEY = "PAID-TEST-KEY";
  process.env.PAID_MODEL = "vendor/paid-model";
  delete process.env.PAID_REASONING;
  setModelClientForTests({
    minSpacingMs: 0,
    transport: async (_url, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)));
      return response(choice('{"ok":true}'));
    },
  });
  try {
    setModelSelection({ route: "paid", model: null });
    await completeJson(messages, { timeoutMs: 20_000 });
    process.env.PAID_REASONING = "default";
    await completeJson(messages, { timeoutMs: 20_000 });
    setModelSelection({ route: "direct", model: null });
    await completeJson(messages, { timeoutMs: 20_000 });
  } finally {
    setModelSelection({ route: "direct", model: null });
    for (const [name, value] of [["PAID_BASE_URL", saved.base], ["PAID_API_KEY", saved.key], ["PAID_MODEL", saved.model], ["PAID_REASONING", saved.mode]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  assert.deepEqual(bodies[0].reasoning, { enabled: false });
  assert.equal("reasoning" in bodies[1], false, "PAID_REASONING=default leaves the host's own behavior");
  assert.equal("reasoning" in bodies[2], false, "the NVIDIA route is unchanged");
  assert.deepEqual(bodies[2].chat_template_kwargs, { enable_thinking: false });
});
