# Three-key probe, 36 requests (VALID run), 2026-10-24 12:43 to 12:50 UTC

Command: node node_modules\tsx\dist\cli.mjs eval/probe-phrases.ts "CAUSE SSA-001|PATTERNS thisweek|PATTERNS lastweek|NEXT SSA-001" 9 6000
Keys: Planner = first key, Evaluator = key named GenAI Hackathon - EV, Executor = third key. No key values recorded. Code at f308bd7.
Baseline on the shared key (same probe, same day): eval/results/keysplit-baseline-audit.json.

## Gates (reviewer disposition and threshold)
- 429 attempts <= 26 (80% reduction from 134): FAIL, 143 (+6.7%)
- Headline success >= 18 of 36: FAIL, 10
- Evaluator model approval >= 18 of 36: FAIL, 15
- Complete model-stage success >= 18 (reviewer) and >= 32 (threshold): FAIL, 7 of 36 (baseline 7 of 36)
- r7 250-run sample: NOT STARTED, gate not met

## RESULT lines
RESULT CAUSE SSA-001 status=ok fb=false  ms=6365 trace=4df7f7ee-fa25-4e74-bc4a-167837322c32
RESULT PATTERNS thisweek status=ok fb=false  ms=6152 trace=9084a5f6-290b-4aaf-86eb-deafaefd59db
RESULT PATTERNS lastweek status=ok fb=false  ms=4389 trace=e99207ab-b379-4477-9f8b-9d6127bdb48d
RESULT NEXT SSA-001 status=ok fb=false  ms=1507 trace=8b3f4a2c-2f76-42b4-bbd0-5f7ad95be742
RESULT CAUSE SSA-001 status=ok fb=false  ms=4732 trace=00b8cd67-c0e3-40b2-9265-9ee187d81d24
RESULT PATTERNS thisweek status=ok fb=false  ms=6451 trace=737f167f-5fe5-4bbb-b5d2-ab071bd3e4c3
RESULT PATTERNS lastweek status=ok fb=false  ms=10520 trace=bec01846-b0b0-4ad8-a2df-95e26e8cfd9d
RESULT NEXT SSA-001 status=ok fb=false  ms=4156 trace=9494f8d3-9795-4a7b-b65b-cfe8131c2cb8
RESULT CAUSE SSA-001 status=ok fb=false  ms=6040 trace=33ec8885-f665-48f1-95db-3fa1d4d76e27
RESULT PATTERNS thisweek status=ok fb=false  ms=5462 trace=bec5d4a6-2a3e-4c84-9a36-0f02071dab93
RESULT PATTERNS lastweek status=ok fb=false  ms=6299 trace=2687d44c-891a-418c-baac-a128698a6456
RESULT NEXT SSA-001 status=ok fb=false  ms=6073 trace=ef1b0b3d-eaa7-4c30-8dc4-8d226391fb8b
RESULT CAUSE SSA-001 status=ok fb=false  ms=2164 trace=16f69f72-6f8e-4af9-b0d1-e6ceff9f2e2c
RESULT PATTERNS thisweek status=ok fb=false  ms=2352 trace=ee10f3e0-b1cc-493b-b8e3-7989a462e2a5
RESULT PATTERNS lastweek status=ok fb=false  ms=2794 trace=b14f828e-8ace-4119-954a-8c675d965be3
RESULT NEXT SSA-001 status=ok fb=false  ms=6220 trace=2e60ae97-8c4c-4582-89d0-8d5b1e4c266a
RESULT CAUSE SSA-001 status=ok fb=false  ms=5857 trace=426b0a43-89d7-4090-98e8-c227094a768a
RESULT PATTERNS thisweek status=ok fb=false  ms=3259 trace=329d4063-525c-410d-9b6b-33f251b33ea1
RESULT PATTERNS lastweek status=ok fb=false  ms=5892 trace=4919dbb4-9a7d-41d8-a4d9-152faba6b3ef
RESULT NEXT SSA-001 status=ok fb=false  ms=4939 trace=10b726cc-46a3-4af2-98bc-88a307d7f13c
RESULT CAUSE SSA-001 status=ok fb=false  ms=6841 trace=707b2f54-4826-4563-b9e6-6a0a3144a5f3
RESULT PATTERNS thisweek status=ok fb=false  ms=6117 trace=1fb24d71-1fe2-465b-b824-c54f809c500c
RESULT PATTERNS lastweek status=ok fb=false  ms=6235 trace=74b02a17-ac5f-414b-9e0e-7b9c86d5d09a
RESULT NEXT SSA-001 status=ok fb=false  ms=6186 trace=8cdd222b-40e9-4a7d-9abf-55beb31dfdbc
RESULT CAUSE SSA-001 status=ok fb=false  ms=6162 trace=9c5ac101-271d-41f6-ba10-00917e1e46d6
RESULT PATTERNS thisweek status=ok fb=false  ms=5769 trace=51b2b7a6-561e-4240-b7f8-32f9e9f81128
RESULT PATTERNS lastweek status=ok fb=false  ms=6478 trace=8e03f014-a579-4b3e-9a4c-d02af6ea68a4
RESULT NEXT SSA-001 status=ok fb=false  ms=3893 trace=3869d199-360c-43d9-af4a-161dce22c36f
RESULT CAUSE SSA-001 status=ok fb=false  ms=6252 trace=f21bbe1f-f494-4b83-8ffd-4d58f376ab6c
RESULT PATTERNS thisweek status=ok fb=false  ms=7217 trace=839467cf-1e67-46fd-bd96-016c3f7c6348
RESULT PATTERNS lastweek status=ok fb=false  ms=6594 trace=a0fef13e-8ca1-4031-8af7-d435e2b00bab
RESULT NEXT SSA-001 status=ok fb=false  ms=6303 trace=ba34641a-a30e-4e8e-8ccb-81a4310c20a3
RESULT CAUSE SSA-001 status=ok fb=false  ms=5833 trace=919a1374-fd3d-4c97-bcd1-ddd1b201a070
RESULT PATTERNS thisweek status=ok fb=false  ms=8692 trace=34107c8e-7f44-4ca3-a2a8-8cef342cceb2
RESULT PATTERNS lastweek status=ok fb=false  ms=6435 trace=cc93810a-c256-4238-ad8c-b9d6854f74f2
RESULT NEXT SSA-001 status=ok fb=false  ms=6111 trace=9119fbde-38f3-4a58-bad8-a9b609c332f1
