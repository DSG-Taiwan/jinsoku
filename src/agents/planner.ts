import { RequestDeadlineError } from "../deadline.ts";
import type { CallObject, HopOutcome, Plan } from "../schemas.ts";
import { parsePlan } from "../schemas.ts";
import { callSchema } from "./model-json.ts";

const SYSTEM = `You are the Planner for a read-only HVAC triage layer. Reply with one JSON object only:
{"objective":string,"subtasks":string[],"required_data":string[],"success_criteria":string[]}
CAUSE = explain repeat failures with evidence. PATTERNS = cross-unit patterns in a week. NEXT = what to check first.
Do not perform or mutate anything. Do not invent assets, names, or facts. Leave every HAZARD open for a human.`;

export function planFromCall(call: CallObject): Plan {
  const target = call.asset ?? call.period ?? "assets";
  return {
    objective: `${call.verb} ${target}: retrieve issues and memories, draft cited findings, keep HAZARD open for a human`,
    subtasks: ["Query Zetaris issues", "Query H-MEM incident memories", "Draft findings with retrieved ids"],
    required_data: ["synthetic issues", "hmem incident memories"],
    success_criteria: ["every claim cites retrieved ids", "zetaris and hmem both cited", "HAZARD stays open"],
  };
}

export async function plan(
  call: CallObject,
  timeoutMs: number,
  onRepair?: (m: string) => void,
  signal?: AbortSignal,
  remaining?: () => number,
  clock?: { hold(): void; resume(): void },
): Promise<HopOutcome<Plan>> {
  try {
    const value = await callSchema(
      SYSTEM,
      { call: { verb: call.verb, asset: call.asset, period: call.period, role: call.role } },
      parsePlan,
      timeoutMs,
      onRepair,
      signal,
      1200,
      undefined,
      remaining,
      clock,
      undefined,
      "planner",
    );
    return { value, fallbackUsed: false, fallbackName: null };
  } catch (err) {
    if (err instanceof RequestDeadlineError) throw err;
    return { value: planFromCall(call), fallbackUsed: true, fallbackName: "planFromCall" };
  }
}
