# MT5 native storage Windows evidence, 2026-09-05

The operator completed the isolated native-file test workflow during this task. This audit records the supplied evidence at its actual strength. It permits continuing local outbox development; it does not certify the full EA or a production release.

## Implemented source and bundle

Backend root: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`.

| Artifact | SHA-256 |
| --- | --- |
| `Include/TradeOpsTelemetryFileStore.mqh` | `e6d065d5634e1cd941a66d07ed1d6e6686c46d5b3e5b69632ec624ab247b9bad` |
| `Scripts/TradeOpsTelemetryFileStoreSelfTest.mq5` (v8) | `4b488d1e5767c6cd37e5dbbdb17cad5df768fe01e6a3a898c73067ca1c2cae97` |
| v8 ZIP | `732d37d4c311aad8ae8a304699901a273e2110c0558954d5cea1cf1212db12fb` |
| Existing active-EA source `TradeOpsAgent.mq5` | `4d3058b7ada9d2a2de5ab7bd864225e9120f645cf084e75e731ba747983b12b9` |

Bundle: `/private/tmp/tradeops-native-v8-4MOWwY/TradeOpsTelemetryFileStoreNative-v8.zip`. All six archived source members were compared byte-for-byte against backend sources and ZIP integrity passed. The entire v7-to-v8 MQL difference was addition of `#property script_show_inputs` to the isolated self-test. Storage logic was unchanged. The regression check first failed for the absent directive, then the six focused telemetry/safety suites passed69 tests. Typecheck, lint and the dry-run boundary verifier also passed in that packaging turn. These are host checks, not MQL execution.

## Operator evidence

Image filenames below refer to attachments in this task (temporary clipboard paths under the user's macOS temporary directory); retain the task attachments as the evidence source.

| Mode/evidence | Observed result | Source |
| --- | --- | --- |
| Inputs dialog | Common and Inputs tabs visible; TestMode=LOCAL, HoldSeconds=30 | `codex-clipboard-f2c0f357-02c7-4838-a0b5-c8804fa284bb.png`, `codex-clipboard-b0769376-a0a2-4d0b-a506-916083be8feb.png` |
| LOCAL | `TOV2_FILE_STORE_LOCAL_PASS checks=153 failures=0` visible behind dialog | same attachments; earlier v7 result also shown in `codex-clipboard-f145f943-fc5b-44db-8910-618952b266c6.png` |
| HOLD_READY | `TOV2_FILE_STORE_HOLD_READY seconds=120`, timestamp19:36:17 | `codex-clipboard-a6671836-a607-44d2-87a5-d15832be2123.png` |
| PROBE_LOCK | `TOV2_FILE_STORE_PROBE_LOCK_PASS checks=2 failures=0`, timestamp19:36:20 | `codex-clipboard-47856ad8-c394-48a9-aa42-a78571759c9a.png` |
| HOLD_LOCK | `TOV2_FILE_STORE_HOLD_LOCK_PASS checks=5 failures=0` | `codex-clipboard-d407511a-0633-4e24-aaab-695126dce635.png`; this screenshot records a later hold run, not a continuous raw log of the19:36 pair |
| PROBE_AFTER_RELEASE | `TOV2_FILE_STORE_PROBE_AFTER_RELEASE_PASS checks=3 failures=0` | `codex-clipboard-3348a6e6-2147-4f59-8e37-218f23f6b427.png` |
| WRITE_FIXTURE | `TOV2_FILE_STORE_WRITE_FIXTURE_PASS checks=6 failures=0` | `codex-clipboard-dcc96dfc-f45e-48ad-a238-a12a266fa30e.png` |
| READ_FIXTURE | Operator said "got pass check=4" after instructions to fully close/reopen the first test-only MT5 | User-reported PASS/count; no final raw marker/screenshot, exact failures field, or process trace supplied |

The two lock-test screenshots print the same `FILE_COMMON` base path and show distinct MT5 installations/windows; the probe was recorded about3 seconds after the120-second hold began. The operator identified them as separate MT5 applications. No independent process inventory was collected. The running second terminal's chart continued to show `TradeOpsAgent | SYNC_OK | DRY_RUN` in supplied screenshots.

The first test-only MT5 was selected for WRITE_FIXTURE and the fresh-process READ_FIXTURE sequence. The second MT5 with the working EA was explicitly left running. Do not ask the user to repeat these operations merely to begin local implementation. Do not delete or reset the retained namespace.

## Evidence limits and next work

The current diagnostic script lacks some path/inventory digest inputs and outputs described in the older native-file plan. Those fields were not collected and must not be retroactively inferred. Native source-to-EX5 identity, complete compiler output/build and a fresh process trace are not independently established by screenshots. READ_FIXTURE remains operator-reported. No claim of hardware power-loss durability or protection against external rollback follows from these tests.

The next approved checkpoint is the [isolated durable outbox](../superpowers/plans/2026-09-05-mt5-telemetry-outbox.md). The existing format/state tests and native adapter evidence are predecessors; PREPARE/ACK/REPLACE, capture/history, production wire adapter and active-EA lifecycle still require their own implementation and verification.
