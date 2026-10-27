# Paced live probe r3, after the short 429 backoff (2026-10-24)

Command: node node_modules\tsx\dist\cli.mjs eval/probe-phrases.ts "CAUSE SSA-001|PATTERNS thisweek|PATTERNS lastweek|NEXT SSA-001" 9 6000
6000 ms pause after every request. 36 requests ran; 35 RESULT lines were captured. Code at 6a4d86d (HEAD at run time).

gate blocks: 0. exhausts: 0.

RESULT PATTERNS thisweek status=ok fb=false  ms=12207 trace=21764c1f-8d12-4a83-8040-9cc93954801b
RESULT PATTERNS lastweek status=ok fb=false  ms=22561 trace=285777ec-31e3-4791-9e5e-e3666c531979
RESULT NEXT SSA-001 status=ok fb=false  ms=5599 trace=0ec8dbb2-c324-4711-bde2-06e5141e69e6
RESULT CAUSE SSA-001 status=ok fb=false  ms=12028 trace=a77b9cba-0b45-4816-8bec-6ad657e557be
RESULT PATTERNS thisweek status=ok fb=false  ms=10396 trace=ead76a96-791f-41ba-b72f-50b6b13d4a3f
RESULT PATTERNS lastweek status=ok fb=true http-429 ms=5589 trace=387a267f-f358-4ced-aa47-8ad9e878d2ee
RESULT NEXT SSA-001 status=ok fb=false  ms=4100 trace=800becd4-3d98-4439-843d-a559fbb2c9dc
RESULT CAUSE SSA-001 status=ok fb=true http-429 ms=5002 trace=820440a4-093e-4cf3-8c47-fdb6fd821b32
RESULT PATTERNS thisweek status=ok fb=false  ms=11344 trace=9f739288-78a6-401e-848b-82ad4f5d4a08
RESULT PATTERNS lastweek status=ok fb=true timeout ms=18306 trace=aefb72a3-10a6-4bb7-8679-a3d28419d1dc
RESULT NEXT SSA-001 status=ok fb=false  ms=6229 trace=eac0b3d7-c1b5-4d32-afee-8d659354fde9
RESULT CAUSE SSA-001 status=ok fb=true timeout ms=11034 trace=e05e65e0-632d-4e39-913e-31b699a44a0a
RESULT PATTERNS thisweek status=ok fb=false  ms=10176 trace=8f2b7203-3bea-40c9-a91b-80d5e6027e66
RESULT PATTERNS lastweek status=ok fb=true http-429 ms=5789 trace=030e1eed-549d-4fa7-af7a-91fe41af3548
RESULT NEXT SSA-001 status=ok fb=false  ms=6226 trace=2146db11-6bb9-404c-bcc1-ccec0b4dd089
RESULT CAUSE SSA-001 status=ok fb=true timeout ms=11036 trace=b1edf063-c549-4bfc-b4fc-6d69d0434ce4
RESULT PATTERNS thisweek status=ok fb=false  ms=13416 trace=803ad9dc-72dd-4fcf-a8e5-bb51b3c4b7b1
RESULT PATTERNS lastweek status=ok fb=false  ms=15498 trace=15997411-42a6-408f-8d88-752980b5d038
RESULT NEXT SSA-001 status=ok fb=false  ms=6302 trace=e6f99af0-8362-4cd1-a50d-00266de0d41b
RESULT CAUSE SSA-001 status=ok fb=false  ms=12054 trace=7d29d836-9d4c-4442-ac85-9248535beecc
RESULT PATTERNS thisweek status=ok fb=false  ms=12922 trace=ca81836a-d689-441f-a469-489c860407d4
RESULT PATTERNS lastweek status=ok fb=false  ms=8750 trace=c1aca1e9-bd06-41c0-8315-2abdfc8ae6cc
RESULT NEXT SSA-001 status=ok fb=false  ms=8033 trace=2bd8c4cc-adb8-4822-b895-e86203b9258b
RESULT CAUSE SSA-001 status=ok fb=true timeout ms=13039 trace=e2e73c5e-c971-4a28-86cb-0faf26852469
RESULT PATTERNS thisweek status=ok fb=false  ms=10068 trace=32b5bd6f-8293-40e9-b1fb-65dc6b08d19d
RESULT PATTERNS lastweek status=ok fb=false  ms=15863 trace=92eab6cd-c2f2-4b3e-940c-1c6f0b8710f7
RESULT NEXT SSA-001 status=ok fb=false  ms=8042 trace=a9bd6df7-9988-4637-81a3-e3a9a97e4b8a
RESULT CAUSE SSA-001 status=ok fb=false  ms=9380 trace=4bd785f8-75ee-4fcd-a310-95512c782002
RESULT PATTERNS thisweek status=ok fb=true timeout ms=16887 trace=78aa6dcb-d7f2-4882-9673-dc31f35a198a
RESULT PATTERNS lastweek status=ok fb=false  ms=12741 trace=aed8f24e-6f41-45e9-8d99-e6d4de67961c
RESULT NEXT SSA-001 status=ok fb=false  ms=8040 trace=97e24ac1-76e5-4c63-8372-59fa9e22d839
RESULT CAUSE SSA-001 status=ok fb=false  ms=6516 trace=edfd11d6-20b6-4f7c-a80b-34b19ceee17f
RESULT PATTERNS thisweek status=ok fb=true http-429 ms=5588 trace=03204911-2b4d-47ef-9f21-bb5ba6d140ee
RESULT PATTERNS lastweek status=ok fb=true http-429 ms=5638 trace=a8d284d2-5aca-480a-802a-22dfcb3ef90f
RESULT NEXT SSA-001 status=ok fb=false  ms=8030 trace=58a0d516-1495-460e-bec8-a358fced27d5
