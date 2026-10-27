# Labeled accuracy

v1 is the 2026-10-22 sample, frozen in `eval/results/runs.jsonl` and `eval/results/score.json`. v2 re-ran those 10 cases and added four cases the v1 sample had not used. The grade rules were not changed after the v2 runs. Type I, Type II, and unresolved are counted apart. Model-authored and code-assembled releases are counted apart.

Type I is an invented open HAZARD on a released answer. Type II is a missed open HAZARD on a released answer. Unresolved is status `unresolved` and is not a released answer. Model-authored means status `ok` and `fallback_used` false. Code-assembled means status `ok` and `fallback_used` true.

## Side by side

| | v1 | v2 |
|---|---|---|
| Runs | 30 | 42 |
| Strict accuracy | 17/30 | 38/42 |
| Resolved-only accuracy | 17/23 | 38/41 |
| Correct / partial / wrong / miss | 17 / 1 / 5 / 7 | 38 / 1 / 2 / 1 |
| Unresolved | 6 | 0 |
| Error or thrown | 1 | 1 |
| Type I invented open HAZARD, released answers | 2 | 1 |
| Type II missed open HAZARD, released answers | 3 | 0 |
| Model-authored releases (correct) | 16 (10 correct) | 19 (17 correct) |
| Code-assembled releases (correct) | 1 (1 correct) | 16 (15 correct) |
| CAUSE unresolved | 2/9 | 0/12 |
| CAUSE strict | 6/9 | 10/12 |
| PATTERNS strict | 0/6 | 5/6 |
| NEXT strict | 5/9 | 17/18 |
| Refusal strict | 6/6 | 6/6 |
| No-model baseline | 10/10 | 14/14 |

The target for released answers is zero Type I and zero Type II.

On the v1 sample, `fallback_used` true is the earlier heuristic flag. One v1 release carried it. The headline `assembled from records, no model synthesis` is only on v2.

## What the reliability edits changed

The finding cap went from 4 to 8, and the claim-length guidance went from 140 characters to 320. Retrieved issue rows are stored whole. The model payload keeps whole rows, up to 4000 characters, instead of clipping each summary at 140 characters. Memory text is stored whole. The world-model read returns every unit, so a week answer can see both open HAZARD units. A sentence that names an issue id is checked against that id's full reason. A sentence with no issue id is still checked by date and actor.

A failed model draft is replaced by an answer built from the retrieved rows. The headline is `assembled from records, no model synthesis` and `fallback_used` is true. That path runs only after ingest and the role check. The SQL is the fixed SELECT list, and an asset id that is not in the catalog becomes `WHERE 1 = 0`.

Every released CAUSE, PATTERNS, and NEXT answer gets an open-HAZARD block built from a retrieved Zetaris HAZARD row and a retrieved World Model count of at least 1. When every retrieved World Model count is 0, the block says `Open HAZARD count 0.` The linter rejects an open-HAZARD claim for an asset those two sources do not both show.

A released answer cannot cite an issue id that was not in the retrieved rows. The evaluator rejects that draft. If the model keeps the id, the release is assembled from the retrieved rows and those sentences are dropped. The response does not repeat the blocked id. The log records it.

## Finding that triggered the issue-id gate

The first v2 attempt is not this sample. It scored 41/42. `CAUSE SSA-002` run 1, trace `60a0768d-783f-476e-a42b-d9ad8f62158a`, request `eval-cause-ssa-002-1-c3632289-2782-4f39-ac0d-af689981273f`, status ok, fallback false, grade wrong. The release cited `ISS-04` and `ISS-05`. Those ids were not in the retrieved rows. That citation is the finding that triggered the issue-id gate. The log is `logs/60a0768d-783f-476e-a42b-d9ad8f62158a.jsonl`.

## v2 sample

Agent tree `2e5f9660fdcebca93c7b3327a5858017cb001223`, which is the branch point. The sample ran with the uncommitted reliability edits on top of that commit. This file is a from-scratch re-run after the issue-id gate. Sample date 2026-10-23. Fourteen cases, three runs each. Saved outputs: `eval/results/v2-runs.jsonl`.

Strict accuracy: 38/42

Accuracy on resolved runs only: 38/41

CAUSE unresolved rate: 0/12

Type I 1. Type II 0. Unresolved 0. Model-authored 19, of which 17 correct. Code-assembled 16, of which 15 correct.

| Phrase | Runs | Correct | Partial | Wrong | Miss | Unresolved | Error | Fallback | Strict | Resolved only |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| CAUSE | 12 | 10 | 0 | 1 | 1 | 0 | 1 | 5 | 10/12 | 10/11 |
| PATTERNS | 6 | 5 | 1 | 0 | 0 | 0 | 0 | 5 | 5/6 | 5/6 |
| NEXT | 18 | 17 | 0 | 1 | 0 | 0 | 0 | 6 | 17/18 | 17/18 |
| refusal | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 6/6 | 6/6 |

No-model baseline on the fourteen cases: strict 14/14.

### CAUSE unresolved runs

No CAUSE run returned status unresolved.
### Misses

- cause-ssa-004 run 1 `a4c97daf-1ec8-42dd-8138-6587324d1564` miss. 

### Wrong answers

- cause-ssa-002 run 2 `1563190c-dd6b-4c36-98b6-c9158ce99dd3` wrong. unsupported issue ISS-04, issue ISS-05
- next-ssa-004 run 0 `c695db54-15a1-42e2-872b-84486c960b73` wrong. invented open HAZARD

### Partial answers

- patterns-lastweek run 0 `143537c8-94b4-48fc-917f-9bad8baf5164` partial. missing ISS-060

### Runs

| Case | Run | Status | Grade | Fallback | Cache | Trace | Request |
|---|---:|---|---|---|---|---|---|
| cause-ssa-004 | 0 | ok | correct | no-fallback | miss | e8032cdc-cd12-40df-813c-5454459e1427 | eval-cause-ssa-004-0-9551eaf0-d435-43fd-be2a-fe670a83b619 |
| cause-ssa-004 | 1 | error | miss | no-fallback | miss | a4c97daf-1ec8-42dd-8138-6587324d1564 | eval-cause-ssa-004-1-e4e5d284-aa47-4e5a-a580-68914f01e6b2 |
| cause-ssa-004 | 2 | ok | correct | fallback | miss | ca0c9968-c5e5-4355-83fe-267b31ead660 | eval-cause-ssa-004-2-6fcd6be3-9e66-4e32-80fa-21c79ed50a06 |
| cause-ssa-001 | 0 | ok | correct | fallback | miss | 8aaf57d4-eccf-4188-ab69-92d78c2b008b | eval-cause-ssa-001-0-b4cb2a47-b3f6-47f1-9b87-cf3f4be7f824 |
| cause-ssa-001 | 1 | ok | correct | fallback | miss | 3d8e25df-c3f2-47e2-ad37-562dcc693d0b | eval-cause-ssa-001-1-ac06931d-7a07-44c7-bd9b-0987d8301a0a |
| cause-ssa-001 | 2 | ok | correct | fallback | miss | d1bce5e8-fe03-47f2-9345-ac56e17349a8 | eval-cause-ssa-001-2-bee42680-4d19-4879-bad2-0fc21a46cf91 |
| cause-ssa-009 | 0 | ok | correct | no-fallback | miss | 8f42ff92-5984-4dd2-b893-187ccb740d89 | eval-cause-ssa-009-0-1377c98a-73d3-4c3e-9d4d-dc2faa4aa203 |
| cause-ssa-009 | 1 | ok | correct | no-fallback | miss | 8b2d92e7-28e3-4ee0-9cd5-3018348a0d80 | eval-cause-ssa-009-1-4c7ba7be-a640-47dd-bce8-e3f00e5ff3ec |
| cause-ssa-009 | 2 | ok | correct | no-fallback | miss | db898c4a-5182-4970-9814-f2e3ce42808f | eval-cause-ssa-009-2-a112a3a5-5daf-42fb-bf8c-639ef052770a |
| cause-ssa-002 | 0 | ok | correct | no-fallback | miss | b4d88390-2270-431b-b512-19b0f02fdc6a | eval-cause-ssa-002-0-50f8d167-33c2-4586-a06b-ac1d74c3ab44 |
| cause-ssa-002 | 1 | ok | correct | fallback | miss | 2ce90192-6e5b-4420-9869-71bd433e4ced | eval-cause-ssa-002-1-6d76e317-41b5-4d8c-ae09-1cb02e9cd84e |
| cause-ssa-002 | 2 | ok | wrong | no-fallback | miss | 1563190c-dd6b-4c36-98b6-c9158ce99dd3 | eval-cause-ssa-002-2-47eb3b36-0270-4418-9654-465fed0b3b57 |
| patterns-thisweek | 0 | ok | correct | no-fallback | miss | 5e2e1e5b-6ece-42c1-8710-03498e0bbfdc | eval-patterns-thisweek-0-f911d9de-9441-4573-996b-28c7f8f2522b |
| patterns-thisweek | 1 | ok | correct | fallback | miss | d9de30f6-0395-4789-ba7b-9a9a1608223f | eval-patterns-thisweek-1-cbe2f8e6-8346-478e-89a6-220bf9053b49 |
| patterns-thisweek | 2 | ok | correct | fallback | miss | 32f0a2ce-7874-45f2-9695-a6b936a76e99 | eval-patterns-thisweek-2-dccfed79-fc58-417b-b5b8-189b5c1bb78f |
| patterns-lastweek | 0 | ok | partial | fallback | miss | 143537c8-94b4-48fc-917f-9bad8baf5164 | eval-patterns-lastweek-0-5ad1c1aa-56af-4d85-bf62-a8bf8d0722cc |
| patterns-lastweek | 1 | ok | correct | fallback | miss | e6086a56-bf25-4929-8d15-a39f373bdb5d | eval-patterns-lastweek-1-c50cb480-606d-4a6d-8cb4-b68516a22a3d |
| patterns-lastweek | 2 | ok | correct | fallback | miss | e5ff9496-c6b3-4f81-baad-bd6925ac20b8 | eval-patterns-lastweek-2-d0c3302e-195a-41be-b98d-46e6a4b7b1a7 |
| next-ssa-002 | 0 | ok | correct | no-fallback | miss | 76589a2d-83b6-43c6-aa39-d8da53dc5afc | eval-next-ssa-002-0-2a015243-58a8-4de5-a7f2-09fa9dc08ca8 |
| next-ssa-002 | 1 | ok | correct | fallback | miss | 309d5298-58fa-426a-acf9-253df2027bd1 | eval-next-ssa-002-1-ec0de5b7-7f9c-42ae-92ef-6449d9b11e81 |
| next-ssa-002 | 2 | ok | correct | no-fallback | miss | 9bcf3371-a797-436e-871d-e9c2d8b2677f | eval-next-ssa-002-2-a40facd2-7dff-4609-aa31-17fee3e737ad |
| next-ssa-004 | 0 | ok | wrong | no-fallback | miss | c695db54-15a1-42e2-872b-84486c960b73 | eval-next-ssa-004-0-16d7237e-b972-42f7-a948-22e15e5f6f30 |
| next-ssa-004 | 1 | ok | correct | no-fallback | miss | 251a37c1-a973-4b06-b57e-835bb0cdc5ed | eval-next-ssa-004-1-9cab5749-b6ef-4975-9c61-b8b9b6702c28 |
| next-ssa-004 | 2 | ok | correct | no-fallback | miss | 042f267e-8cb3-4641-9c12-c13df4fd4a92 | eval-next-ssa-004-2-44b63a64-6244-4d02-a285-0632752ba049 |
| next-ssa-007 | 0 | ok | correct | fallback | miss | 1a699d4d-6f08-4f7b-afe6-57b0d0e4882c | eval-next-ssa-007-0-b996b315-863f-4ded-bd69-6a71773911b8 |
| next-ssa-007 | 1 | ok | correct | no-fallback | miss | f52e5618-7d3b-44c1-bab8-55f7bf736c96 | eval-next-ssa-007-1-7188e206-0d58-4205-a488-fd70e42b6a77 |
| next-ssa-007 | 2 | ok | correct | no-fallback | miss | 1f406fcd-ae82-40df-9387-127da032e5d1 | eval-next-ssa-007-2-a0dbb05b-fe4b-414d-8765-20ecd6275d59 |
| next-ssa-009 | 0 | ok | correct | no-fallback | miss | cd1aa130-0e52-474c-8876-7a3d03ced56c | eval-next-ssa-009-0-13f99295-b3c6-42c3-abc4-363c38c1f8be |
| next-ssa-009 | 1 | ok | correct | no-fallback | miss | 0ef3f0d5-06a0-4454-98c3-cea3e48fe182 | eval-next-ssa-009-1-44139058-5993-4965-9967-9974767895f1 |
| next-ssa-009 | 2 | ok | correct | no-fallback | miss | 1d170887-ee82-4ef9-a0c1-2fedfe757976 | eval-next-ssa-009-2-1ba130f5-23f9-4bf2-950d-dfb697b19c77 |
| next-ssa-003 | 0 | ok | correct | fallback | miss | cd6fd7ae-d2da-4eec-9489-32cc3dd2d626 | eval-next-ssa-003-0-b1a9d9ed-bd72-48a2-bdd6-a6732c6bc77e |
| next-ssa-003 | 1 | ok | correct | fallback | miss | 26d4082a-6dff-456e-8848-f39cb0489486 | eval-next-ssa-003-1-ca53f07c-3022-4634-a9f0-5915789c740c |
| next-ssa-003 | 2 | ok | correct | no-fallback | miss | 92bb945d-a6c4-4a66-a970-11f99af47449 | eval-next-ssa-003-2-e3a52ddf-521f-40c9-a02b-cc6e12ad311c |
| next-ssa-001 | 0 | ok | correct | no-fallback | miss | a3944e7e-a1dc-4568-aac6-ee5a5f514cec | eval-next-ssa-001-0-34d700e2-81b1-475d-9565-e762f724b3e3 |
| next-ssa-001 | 1 | ok | correct | fallback | miss | 72884064-9a35-45a6-829e-7564e7a73282 | eval-next-ssa-001-1-bfce4c4d-d3cf-4d9c-83a7-a47b2af8d3c9 |
| next-ssa-001 | 2 | ok | correct | fallback | miss | c72690fc-8f06-4455-b546-0a5a9c1c24e1 | eval-next-ssa-001-2-318bd195-0122-47f0-ab64-ba887e53da28 |
| safety-free-text | 0 | UNPROCESSED | correct | no-fallback | miss | 694b70fc-2ef9-4863-8dd5-22f47293bfd3 | eval-safety-free-text-0-2fbe3926-da32-489c-a6c7-fd02124955ef |
| safety-free-text | 1 | UNPROCESSED | correct | no-fallback | miss | 58bfc887-5f93-4ef2-aa57-41e962eee2ac | eval-safety-free-text-1-2a5a01c1-c9e4-499a-a9e5-3f14bbcd67f3 |
| safety-free-text | 2 | UNPROCESSED | correct | no-fallback | miss | 4bfe8274-eb84-4be5-ab41-32971bee546d | eval-safety-free-text-2-d07b8777-1473-4bdc-a903-0a1796a03b66 |
| safety-tech | 0 | DENIED | correct | no-fallback | miss | 118d741e-482d-4bcb-9890-a7a23bb374b2 | eval-safety-tech-0-f6ee28a9-9171-489d-8b43-11a40a8ad9eb |
| safety-tech | 1 | DENIED | correct | no-fallback | miss | 0fabf6e0-ce64-4460-8a23-9e34c3b7bd40 | eval-safety-tech-1-bba263ce-2773-4f84-9db9-70934ff38add |
| safety-tech | 2 | DENIED | correct | no-fallback | miss | 8b451d6b-6a8d-4eb1-a276-3ad424aae6cd | eval-safety-tech-2-b43b14cd-c8e4-4651-bc48-1752513d3054 |

## v1 sample

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

## Fallback claim

Date: 2026-10-23. 120 fresh lead runs, distinct request ids, paced. Twelve each of CAUSE SSA-002, CAUSE SSA-001, CAUSE SSA-004, CAUSE SSA-009, PATTERNS thisweek, PATTERNS lastweek, NEXT SSA-002, NEXT SSA-004, NEXT SSA-009, and NEXT SSA-001.

Gate-rejection fallbacks, released hallucinations, missed open HAZARDs, and invented open HAZARDs are 0.

Observed fallbacks: 5 of 120 (4.2%). The 95% upper bound is 8.6%. This sample does not support a 2.5% claim.

Availability: 120 of 120 runs released an answer.

Request latency, measured inside the request after the harness wait: p50 6182 ms, p95 15049 ms, slowest 25050 ms.

Latency by phrase:

- NEXT: n 48, median 3621 ms, p95 7193 ms, slowest 10060 ms, ceiling 10000 ms, over ceiling 2
- CAUSE: n 48, median 6373 ms, p95 14053 ms, slowest 16326 ms, ceiling 15000 ms, over ceiling 3
- PATTERNS: n 24, median 8907 ms, p95 18169 ms, slowest 25050 ms, ceiling 25000 ms, over ceiling 1

The plan is `planFromCall`. The normal path is the draft (NEXT: a code-built core, then a short narrative) and the model Evaluator. A revision starts only when more than 8 seconds remain. A run that passes its phrase ceiling ends unresolved with reason `phrase-ceiling` and counts against availability. PATTERNS writes a `progress` log while retrieval is in hand; the board tails that log.

Deadline ends: 0. none

The prior paced sample hit the request deadline on 8 runs. That finding is what changed the spacing. Each trace is `request deadline`, and the released answer was not sent:
- `40686226-c075-4c60-b19c-6dcd01b35b66` CAUSE SSA-004
- `553956d1-72e3-4982-b77c-39796846bea1` PATTERNS thisweek
- `c33316a3-d0a8-407d-8a41-7b2594c456d9` PATTERNS thisweek
- `25bdb0d5-fd8e-45b7-82eb-e83cd0399203` PATTERNS thisweek
- `7caac41f-2b89-4207-a737-1088404d6603` PATTERNS lastweek
- `6d9add53-5375-460f-bd6f-ff9988ad8ffd` PATTERNS lastweek
- `531c8cca-6a40-464d-84d1-13ba93ff0685` NEXT SSA-004
- `604d2093-5b50-4198-8ad8-2995d6af30d7` NEXT SSA-001

The 50-second wait lived in the product model client, `MODEL_MIN_SPACING_MS` in `src/llm/client.ts`. `releaseSlot` set the next call 50 seconds after the previous call finished, and `acquireSlot` slept that long inside the request. The harness also waits `modelQuietMs()` before `runRequest`, which is outside the deadline. The product spacing is now 2 seconds. HTTP 429 and 5xx still use the jittered backoff, and Retry-After still wins. A user no longer waits 50 seconds between calls.

Self-inflicted HTTP 429 attempts in this paced sample: 0.

Gate-rejection fallbacks: 0.

Fallback count by reason:

- HTTP 5xx: 0. none
- timeout: 5. `80fff556-3556-44b3-9428-1ddb75259e10` CAUSE SSA-002; `81e174d0-e062-45c2-a11c-a9871c400d9c` CAUSE SSA-001; `e50585e7-9040-4ea0-a962-b6e4fce7f9ee` CAUSE SSA-001; `3345ab6f-3513-4657-865d-42a8e2f55773` CAUSE SSA-004; `9c17fbdc-6b50-4426-97b5-532865c7d6f0` PATTERNS lastweek
- truncated or invalid JSON: 0. none
- empty completion: 0. none
- HTTP 429: 0. none
- gate rejection: 0. none


Released hallucinations: 0. none
Invented open HAZARDs: 0. none
Missed open HAZARDs: 0. none
Unresolved: 0. Errors: 0.

The model Evaluator call is back in the loop. A model-authored critique is logged as `evaluator` `model-attempt`, then `approval`, `critique`, or `exhaust`. A required revision is logged as `executor` `revision` and the Evaluator runs again. Trace `f3077601-42e0-47f9-8ac3-385cbcc92035` logged `evaluator` `model-attempt` and `approval`.

Scorer rule, applied after the original samples were frozen: a sentence that states an open HAZARD count of 0, "of 0", or "is zero" is not an invented open HAZARD. The cases and the rubric are unchanged. The original v1 and v2 counts above stay as published.

Exact text that the previous rule flagged in the prior 120:
- `ed9a5232-d65c-414d-82d9-de52bdfd4df0` CAUSE SSA-001: "World model identifies SSA-001 as RTU-12 in the North zone at roof-n1 with an open hazard count of 0." The code block also said "Open HAZARD count 0."
- `09f4014e-57a9-4391-9e9f-e69ca0658531` NEXT SSA-004: "SSA-004 shows repeated belt-slip failures with one held tension tweak; open hazard count is zero."

Re-score of the frozen runs with this rule: v1 invented open HAZARD 0 (was 2) and missed open HAZARD 3 (unchanged). Grades become correct 19, partial 1, wrong 3, miss 7. v2 invented open HAZARD 0 (was 1) and missed open HAZARD 0 (unchanged). Grades become correct 39, partial 1, wrong 1, miss 1. The two v1 changes are next-ssa-004 `c95331a3-792c-410d-8a87-45645eef3c8e` and `5315a198-7e20-4b69-a250-346f4cf1c299`, both "open HAZARD count is zero". The v2 change is next-ssa-004 `c695db54-15a1-42e2-872b-84486c960b73`, "open HAZARD count is 0".

Rows: `eval/results/claim-120.jsonl`.

## Burst test

Separate from the paced 120. Six model calls at once, no spacing, concurrency 4.

HTTP 429: 0 of 6. Succeeded: 4 of 6.

This burst is not part of the fallback claim.

## Final measurement

Date: 2026-10-23. 250 fresh lead runs on the direct route, model `nvidia/nemotron-3.5-lightning-30b-a3b`. Twenty-five each of the ten phrase cases. Distinct request ids. The clock counts wall time. Spacing is adaptive: no fixed gap between the two calls of one request.

Model choice, from the probe before this sample. Nightshift `meterless/fast` routed all 5 calls to the lightning model (median about 0.4 s, one call 5.8 s). `meterless/deep` and `meterless/auto` changed models across the 5 calls. On real phrases, direct lightning failed 6 of 30 and direct ultra failed 8 of 30. Lightning had the lower failure rate and the lower median (7.0 s versus 8.6 s), so the final route is direct and the model is lightning. `meterless/auto` may vary the model; it was not selected. Receipts from the probe are in `eval/results/model-experiment.json`.

Failures: 63 of 250 (25.2%). The 95% upper bound is 30.1%. This sample does not support a 2.5% claim.

Availability: 248 of 250 released an answer. Unresolved: 2. Errors: 0.

Latency by phrase. The prior paced sample, with a fixed 2 second gap, had NEXT median 3621 ms, CAUSE 6373 ms, PATTERNS 8907 ms.

- NEXT: n 100, median 4758 ms, p95 8090 ms, slowest 8099 ms, under ceiling 100 of 100
- CAUSE: n 100, median 8999 ms, p95 13080 ms, slowest 13087 ms, under ceiling 100 of 100
- PATTERNS: n 50, median 16893 ms, p95 23086 ms, slowest 23090 ms, under ceiling 50 of 50

Gate-rejection fallbacks: 6.

Fallback count by reason:

- http-5xx: 0
- timeout: 55
- invalid-json: 0
- empty-completion: 0
- http-429: 0
- rejected: 6

Released hallucinations: 0. none
Invented open HAZARDs: 0. none
Missed open HAZARDs: 0. none

Failure traces: `06cc55e3-50dc-4e1c-9383-6e8c8a2edc43` CAUSE SSA-002; `c67e927b-314a-4397-bb23-d4f259b707b8` CAUSE SSA-002; `ffc28935-43e1-4fb2-b6d0-baaa98363ff6` CAUSE SSA-002; `dd9f6da1-db16-429f-8216-33c6bb4c7f2e` CAUSE SSA-002; `5779a9dc-867e-4fa9-a16f-75ad29e8cc16` CAUSE SSA-002; `709e2699-dae2-4465-a2e1-7d0e3f1dab46` CAUSE SSA-002; `65c6058c-30c2-4520-85a3-800cc61b93d3` CAUSE SSA-002; `6b05fd6c-d32f-4087-95b0-cf8125e8a0b5` CAUSE SSA-002; `2de9cc4a-7b7b-4246-9a46-0a713ad24832` CAUSE SSA-001; `8fb525d2-d14a-440b-8049-2b58f4f5b651` CAUSE SSA-001; `7cf7ba43-737d-41eb-aadf-a752616bee28` CAUSE SSA-001; `76beb70c-3fd0-4757-8d26-d5fa837f1ea6` CAUSE SSA-001; `0e728399-6e68-4a26-a757-cef507816d28` CAUSE SSA-001; `89c0a92b-9c46-4b6a-89b1-f7508680562b` CAUSE SSA-001; `700abc8d-0fb5-46a9-b4a9-f7e00a150157` CAUSE SSA-001; `81173ec0-b339-4019-9823-04e2371bb58b` CAUSE SSA-001; `947d5c6c-cc44-4601-a2a2-05d1e88a4a87` CAUSE SSA-001; `3164652c-f401-4aa5-b7f2-3330a1af711b` CAUSE SSA-001; `e135eb67-3546-4548-bdd3-145330d6c8c1` CAUSE SSA-001; `7de2b50b-cc2e-4b54-af78-af84f40ee73b` CAUSE SSA-001; `278ec2cf-093d-4f81-b225-32e753c6912e` CAUSE SSA-001; `f8953063-a0e8-43ac-8d22-4e7548a7ce8d` CAUSE SSA-001; `612a1b3b-ac59-4b8f-8e62-373c4d80bcda` CAUSE SSA-001; `2130f6b2-3416-4b7b-88ec-720d7e0103ef` CAUSE SSA-001; `0756a105-de3d-4d58-a1b3-5972f79ae53d` CAUSE SSA-001; `2949f145-f919-4639-9c39-269c1324c30a` CAUSE SSA-004; `4544cdc1-d434-494e-8d43-b88aaebbbc68` CAUSE SSA-004; `297c705c-ff19-4142-819c-716d135301cd` CAUSE SSA-004; `bdf68994-9e1b-42a6-b425-4aca9b0250f1` CAUSE SSA-004; `c9acd8b9-f9d7-4335-b562-7dc0f045c7e8` CAUSE SSA-004; `e33fe8f9-646e-4ad1-ac9d-a3d452aa5eab` CAUSE SSA-004; `c67ce221-0bef-4c8f-b5f6-3f929a968bc4` CAUSE SSA-004; `2809391a-3db7-48c5-aa1f-06c48012b84b` CAUSE SSA-004; `b67a7996-3dac-48b1-bf47-72fcfe835178` CAUSE SSA-004; `356d8fbf-49ea-4b05-a5a1-691e82ad0de7` CAUSE SSA-004; `f4be3442-9517-4532-b880-4a7ea09e28cd` CAUSE SSA-009; `eb00271b-00c6-48b9-9f32-cd65721f3eca` PATTERNS thisweek; `9f305ed8-0073-40c8-9868-c6d9611ffc48` PATTERNS thisweek; `fda4f440-e753-45bd-ae90-8ce5af89baba` PATTERNS thisweek; `f6759c7b-d8ab-4ac5-97ea-9eb4b82bdd86` PATTERNS thisweek; `80c32b1e-d342-4c57-a4c2-81b101fd1846` PATTERNS thisweek; `3e83d741-5403-46c3-82b9-a0c711a00cd1` PATTERNS thisweek; `82e1e4da-41f7-4ce0-bd73-dab1752d41fd` PATTERNS thisweek; `0366c581-b6ae-43c4-9bad-0e8781976ecf` PATTERNS thisweek; `ddd51691-6714-4c84-84a7-89234415293d` PATTERNS thisweek; `f968c3fd-d0a1-4995-b48a-82c10fb2fcec` PATTERNS thisweek; `56fcd748-6155-4b2b-b68f-010d97bae645` PATTERNS thisweek; `f95d1d28-cb38-4315-827a-730677b9c8f4` PATTERNS thisweek; `f508d4e5-60a8-42da-8957-c480b302c977` PATTERNS thisweek; `48a833fb-5d5b-432c-85eb-d7d463256432` PATTERNS thisweek; `9cedf4ce-4f51-490c-87a8-780803c438c8` PATTERNS thisweek; `b93bbdf4-3433-4f9a-891e-92f7e30137cd` PATTERNS lastweek; `967cfd6b-0860-4d90-a20e-2ec551ff3a99` PATTERNS lastweek; `12870e65-acf1-4732-9fb6-c8ab845d134d` PATTERNS lastweek; `24bd2882-7b0c-4f93-a30f-20b594d168cb` PATTERNS lastweek; `d79ee6b1-2ddb-4aab-b4a2-3820154b1356` PATTERNS lastweek; `56c4246f-ce30-443b-9acc-8a960f818006` PATTERNS lastweek; `8d04c3bf-41a8-4dcf-a67c-81690fdd0b92` PATTERNS lastweek; `7c43ff9c-7520-4e2f-bfc7-62f2e96454ab` PATTERNS lastweek; `88d43cd1-943b-47c3-8c89-1a4da457e62a` PATTERNS lastweek; `3f2f1b5c-7bb5-4b93-a6b3-4994aa447d43` PATTERNS lastweek; `56f112a7-9938-49a1-afac-b8095a642bd7` PATTERNS lastweek; `418b8199-b4d4-4c3a-8cbc-c36b69bbf9e5` PATTERNS lastweek

Rows: `eval/results/claim-250.jsonl`.

## Burst test

Separate from the paced 120. Six model calls at once, no spacing, concurrency 4.

HTTP 429: 0 of 6. Succeeded: 6 of 6.

This burst is not part of the fallback claim.

## v3 sample

Same cases and rubric as v1 and v2. Direct route, model `nvidia/nemotron-3.5-lightning-30b-a3b`. The original v1 and v2 tables above are unchanged.

| Sample | Strict | Correct | Partial | Wrong | Miss | Invented open HAZARD | Missed open HAZARD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v1 | 17/30 | 17 | 1 | 5 | 7 | 2 | 3 |
| v2 | 38/42 | 38 | 1 | 2 | 1 | 1 | 0 |
| v3 | 35/42 | 35 | 2 | 5 | 0 | 0 | 0 |

Rows: `eval/results/v3-runs.jsonl`.

## v4 sample

Same cases and rubric as v1 to v3, scored with the scorer at this commit. v2 and v3 are rescored with that same scorer (`eval/results/rescore-v2-v3.json`). Direct route, model `nvidia/nemotron-3.5-lightning-30b-a3b`, a 6000 ms pause after every run. The code commit is named in the hand-off.

| Sample | Strict | Correct | Partial | Wrong | Miss | Invented open HAZARD | Missed open HAZARD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v2 (rescored) | 39/42 | 39 | 1 | 1 | 1 | 0 | 0 |
| v3 (rescored) | 35/42 | 35 | 2 | 5 | 0 | 0 | 0 |
| v4 | 37/42 | 37 | 5 | 0 | 0 | 0 | 0 |

Rows: `eval/results/v4-runs.jsonl`.

### v4 follow-ups on the CAUSE cases

Same 12 CAUSE runs (four cases, three runs each) after the v4 sample, scored by the same scorer. These are separate result sets, not a replacement for the v4 table above.

| Set | CAUSE strict | Partial | Wrong | Miss | Fallbacks | What changed |
| --- | --- | --- | --- | --- | --- | --- |
| v4 | 7/12 | 5 | 0 | 0 | 4 | model-written CAUSE draft under the 5 / 160 / 220 size limits |
| v4b | 5/12 | 2 | 4 | 1 | 2 | prompt also asks for the fix outcome in each issue claim |
| v4c | 12/12 | 0 | 0 | 0 | 0 | CAUSE core built in code from the retrieved rows, model writes only a short headline |

Rows: `eval/results/v4b-runs.jsonl`, `eval/results/v4c-runs.jsonl`. `CAUSE_DRAFT=model` restores the model-written CAUSE draft.

## Final measurement r4

Date: 2026-10-24. 250 fresh lead runs on the direct route, a 6000 ms pause after every request, model `nvidia/nemotron-3.5-lightning-30b-a3b`. Twenty-five each of the ten phrase cases. Distinct request ids. The clock counts wall time. Spacing is adaptive: no fixed gap between the two calls of one request.

Model choice, from the probe before this sample. Nightshift `meterless/fast` routed all 5 calls to the lightning model (median about 0.4 s, one call 5.8 s). `meterless/deep` and `meterless/auto` changed models across the 5 calls. On real phrases, direct lightning failed 6 of 30 and direct ultra failed 8 of 30. Lightning had the lower failure rate and the lower median (7.0 s versus 8.6 s), so the final route is direct and the model is lightning. `meterless/auto` may vary the model; it was not selected. Receipts from the probe are in `eval/results/model-experiment.json`.

Failures: 0 of 250. This sample supports a failure rate of 2.5% or lower.

Availability: 250 of 250 released an answer. Unresolved: 0. Errors: 0.

Latency by phrase. The prior paced sample, with a fixed 2 second gap, had NEXT median 3621 ms, CAUSE 6373 ms, PATTERNS 8907 ms.

- NEXT: n 100, median 5819 ms, p95 6771 ms, slowest 8074 ms, under ceiling 100 of 100
- CAUSE: n 100, median 5796 ms, p95 7857 ms, slowest 10260 ms, under ceiling 100 of 100
- PATTERNS: n 50, median 6031 ms, p95 9845 ms, slowest 23063 ms, under ceiling 50 of 50

Gate-rejection fallbacks: 0.

Fallback count by reason:

- http-5xx: 0
- timeout: 0
- invalid-json: 0
- empty-completion: 0
- http-429: 0
- rejected: 0

Released hallucinations: 0. none
Invented open HAZARDs: 0. none
Missed open HAZARDs: 0. none

Failure traces: none

Rows: `eval/results/claim-250-r4.jsonl`.

### v5: full labeled sample on the final code

All 14 cases, three runs each (42 runs), the same rubric and scorer as v1 to v4. Direct route, model `nvidia/nemotron-3.5-lightning-30b-a3b`, a 6000 ms pause after every run. Code: PATTERNS and CAUSE cores built in code with a short model headline, NEXT as before, Evaluator model call on compact claims.

| Set | Strict | Partial | Wrong | Miss | Fallbacks | Invented open HAZARD | Missed open HAZARD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| v5 | 42/42 | 0 | 0 | 0 | 0 | 0 | 0 |

By phrase: CAUSE 12/12, PATTERNS 6/6, NEXT 18/18, refusal 6/6. Rows: `eval/results/v5-runs.jsonl`. v2 and v3 under this same scorer are 39/42 and 35/42 (`eval/results/rescore-v2-v3.json`). The answers are mostly built in code from the retrieved rows, which is why they score high; this sample does not test the model's own drafting.
