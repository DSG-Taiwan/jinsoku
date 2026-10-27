# Integration facts

Public description of what this repo actually calls. Dates and file paths match the tree. No keys.

## Zetaris

Zetaris runs locally, outside this process. The adapter is `src/adapters/zetaris.ts`. `runSql` posts one statement to `{ZETARIS_REST_URL}/sql-editor/sqls/run` with `Authorization`, `X-Org-ID` (the numeric org id), and a fresh `X-Request-ID`. The body carries `queryId`, the SQL, `source: "SqlEditor"`, and a limit.

`assertReadOnlySql` allows a single `SELECT`. A semicolon is rejected. `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `MERGE`, `CREATE`, `GRANT`, and `REVOKE` are rejected. The agent does not send those verbs.

The Executor in `src/agents/executor.ts` (`retrieve`) is the caller. It reads two qualified tables:

- `hvac.assets` — `asset_id`, `model`, `location`, `zone`
- `hvac.issues` — `issue_id`, `asset_id`, `kind`, `opened_at`, `closed_at`, `reason`, `actor_key`, `fix_outcome`

The SQL strings are built in `src/data/seed.ts` (`assetsSelect`, `issuesSelect`). A `PATTERNS` run adds one more `SELECT` on `hvac.issues` for `fix_outcome = 'did_not_hold'`. `GET /health` sends `SELECT 1 AS one`.

`scripts/load-hvac.ts` loads the synthetic tables once, including `hvac.presence_events`. The three phrases do not query `presence_events`. Rows are synthetic HVAC issues. Citation ids look like `zetaris:<queryId>`. One id from the saved `PATTERNS thisweek` run `38ecfb9d-2d93-4b07-9b09-11dbafad1f7b` is `zetaris:f3c7f5b9-b08a-45c0-afd9-7309e3a83cd0`.

## Meterless H-MEM

H-MEM is the incident memory. It is the reference engine from Meterless, copied into `vendor/hmem` by `npm run setup` or by the Docker build. `src/engine.ts` loads it. `src/adapters/meterless.ts` constructs it in-process with storage under `data/hmem`. There is no Meterless API key.

`seedIncidents` writes synthetic facts from `memoryFacts()` in `src/data/seed.ts`. `queryIncidents` recalls them during `retrieve`. The Executor keeps hits that match the asset on a `CAUSE` or `NEXT` call. Each hit is cited as `hmem:<memory id>`. On the same `PATTERNS` run, the retrieval list includes `hmem:mem-46`, `hmem:mem-34`, and `hmem:mem-70`.

## Meterless World Model

World Model is the unit graph. The reference engine is copied into `vendor/world-model`. `src/adapters/world-model.ts` opens it with namespace `hvac-d3` and storage under `data/world`.

`seedUnitState` upserts one `unit` entity per synthetic asset. For each open HAZARD issue it upserts a `hazard` entity and `relate`s the unit to that hazard with `has_hazard`. `queryUnits` does not read a stored count field. It counts `neighborsOf(unit, { via: "has_hazard" })` where the neighbor type is `hazard`, and the sentence given to the model says the count was read from the world-model graph.

Cited ids look like `worldmodel:<entity id>`. The same `PATTERNS` run cites `worldmodel:unit:hvac:SSA-002`. The saved `NEXT SSA-002` run `5e50f444-b072-4b2f-940b-63acbd20b27b` cites that id as well.

## Meterless Markovian

Markovian compresses one asset's incident chain into the next check. It runs only for `NEXT <asset>`. `CAUSE` and `PATTERNS` do not call it.

The reference is copied into `vendor/markovian` by `npm run setup` or by the Docker build. `src/adapters/markov.ts` loads `vendor/markovian/reference/src/index.ts` and constructs `Markovian` in-process. There is no Meterless API key and no network call. The reference requires an injected `stepFn`. This adapter's step function reads the synthetic chain one incident per chunk. It does not call the NVIDIA model.

The chain is the asset's rows from `data/synthetic/issues.json`, then any later rows in `data/synthetic/incident-sequences.json` for `SSA-001`, `SSA-002`, and `SSA-003`. Those extra rows exist because the catalog history is shorter than a carryover budget. Each chunk's `[STATE_CHECKPOINT]` keeps whole incident lines. Open HAZARD lines stay in that block, and the line says the HAZARD stays open for a human. Older non-hazard lines are dropped when `estimateTokens` (`ceil(chars / 4)`) would pass 128.

Config passed to the reference: `chunkSize` 2000, `maxChunks` equal to the chain length, `carryoverTokens` 128, `overlapTokens` 0. `reflect` is false. `historyDir` is unset, so the reference does not write `history.json`.

`run` returns when `stopWhen` sees `{ step, carryover }` with `step` at the end of the chain. The marker level of `CarryoverService` accepts that checkpoint when it is at least 24 characters and within the token budget. That accepted string is the cited summary.

The cited id is `markov:<asset>`, for example `markov:SSA-001`. After a model draft, `prepareNextDraft` in `src/agents/next-check.ts` sets `recommended_next_check` from that summary. The findings are one full retrieved summary per kind, and one finding whose only evidence id is that markov id. The model draft's own sentences are not copied into the findings. A fallback draft is left unchanged, and the linter does not release it. The Evaluator still reviews the draft. The same linter rule as the other kinds applies: a released draft must cite every retrieved kind, and an id that was not retrieved is rejected. The call is logged when `Markovian.run` returns, action `markov-query`, with that evidence id.

## Scout Intent

Scout Intent was scoped out. This layer calls three Meterless engines: H-MEM, World Model, and Markovian. Scout Intent is not called.

## NVIDIA

The model is NVIDIA Nemotron, through an OpenAI-compatible chat completions client in `src/llm/client.ts`. Config names are `MODEL_BASE_URL`, `MODEL_API_KEY`, and `NEMOTRON_MODEL`.

All three agents use it, with JSON schema output from `src/agents/model-json.ts`:

- Planner: `src/agents/planner.ts`
- Executor draft and revision: `src/agents/executor.ts`
- Evaluator: `src/agents/evaluator.ts`

The client asks for `json_schema` when a schema is provided. An HTTP 5xx is retried once. An empty completion is retried once with `max_tokens` raised to at least 2048. If the hop still fails, that agent uses its retrieved-evidence fallback and the response sets `fallback_used`. The Evaluator can still reject a draft. A released finding has to cite ids from that run's retrieval. The final pass rejects the whole draft when a finding cites an id that was not retrieved, or when the draft says two incidents failed for the same reason and their retrieved reason text differs.

## Cursor

The product code in this repo was written with AI coding assistants (Cursor and Claude Code) from written briefs. Tests and audits were run by separate reviewers who did not author that code. This file does not name a model or a tool as the author of an answer.

## What a judge runs

A judge supplies their own Zetaris and their own model key through `.env`, using the names in `.env.example`. H-MEM, World Model, and Markovian start inside the process after `npm run setup` or `docker build`. Steps are in `README.md`.
