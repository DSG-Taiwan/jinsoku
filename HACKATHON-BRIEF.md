# Open Agent Hackathon 2026 - Brief
Build an agent that does real work. Where this brief and the Official Rules on the event page disagree, the Official Rules apply.
Build window: 22-27 Oct 2026. Submit well before 23:45 UTC on 27 Oct.

## Required in every submission
- Zetaris integrated (real role), Meterless integrated (real role), developed in Cursor, NVIDIA (Nemotron) wherever it contributes.
- README and metadata.json must say where each sponsor sits / which Meterless engines were used (Sponsor Tech = 10 pts each).
- Public repo, demo video 1-4 min, slide deck, sponsor-tech explanation, pre-existing components declared.

## Disqualifying / unscoreable
Hardcoded outputs; fake agents (no real model/logic call); one prompt wrapped as several agents; linear A->B->C with no feedback loop; mocked Zetaris/Meterless presented as real; committed API keys; irreproducible manual setup steps.

## Build loop
Describe > Generate > Inspect > Run > Log > Test > Refine > Document. Smallest working version first.
Order: entry point > model call > Zetaris + Meterless > agents > logs > Docker > README > optional UI.

## Architecture (simple, strong)
Planner <-> Executor <-> Evaluator with retry/refine. Evaluator critiques; Executor revises; Planner finalizes.
Tracks: Solving Fragmented Intelligence | The Agent That Can Explain Why | Reasoning Architecture | Wildcard [Tinkerer].

## Suggested layout
app/{agents.py, llm.py, tracing.py, adapters/{zetaris.py, meterless.py}}, data/, scripts/, run.py (POST /run :8000), requirements.txt, Dockerfile, input_examples/ (>=3), output_examples/ (>=3 REAL outputs, never loaded at runtime), logs/, .env.example, README.md.

## Env (.env, never committed)
MODEL_API_KEY, MODEL_BASE_URL, MODEL_NAME, ZETARIS_REST_URL (default http://localhost:8888/api/v1.0), ZETARIS_ORG_ID, ZETARIS_API_KEY, METERLESS_API_KEY, SAMPLE_MODE=false.
Keep the product's model key OUT of Cursor settings.

## Zetaris call
POST {ZETARIS_REST_URL}/sql-editor/sqls/run, headers Authorization: Bearer key, X-Org-ID, X-Request-ID (fresh UUID); body {queryId, sql, source:"SqlEditor", limit}.

## Logs (JSONL in logs/ + stdout)
Fields: timestamp, trace_id, agent_name, action, input_summary, output_summary, target_agent, confidence, retry_count, status. Must show handoffs and at least one evaluator critique + revision.

## Request/response contract
Request: request_id, user_query, context{track}. Response: request_id, trace_id, status, agents_used, result{summary, findings, confidence}, collaboration{feedback_loop_completed, revision_count, evaluator_findings}, log_path.

## Anti-hardcoding checks
grep -R "return {" app/ run.py ; grep -R "output_examples" app/ run.py. Run two unrelated queries; outputs must differ. SAMPLE_MODE loads sample INPUTS only.

## Six-day plan
- By 21 Oct: Cursor + Zetaris + Meterless set up, workshops watched.
- D1 22 Oct: track/user/output; scaffold; connect Zetaris+Meterless; one real e2e run.
- D2 23 Oct: planner/executor/evaluator loop; JSONL logs.
- D3 24 Oct: data, sample mode, retries/errors; mid-build "what fails if we submit tomorrow?"
- D4 25 Oct: prompts/quality; Docker; fresh-clone validation.
- D5 26 Oct: real output examples; README, sponsor explanation, deck; demo video.
- D6 27 Oct: final audit, secrets check, declare pre-existing components, submit.

## Final checklist
Entry point documented | requirements/.env.example/README | 3 inputs + 3 real outputs | no keys committed | repo public | >=2 distinct agents + feedback loop | logs tied to request | README matches code | runs from clean clone | Docker builds.

## Local notes (this machine)
- Meterless starter in this folder is TypeScript/Node (src/, notebook.ts, package.json), while the guide scaffolds Python/FastAPI. Decide stack on D1; Python 3.11 is installed alongside 3.14 (`py -3.11`).
- Meterless engines: https://github.com/Meterless/Meterless (H-MEM, World Model, Markovian, Scout Intent; Apache 2.0). Template prompts: meterless.ai/engines.html.
- Zetaris instance/docs and NVIDIA key/credits: "TBC" on HackOS until 22 Oct.
- NVIDIA key route: build.nvidia.com, base URL https://integrate.api.nvidia.com/v1.
- Docker Desktop installed; may need reboot/first launch.
