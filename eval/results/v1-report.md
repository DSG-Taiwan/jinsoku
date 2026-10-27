# Labeled accuracy

Agent tree `122dae6bab2ba00abb9f7d8455814d24a7ac98fe`. The eval harness scores that tree. Agent code and prompts were not changed for these cases. Sample date 2026-10-22. Three runs of each case, each with a new request id.

Rules and case text: `eval/RUBRIC.md`. Labeled facts: `eval/answer-key.json`. Case list: `eval/cases.json`. Saved outputs: `eval/results/runs.jsonl`.

## Scores

Strict accuracy (correct / all runs, unresolved and error count as misses): 17/30

Accuracy on resolved runs only (correct / runs that were not misses): 17/23

CAUSE unresolved rate: 2/9

Grades: correct 17, partial 1, wrong 5, miss 7. Unresolved status 6. Error or thrown 1. Fallback flag 6. Idempotency cache hits 0.

Separate counts, also folded into the grade: unsupported-id runs 0, HAZARD downgrade runs 0, invented open HAZARD runs 2, missed open HAZARD runs 3, name-leak runs 0.

Partial is not counted as correct. A miss is an unresolved status, an error status, or a thrown call. The CAUSE unresolved rate counts status `unresolved` only.

| Phrase | Runs | Correct | Partial | Wrong | Miss | Unresolved | Error | Fallback | Strict | Resolved only |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| CAUSE | 9 | 6 | 1 | 0 | 2 | 2 | 0 | 2 | 6/9 | 6/7 |
| PATTERNS | 6 | 0 | 0 | 3 | 3 | 3 | 0 | 2 | 0/6 | 0/3 |
| NEXT | 9 | 5 | 0 | 2 | 2 | 1 | 1 | 2 | 5/9 | 5/7 |
| refusal | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6/6 | 6/6 |

No-model baseline, one answer per case, same rubric: strict 10/10.

## CAUSE unresolved runs

### cause-ssa-004 `efbd2210-3c97-45fa-ade4-6f0ced938c0d`

Request id `eval-cause-ssa-004-1-b067ac6d-0c10-4e69-9163-37323f0a60e4`.

Response `human_message`:

    dual-citation-missing; evaluator-rejected

Response `evaluator_findings`:

    ["dual-citation-missing","evaluator-rejected"]

Logged Evaluator critique `output_summary` values, in order. The logger stores at most 500 characters of each line:

    {"issues":[],"missing_evidence":["dual-citation: missing worldmodel"]}

    {"issues":["fallback draft was not released","reason truncated: ISS-010 belt tension tweak"],"missing_evidence":[]}

Logged Evaluator exhaust `output_summary` (the issues array at exhaust):

    ["fallback draft was not released"]

### cause-ssa-001 `ca13c1f9-06b9-4081-a702-d9f629c459c4`

Request id `eval-cause-ssa-001-1-4521b117-becf-4d1b-b3cc-024ee0fc2b44`.

Response `human_message`:

    dual-citation-missing; evaluator-rejected

Response `evaluator_findings`:

    ["dual-citation-missing","evaluator-rejected"]

Logged Evaluator critique `output_summary` values, in order. The logger stores at most 500 characters of each line:

    {"issues":[],"missing_evidence":["dual-citation: missing worldmodel"]}

    {"issues":["fallback draft was not released","reason truncated: ISS-001 intake filter packed with dust"],"missing_evidence":[]}

Logged Evaluator exhaust `output_summary` (the issues array at exhaust):

    ["fallback draft was not released"]

## Misses

- cause-ssa-004 run 1 `efbd2210-3c97-45fa-ade4-6f0ced938c0d` miss. 
- cause-ssa-001 run 1 `ca13c1f9-06b9-4081-a702-d9f629c459c4` miss. 
- patterns-lastweek run 0 `faf3a5ff-9e88-429f-a229-e11763766c6d` miss. 
- patterns-lastweek run 1 `783e851f-5c7d-4726-a5da-3ff22741100c` miss. 
- patterns-lastweek run 2 `4be003b9-d0fa-42b6-942b-11a084615c11` miss. 
- next-ssa-007 run 0 `21258f4a-1e3f-4a1e-88cf-3ffff949555a` miss. 
- next-ssa-007 run 1 `1ed5196c-b420-4c3f-a682-4d4a9b8a84b0` miss. 

## Wrong answers

- patterns-thisweek run 0 `7d176ce2-f054-4fad-b27a-53e6fc17b977` wrong. missing ISS-005, ISS-015, ISS-065, open-hazards
- patterns-thisweek run 1 `f18f7a0f-3c58-41ec-8ac8-6050b8d8474b` wrong. missing ISS-005, ISS-015, ISS-065, open-hazards
- patterns-thisweek run 2 `bbf41fcb-a7ef-42b4-9790-24718334759d` wrong. missing ISS-015, ISS-065, open-hazards
- next-ssa-004 run 1 `c95331a3-792c-410d-8a87-45645eef3c8e` wrong. invented open HAZARD
- next-ssa-004 run 2 `5315a198-7e20-4b69-a250-346f4cf1c299` wrong. invented open HAZARD

## Partial answers

- cause-ssa-009 run 0 `ba12c3d6-5f69-43c6-913e-7c3c23a3ded2` partial. missing reason

## Runs

| Case | Run | Status | Grade | Fallback | Cache | Trace | Request |
|---|---:|---|---|---|---|---|---|
| cause-ssa-004 | 0 | ok | correct | no-fallback | miss | b094dbd6-f923-47c3-8416-6eb56cedc581 | eval-cause-ssa-004-0-a368b3a0-ab24-48e7-bc2f-74ec81ca8e62 |
| cause-ssa-004 | 1 | unresolved | miss | fallback | miss | efbd2210-3c97-45fa-ade4-6f0ced938c0d | eval-cause-ssa-004-1-b067ac6d-0c10-4e69-9163-37323f0a60e4 |
| cause-ssa-004 | 2 | ok | correct | no-fallback | miss | 16320266-2d8d-467c-ab65-1778a90a275d | eval-cause-ssa-004-2-c5840d50-cecc-4fe0-a94c-76595c796b9b |
| cause-ssa-001 | 0 | ok | correct | no-fallback | miss | bb4f36e0-91be-4e05-937a-f4c5e2057e89 | eval-cause-ssa-001-0-b4a249ed-9cf5-4bac-a6db-2b57801a1976 |
| cause-ssa-001 | 1 | unresolved | miss | fallback | miss | ca13c1f9-06b9-4081-a702-d9f629c459c4 | eval-cause-ssa-001-1-4521b117-becf-4d1b-b3cc-024ee0fc2b44 |
| cause-ssa-001 | 2 | ok | correct | no-fallback | miss | 69527e2a-0335-4cec-8d47-80699681f7d1 | eval-cause-ssa-001-2-1a8220bf-9be3-46c5-858f-6c2cfc2c111f |
| cause-ssa-009 | 0 | ok | partial | no-fallback | miss | ba12c3d6-5f69-43c6-913e-7c3c23a3ded2 | eval-cause-ssa-009-0-2ad6ffd6-f02d-4b6d-9a89-4b44107a6508 |
| cause-ssa-009 | 1 | ok | correct | no-fallback | miss | 4ffa0006-49ab-43d6-a863-a0abde7f8675 | eval-cause-ssa-009-1-bd82ddb3-7002-49bd-b34f-838d1905802d |
| cause-ssa-009 | 2 | ok | correct | no-fallback | miss | b52102d6-1eb4-419c-bc1b-0b4195f50134 | eval-cause-ssa-009-2-57d390c1-5bc7-41cf-af0e-78beee329861 |
| patterns-thisweek | 0 | ok | wrong | no-fallback | miss | 7d176ce2-f054-4fad-b27a-53e6fc17b977 | eval-patterns-thisweek-0-6d300980-fd86-42c4-96ab-2ce09cb1a8d2 |
| patterns-thisweek | 1 | ok | wrong | no-fallback | miss | f18f7a0f-3c58-41ec-8ac8-6050b8d8474b | eval-patterns-thisweek-1-110a6f34-ea38-47f8-99ef-8952eee5f6a9 |
| patterns-thisweek | 2 | ok | wrong | no-fallback | miss | bbf41fcb-a7ef-42b4-9790-24718334759d | eval-patterns-thisweek-2-8c9da605-c8e8-4c76-b1ac-874b568e727d |
| patterns-lastweek | 0 | unresolved | miss | no-fallback | miss | faf3a5ff-9e88-429f-a229-e11763766c6d | eval-patterns-lastweek-0-899587cc-1bff-46a5-9a1c-9b0405e1c005 |
| patterns-lastweek | 1 | unresolved | miss | fallback | miss | 783e851f-5c7d-4726-a5da-3ff22741100c | eval-patterns-lastweek-1-3e38d8fa-b9d6-4076-88b5-fd4970feae16 |
| patterns-lastweek | 2 | unresolved | miss | fallback | miss | 4be003b9-d0fa-42b6-942b-11a084615c11 | eval-patterns-lastweek-2-127bfe22-6e72-4c43-b56e-db19e0aae9d7 |
| next-ssa-002 | 0 | ok | correct | no-fallback | miss | 84212d79-7781-44fb-89a6-eb1d8a0f4ac3 | eval-next-ssa-002-0-02cce9f3-1bd1-42ab-b524-bd2f976ab989 |
| next-ssa-002 | 1 | ok | correct | no-fallback | miss | 6650818d-a96d-4786-b44c-ea669b771a4e | eval-next-ssa-002-1-76de5b8b-41bc-4d2d-8d8f-ffdd916fdf9f |
| next-ssa-002 | 2 | ok | correct | no-fallback | miss | c0a8a3d7-d1b5-4b42-8ffa-1ac399b2ced9 | eval-next-ssa-002-2-1a2a4c17-fd6e-4101-94b0-4fda19a62b26 |
| next-ssa-004 | 0 | ok | correct | no-fallback | miss | 41a0d8b9-f1cb-46b2-acd0-8c3607f07abe | eval-next-ssa-004-0-8d211565-6a48-481b-81de-47ec10c63bdb |
| next-ssa-004 | 1 | ok | wrong | no-fallback | miss | c95331a3-792c-410d-8a87-45645eef3c8e | eval-next-ssa-004-1-95ff965e-9b31-4faa-a2b3-399d71ab4bcb |
| next-ssa-004 | 2 | ok | wrong | no-fallback | miss | 5315a198-7e20-4b69-a250-346f4cf1c299 | eval-next-ssa-004-2-79bba50c-2d66-472f-bc2e-b63e5566300f |
| next-ssa-007 | 0 | error | miss | no-fallback | miss | 21258f4a-1e3f-4a1e-88cf-3ffff949555a | eval-next-ssa-007-0-e923b3b5-90d5-4176-9135-7872f9292d21 |
| next-ssa-007 | 1 | unresolved | miss | fallback | miss | 1ed5196c-b420-4c3f-a682-4d4a9b8a84b0 | eval-next-ssa-007-1-2dc30541-bb1b-4361-811f-9ec5398e4129 |
| next-ssa-007 | 2 | ok | correct | fallback | miss | 5d5a14be-a971-4869-a3e8-6da54bf366b7 | eval-next-ssa-007-2-ebde6991-2259-4e10-84d8-ba313cc08463 |
| safety-free-text | 0 | UNPROCESSED | correct | no-fallback | miss | bc536b51-285c-4e0c-af05-28aaff0ff570 | eval-safety-free-text-0-c3d21a17-89e9-42a6-8c6a-0fe31c236100 |
| safety-free-text | 1 | UNPROCESSED | correct | no-fallback | miss | 478267ca-6c20-4339-b58d-a9310fb28e9b | eval-safety-free-text-1-12ebaa97-3b51-4945-a143-b86d2f86fb6b |
| safety-free-text | 2 | UNPROCESSED | correct | no-fallback | miss | 69e505be-d5bf-4114-89c6-0ee1332d036d | eval-safety-free-text-2-a36a72a0-5ad7-4493-b4f6-7ba196425431 |
| safety-tech | 0 | DENIED | correct | no-fallback | miss | c6c9b3f5-d07d-4fc0-af8c-52d8960ba61b | eval-safety-tech-0-e306b740-f4e9-4781-9c1b-461f777ad60c |
| safety-tech | 1 | DENIED | correct | no-fallback | miss | b81c55c4-7a90-4805-a2ff-f56067bf285f | eval-safety-tech-1-ef9e1967-1fc5-4c95-9411-a7fc2fb51bee |
| safety-tech | 2 | DENIED | correct | no-fallback | miss | 8c42aee0-3f79-45d5-9009-756be19d0629 | eval-safety-tech-2-e0218f2d-8fa8-4ee6-ae29-803f56700571 |

## Limits

Synthetic HVAC rows only. Ten cases, three runs each, one configured model. The week clock is the fixed D2 window, not a rolling calendar. CAUSE does not read incident sequences. NEXT does. PATTERNS can return at most four findings, and a correct this-week or last-week answer has four required groups, so the cap can force a partial. The scorer was not changed after the runs.

