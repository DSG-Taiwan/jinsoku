# DIAGNOSTIC, INVALID RUN. Excluded from all performance statistics.

Date: 2026-10-24 12:30 UTC. 36-request paced probe on the three new keys while NEMOTRON_MODEL was missing from the dev .env.
Every model call returned HTTP 400 'model field is required' before reaching any rate limit. The 0 HTTP 429 reading and the 1.3 to 1.5 s medians are artifacts of that. All three keys were accepted. Fixed 12:43 UTC; the probe now stops when a required setting is empty (f308bd7).
Model-stage audit of this run: narrative ok 0, skipped 36 (HTTP 400); Evaluator model approved 0, deterministic fallback 36; 429 attempts 0; requests with every model stage ok 0 of 36. Answers released from code: 36 of 36 ok.

## RESULT lines
RESULT CAUSE SSA-001 status=ok fb=false  ms=1429 trace=d6555e13-3941-4fcc-aa35-e9d053b064c2
RESULT PATTERNS thisweek status=ok fb=false  ms=1483 trace=d9cde214-3c71-49c3-b10f-ff5b6a71a12e
RESULT PATTERNS lastweek status=ok fb=false  ms=1647 trace=0cc085df-f8b6-48e6-80dd-d2ad51bcc608
RESULT NEXT SSA-001 status=ok fb=false  ms=1297 trace=6c52cc41-f553-4cd7-aaad-2711f9506599
RESULT CAUSE SSA-001 status=ok fb=false  ms=1318 trace=4932aff5-084b-421c-aff3-2c285a32bed5
RESULT PATTERNS thisweek status=ok fb=false  ms=1352 trace=b2d5430f-b709-4e53-8256-421a2d78ad6f
RESULT PATTERNS lastweek status=ok fb=false  ms=1456 trace=b8434d4d-27c5-4887-b7dc-9658540766f6
RESULT NEXT SSA-001 status=ok fb=false  ms=1127 trace=c21214a3-4b19-4a9b-b5f0-489f71a74ea8
RESULT CAUSE SSA-001 status=ok fb=false  ms=1169 trace=264cc3b1-cc9d-4758-b827-138e1e6e2370
RESULT PATTERNS thisweek status=ok fb=false  ms=1340 trace=24d717aa-272e-4fba-8a7c-bf6d231efc4f
RESULT PATTERNS lastweek status=ok fb=false  ms=1590 trace=b276485f-933b-4eed-a87c-404a909f1833
RESULT NEXT SSA-001 status=ok fb=false  ms=1556 trace=ef2f2a93-6b3a-4b54-9b21-ab99d25b1f45
RESULT CAUSE SSA-001 status=ok fb=false  ms=1165 trace=57f155d9-9670-45ac-85c6-6305715eeb48
RESULT PATTERNS thisweek status=ok fb=false  ms=1463 trace=6ee831c5-db7e-4699-92af-a849b29043b1
RESULT PATTERNS lastweek status=ok fb=false  ms=1721 trace=153e5aa0-49e4-401b-9cc0-d6159f9229a2
RESULT NEXT SSA-001 status=ok fb=false  ms=1532 trace=b3f19f1d-dd6e-4f09-b9ad-e660910bd32f
RESULT CAUSE SSA-001 status=ok fb=false  ms=1312 trace=c225643e-dc1a-41af-a951-49c45da529e4
RESULT PATTERNS thisweek status=ok fb=false  ms=1877 trace=9799eb62-3b5c-4466-bbc2-ffe2ca4987e8
RESULT PATTERNS lastweek status=ok fb=false  ms=1760 trace=e1277e95-dbac-403c-9935-c6b1969065be
RESULT NEXT SSA-001 status=ok fb=false  ms=1396 trace=494b8052-6c02-4d05-b7a5-0a1950fe05df
RESULT CAUSE SSA-001 status=ok fb=false  ms=1431 trace=d3ef9366-e756-42a6-a920-665ebc3b39cf
RESULT PATTERNS thisweek status=ok fb=false  ms=1650 trace=b542c665-a066-4bc0-a8af-f2f4039b2cde
RESULT PATTERNS lastweek status=ok fb=false  ms=1489 trace=2aa7853d-ca81-4781-a293-3499840c0d91
RESULT NEXT SSA-001 status=ok fb=false  ms=1521 trace=7842d123-5160-48a2-bbd0-67d905626447
RESULT CAUSE SSA-001 status=ok fb=false  ms=1229 trace=8c5ac534-9c93-4c47-bdb1-dc9763d4b7d1
RESULT PATTERNS thisweek status=ok fb=false  ms=1424 trace=eadbdd91-6224-4eab-8ef4-20a218fbce15
RESULT PATTERNS lastweek status=ok fb=false  ms=1635 trace=0cad5429-9d4f-43d4-a819-2fc364139fd2
RESULT NEXT SSA-001 status=ok fb=false  ms=1387 trace=3dd88b6d-5810-4ea0-810c-17e5477e810c
RESULT CAUSE SSA-001 status=ok fb=false  ms=1389 trace=5835b60d-f835-41a5-8f7b-f52e0ec029a1
RESULT PATTERNS thisweek status=ok fb=false  ms=1736 trace=466dd380-2ca3-4466-855d-630181099ca1
RESULT PATTERNS lastweek status=ok fb=false  ms=1738 trace=f643ecd9-977a-441a-9ec6-4a9ab5c4d8c1
RESULT NEXT SSA-001 status=ok fb=false  ms=1146 trace=23779784-8dec-45f3-91fd-1b0937b0e68c
RESULT CAUSE SSA-001 status=ok fb=false  ms=1459 trace=899c86be-bffb-4d2c-9923-0cf26dbfcbeb
RESULT PATTERNS thisweek status=ok fb=false  ms=1297 trace=ed3dd7f8-b73b-4edc-a477-f586e792824e
RESULT PATTERNS lastweek status=ok fb=false  ms=1311 trace=66a6cd4d-291b-4623-957f-a879378be8a3
RESULT NEXT SSA-001 status=ok fb=false  ms=1510 trace=60a4b148-da50-433f-8b3b-ccee468ed2da
