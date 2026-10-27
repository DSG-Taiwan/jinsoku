# DIAGNOSTIC, EXCLUDED FROM PERFORMANCE STATISTICS: lightning on OpenRouter with hidden reasoning left ON

Date: 2026-10-24 14:21 to 14:30 UTC. Route paid, model nvidia/nemotron-3.5-lightning, host openrouter.ai, analysis OFF, 36-request paced probe. Cause: the request sent only chat_template_kwargs enable_thinking=false, which this host ignores, so the model spent its token budget on hidden reasoning and often returned an empty reply (raw test: 4 of 4 calls EMPTY at max_tokens 200, 187 to 206 reasoning tokens, about 2.2 s; with reasoning {enabled:false}: 4 of 4 real replies, about 17 tokens, about 0.44 s).

Result of this run (not a valid measure of the host): 36 of 36 answers ok, 0 answer fallbacks, 0 HTTP 429s, 2 timeouts, headline ok 9 of 36, Evaluator model approved 12 of 36, requests with every model stage complete 1 of 36.

## RESULT lines
RESULT CAUSE SSA-001 status=ok fb=false  ms=12004
RESULT PATTERNS thisweek status=ok fb=false  ms=15255
RESULT PATTERNS lastweek status=ok fb=false  ms=15529
RESULT NEXT SSA-001 status=ok fb=false  ms=2137
RESULT CAUSE SSA-001 status=ok fb=false  ms=11801
RESULT PATTERNS thisweek status=ok fb=false  ms=18062
RESULT PATTERNS lastweek status=ok fb=false  ms=23074
RESULT NEXT SSA-001 status=ok fb=false  ms=2214
RESULT CAUSE SSA-001 status=ok fb=false  ms=11671
RESULT PATTERNS thisweek status=ok fb=false  ms=16220
RESULT PATTERNS lastweek status=ok fb=false  ms=15038
RESULT NEXT SSA-001 status=ok fb=false  ms=6816
RESULT CAUSE SSA-001 status=ok fb=false  ms=11505
RESULT PATTERNS thisweek status=ok fb=false  ms=14690
RESULT PATTERNS lastweek status=ok fb=false  ms=14939
RESULT NEXT SSA-001 status=ok fb=false  ms=7071
RESULT CAUSE SSA-001 status=ok fb=false  ms=11486
RESULT PATTERNS thisweek status=ok fb=false  ms=2370
RESULT PATTERNS lastweek status=ok fb=false  ms=3991
RESULT NEXT SSA-001 status=ok fb=false  ms=7878
RESULT CAUSE SSA-001 status=ok fb=false  ms=10993
RESULT PATTERNS thisweek status=ok fb=false  ms=1972
RESULT PATTERNS lastweek status=ok fb=false  ms=2077
RESULT NEXT SSA-001 status=ok fb=false  ms=7309
RESULT CAUSE SSA-001 status=ok fb=false  ms=2108
RESULT PATTERNS thisweek status=ok fb=false  ms=2059
RESULT PATTERNS lastweek status=ok fb=false  ms=17280
RESULT NEXT SSA-001 status=ok fb=false  ms=8070
RESULT CAUSE SSA-001 status=ok fb=false  ms=10523
RESULT PATTERNS thisweek status=ok fb=false  ms=2608
RESULT PATTERNS lastweek status=ok fb=false  ms=15022
RESULT NEXT SSA-001 status=ok fb=false  ms=1959
RESULT CAUSE SSA-001 status=ok fb=false  ms=10509
RESULT PATTERNS thisweek status=ok fb=false  ms=2085
RESULT PATTERNS lastweek status=ok fb=false  ms=2679
RESULT NEXT SSA-001 status=ok fb=false  ms=7506
