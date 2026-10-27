# Jinsoku (迅速): a gated agent layer over SpeedStack (Open Agent Hackathon 2026)

Wildcard [Tinkerer]. Jinsoku is a propose-only agent layer for a maintenance floor. A person asks about one unit or about the whole fleet; the layer answers only from the incident records, shows the evidence, says what it did not cover, and proposes what a human might check. It never writes to GitHub Issues, Redis or any other store, and a person decides what to do with the answer.

It sits beside SpeedStack, the existing HVAC operations engine (see "Pre-existing components"). It does not call the SpeedStack state machine.

## What it does

The board has three requests, and a fleet strip that shows which units need a look:

| Board button | Request underneath | What it returns |
|---|---|---|
| Diagnose | `CAUSE <asset>` | The unit's repair history, warning rules (3 or more repairs that did not hold; repeated airflow fixes plus coil icing), open hazards, and a proposed escalation when a rule fires. |
| All-unit repair history | `PATTERNS thisweek`, `PATTERNS lastweek` or `PATTERNS FROM..TO` | Every unit's repairs for the period or an ISO date range (for example `2026-10-01..2026-10-21`, bounded by the data window), with failed repairs grouped by technician. |
| Latest incidents | `NEXT <asset>` | The unit's most recent incidents from the next-step model's chain, plus unit-graph facts. |

Anything else is refused and logged. Role `lead` may run the requests; role `tech` is denied, and a denied or unrecognized request never reaches a model.

How an answer is made: a request is gated (command, asset, role, rate limit); retrieval reads Zetaris (read-only SQL), H-MEM, the World Model and, for `NEXT`, Markovian; the Planner is code; the Executor builds the draft from the retrieved rows; an Evaluator reviews it and the draft is revised at most twice, then withheld. A release contract decides what a person sees: every sentence is built by code from the records, quoted verbatim from a cited record, or (only when `MODEL_ANALYSIS=on`, off by default) a claim selected from closed lists and verified by code. An open HAZARD is never closed or downgraded by the layer; that rule is code, not a prompt. NVIDIA Nemotron reviews drafts as the Evaluator and, when analysis is on, selects claims; code plans, verifies and writes the released words.

The stack is TypeScript on Node.js. Setup and run steps are below. Sponsor facts for the written submission are in `docs/INTEGRATION.md`.

Provisional patent applications 64/101,544 (filed June 29, 2026) and 64/181,592 (filed October 21, 2026). The first covers the pre-existing base engine. The second covers the new gated agent layer. The design is described in the filing; the implementation was written during the build window.

## What you need

- Node.js 22 and npm
- Docker, if you run the container path below
- A local Zetaris you control. This project does not ship one
- Python 3, only for the one-time static file server used while loading the synthetic tables
- Keys and URLs in `.env`, from the names in `.env.example`. This repo has no key values

## Setup from a clean clone

```bash
npm install
npm run setup
copy .env.example .env
```

On a Unix shell, use `cp .env.example .env`.

`npm run setup` copies the pre-existing Meterless H-MEM reference, World Model, and Markovian reference into `vendor/` (that directory is gitignored) and installs H-MEM's own packages. World Model and Markovian have no install step.

Edit `.env`. Names only are in git:

- `MODEL_BASE_URL`, `MODEL_API_KEY`, `NEMOTRON_MODEL`: your model route
- `ZETARIS_REST_URL`: your Zetaris REST root. The sample value is `http://localhost:8888/api/v1.0`. `ZETARIS_ORG_ID` is the numeric org id. `ZETARIS_API_KEY` is your key
- Meterless does not take a key. H-MEM, World Model, and Markovian start inside this process. H-MEM and World Model files land in `data/hmem` and `data/world`, which are gitignored. Markovian keeps its carryover in memory for that call and does not write a store
- `MODEL_ANALYSIS=on` turns on model-selected claims; the default is off
- `SAMPLE_MODE=false` for a normal run. `SAMPLE_MODE=true` makes the CLI read only files inside `input_examples/`. It does not skip or fake a Zetaris or Meterless call
- `PORT` defaults to `8000`

Load the synthetic HVAC tables into your Zetaris once. From this repo, with Zetaris up:

```bash
npx tsx scripts/build-synthetic.ts
python -m http.server 8765 --directory data/synthetic/csv
npx tsx scripts/load-hvac.ts
```

`load-hvac.ts` reads that file server at `host.docker.internal:8765` because Zetaris itself is in Docker. After `CACHE TABLE`, queries no longer need the file server. Stop the Python server when the load finishes. The tables are synthetic: 12 units and 67 incidents. There is no student, staff, or customer data.

Then:

```bash
npm test
npm start
```

`npm test` runs the suite one file at a time. `npm start` serves the board at `http://localhost:8000` and `POST /run` on the same port. `GET /health` reports whether each required env name is set, and whether Zetaris answered `SELECT 1` and H-MEM loaded. It does not print secret values. `GET /fleet` is read-only and lists the units that need a look.

## Docker

Zetaris stays on the host. The container runs this app, including the in-process Meterless engines. `vendor/` is not in git; the image downloads those engines during `docker build`.

```bash
docker build -t jinsoku .
docker run --env-file .env -p 8000:8000 -e ZETARIS_REST_URL=http://host.docker.internal:8888/api/v1.0 jinsoku
```

Open `http://localhost:8000`. Same board, same `POST /run`. Do not commit `.env`. The image build context excludes it.

## Usage

Send a file with the CLI, or POST the same JSON to `/run`.

```bash
npx tsx src/cli.ts input_examples/cause-ssa-001.json
npx tsx src/cli.ts input_examples/patterns-thisweek.json
npx tsx src/cli.ts input_examples/next-ssa-002.json
npx tsx src/cli.ts input_examples/unprocessed.json
npx tsx src/cli.ts input_examples/tech-denied.json
```

`patterns-lastweek.json` is a second period sample. `unprocessed-injection.json` is free text that must not reach the model. Repeating a `request_id` with the same role and the same phrase returns the stored result. A different role or a different phrase with that id is refused.

The board reads `GET /runs` and `GET /runs/:trace_id`. Reload restores the history and the selected trace from those logs.

## Examples

`output_examples/` holds full responses from real runs on an earlier commit of this layer (2026-10-21 and 2026-10-22). The server never loads that directory. Each file is the stored response, including `trace_id` and `log_path`. Regenerate them by running the CLI commands above.

| File | Phrase | Role | What the run did |
|---|---|---|---|
| `output_examples/cause-ssa-001.json` | `CAUSE SSA-001` | lead | Model draft, evaluator critique, one completed revision, then approval. |
| `output_examples/patterns-thisweek.json` | `PATTERNS thisweek` | lead | Model draft, evaluator critique, one completed revision, then approval. |
| `output_examples/next-ssa-002.json` | `NEXT SSA-002` | lead | Model draft, approved on the first draft, no fallback. |
| `output_examples/unprocessed.json` | free text | lead | Ingest only. Status `UNPROCESSED`. |
| `output_examples/denied.json` | `CAUSE SSA-001` | tech | Ingest only. Status `DENIED`. |

Matching requests are the files of the same name under `input_examples/`, except the denial, which is `input_examples/tech-denied.json`. Logs are `logs/<trace_id>.jsonl` on the machine that produced them; `logs/` is gitignored.

## Logs

One JSONL line per event, written when the call happens: `logs/<trace_id>.jsonl`. Fields include timestamp, trace id, agent, action, summaries, target, confidence, retry count, and status. Retrieval events include the evidence ids and the query text (Zetaris `SELECT`, H-MEM, World Model, and on `NEXT` the Markovian chain). The log is append-only per request; it is not hashed and not tamper-evident. The response field `log_path` points at that file.

## Safety

- Propose only. No write path
- A HAZARD is not closed or downgraded by this layer
- A released claim cites an id that was retrieved on that run
- Synthetic data only
- Unknown text is `UNPROCESSED`. A tech is `DENIED`. Neither call reaches the model

## Measured results

Labeled samples are recorded under `eval/results/` (runs, scores and the scorer's rubric in `eval/RUBRIC.md`). Two recent samples, default configuration (analysis off), one sample each:

- `v8`, commit `00df660`: 39 of 42 correct. All three misses were one case, `NEXT SSA-004`, withheld every time by the evaluator's kind check. The cause was a bug (overlapping retrieved reasons were cut out twice in the claim-binding check); it is fixed in later commits.
- `v9`, commit `fee15e3`: 42 of 42 correct. No invented, missed or downgraded open hazards and no name leaks in either sample.

One sample is not a guarantee, and neither sample was taken on the final commit (date ranges and the `/fleet` check were added afterwards). Earlier samples (`v1` to `v7`) were measured on earlier trees and are in `docs/EVAL.md` and `eval/results/`. Independent QA and audit status is stated in the submission post and is not restated here.

## Limits

- The data is synthetic and the layer is read-only. It does not call the SpeedStack state machine; connecting them, with a recorded human approval step, is future work
- `GET /fleet` counts units from the raw incident data without the row quarantine that a diagnosis applies. On this clean synthetic set the two agree
- A custom `PATTERNS` range filters the issue query, but the answer can also show older "did not hold" rows from the historical and memory sources
- The model client retries an HTTP 5xx once and an empty completion once; the request deadline is 90 seconds. If the model fails, the answer is built from the retrieved records by code, or withheld
- Per-call Nightshift receipt verification and a measured Nightshift run are not built
- Not built: a write path, multi-tenant auth, a cloud deploy, fine-tuning. `hvac.presence_events` is loaded into Zetaris and is not read by the three requests. Markovian runs on `NEXT` only

## Dependencies

Runtime is Node.js 22. The app is TypeScript, started with `tsx` (`npm start`). There is no separate compile step. The only npm package declared here is `tsx`. `npm run setup` and the Docker build install the H-MEM reference's own packages under `vendor/hmem`. World Model is loaded from `vendor/world-model`. Markovian is loaded from `vendor/markovian/reference`. Zetaris is an external local service.

## Pre-existing components

Declared, not modified by this layer:

- The SpeedStack engine and its tests. They are not in this folder
- ArcadePro, the existing SpeedStack board. It is not in this folder and was not modified
- The Meterless starter files in this repo: `notebook.ts`, `src/engine.ts`, `src/llm.ts`. `POST /run` does not call `src/llm.ts`. The agent model client is `src/llm/client.ts`
- Meterless H-MEM, World Model, and Markovian reference engines, Apache-2.0, vendored at setup time into `vendor/`
- Other open-source libraries pulled by npm for this app and for H-MEM

## Precursor flags

Diagnose answers carry up to two deterministic flags, computed in code from the issue rows and citing the rows that triggered them. No model is involved.

- Escalation flag: three fixes that did not hold on one unit, the engine owner's escalation rule, proposed to a lead for human analysis.
- Pattern flag: repeating airflow fixes plus coil icing. This is a draft precursor rule from general HVAC practice and is not validated.

These are flags for a human, not predictions or probabilities. They run on synthetic data only, and nothing about real-world failures was measured.

The board layout is new code in `public/`. No code from any other board is in this repo.

## Where to read next

`docs/INTEGRATION.md` describes how Zetaris, H-MEM, World Model and the NVIDIA model were used. `docs/EVAL.md` records the labeled samples. `.env.example` is the list of config names.
