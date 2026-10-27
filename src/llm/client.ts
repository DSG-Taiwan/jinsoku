import { config } from "../config.ts";
import { RequestDeadlineError, throwIfRequestDeadline } from "../deadline.ts";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class ModelError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function modelCallCause(err: unknown): "http-5xx" | "http-429" | "timeout" | "invalid-json" | "empty-completion" {
  const message = err instanceof Error ? err.message : String(err);
  const status = err instanceof ModelError ? err.status : 0;
  if (/empty/i.test(message)) return "empty-completion";
  if (status === 429 || /\bHTTP 429\b/.test(message)) return "http-429";
  if (status >= 500 || /\bHTTP 5\d\d\b/.test(message)) return "http-5xx";
  if (/timeout/i.test(message)) return "timeout";
  return "invalid-json";
}

/** No fixed gap between sequential calls. A 429 or Retry-After sets the next start. */
export const MODEL_MIN_SPACING_MS = 0;
export const MODEL_ATTEMPT_MS = 50_000;
export const MODEL_MAX_CONCURRENCY = 1;

type Transport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ClientHooks {
  transport: Transport;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  random: () => number;
  minSpacingMs: number;
  maxConcurrency: number;
}

const hooks: ClientHooks = {
  transport: (input, init) => fetch(input, init),
  sleep: (ms, signal) => pause(ms, signal),
  now: () => Date.now(),
  random: () => Math.random(),
  minSpacingMs: MODEL_MIN_SPACING_MS,
  maxConcurrency: MODEL_MAX_CONCURRENCY,
};

/** main is the Executor and anything not named. Planner and evaluator use their own key and pacing when that key is set. */
export type ModelLane = "main" | "planner" | "evaluator";

interface Slots {
  inFlight: number;
  nextStart: number;
  waiters: Array<() => void>;
}

const newSlots = (): Slots => ({ inFlight: 0, nextStart: 0, waiters: [] });
/** Each lane has its own concurrency and 429 pacing. A lane exists only when its key is set (PLANNER_API_KEY, EVALUATOR_API_KEY); otherwise its calls use the main lane and MODEL_API_KEY. */
const newLanes = (): Record<ModelLane, Slots> => ({ main: newSlots(), planner: newSlots(), evaluator: newSlots() });
const laneSlots: Record<ModelLane, Slots> = newLanes();
let laneKeyOverride: Partial<Record<ModelLane, string | null>> = {};

function laneKey(lane: ModelLane): string {
  if (lane === "main") return config.modelApiKey;
  const override = laneKeyOverride[lane];
  if (override !== undefined) return override ?? "";
  return lane === "planner" ? config.plannerApiKey : config.evaluatorApiKey;
}

export function setEvaluatorKeyForTests(key: string | null): void {
  laneKeyOverride.evaluator = key;
}

export function setPlannerKeyForTests(key: string | null): void {
  laneKeyOverride.planner = key;
}

function resolveLane(lane: ModelLane | undefined): ModelLane {
  return lane && lane !== "main" && laneKey(lane) ? lane : "main";
}

export function setModelClientForTests(opts: Partial<ClientHooks>): void {
  Object.assign(hooks, opts);
  Object.assign(laneSlots, newLanes());
}

export function resetModelClientForTests(): void {
  hooks.transport = (input, init) => fetch(input, init);
  hooks.sleep = (ms, signal) => pause(ms, signal);
  hooks.now = () => Date.now();
  hooks.random = () => Math.random();
  hooks.minSpacingMs = MODEL_MIN_SPACING_MS;
  hooks.maxConcurrency = MODEL_MAX_CONCURRENCY;
  Object.assign(laneSlots, newLanes());
  laneKeyOverride = {};
  routeName = routeFromEnv();
  modelOverride = null;
  receiptLogger = null;
}

/** Delay before another try. Retry-After wins. Otherwise the wait doubles, then a little jitter. */
export function retryWaitMs(attempt: number, retryAfter: string | null, now: number, random: () => number): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const when = Date.parse(retryAfter);
    if (Number.isFinite(when)) return Math.max(0, when - now);
  }
  const exponential = Math.min(8_000, 500 * 2 ** Math.max(0, attempt - 1));
  return exponential + Math.floor(random() * 400);
}

async function acquireSlot(lane: ModelLane, signal: AbortSignal | undefined): Promise<void> {
  const slots = laneSlots[lane];
  while (slots.inFlight >= hooks.maxConcurrency) {
    await new Promise<void>((resolve) => slots.waiters.push(resolve));
    throwIfRequestDeadline(signal);
  }
  const wait = Math.max(0, slots.nextStart - hooks.now());
  slots.inFlight += 1;
  if (wait > 0) {
    try {
      await hooks.sleep(wait, signal);
    } catch (err) {
      releaseSlot(lane);
      throw err;
    }
  }
}

function releaseSlot(lane: ModelLane): void {
  const slots = laneSlots[lane];
  slots.inFlight = Math.max(0, slots.inFlight - 1);
  const next = slots.waiters.shift();
  next?.();
}

function spaceAfter(lane: ModelLane, waitMs: number): void {
  const slots = laneSlots[lane];
  slots.nextStart = Math.max(slots.nextStart, hooks.now() + waitMs);
}

/** How long the next model call will wait. Callers can spend this outside a request deadline. */
export function modelQuietMs(): number {
  return Math.max(0, ...Object.values(laneSlots).map((slots) => slots.nextStart - hooks.now()));
}

/** paid is a second inference host (PAID_BASE_URL, PAID_API_KEY, PAID_MODEL). The NVIDIA settings stay untouched, so MODEL_ROUTE=direct is the rollback. */
export type ModelRouteName = "direct" | "nightshift" | "paid";

function routeFromEnv(): ModelRouteName {
  const route = process.env.MODEL_ROUTE;
  return route === "nightshift" || route === "paid" ? route : "direct";
}

export interface ModelReceipt {
  receipt_id: string | null;
  routed_model: string | null;
  provider: string | null;
  /** From the receipt's cache block. A cache hit is not a model latency or reliability sample. */
  from_cache?: boolean;
}

let routeName: ModelRouteName = routeFromEnv();
let modelOverride: string | null = null;
let receiptLogger: ((receipt: ModelReceipt) => void) | null = null;

export function setModelSelection(next: { route?: ModelRouteName; model?: string | null }): void {
  if (next.route) routeName = next.route;
  if (next.model !== undefined) modelOverride = next.model;
}

export function modelSelection(): { route: ModelRouteName; model: string } {
  if (routeName === "nightshift") {
    return { route: "nightshift", model: modelOverride || process.env.NIGHTSHIFT_MODE || "meterless/auto" };
  }
  if (routeName === "paid") {
    return { route: "paid", model: modelOverride || (process.env.PAID_MODEL ?? "") };
  }
  return { route: "direct", model: modelOverride || config.nemotronModel };
}

export function setReceiptLogger(fn: ((receipt: ModelReceipt) => void) | null): void {
  receiptLogger = fn;
}

function completionsUrl(route: ModelRouteName): string {
  const base =
    route === "nightshift" ? process.env.NIGHTSHIFT_BASE_URL || "" : route === "paid" ? process.env.PAID_BASE_URL || "" : config.modelBaseUrl;
  return `${base.replace(/\/+$/, "")}/chat/completions`;
}

function readReceipt(body: string): ModelReceipt | null {
  try {
    const parsed = JSON.parse(body) as {
      meterless?: {
        receipt_id?: unknown;
        routed_model?: unknown;
        winning_route?: { provider?: unknown };
        from_cache?: unknown;
        cache?: { from_cache?: unknown };
      };
    };
    const meterless = parsed.meterless;
    if (!meterless) return null;
    const cached = meterless.cache?.from_cache ?? meterless.from_cache;
    return {
      receipt_id: typeof meterless.receipt_id === "string" ? meterless.receipt_id : null,
      routed_model: typeof meterless.routed_model === "string" ? meterless.routed_model : null,
      provider: typeof meterless.winning_route?.provider === "string" ? meterless.winning_route.provider : null,
      ...(typeof cached === "boolean" ? { from_cache: cached } : {}),
    };
  } catch {
    return null;
  }
}

interface Posted {
  status: number;
  body: string;
  retryAfter: string | null;
}

type AttemptFailure = "http-429" | "http-5xx" | "http-4xx" | "empty-completion" | "error-object" | "invalid-json" | "timeout";

interface Classified {
  status: number;
  content: string;
  retryAfter: string | null;
  failure: AttemptFailure | null;
  usage?: { prompt: number; completion: number; cached?: number };
}

function failureError(result: Classified): ModelError {
  if (result.failure === "empty-completion") return new ModelError(result.status, "model content empty after retry");
  if (result.failure === "error-object") return new ModelError(result.status, "model error object in 200");
  if (result.failure === "invalid-json") return new ModelError(result.status, "model response was not JSON");
  return new ModelError(result.status, `model HTTP ${result.status}`);
}

function hasErrorObject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const error = (value as { error?: unknown }).error;
  if (typeof error === "string") return error.trim().length > 0;
  return error != null && typeof error === "object";
}

function classify(posted: Posted): Classified {
  const base = { status: posted.status, content: "", retryAfter: posted.retryAfter };
  if (posted.status === 429) return { ...base, failure: "http-429" };
  if (posted.status >= 500) return { ...base, failure: "http-5xx" };
  if (posted.status >= 400) return { ...base, failure: "http-4xx" };
  let parsed: {
    error?: unknown;
    choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
  };
  try {
    parsed = JSON.parse(posted.body) as typeof parsed;
  } catch {
    return { ...base, failure: "invalid-json" };
  }
  if (hasErrorObject(parsed)) return { ...base, failure: "error-object" };
  const msg = parsed.choices?.[0]?.message;
  let content = typeof msg?.content === "string" ? msg.content : "";
  if (!content.trim()) {
    const reasoning = typeof msg?.reasoning_content === "string" ? msg.reasoning_content : "";
    if (reasoning.includes("{")) content = reasoning;
  }
  content = stripReasoning(content);
  if (!content.trim()) return { ...base, failure: "empty-completion" };
  try {
    extractJson(content);
  } catch {
    return { ...base, failure: "invalid-json" };
  }
  const usage = parsed.usage;
  const prompt = Number(usage?.prompt_tokens);
  const completion = Number(usage?.completion_tokens);
  return {
    ...base,
    content,
    failure: null,
    ...(Number.isFinite(prompt) && Number.isFinite(completion)
      ? { usage: { prompt, completion, ...(Number(usage?.prompt_tokens_details?.cached_tokens) > 0 ? { cached: Number(usage?.prompt_tokens_details?.cached_tokens) } : {}) } }
      : {}),
  };
}

async function postOnce(
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
  jsonObject: boolean,
  signal?: AbortSignal,
  schema?: Record<string, unknown>,
  lane: ModelLane = "main",
): Promise<Posted> {
  throwIfRequestDeadline(signal);
  const selected = modelSelection();
  if (selected.route === "nightshift" && !process.env.NIGHTSHIFT_BASE_URL) {
    throw new ModelError(0, "nightshift route has no base url");
  }
  if (selected.route === "paid" && !(process.env.PAID_BASE_URL && process.env.PAID_API_KEY && selected.model)) {
    throw new ModelError(0, "paid route is not configured");
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const body: Record<string, unknown> = {
      model: selected.model,
      messages,
      max_tokens: maxTokens,
      temperature: 0,
      chat_template_kwargs: { enable_thinking: false },
      // Hidden reasoning spends the token budget and can return an empty reply. The paid host ignores chat_template_kwargs, so ask it directly.
      ...(selected.route === "paid" && process.env.PAID_REASONING !== "default" ? { reasoning: { enabled: false } } : {}),
    };
    if (schema) {
      body.response_format = { type: "json_schema", json_schema: { name: "agent_json", strict: true, schema } };
    } else if (jsonObject) body.response_format = { type: "json_object" };
    const key =
      selected.route === "nightshift"
        ? process.env.NIGHTSHIFT_TOKEN || ""
        : selected.route === "paid"
          ? process.env.PAID_API_KEY || ""
          : lane !== "main" && laneKey(lane)
          ? laneKey(lane)
          : config.modelApiKey;
    const res = await hooks.transport(completionsUrl(selected.route), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    const receipt = readReceipt(text);
    if (receipt && (selected.route === "nightshift" || receipt.receipt_id || receipt.routed_model)) {
      receiptLogger?.(receipt);
    }
    return { status: res.status, body: text, retryAfter: res.headers.get("retry-after") };
  } catch (err) {
    if (err instanceof ModelError) throw err;
    if (signal?.aborted) throw new RequestDeadlineError();
    const name = (err as Error).name;
    if (name === "AbortError") throw new ModelError(0, "model timeout");
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfRequestDeadline(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new RequestDeadlineError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export let modelCallCount = 0;
export function resetModelCallCount(): void {
  modelCallCount = 0;
}

function retryable(failure: AttemptFailure | null): boolean {
  return (
    failure === "http-429" ||
    failure === "http-5xx" ||
    failure === "empty-completion" ||
    failure === "error-object" ||
    failure === "invalid-json" ||
    failure === "timeout"
  );
}

export async function completeJson(
  messages: ChatMessage[],
  opts?: {
    maxTokens?: number;
    /** Hard ceiling on max_tokens for every attempt, including the empty-completion escalation. */
    maxTokensCap?: number;
    /** A planner or evaluator call uses that role's key and its own pacing when the key is set; otherwise it shares the main lane. */
    lane?: ModelLane;
    timeoutMs?: number;
    signal?: AbortSignal;
    schema?: Record<string, unknown>;
    onAttempt?: (message: string) => void;
    attemptMs?: number;
    remaining?: () => number;
    clock?: { hold(): void; resume(): void };
  },
): Promise<string> {
  modelCallCount += 1;
  const lane = resolveLane(opts?.lane);
  const timeoutMs = opts?.timeoutMs ?? 22_000;
  const attemptMs = opts?.attemptMs ?? MODEL_ATTEMPT_MS;
  const signal = opts?.signal;
  let end = 0;
  let maxTokens = opts?.maxTokens ?? 1024;
  let jsonObject = true;
  let schema = opts?.schema;
  let attempt = 0;
  let droppedSchema = false;
  let droppedJsonMode = false;
  let last = new ModelError(0, "model timeout");

  while (attempt < 4) {
    throwIfRequestDeadline(signal);
    const parked = hooks.now();
    await acquireSlot(lane, signal);
    const waited = hooks.now() - parked;
    if (end === 0) end = hooks.now() + timeoutMs;
    else end += waited;
    if (end - hooks.now() < 1_000) {
      releaseSlot(lane);
      throw last;
    }
    attempt += 1;
    const requestLeft = opts?.remaining ? opts.remaining() : end - hooks.now();
    const postBudget = Math.min(attemptMs, end - hooks.now(), Math.max(0, requestLeft - 2_000));
    if (postBudget < Math.min(1_000, attemptMs)) {
      releaseSlot(lane);
      if (requestLeft < 1_000) throw new RequestDeadlineError();
      throw last;
    }
    try {
      let failure: AttemptFailure | null = null;
      let status = 0;
      let retryAfter: string | null = null;
      try {
        const result = classify(await postOnce(messages, maxTokens, postBudget, jsonObject, signal, schema, lane));
        if (!result.failure) {
          opts?.onAttempt?.(
            `attempt ${attempt} ok status ${result.status}${result.usage ? ` tokens ${result.usage.prompt}/${result.usage.completion}${result.usage.cached ? ` cached ${result.usage.cached}` : ""}` : ""}`,
          );
          return result.content;
        }
        failure = result.failure;
        status = result.status;
        retryAfter = result.retryAfter;
        last = failureError(result);
      } catch (err) {
        if (err instanceof RequestDeadlineError) throw err;
        if (!(err instanceof ModelError) || !/timeout/i.test(err.message)) throw err;
        failure = "timeout";
        status = 0;
        last = err;
      }
      if (failure === "http-4xx" && status === 400 && schema && !droppedSchema) {
        droppedSchema = true;
        schema = undefined;
        opts?.onAttempt?.(`attempt ${attempt} http-4xx status 400`);
        continue;
      }
      if (failure === "http-4xx" && status === 400 && jsonObject && !droppedJsonMode) {
        droppedJsonMode = true;
        jsonObject = false;
        opts?.onAttempt?.(`attempt ${attempt} http-4xx status 400`);
        continue;
      }
      if (!retryable(failure)) throw last;
      if (failure === "empty-completion") maxTokens = Math.min(opts?.maxTokensCap ?? Infinity, Math.max(maxTokens, 2048));
      const base = retryWaitMs(attempt, retryAfter, hooks.now(), hooks.random);
      const wait = base;
      const remain = end - hooks.now();
      const requestLeft = opts?.remaining ? opts.remaining() : remain;
      const need = failure === "timeout" ? 15_000 : 3_000;
      opts?.onAttempt?.(`attempt ${attempt} ${failure} status ${status} wait ${wait}ms`);
      if (remain < wait + need || requestLeft < wait + need) throw last;
      if (failure === "http-429" || retryAfter) {
        spaceAfter(lane, wait);
      } else {
        await hooks.sleep(wait, signal);
        end += wait;
      }
    } finally {
      releaseSlot(lane);
    }
  }
  throw last;
}

function parseJsonText(text: string): unknown {
  const cleaned = text.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const msg = (err as Error).message;
    const at = msg.match(/position (\d+)/);
    if (at && /after JSON/i.test(msg)) return JSON.parse(cleaned.slice(0, Number(at[1])));
    throw err;
  }
}

/** Drop an inline reasoning block, through the closing think tag, before JSON parse. */
export function stripReasoning(text: string): string {
  const end = text.toLowerCase().lastIndexOf("</think>");
  if (end < 0) return text;
  return text.slice(end + "</think>".length).trim();
}

export function extractJson(text: string): unknown {
  const trimmed = stripReasoning(text).trim();
  try {
    return parseJsonText(trimmed);
  } catch {
    /* fall through to a string-aware object scan */
  }
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1].trim() : trimmed;
  const start = raw.indexOf("{");
  if (start < 0) throw new Error("no JSON object in model content");
  for (let from = start; from >= 0 && from < raw.length; from = raw.indexOf("{", from + 1)) {
    const parsed = sliceObject(raw, from);
    if (parsed !== undefined) return parsed;
  }
  throw new Error("no JSON object in model content");
}

function sliceObject(raw: string, start: number): unknown | undefined {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return parseJsonText(raw.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}
