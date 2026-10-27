# Paid-route diagnostic: 36-request paced probe (2026-10-24 13:33 to 13:40 UTC)

Route: paid. Model: nvidia/nemotron-3-ultra-550b-a55b. Host: openrouter.ai (the underlying inference provider is not recorded in the logs). Code at c98368c. Same workload as the NVIDIA baseline: CAUSE SSA-001, PATTERNS thisweek, PATTERNS lastweek, NEXT SSA-001, nine rounds, 6 s pause.
Caveat: host AND model changed together; OpenRouter showed about 20% of prompt tokens cached on its dashboard.

## Five-call compatibility check
route: paid  model: nvidia/nemotron-3-ultra-550b-a55b  host: openrouter.ai
PASS 1 plain JSON mode  906 ms  reply 11 chars  attempts: attempt 1 ok status 200 tokens 28/6
PASS 2 strict JSON schema  1276 ms  reply 93 chars  attempts: attempt 1 ok status 200 tokens 48/31
PASS 3 evaluator-shaped call  347 ms  reply 93 chars  attempts: attempt 1 ok status 200 tokens 61/31
PASS 4 short headline call  393 ms  reply 98 chars  attempts: attempt 1 ok status 200 tokens 37/20
PASS 5 longer answer  1272 ms  reply 306 chars  attempts: attempt 1 ok status 200 tokens 44/59
COMPAT PASS 5 of 5

## Gates (reviewer greenlight)
- Complete model-stage success: 35 of 36 (minimum 18, recommended 32): PASS both
- HTTP 429 attempts: 0 (maximum 26): PASS
- NEXT median: 3.49 s (target 5 s): PASS

## RESULT lines
RESULT CAUSE SSA-001 status=ok fb=false  ms=9023
RESULT PATTERNS thisweek status=ok fb=false  ms=5408
RESULT PATTERNS lastweek status=ok fb=false  ms=2129
RESULT NEXT SSA-001 status=ok fb=false  ms=3417
RESULT CAUSE SSA-001 status=ok fb=false  ms=4226
RESULT PATTERNS thisweek status=ok fb=false  ms=5873
RESULT PATTERNS lastweek status=ok fb=false  ms=3526
RESULT NEXT SSA-001 status=ok fb=false  ms=4044
RESULT CAUSE SSA-001 status=ok fb=false  ms=8760
RESULT PATTERNS thisweek status=ok fb=false  ms=2897
RESULT PATTERNS lastweek status=ok fb=false  ms=2035
RESULT NEXT SSA-001 status=ok fb=false  ms=2734
RESULT CAUSE SSA-001 status=ok fb=false  ms=9278
RESULT PATTERNS thisweek status=ok fb=false  ms=4152
RESULT PATTERNS lastweek status=ok fb=false  ms=3883
RESULT NEXT SSA-001 status=ok fb=false  ms=4819
RESULT CAUSE SSA-001 status=ok fb=false  ms=10844
RESULT PATTERNS thisweek status=ok fb=false  ms=4644
RESULT PATTERNS lastweek status=ok fb=false  ms=4839
RESULT NEXT SSA-001 status=ok fb=false  ms=3008
RESULT CAUSE SSA-001 status=ok fb=false  ms=7482
RESULT PATTERNS thisweek status=ok fb=false  ms=4705
RESULT PATTERNS lastweek status=ok fb=false  ms=7583
RESULT NEXT SSA-001 status=ok fb=false  ms=3332
RESULT CAUSE SSA-001 status=ok fb=false  ms=5438
RESULT PATTERNS thisweek status=ok fb=false  ms=14044
RESULT PATTERNS lastweek status=ok fb=false  ms=2834
RESULT NEXT SSA-001 status=ok fb=false  ms=4839
RESULT CAUSE SSA-001 status=ok fb=false  ms=6751
RESULT PATTERNS thisweek status=ok fb=false  ms=3351
RESULT PATTERNS lastweek status=ok fb=false  ms=2048
RESULT NEXT SSA-001 status=ok fb=false  ms=3585
RESULT CAUSE SSA-001 status=ok fb=false  ms=3779
RESULT PATTERNS thisweek status=ok fb=false  ms=2442
RESULT PATTERNS lastweek status=ok fb=false  ms=9110
RESULT NEXT SSA-001 status=ok fb=false  ms=3494
