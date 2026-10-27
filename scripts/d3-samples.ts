import { runRequest } from "../src/orchestrator.ts";

const only = process.argv[2];
const inputs = [
  { request_id: "d3-cause-ssa-001", user_query: "CAUSE SSA-001", role: "lead" },
  { request_id: "d3-cause-ssa-004", user_query: "CAUSE SSA-004", role: "lead" },
  { request_id: "d3-patterns-thisweek", user_query: "PATTERNS thisweek", role: "lead" },
].filter((item) => !only || item.user_query.includes(only));

for (const item of inputs) {
  const started = Date.now();
  const res = await runRequest({
    request_id: item.request_id,
    user_query: item.user_query,
    context: { track: "Wildcard [Tinkerer]", role: item.role },
  });
  const findings = res.result.findings.map((f) => `${f.evidence_ids.join(",")}:${f.claim}`).join(" || ");
  process.stdout.write(
    JSON.stringify({
      query: item.user_query,
      ms: Date.now() - started,
      trace_id: res.trace_id,
      status: res.status,
      fallback_used: res.result.fallback_used,
      fallback_rate: res.collaboration.fallback_rate,
      revision_count: res.collaboration.revision_count,
      summary: res.result.summary,
      next: res.result.human_message,
      findings,
    }) + "\n",
  );
}
