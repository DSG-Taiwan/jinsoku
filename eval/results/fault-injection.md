# Labeled synthetic fault injection, live provider

Route: paid. Model: nvidia/nemotron-3-ultra-550b-a55b. Case: CAUSE SSA-001, role lead. Synthetic data only. Faults are injected by FAULT_INJECT into the analysis output and logged as `fault-injected`.

| Scenario | Persistent | Status | Fault logged | Critiques | Real revisions | Analysis released | Faulty text released | Outcome | Trace |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| invented_asset | no | ok | true | 1 | 1 | true | false | caught, repaired by a real revision, released | `5b1a46aa-4ae3-4003-a079-5774dd81a262` |
| hallucinated_issue | no | ok | true | 1 | 1 | true | false | caught, repaired by a real revision, released | `12043c21-c4d5-4669-b5c7-e88e534fd32f` |
| uncited | no | ok | true | 1 | 1 | true | false | caught, repaired by a real revision, released | `3bf77b24-ffc5-4593-b97d-6a54a132bb40` |
| closure_language | no | ok | true | 1 | 1 | true | false | caught, repaired by a real revision, released | `b9c44469-173a-4b5d-85ec-77a35e1cf882` |
| person_name | no | ok | true | 1 | 1 | true | false | caught, repaired by a real revision, released | `49eaef89-92ba-43fb-90b9-f92c56f7484e` |
| uncited | yes | ok | true | 2 | 2 | false | false | caught, analysis withheld, evidence core released | `fcfa1098-56bd-4be9-8fc2-408b61d65c20` |

Faulty text released in any run: none.
