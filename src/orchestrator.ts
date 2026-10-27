import { randomUUID } from "node:crypto";
import { meterlessStatus } from "./adapters/meterless.ts";
import { runSql } from "./adapters/zetaris.ts";
import { deterministicCritique, evaluate } from "./agents/evaluator.ts";
import { assembleFromRecords, citeMissingKinds, draft as execDraft, isAssembledDraft, retrieve, revise } from "./agents/executor.ts";
import { codeNextDraft, prepareNextDraft } from "./agents/next-check.ts";
import {
  analysisClaims,
  analysisEnabled,
  currentAnalysis,
  faultPersists,
  faultScenario,
  hasAnalysis,
  injectFault,
  reviseAnalysis,
  runAnalysis,
  stripAnalysis,
  type AnalysisContext,
} from "./agents/analysis.ts";
import { acceptableHeadline, codeRowsDraft } from "./agents/patterns-core.ts";
import { planFromCall } from "./agents/planner.ts";
import { missingEnv } from "./config.ts";
import { Deadline, MODEL_HOP_MS, phraseCeilingMs, RequestDeadlineError } from "./deadline.ts";
import { LinterError, blockedExcerpt, lintAndAssemble } from "./final-pass.ts";
import { ingest } from "./ingest.ts";
import { beginAuthorizedRun, finishRun, matchingStored, noteTrace } from "./idempotency.ts";
import { completeJson, extractJson, setReceiptLogger, type ModelReceipt } from "./llm/client.ts";
import { isRefusal, type CallObject, type Critique, type ModelStages, type RunRequest, type RunResponse, type SmokeDraft } from "./schemas.ts";
import { logPathFor, writeLog, type RetrievalRecord } from "./tracing.ts";

const MAX_ROUNDS = 2;
/** Paths on which no model stage can have run (refusals, id conflicts): every stage is n/a. */
const NO_MODEL_STAGES: ModelStages = { headline: "n/a", analysis: "n/a", evaluator: "n/a", revisions: 0, synthetic_fault: "none" };
const HEALTH_SQL = "SELECT 1 AS one";

function modelAttempt(message: string): number {
  const match = /^attempt (\d+)/.exec(message);
  return match ? Number(match[1]) : 1;
}

function log(
  traceId: string,
  agent_name: string,
  action: string,
  input_summary: string,
  output_summary: string,
  target_agent: string | null,
  status: string,
  extra?: {
    confidence?: number | null;
    retry_count?: number;
    retrieval?: RetrievalRecord;
    fallback_reason?: { hop: string; cause: string; retry_count: number; trace_id: string };
    meterless?: ModelReceipt;
  },
): void {
  writeLog({
    timestamp: new Date().toISOString(),
    trace_id: traceId,
    agent_name,
    action,
    input_summary,
    output_summary,
    target_agent,
    confidence: extra?.confidence ?? null,
    retry_count: extra?.retry_count ?? 0,
    status,
    retrieval: extra?.retrieval,
    fallback_reason: extra?.fallback_reason,
    meterless: extra?.meterless,
  });
}

function refused(req: RunRequest, traceId: string, gate: { status: string; reason_code: string; human_message: string }): RunResponse {
  return {
    request_id: req.request_id,
    trace_id: traceId,
    status: gate.status,
    agents_used: ["ingest"],
    result: {
      summary: gate.human_message,
      findings: [],
      confidence: 1,
      human_message: gate.human_message,
      reason_code: gate.reason_code,
      fallback_used: false,
      fallback_reason: null,
    },
    collaboration: {
      feedback_loop_completed: false,
      revision_count: 0,
      evaluator_findings: [],
      note: "Ingest only. No model or Zetaris call.",
      model_stages: NO_MODEL_STAGES,
    },
    log_path: logPathFor(traceId),
  };
}

export async function health(): Promise<{
  ok: boolean;
  env: Record<string, boolean>;
  dependencies: Record<string, { ok: boolean; detail: string }>;
}> {
  const missing = missingEnv();
  const env: Record<string, boolean> = {
    MODEL_BASE_URL: !missing.includes("MODEL_BASE_URL"),
    MODEL_API_KEY: !missing.includes("MODEL_API_KEY"),
    NEMOTRON_MODEL: !missing.includes("NEMOTRON_MODEL"),
    ZETARIS_REST_URL: !missing.includes("ZETARIS_REST_URL"),
    ZETARIS_API_KEY: !missing.includes("ZETARIS_API_KEY"),
    ZETARIS_ORG_ID: !missing.includes("ZETARIS_ORG_ID"),
  };
  const dependencies: Record<string, { ok: boolean; detail: string }> = {};
  try {
    const sql = await runSql(HEALTH_SQL, 1);
    const ok = String(sql.data?.[0]?.[0]) === "1";
    dependencies.zetaris = { ok, detail: ok ? "SELECT 1 returned 1" : "unexpected payload" };
  } catch (err) {
    dependencies.zetaris = { ok: false, detail: (err as Error).message };
  }
  const mem = await meterlessStatus();
  dependencies.meterless = { ok: mem.ok, detail: mem.source };
  dependencies.model = {
    ok: env.MODEL_BASE_URL && env.MODEL_API_KEY && env.NEMOTRON_MODEL,
    detail: env.MODEL_API_KEY ? "env present" : "env missing",
  };
  const ok = Object.values(env).every(Boolean) && dependencies.zetaris.ok && dependencies.meterless.ok;
  return { ok, env, dependencies };
}

const RESPONSE_CODES = new Set([
  "hazard-downgrade",
  "person-name",
  "claim-source-mismatch",
  "unknown-evidence-id",
  "dual-citation-missing",
  "evaluator-rejected",
]);

const STATIC_DIAGNOSTIC = new Map<string, string>([
  ["HAZARD downgrade/close", "hazard-downgrade"],
  ["person name", "person-name"],
]);

/** Closed set of response codes. Critique text is not copied into the response. */
export function safeDiagnostic(raw: string): string {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  const mapped = STATIC_DIAGNOSTIC.get(text);
  let code = "evaluator-rejected";
  if (mapped) code = mapped;
  else if (/^findings\[\d+\] has no retrieved id$/.test(text)) code = "claim-source-mismatch";
  else if (text === "unknown id" || text.startsWith("unknown id ")) code = "unknown-evidence-id";
  else if (text === "dual-citation: missing" || text.startsWith("dual-citation: missing ")) code = "dual-citation-missing";
  return typeof code === "string" && RESPONSE_CODES.has(code) ? code : "evaluator-rejected";
}

/** A blocked hallucination is not repeated in the response. The log keeps the id. */
export function responseFindings(items: string[]): string[] {
  return [...new Set(items.map((item) => (item.startsWith("unsupported issue") ? safeDiagnostic(item) : item)))];
}

/** An exhausted revision is not a released answer. */
export function exhaustedRelease(draft: SmokeDraft, evaluatorFindings: string[]) {
  void draft;
  const diagnostics = [...new Set(evaluatorFindings.map((item) => safeDiagnostic(String(item))))].filter((code) =>
    RESPONSE_CODES.has(code),
  );
  return {
    summary: "Unresolved after revision rounds. A human decides.",
    findings: [] as SmokeDraft["findings"],
    confidence: 0,
    human_message: diagnostics.join("; ") || "Evaluator did not approve. The draft was not released.",
    reason_code: "unresolved",
    not_checked: ["Unapproved draft was not released"],
    diagnostics,
  };
}

export async function runRequest(req: RunRequest): Promise<RunResponse> {
  if (!req.request_id) throw new Error("request_id required");

  const traceId = randomUUID();
  const agentsUsed: string[] = ["ingest"];
  const log_path = logPathFor(traceId);

  const gate = ingest(req.user_query, req.context, traceId);
  if (isRefusal(gate)) {
    const stored = matchingStored(req);
    if (stored) return stored;
    log(traceId, "ingest", "refuse", String(req.user_query ?? "").slice(0, 200), `${gate.status} ${gate.reason_code}`, null, gate.status, {
      confidence: 1,
    });
    const response = refused(req, traceId, gate);
    finishRun(req, response);
    return response;
  }

  const lookup = beginAuthorizedRun(req);
  if (lookup.kind === "hit") return lookup.response;
  if (lookup.kind === "conflict" || lookup.kind === "pending") {
    const reason = lookup.kind === "conflict" ? "request-id-conflict" : "request-in-progress";
    const human =
      lookup.kind === "conflict"
        ? "This request_id was already used for a different command or role."
        : "This request_id is already running.";
    log(traceId, "ingest", "refuse", String(req.user_query ?? "").slice(0, 200), reason, null, "error");
    return {
      request_id: req.request_id,
      trace_id: traceId,
      status: "error",
      agents_used: ["ingest"],
      result: {
        summary: human,
        findings: [],
        confidence: 0,
        human_message: human,
        reason_code: reason,
        fallback_used: false,
        fallback_reason: null,
      },
      collaboration: {
        feedback_loop_completed: false,
        revision_count: 0,
        evaluator_findings: [],
        note: "Request id was not reused.",
        model_stages: NO_MODEL_STAGES,
      },
      log_path,
    };
  }

  noteTrace(req.request_id, traceId);
  const deadline = Deadline.start(phraseCeilingMs(gate.verb));
  log(
    traceId,
    "ingest",
    "accept",
    `${gate.verb} ${gate.asset ?? gate.period}`,
    JSON.stringify({ verb: gate.verb, asset: gate.asset, period: gate.period, role: gate.role }),
    "planner",
    "ok",
    { confidence: 1 },
  );

  setReceiptLogger((receipt) => {
    log(traceId, "model", "meterless", receipt.routed_model ?? "unrouted", receipt.receipt_id ?? "none", null, "ok", {
      meterless: receipt,
    });
  });
  try {
    const response = await runLoop(req, gate, traceId, deadline, agentsUsed, log_path);
    if (deadline.over() && response.status === "ok") {
      log(traceId, "orchestrator", "unresolved", "phrase ceiling", "wall clock", null, "unresolved");
      const held: RunResponse = {
        request_id: req.request_id,
        trace_id: traceId,
        status: "unresolved",
        agents_used: agentsUsed,
        result: {
          summary: "The phrase ceiling ended before an answer was released.",
          findings: [],
          confidence: 0,
          reason_code: "phrase-ceiling",
          human_message: "The answer was not released. A human decides.",
          fallback_used: false,
          fallback_reason: null,
        },
        collaboration: {
          feedback_loop_completed: false,
          revision_count: 0,
          evaluator_findings: [],
          note: `${gate.verb} ceiling ${phraseCeilingMs(gate.verb)}ms`,
        },
        log_path,
      };
      finishRun(req, held);
      return held;
    }
    finishRun(req, response);
    return response;
  } catch (err) {
    if (err instanceof RequestDeadlineError) {
      log(traceId, "orchestrator", "unresolved", "phrase ceiling", err.message, null, "unresolved");
      const response: RunResponse = {
        request_id: req.request_id,
        trace_id: traceId,
        status: "unresolved",
        agents_used: agentsUsed,
        result: {
          summary: "The phrase ceiling ended before an answer was released.",
          findings: [],
          confidence: 0,
          reason_code: "phrase-ceiling",
          human_message: "The answer was not released. A human decides.",
          fallback_used: false,
          fallback_reason: null,
        },
        collaboration: {
          feedback_loop_completed: false,
          revision_count: 0,
          evaluator_findings: [],
          note: `${gate.verb} ceiling ${phraseCeilingMs(gate.verb)}ms`,
        },
        log_path,
      };
      finishRun(req, response);
      return response;
    }
    const message = (err as Error).message;
    log(traceId, "orchestrator", "error", "deadline or hop", message, null, "error");
    const response: RunResponse = {
      request_id: req.request_id,
      trace_id: traceId,
      status: "error",
      agents_used: agentsUsed,
      result: {
        summary: `Request stopped: ${message}`,
        findings: [],
        confidence: 0,
        reason_code: "deadline",
        human_message: "The answer was not released. A human decides.",
        fallback_used: false,
        fallback_reason: null,
      },
      collaboration: {
        feedback_loop_completed: false,
        revision_count: 0,
        evaluator_findings: [message],
        note: "Fail closed.",
      },
      log_path,
    };
    finishRun(req, response);
    return response;
  } finally {
    setReceiptLogger(null);
  }
}

async function runLoop(
  req: RunRequest,
  gate: CallObject,
  traceId: string,
  deadline: Deadline,
  agentsUsed: string[],
  log_path: string,
): Promise<RunResponse> {
  const stats = { hops: 0, fallbacks: 0 };
  let assemblerReason: string | null = null;
  const signal = deadline.signal;
  const noteFallback = (agent: string, fallbackName: string, target: string, cause = "model-call"): void => {
    stats.fallbacks += 1;
    const record = { hop: agent, cause, retry_count: stats.hops, trace_id: traceId };
    log(traceId, agent, "fallback", fallbackName, JSON.stringify(record), target, "fallback", {
      retry_count: record.retry_count,
      fallback_reason: record,
    });
  };
  const noteModelAssembly = (cause: string): void => {
    assemblerReason = cause;
  };
  const assemblerNote = (reason: string): string =>
    reason === "rejected"
      ? "Assembled from records after the draft was rejected."
      : `Assembled from records after a model-call failure (${reason}).`;
  const rate = (): number => (stats.hops === 0 ? 0 : Number((stats.fallbacks / stats.hops).toFixed(2)));

  agentsUsed.push("planner");
  const left = (): number => deadline.remaining();
  const planObj = planFromCall(gate);
  log(
    traceId,
    "planner",
    "plan",
    planObj.objective,
    JSON.stringify(planObj.subtasks).slice(0, 400),
    "executor",
    "ok",
  );
  log(traceId, "planner", "progress", gate.verb, "code plan", "executor", "ok");

  agentsUsed.push("executor", "zetaris", "meterless");
  if (gate.verb === "NEXT") agentsUsed.push("markov");
  const { sqls, queries, retrieved } = await retrieve(gate, signal);
  log(
    traceId,
    "executor",
    "zetaris-query",
    sqls.join(" || ").slice(0, 900),
    `sources=${retrieved.length} ids=${retrieved.map((s) => s.id).join(",")}`,
    "evaluator",
    "ok",
    {
      retrieval: {
        evidence_ids: retrieved.map((source) => source.id),
        queries,
      },
    },
  );
  if (gate.verb === "PATTERNS") {
    log(traceId, "executor", "progress", gate.period ?? "week", `retrieved ${retrieved.length} sources`, "executor", "ok");
  }

  stats.hops += 1;
  let drafted: Awaited<ReturnType<typeof execDraft>>;
  let headlineSource: ModelStages["headline"] = "code";
  const modelWritesCause = gate.verb === "CAUSE" && process.env.CAUSE_DRAFT === "model";
  // Whenever a model writes a whole draft (the first draft or a revision), its headline and next check are replaced by the code-built core's.
  const withCodeText = (draft: SmokeDraft): SmokeDraft => {
    const core = gate.verb === "NEXT" ? codeNextDraft(retrieved) : codeRowsDraft(gate, retrieved);
    return { ...draft, headline: core.headline, recommended_next_check: core.recommended_next_check };
  };
  if (!modelWritesCause) {
    const core = gate.verb === "NEXT" ? codeNextDraft(retrieved) : codeRowsDraft(gate, retrieved);
    log(
      traceId,
      "executor",
      "progress",
      core.recommended_next_check.slice(0, 240),
      `cited rows ${core.findings.length}`,
      "executor",
      "ok",
    );
    drafted = { value: core, fallbackUsed: false, fallbackName: null };
    // The headline is always built by code from the accepted call; the model writes no headline text.
  } else {
    const reserve = 4_000;
    const cap = 11_000;
    const draftBudget = Math.max(2_500, Math.min(cap, deadline.remaining() - reserve));
    drafted = await execDraft(
      gate,
      planObj,
      retrieved,
      deadline.hop(draftBudget),
      (m) => log(traceId, "executor", "model-attempt", "model call", m, "executor", "retry", { retry_count: modelAttempt(m) }),
      signal,
      left,
      deadline,
    );
    // Model-originated prose is not released: the model's headline and next check are replaced by the code-built core's. The model's
    // findings stay subject to the release contract (code-built, verbatim of a cited source, or verified structured analysis).
    if (!drafted.fallbackUsed) drafted = { ...drafted, value: withCodeText(drafted.value) };
    headlineSource = "code";
  }
  if (drafted.fallbackUsed && drafted.fallbackName) {
    noteFallback("executor", drafted.fallbackName, "evaluator", drafted.fallbackReason ?? "invalid-json");
    if (drafted.fallbackName === "assembleFromRecords") noteModelAssembly(drafted.fallbackReason ?? "invalid-json");
  }
  let current = citeMissingKinds(prepareNextDraft(drafted.value, retrieved), retrieved);
  log(traceId, "executor", "draft", current.headline, `findings=${current.findings.length}`, "evaluator", drafted.fallbackUsed ? "fallback" : "ok", {
    confidence: current.confidence,
  });

  const analysisContext = (core: SmokeDraft): AnalysisContext => ({
    call: gate,
    retrieved,
    core,
    timeoutMs: deadline.hop(MODEL_HOP_MS),
    onRepair: (m) => log(traceId, "executor", "model-attempt", "analysis", m, "executor", "retry", { retry_count: modelAttempt(m) }),
    signal,
    remaining: left,
    clock: deadline,
  });
  let analysisProduced = false;
  let analysisEmpty = false;
  let injectedFault: string | null = null;
  const assembledEarly = isAssembledDraft(current);
  if (assembledEarly && analysisEnabled() && (gate.verb === "CAUSE" || gate.verb === "PATTERNS")) {
    // A records-only draft is never reviewed by the model Evaluator, so no model-written analysis is added to it.
    log(traceId, "executor", "analysis", "analysis skipped", "draft assembled from records; no model analysis is added", "evaluator", "fallback");
  }
  if (!assembledEarly && analysisEnabled() && (gate.verb === "CAUSE" || gate.verb === "PATTERNS") && deadline.remaining() > 6_000) {
    try {
      let claims = await runAnalysis(analysisContext(current));
      analysisEmpty = claims.length === 0;
      const fault = faultScenario();
      if (fault) {
        claims = injectFault(claims, fault);
        injectedFault = fault;
        log(traceId, "executor", "fault-injected", `synthetic fault: ${fault}`, faultPersists() ? "persistent" : "first output only", "evaluator", "ok");
      }
      current = { ...current, findings: [...current.findings, ...analysisClaims(claims, retrieved)] };
      analysisProduced = true;
      log(traceId, "executor", "analysis", current.headline, `claims=${claims.length}`, "evaluator", "ok");
    } catch (err) {
      if (err instanceof RequestDeadlineError) throw err;
      log(traceId, "executor", "analysis", "analysis skipped", (err as Error).message.slice(0, 120), "evaluator", "fallback");
    }
  }

  agentsUsed.push("evaluator");
  stats.hops += 1;
  let critiqueHop = await evaluate(
    planObj,
    current,
    retrieved,
    deadline.hop(30_000),
    (m) => log(traceId, "evaluator", "model-attempt", "model call", m, "evaluator", "retry", { retry_count: modelAttempt(m) }),
    signal,
    left,
    deadline,
  );
  if (critiqueHop.fallbackUsed && critiqueHop.fallbackName) noteFallback("evaluator", critiqueHop.fallbackName, "executor");
  let critique: Critique = critiqueHop.value;
  let revisionCount = 0;
  const evaluatorFindings = [...critique.issues, ...critique.missing_evidence];

  while (critique.requires_revision && revisionCount < MAX_ROUNDS && deadline.remaining() > 3_500) {
    log(
      traceId,
      "evaluator",
      "critique",
      current.headline,
      JSON.stringify({ issues: critique.issues, missing_evidence: critique.missing_evidence }).slice(0, 500),
      "executor",
      "revise",
      { confidence: critique.confidence },
    );
    revisionCount += 1;
    stats.hops += 1;
    let revised: Awaited<ReturnType<typeof revise>>;
    if (hasAnalysis(current)) {
      try {
        let claims = await reviseAnalysis(analysisContext(current), currentAnalysis(current), {
          issues: critique.issues,
          missing_evidence: critique.missing_evidence,
        });
        if (claims.length === 0) analysisEmpty = true;
        const fault = faultScenario();
        if (fault && faultPersists()) {
          claims = injectFault(claims, fault);
          injectedFault = fault;
          log(traceId, "executor", "fault-injected", `synthetic fault: ${fault}`, "persistent", "evaluator", "ok");
        }
        const base = stripAnalysis(current);
        revised = { value: { ...base, findings: [...base.findings, ...analysisClaims(claims, retrieved)] }, fallbackUsed: false, fallbackName: null };
      } catch (err) {
        if (err instanceof RequestDeadlineError) throw err;
        revised = { value: stripAnalysis(current), fallbackUsed: false, fallbackName: null };
        log(traceId, "executor", "analysis", "analysis dropped", (err as Error).message.slice(0, 120), "evaluator", "fallback");
      }
    } else {
      revised = await revise(
        gate,
        planObj,
        retrieved,
        current,
        critique,
        deadline.hop(MODEL_HOP_MS),
        (m) => log(traceId, "executor", "model-attempt", "model call", m, "executor", "retry", { retry_count: modelAttempt(m) }),
        signal,
        left,
        deadline,
      );
    }
    if (!revised.fallbackUsed) revised = { ...revised, value: withCodeText(revised.value) };
    if (revised.fallbackUsed && revised.fallbackName) {
      noteFallback("executor", revised.fallbackName, "evaluator", revised.fallbackReason ?? "invalid-json");
      if (revised.fallbackName === "assembleFromRecords") noteModelAssembly(revised.fallbackReason ?? "invalid-json");
    }
    current = citeMissingKinds(prepareNextDraft(revised.value, retrieved), retrieved);
    log(traceId, "executor", "revision", current.headline, `round=${revisionCount}`, "evaluator", revised.fallbackUsed ? "fallback" : "ok", {
      confidence: current.confidence,
    });
    stats.hops += 1;
    critiqueHop = await evaluate(
      planObj,
      current,
      retrieved,
      deadline.hop(30_000),
      (m) => log(traceId, "evaluator", "model-attempt", "model call", m, "evaluator", "retry", { retry_count: modelAttempt(m) }),
      signal,
      left,
      deadline,
    );
    if (critiqueHop.fallbackUsed && critiqueHop.fallbackName) noteFallback("evaluator", critiqueHop.fallbackName, "planner");
    critique = critiqueHop.value;
    evaluatorFindings.push(...critique.issues, ...critique.missing_evidence);
  }

  // The last Evaluator hop decides. If it fell back to the local check, no model reviewed the analysis, so model-written text is not released as reviewed.
  const evaluatorUnavailable = critiqueHop.fallbackUsed;
  let analysisWithheld = false;
  if (hasAnalysis(current) && (critique.requires_revision || evaluatorUnavailable)) {
    current = stripAnalysis(current);
    analysisWithheld = true;
    critique = deterministicCritique(current, retrieved);
    log(
      traceId,
      "executor",
      "analysis",
      "analysis withheld",
      evaluatorUnavailable ? `model Evaluator unavailable after ${revisionCount} revisions; evidence core released` : `after ${revisionCount} revisions; evidence core released`,
      "planner",
      "fallback",
    );
  }

  // `released` says what the response carries: the checked draft, a records-only rebuild that replaced it, or nothing at all.
  // Only the checked draft may report model output as produced; otherwise the model analysis was not released.
  const modelStages = (released: "draft" | "records" | "none" = "draft"): ModelStages => {
    const base: ModelStages["analysis"] = !analysisEnabled()
      ? "off"
      : gate.verb !== "CAUSE" && gate.verb !== "PATTERNS"
      ? "n/a"
      : analysisWithheld
      ? "withheld"
      : hasAnalysis(current)
      ? "produced"
      : analysisProduced
      ? analysisEmpty
        ? "empty"
        : "dropped"
      : "skipped";
    return {
      headline: released === "draft" ? headlineSource : "code",
      analysis: released !== "draft" && base === "produced" ? "withheld" : base,
      evaluator: released === "records" || !critiqueHop.modelUsed ? "deterministic" : "model",
      revisions: revisionCount,
      // Only a fault that was actually injected and logged is reported; a configured scenario that never ran is "none".
      synthetic_fault: injectedFault ?? "none",
    };
  };

  const releaseAssembled = (reason: string): RunResponse | null => {
    const why = assemblerReason ?? reason;
    const assembled = assembleFromRecords(gate, retrieved);
    const local = deterministicCritique(assembled, retrieved);
    if (local.requires_revision || !local.approve) {
      log(
        traceId,
        "executor",
        "assemble",
        assembled.headline,
        JSON.stringify({ issues: local.issues, missing_evidence: local.missing_evidence }).slice(0, 400),
        "planner",
        "error",
      );
      return null;
    }
    try {
      const final = lintAndAssemble(assembled, retrieved, traceId);
      if (!agentsUsed.includes("final-pass")) agentsUsed.push("final-pass");
      log(traceId, "executor", "assemble", final.headline, `${why} findings=${final.findings.length}`, "planner", "fallback", {
        confidence: final.confidence,
      });
      log(traceId, "planner", "final", final.headline, `findings=${final.findings.length}`, null, "ok", {
        confidence: final.confidence,
      });
      log(traceId, "final-pass", "assemble", `findings=${final.findings.length}`, final.headline, null, "ok", {
        confidence: final.confidence,
      });
      return {
        request_id: req.request_id,
        trace_id: traceId,
        status: "ok",
        agents_used: agentsUsed,
        result: {
          summary: final.headline,
          findings: final.findings,
          confidence: final.confidence,
          headline: final.headline,
          recommended_next_check: final.recommended_next_check,
          needs_human_decision: final.needs_human_decision,
          not_checked: final.not_checked,
          fallback_used: true,
          fallback_reason: why,
        },
        collaboration: {
          feedback_loop_completed: true,
          revision_count: revisionCount,
          evaluator_findings: responseFindings(evaluatorFindings),
          fallback_rate: rate(),
          model_stages: modelStages("records"),
          note: assemblerNote(why),
        },
        log_path,
      };
    } catch (err) {
      const message = err instanceof LinterError ? err.message : (err as Error).message;
      log(traceId, "final-pass", "block", "assembled draft", message, null, "error");
      return null;
    }
  };

  if (critique.requires_revision || !critique.approve) {
    if (assemblerReason && assemblerReason !== "rejected") {
      const assembledRelease = releaseAssembled(assemblerReason);
      if (assembledRelease) return assembledRelease;
    }
    log(traceId, "evaluator", "exhaust", "max revisions", `${JSON.stringify(critique.issues).slice(0, 150)} | ${blockedExcerpt(current)}`, "planner", "unresolved");
    log(traceId, "planner", "final", "unresolved", "human decides", null, "ok");
    const { diagnostics, ...held } = exhaustedRelease(current, evaluatorFindings);
    return {
      request_id: req.request_id,
      trace_id: traceId,
      status: "unresolved",
      agents_used: agentsUsed,
      result: {
        ...held,
        fallback_used: false,
        fallback_reason: null,
      },
      collaboration: {
        feedback_loop_completed: true,
        revision_count: revisionCount,
        evaluator_findings: diagnostics,
        fallback_rate: rate(),
        model_stages: modelStages("none"),
        note: "Exhausted MAX 2 revision rounds. No guess.",
      },
      log_path,
    };
  }

  log(traceId, "evaluator", "approval", current.headline, "approve", "planner", "ok", { confidence: critique.confidence });
  agentsUsed.push("final-pass");
  try {
    const final = lintAndAssemble(current, retrieved, traceId);
    const assembled = isAssembledDraft(current);
    log(traceId, "planner", "final", final.headline, `findings=${final.findings.length}`, null, "ok", {
      confidence: final.confidence,
    });
    log(traceId, "final-pass", "assemble", `findings=${final.findings.length}`, final.headline, null, "ok", {
      confidence: final.confidence,
    });
    return {
      request_id: req.request_id,
      trace_id: traceId,
      status: "ok",
      agents_used: agentsUsed,
      result: {
        summary: final.headline,
        findings: final.findings,
        confidence: final.confidence,
        headline: final.headline,
        recommended_next_check: final.recommended_next_check,
        needs_human_decision: final.needs_human_decision,
        not_checked: final.not_checked,
          fallback_used: assembled,
          fallback_reason: assembled ? (assemblerReason ?? "rejected") : null,
        },
        collaboration: {
          feedback_loop_completed: true,
          revision_count: revisionCount,
          evaluator_findings: responseFindings(evaluatorFindings),
          fallback_rate: rate(),
          model_stages: modelStages(),
          note: analysisWithheld
            ? evaluatorUnavailable
              ? `Analysis withheld: the model Evaluator was unavailable. Evidence core released.`
              : `Analysis withheld after ${revisionCount} revisions. Evidence core released.`
            : assembled
            ? assemblerNote(assemblerReason ?? "rejected")
            : modelStages().analysis === "dropped"
            ? `Analysis dropped: the revision failed. Evidence core released.`
            : modelStages().analysis === "empty"
            ? `Analysis empty: the model returned no claims. Evidence core released.`
            : evaluatorUnavailable
              ? "Model Evaluator unavailable; the deterministic check was applied."
              : revisionCount > 0
              ? "Evaluator critique and Executor revision logged."
              : "Evaluator approved first draft.",
        },
      log_path,
    };
  } catch (err) {
    const message = err instanceof LinterError ? err.message : (err as Error).message;
    log(traceId, "final-pass", "block", "linter", `${message} | ${blockedExcerpt(current)}`, null, "error");
    if (!isAssembledDraft(current)) {
      const assembledRelease = releaseAssembled("rejected");
      if (assembledRelease) return assembledRelease;
    }
    return {
      request_id: req.request_id,
      trace_id: traceId,
      status: "error",
      agents_used: agentsUsed,
      result: {
        summary: "The answer was not released. A human decides.",
        findings: [],
        confidence: 0,
        reason_code: "linter",
        human_message: "The answer was not released. A human decides.",
        fallback_used: false,
        fallback_reason: null,
      },
      collaboration: {
        feedback_loop_completed: true,
        revision_count: revisionCount,
        evaluator_findings: responseFindings([message]),
        fallback_rate: rate(),
        model_stages: modelStages("none"),
        note: "Fail closed.",
      },
      log_path,
    };
    finishRun(req, response);
    return response;
  }
}

/** Test helper: run linter on a bad draft without a model. */
export function blockBadDraft(draft: SmokeDraft, retrieved: { id: string; kind: "zetaris" | "hmem"; summary: string }[], traceId: string): void {
  lintAndAssemble(draft, retrieved, traceId);
}
