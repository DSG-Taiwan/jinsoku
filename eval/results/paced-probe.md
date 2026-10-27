# Paced live probe on reliability-fixes (2026-10-24)

Command: node node_modules\tsx\dist\cli.mjs eval/probe-phrases.ts "CAUSE SSA-001|PATTERNS thisweek|PATTERNS lastweek|NEXT SSA-001" 9 6000
6000 ms pause after every request. 36 requests ran; 35 RESULT lines were captured (one line was not recorded). Code at the commit named in the hand-off r2.

gate blocks: 0. exhausts: 0.

RESULT PATTERNS thisweek status=ok fb=false  ms=8265 trace=c3e1d7d2-0657-4f10-8844-b6ab9735566f
RESULT PATTERNS lastweek status=ok fb=false  ms=19819 trace=77a8917b-fcac-4652-b170-76536b454bb7
RESULT NEXT SSA-001 status=ok fb=false  ms=1324 trace=0ac7cae4-d08b-4d3b-a86c-6ae7b289adce
RESULT CAUSE SSA-001 status=ok fb=true http-429 ms=935 trace=ffe7225b-bce0-48c3-9a3b-4a9bb9e187f3
RESULT PATTERNS thisweek status=ok fb=false  ms=19999 trace=a5ae4ace-12d8-4b99-a9bd-8a13a8654e9d
RESULT PATTERNS lastweek status=ok fb=true http-429 ms=13468 trace=57b843ff-ea1d-43e5-8cb7-4573d1197dcc
RESULT NEXT SSA-001 status=ok fb=false  ms=8036 trace=1009a342-163e-4945-bb67-b270ecc3a5bd
RESULT CAUSE SSA-001 status=ok fb=true http-429 ms=792 trace=bba79bbd-14c5-43b6-84b1-8d02a7c9abe3
RESULT PATTERNS thisweek status=ok fb=false  ms=22895 trace=e8331daf-0ada-4fd5-a889-e7b6cd30186c
RESULT PATTERNS lastweek status=ok fb=false  ms=23030 trace=003cbb1c-9291-404a-9200-cd0e75b39acc
RESULT NEXT SSA-001 status=ok fb=false  ms=1410 trace=cf4730c6-4a21-4d07-85d3-7850e9961224
RESULT CAUSE SSA-001 status=ok fb=false  ms=6798 trace=a592937b-33e3-44d8-a462-70c4c30e131c
RESULT PATTERNS thisweek status=ok fb=false  ms=22692 trace=b14581fe-f6fb-4764-bf8b-d2915776acab
RESULT PATTERNS lastweek status=ok fb=false  ms=23030 trace=2954f2a9-fee5-4afd-b882-4e7605070046
RESULT NEXT SSA-001 status=ok fb=false  ms=4891 trace=dcdde883-177a-4602-b7de-f40e08486eb0
RESULT CAUSE SSA-001 status=ok fb=false  ms=7909 trace=fe2cf224-da7e-4ba5-897c-f2148b36a79b
RESULT PATTERNS thisweek status=ok fb=true http-429 ms=13431 trace=f43a7ce6-2e45-4957-b4a4-183a75e84bf3
RESULT PATTERNS lastweek status=ok fb=false  ms=18260 trace=a28498d9-c876-4342-908d-0c4f52d4aee4
RESULT NEXT SSA-001 status=ok fb=false  ms=7210 trace=eb762aeb-8445-47c5-b16f-bb23a214c627
RESULT CAUSE SSA-001 status=ok fb=false  ms=7903 trace=bd69b578-c0fb-4dee-b086-61ce79066402
RESULT PATTERNS thisweek status=ok fb=false  ms=18818 trace=8e14ddf7-19ff-4dcc-bf22-7feddac458e6
RESULT PATTERNS lastweek status=ok fb=false  ms=17986 trace=7cc4279a-5c87-4647-b12f-0d2d00fdd9df
RESULT NEXT SSA-001 status=ok fb=false  ms=1510 trace=284dd033-5147-4200-b186-cd555f2614b7
RESULT CAUSE SSA-001 status=ok fb=false  ms=5645 trace=d8d581a4-bae2-414e-a1a3-de05895f34dc
RESULT PATTERNS thisweek status=ok fb=true http-429 ms=13207 trace=51f1335d-f4fd-4355-82f9-3e568ab52438
RESULT PATTERNS lastweek status=ok fb=false  ms=12969 trace=d842c867-f550-4ab0-92a0-7811162261c2
RESULT NEXT SSA-001 status=ok fb=false  ms=4131 trace=2372aac3-0526-4e7f-9388-c6dce49752ae
RESULT CAUSE SSA-001 status=ok fb=true http-429 ms=830 trace=9b62a9ac-0dfc-43d9-a380-d82b2f5f5de7
RESULT PATTERNS thisweek status=ok fb=false  ms=7557 trace=aac80cfe-c052-4470-b0a3-5b0a50a8ba94
RESULT PATTERNS lastweek status=ok fb=false  ms=12515 trace=22deb7c7-a0ee-434b-9c1c-7111bb0486c8
RESULT NEXT SSA-001 status=ok fb=false  ms=4604 trace=1a945c2f-af65-4ff2-8989-c0d5b11a8597
RESULT CAUSE SSA-001 status=ok fb=false  ms=7716 trace=6d2d637a-3c8a-4aed-9696-d4f1ac93ed04
RESULT PATTERNS thisweek status=ok fb=true http-429 ms=13363 trace=2e4ffe5b-20a4-410f-8168-29d4c6bd4ede
RESULT PATTERNS lastweek status=ok fb=true http-429 ms=13550 trace=1c564728-5c47-4b1a-b6fe-2a64eb667214
RESULT NEXT SSA-001 status=ok fb=false  ms=1318 trace=5ecdab99-b726-4749-8a5b-957496cca641
