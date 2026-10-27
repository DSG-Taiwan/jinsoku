# Live probes on reliability-fixes (2026-10-24)

RESULT lines only. Phrases: CAUSE SSA-001, PATTERNS thisweek, PATTERNS lastweek. Probe 3 ran after the claim-boundary fix. Probe 4 ran after the 5-finding cap. Probe 5 ran after the HAZARD-context change. Probe 5 hit HTTP 429 on the NVIDIA key (11 of 13 fallbacks).

## probe3
RESULT PATTERNS thisweek status=ok fb=false  ms=7960
RESULT PATTERNS lastweek status=ok fb=true timeout ms=16861
RESULT CAUSE SSA-001 status=ok fb=true timeout ms=13023
RESULT PATTERNS thisweek status=ok fb=false  ms=7914
RESULT PATTERNS lastweek status=ok fb=true timeout ms=16902
RESULT CAUSE SSA-001 status=ok fb=false  ms=7875
RESULT PATTERNS thisweek status=ok fb=false  ms=8050
RESULT PATTERNS lastweek status=ok fb=false  ms=10075
RESULT CAUSE SSA-001 status=ok fb=false  ms=6503
RESULT PATTERNS thisweek status=ok fb=false  ms=8537
RESULT PATTERNS lastweek status=ok fb=false  ms=12410
RESULT CAUSE SSA-001 status=ok fb=false  ms=7057
RESULT PATTERNS thisweek status=ok fb=false  ms=10750
RESULT PATTERNS lastweek status=ok fb=false  ms=12885
RESULT CAUSE SSA-001 status=ok fb=false  ms=13018
RESULT PATTERNS thisweek status=ok fb=false  ms=7689
RESULT PATTERNS lastweek status=ok fb=false  ms=9951
RESULT CAUSE SSA-001 status=ok fb=false  ms=13017
RESULT PATTERNS thisweek status=ok fb=false  ms=8323
RESULT PATTERNS lastweek status=ok fb=false  ms=7619
RESULT CAUSE SSA-001 status=ok fb=false  ms=8817
RESULT PATTERNS thisweek status=ok fb=false  ms=15751
RESULT PATTERNS lastweek status=ok fb=false  ms=9353
RESULT CAUSE SSA-001 status=ok fb=false  ms=13012
RESULT PATTERNS thisweek status=ok fb=false  ms=9955
RESULT PATTERNS lastweek status=ok fb=false  ms=11364

gate blocks and exhausts:
0

## probe4
RESULT PATTERNS thisweek status=ok fb=false  ms=14044
RESULT PATTERNS lastweek status=ok fb=false  ms=11467
RESULT CAUSE SSA-001 status=ok fb=true timeout ms=11030
RESULT PATTERNS thisweek status=ok fb=false  ms=12537
RESULT PATTERNS lastweek status=ok fb=false  ms=7643
RESULT CAUSE SSA-001 status=ok fb=false  ms=10613
RESULT PATTERNS thisweek status=unresolved fb=false  ms=16150
RESULT PATTERNS lastweek status=ok fb=false  ms=7004
RESULT CAUSE SSA-001 status=ok fb=false  ms=10495
RESULT PATTERNS thisweek status=ok fb=false  ms=6246
RESULT PATTERNS lastweek status=ok fb=false  ms=11470
RESULT CAUSE SSA-001 status=ok fb=false  ms=7308
RESULT PATTERNS thisweek status=ok fb=false  ms=9153
RESULT PATTERNS lastweek status=ok fb=false  ms=7226
RESULT CAUSE SSA-001 status=ok fb=true timeout ms=11024
RESULT PATTERNS thisweek status=ok fb=false  ms=6769
RESULT PATTERNS lastweek status=ok fb=false  ms=6599
RESULT CAUSE SSA-001 status=ok fb=false  ms=7012
RESULT PATTERNS thisweek status=ok fb=false  ms=14029
RESULT PATTERNS lastweek status=ok fb=false  ms=6866
RESULT CAUSE SSA-001 status=ok fb=false  ms=7262
RESULT PATTERNS thisweek status=ok fb=false  ms=5846
RESULT PATTERNS lastweek status=ok fb=false  ms=14052
RESULT CAUSE SSA-001 status=ok fb=false  ms=9698
RESULT PATTERNS thisweek status=ok fb=false  ms=6758
RESULT PATTERNS lastweek status=ok fb=false  ms=6963
RESULT CAUSE SSA-001 status=ok fb=false  ms=7680
RESULT PATTERNS thisweek status=ok fb=false  ms=22306
RESULT PATTERNS lastweek status=ok fb=false  ms=7090
RESULT CAUSE SSA-001 status=ok fb=false  ms=7476
RESULT PATTERNS thisweek status=ok fb=true timeout ms=16816
RESULT PATTERNS lastweek status=ok fb=false  ms=9678
RESULT CAUSE SSA-001 status=ok fb=false  ms=9758
RESULT PATTERNS thisweek status=ok fb=false  ms=9639
RESULT PATTERNS lastweek status=ok fb=false  ms=8607

gate blocks and exhausts:
1

## probe5
RESULT PATTERNS thisweek status=ok fb=false  ms=11730
RESULT PATTERNS lastweek status=ok fb=false  ms=9322
RESULT CAUSE SSA-001 status=ok fb=false  ms=10183
RESULT PATTERNS thisweek status=ok fb=false  ms=8499
RESULT PATTERNS lastweek status=ok fb=false  ms=11120
RESULT CAUSE SSA-001 status=ok fb=false  ms=7020
RESULT PATTERNS thisweek status=ok fb=false  ms=9815
RESULT PATTERNS lastweek status=ok fb=false  ms=14656
RESULT CAUSE SSA-001 status=ok fb=false  ms=7881
RESULT PATTERNS thisweek status=ok fb=false  ms=8694
RESULT PATTERNS lastweek status=ok fb=false  ms=11554
RESULT CAUSE SSA-001 status=ok fb=false  ms=8287
RESULT PATTERNS thisweek status=ok fb=false  ms=8323
RESULT PATTERNS lastweek status=ok fb=false  ms=18051
RESULT CAUSE SSA-001 status=ok fb=true http-429 ms=648
RESULT PATTERNS thisweek status=ok fb=false  ms=21040
RESULT PATTERNS lastweek status=ok fb=true timeout ms=23021
RESULT CAUSE SSA-001 status=ok fb=true http-429 ms=929
RESULT PATTERNS thisweek status=ok fb=false  ms=12758
RESULT PATTERNS lastweek status=ok fb=false  ms=20834
RESULT CAUSE SSA-001 status=ok fb=true http-429 ms=632
RESULT PATTERNS thisweek status=ok fb=false  ms=17680
RESULT PATTERNS lastweek status=ok fb=true http-429 ms=13015
RESULT CAUSE SSA-001 status=ok fb=true http-429 ms=655
RESULT PATTERNS thisweek status=ok fb=true http-429 ms=13026
RESULT PATTERNS lastweek status=ok fb=false  ms=23024
RESULT CAUSE SSA-001 status=ok fb=false  ms=6858
RESULT PATTERNS thisweek status=ok fb=true http-429 ms=13265
RESULT PATTERNS lastweek status=ok fb=true http-429 ms=13215
RESULT CAUSE SSA-001 status=ok fb=true http-429 ms=660
RESULT PATTERNS thisweek status=ok fb=false  ms=20654
RESULT PATTERNS lastweek status=ok fb=true http-429 ms=13049
RESULT CAUSE SSA-001 status=ok fb=false  ms=11078
RESULT PATTERNS thisweek status=ok fb=true http-429 ms=13438
RESULT PATTERNS lastweek status=ok fb=true timeout ms=23024

gate blocks and exhausts:
0
