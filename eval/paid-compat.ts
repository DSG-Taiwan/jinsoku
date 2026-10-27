import { config } from "../src/config.ts";
import { completeJson, modelSelection, setModelSelection } from "../src/llm/client.ts";
import { CRITIQUE_SCHEMA } from "../src/agents/model-json.ts";

/**
 * Five-call compatibility check for the paid route. It sends the request shapes the engine sends:
 * plain JSON mode, a strict JSON schema, the Evaluator's schema call, a short headline call, and a call with room for a longer answer.
 * Usage: MODEL_ROUTE=paid tsx eval/paid-compat.ts   (needs PAID_BASE_URL, PAID_API_KEY, PAID_MODEL in .env). Prints no key values.
 */
void config;
setModelSelection({ route: process.env.MODEL_ROUTE === "paid" ? "paid" : "direct" });
const selected = modelSelection();
console.log(`route: ${selected.route}  model: ${selected.model}  host: ${new URL((selected.route === "paid" ? process.env.PAID_BASE_URL : config.modelBaseUrl) || "https://unset.invalid").host}`);
if (selected.route !== "paid") console.log("NOTE: MODEL_ROUTE is not paid, so this checks the NVIDIA route");

const critiqueReply = { role: "user" as const, content: 'Reply with {"approve":true,"requires_revision":false,"issues":[],"missing_evidence":[],"confidence":0.8}' };
const calls: { name: string; messages: { role: "system" | "user"; content: string }[]; opts: Record<string, unknown> }[] = [
  { name: "1 plain JSON mode", messages: [{ role: "user", content: 'Reply with one JSON object {"ok":true} only.' }], opts: { maxTokens: 200 } },
  { name: "2 strict JSON schema", messages: [critiqueReply], opts: { maxTokens: 300, schema: CRITIQUE_SCHEMA } },
  { name: "3 evaluator-shaped call", messages: [{ role: "system", content: "You are the Evaluator. Reply with one JSON object only." }, critiqueReply], opts: { maxTokens: 400, schema: CRITIQUE_SCHEMA, lane: "evaluator" } },
  { name: "4 short headline call", messages: [{ role: "user", content: 'Reply with one JSON object {"headline":string}. Under 160 characters. No names.' }], opts: { maxTokens: 200 } },
  { name: "5 longer answer", messages: [{ role: "user", content: 'Reply with one JSON object {"findings":[string,string,string]} with three short sentences about a roof unit that keeps tripping.' }], opts: { maxTokens: 600 } },
];
let failed = 0;
for (const call of calls) {
  const attempts: string[] = [];
  const started = Date.now();
  try {
    const text = await completeJson(call.messages, { timeoutMs: 40_000, onAttempt: (m) => attempts.push(m), ...call.opts });
    console.log(`PASS ${call.name}  ${Date.now() - started} ms  reply ${text.length} chars  attempts: ${attempts.join(" | ")}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${call.name}  ${Date.now() - started} ms  ${(err as Error).message}  attempts: ${attempts.join(" | ")}`);
  }
}
console.log(failed === 0 ? "COMPAT PASS 5 of 5" : `COMPAT FAIL ${failed} of 5`);
process.exit(failed === 0 ? 0 : 1);
