# MT5 telemetry capture checkpoint — implementation evidence

Date: 2026-09-07. Status: first Windows compile failed; corrected source bundle `2e3554c48b2b` reviewed and host-verified, awaiting Windows recompilation. This is not a rollout or native execution attestation.

## Windows compile follow-up — replacement bundle

The operator's screenshot `codex-clipboard-e4a6c1c8-9800-4b29-a845-319ad82daf1e.png` shows6 errors/0 warnings compiling the first bundle: three undeclared dividend/tax identifiers in `TradeOpsNativeCaptureBroker.mqh:23–25`, and three local-variable section limit errors in the self-test at lines362,363,438. This is actual operator-supplied failed compilation evidence, not a native pass. Earlier source-review and host-test results below did not establish MQL compilation correctness.

Root causes and narrow repairs:

- The native mapping used nonexistent `DEAL_TYPE_DIVIDEND`, `DEAL_TYPE_DIVIDEND_FRANKED`, and `DEAL_TYPE_TAX`. The [documented MQL5 identifiers](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties) are `DEAL_DIVIDEND`, `DEAL_DIVIDEND_FRANKED`, and `DEAL_TAX`; those spellings now map to the same unchanged wire strings. No numeric enum guesses or disabled cases were introduced.
- The fake broker embedded2048 history rows directly inside each local broker/rig object. Functions with multiple fixtures and checkpoint copies exceeded the reported2MiB local-variable section ceiling. The synthetic buffer is now a dynamic array with checked allocation of the same2048 rows, allocation-failure READ_FAILED status, and insertion bounds checked against both logical capacity and actual allocation. Production collector limits, State, history scanning and wire formats are unchanged. See [MQL5 compiler memory error338](https://www.mql5.com/en/docs/constants/errorswarnings/errorscompile) and [ArrayResize](https://www.mql5.com/en/docs/array/arrayresize).

Two source regression tests first failed (2 failed/6 passed), then the focused suite passed8/8. Native cases were added for all three enum mappings and synthetic allocation/first-last-slot/overfill/empty-buffer bounds; they remain unexecuted. Independent repair review passed with no blockers. Full controller regression:36 files/582 tests passed in57.75s; typecheck, lint, dry-run boundary verification and whitespace checks passed. The513-file baseline audit still identifies only the earlier authorized State seam and its pin; this repair introduces no additional predecessor change.

Replacement ZIP: `/private/tmp/tradeops-capture-3wW0A6/TradeOpsTelemetryCapture-2e3554c48b2b.zip`.
ZIP SHA256: `81c7b96d208ec96828faf70258f0029af7295869b4e29f0c784de55a9e53a562`.
Target: `MQL5/Scripts/TradeOpsCaptureCheckpoint-2e3554c48b2b/`.
All19 archive members, source/fixture bytes, instructions and hashes were verified; `unzip -t` passed. The old ZIP/folder is retained and superseded, not overwritten or deleted. Its original report was preserved as `package-report-d6045e557df6.json`.

Changed source SHA256 values:

- Native broker: `7b946b743ea84e986609cfef1271d6b138e81c5aeaab3f0519b48826e8888786`.
- Synthetic broker: `6792882993ce5afe0c8194ad83596f310a07f1a1350c0844da6be9f14286f546`.
- Self-test: `b11e76df542b48fcd67b0e4b14af86a1b904c42a21be778363ebd29aacbdd204`.

Next operator action: install the new versioned folder alongside the old one, open the self-test from the NEW folder, press F7, and provide the compiler result. Do not run until compilation is clean. Windows recompilation and native execution remain pending; no claim is made that the revised source compiles with0 errors. The active EA stays unchanged in DRY_RUN. The remaining sections preserve the first implementation and package evidence chronologically.

## Scope

The user authorized read-only account/exposure/history capture after reporting outbox compilation with0 errors/0 warnings and8081 checks. The complete outbox PASS/failures marker, raw logs and EX5 hash were not supplied; that evidence remains operator-reported. The previous outbox checkpoint is not being replaced or rerun as an implementation prerequisite.

Implementation follows [the capture plan](../superpowers/plans/2026-09-07-mt5-telemetry-capture.md) in the isolated backend worktree `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`, HEAD `8a801423bc19b3bb27c8e24f45d2800a9deb6881`. Documentation remains in the separate `tradeops-dashboard-migration` worktree. No work was implemented in the older conversation CWD checkout.

No active-EA edits, deployment, broker operation, commit, staging, migration, frontend redesign or network integration is authorized by this checkpoint. The existing EA still sends the prior health-only payload. Financial dashboard/private reads and full production v2 request/response integration remain later work.

## Task1 — typed capture and canonical records

Eight new files add normalized bounded types, a strict canonical codec, pinned-account two-pass exposure capture, the native read-only broker adapter, a deterministic fake broker, native synthetic self-test, shared vectors and host source-contract checks. Existing source files were unchanged at this review boundary.

The codec includes account, exposure, registration, boundary, DEAL and protection encoding, with strict decode/reencode for persisted shapes. The native adapter reads account-wide positions/orders/history, preserves ulong ticket text and separate signed cost readings, distinguishes failed history from empty history, and retains bounded unsupported-row descriptors. The snapshot compares stable fields across two exposure reads and keeps the last complete snapshot separate from a failed attempt. It permanently stops on a fingerprint mismatch.

Main pre-review corrections: lexicographic boundary exclusions, stable-field comparisons beyond tickets, explicit COMPLETE status on successful broker results, and the receiver's upper boundary-timestamp limit. These were fixed before review. A failed clock read yields cleared outward data without invented observation timestamps; the collector must not encode that as a newly observed failed attempt.

Verification actually run:

- Baseline execution-edge suite before capture changes:35 files /574 tests passed.
- Capture focused host suite after Task1:1 file /3 tests passed, covering11 canonical vectors through the production receiver parser and independent SHA256.
- Typecheck and lint (TypeScript no-emit): passed.
- `git diff --check`: passed.
- Independently compared all513 baseline source hashes: all unchanged; HEAD unchanged, no staged files.

The initial test-first run failed because the new modules/fixtures were missing. A later source-contract RED caught missing stable-field/COMPLETE checks before their implementation. One controller rerun encountered Vite's sandbox temporary-config write restriction, not an assertion failure; the scoped escalated rerun passed. Reviewers also passed using `--configLoader runner --no-cache`.

Independent review order was specification then quality. Both passed on actual source inspection and focused host verification. Quality review noted one nonblocking maintainability improvement: add fixed synthetic scenario labels/check indices on native failures without printing broker values. Task2 will incorporate it while extending the harness.

Reviewed source snapshot and hashes: `/private/tmp/tradeops-capture-3wW0A6/task1-reviewed.json` and `task1-reviewed/`. Whole-worktree preimplementation snapshot: `baseline.json` and `before/` in the same temporary evidence directory.

## Task2 preimplementation contract review

The read-only server/State contract review confirmed the planned narrow `ReadCaptureContext` seam is sufficient; State.Append already publishes exact event records and the next capture checkpoint atomically. No additional generic State writer is needed.

Two design corrections were recorded before implementation:

- Deferred protection observations must retain their original complete sample until drained, or explicitly record an observation gap if superseded. A digest alone cannot recover an older sampled SL/TP value after snapshot replacement.
- Row counts and the262144-byte checkpoint ceiling are independent. Exact encoding is preflighted with diagnostic headroom; exhaustion must not evict revision identities or advance a cursor.

Capture coverage derives from the checkpoint and verified accepted-event count, not the separate State completeness metadata. Synthetic outbox tests pre-read the verified capture context rather than trying a reentrant read inside a State callback.

## Pending evidence

### Initial Task2 specification review — changes required

The independent review found five source-level issues: stale last-quote enrollment could import pre-enrollment records; a newly observed complete protection sample could be discarded on history failure without an observation gap; protection-only deferred work could report UP_TO_DATE after a partial ACK; ordinary quote resumption after idle polls could cause a false clock discontinuity; and UTC reversal below enrollment bypassed watermark invalidation. These are being corrected before packaging, with dedicated native scenarios. Native scenarios are authored evidence, not executed evidence.

The clock refinement adds a bounded fresh-quote enrollment gate and a separately persisted broker-advance UTC anchor. This narrowly extends the new Task1 capture interface/native adapter; it does not alter the active EA or predecessor telemetry behavior. MetaQuotes documents [TimeCurrent as the last quote clock](https://www.mql5.com/en/docs/dateandtime/timecurrent) and [GetTickCount64 as elapsed system milliseconds](https://www.mql5.com/en/docs/common/gettickcount64); the implementation uses receipt-age evidence, not an invented broker/UTC conversion.

A controller full-suite attempt with `--configLoader runner --no-cache` inside the sandbox produced17 coordinator-test setup timeouts and was interrupted (exit130); it was not a passing run. The unchanged local D1 harness starts Miniflare. Re-running its first failing test with the same arguments outside the sandbox passed in868ms (1 passed,16 skipped), isolating the local-runtime restriction. The final full suite will run with the required scoped permission; tests and timeouts were not weakened.

### Task2 correction and regression evidence

All five findings above were resolved and independently re-reviewed: specification PASS. Dedicated native scenarios cover stale enrollment/receipt freshness, failed-history and unsupported-row sample loss, protection-only ACK-between-polls, idle quote resumption, and UTC reversal below enrollment. The 33-field shared checkpoint vector includes `broker_anchor_utc`; its independently verified SHA256 is `cca714485780ec2db7e16cdfbad7f5c451c16dce2cefec1d8ec823b79abece2b`.

Task2 initial host RED was1 missing-module failure with3 existing checks passing. Correction-round host RED was2 failures/4 passing checks for the new clock gate and changed checkpoint framing; focused GREEN was6 capture tests and24 combined capture/State/FileStore tests. Initial native scenarios preceded implementation; additional cases were authored during implementation/review. None were run on this Mac, so there is no native RED/GREEN evidence.

Controller verification against the corrected source:

- `npm test --prefix apps/execution-edge` with scoped permission for disposable local Miniflare runtime:36 files /580 tests passed, duration54.35s.
- `npm run typecheck --prefix apps/execution-edge`: exit0.
- `npm run lint --prefix apps/execution-edge`: exit0.
- `node scripts/verify-mt5-dry-run-boundary.mjs`: passed.
- `git diff --check`: exit0.
- All513 baseline files compared:511 unchanged. HEAD unchanged and no staged files.

The only two changed predecessor files are the25-line `ReadCaptureContext` method and its exact existing source-test hash pin. Direct diffs against the saved preimplementation copies confirm no unrelated changes:

| File | Before SHA256 | After SHA256 |
| --- | --- | --- |
| `mt5/TradeOpsAgent/Include/TradeOpsTelemetryState.mqh` | `5bf3c5be8d65af19776c1e1fbb8f48b279f7a4a4bced275ca4c5619a69061e90` | `91e65764513aabcf76c302bdf0cb8e694833ca40835cd0e61d643f05dd08d8ee` |
| `apps/execution-edge/test/mt5-telemetry-file-store-v2-source.test.ts` | `771b453435a8fd125e7d1cfb6ac6903a293774dfa5c367dc33054b230c761e4c` | `74e299e7bf934ab7c181ae9f09d806a14e8dceb169cd3206525337d6bddbabd9` |

Full source hashes and scope report: `/private/tmp/tradeops-capture-3wW0A6/scope-report.json`. Active EA SHA256 remains `4d3058b7ada9d2a2de5ab7bd864225e9120f645cf084e75e731ba747983b12b9`; FileStore remains `e6d065d5634e1cd941a66d07ed1d6e6686c46d5b3e5b69632ec624ab247b9bad`; outbox remains `82075afa44a5951ccfd00b222c350ece3a8ce7c320a6ff9767d2cad5508f6efd`.

### Final quality review and handoff

Independent whole-capture quality review passed with no blocking findings. One P3 diagnostic improvement was then implemented and re-reviewed: synthetic rig helpers now guard invalid pointers and clear outputs when initialization/read/preparation fails; restart and allocation paths are checked. `UninitializedRigHelpersFailClosed` is invoked by the native self-test. The quality re-review passed. This final delta changed only the new self-test and its host source assertion, not capture runtime or State.

The controller reran the complete suite against that final delta:36 files /580 tests passed in44.30s. Typecheck, lint, dry-run boundary verification and whitespace checks passed again. The513-file scope audit still has exactly the two authorized predecessor changes above; no staged files and no HEAD change.

Verified source-only Windows package:

- ZIP: `/private/tmp/tradeops-capture-3wW0A6/TradeOpsTelemetryCapture-d6045e557df6.zip`
- ZIP SHA256: `12ee2e8c7531452c3cb747e0138d0bb54bef0775bfee7021aac14b64f3e7f6c5`
- Isolated target folder: `MQL5/Scripts/TradeOpsCaptureCheckpoint-d6045e557df6/`.
-16 transitive MQL source files,1 shared synthetic fixture JSON, `SHA256SUMS.txt` and `START-HERE.txt`;19 exact archive members.
- Self-test SHA256: `6adde11169cb217376578d24e8b66cc2adace7a6577d6561d03bfdd1b2e5d65e`.
- Collector SHA256: `367cbcf4670a169816e9d0e87d4f3bf5f2d47e4fa42082253ed7703786e688e9`.
- Capture checkpoint codec SHA256: `d4171ed146b7bfd732ce907a6f22acf37be63784d14059b51c617060d4976bc5`.
- Native broker SHA256: `4a188e675f24a67a1b01612c8ada45307e4bd89ed05a6a4a3b903c13d6e8059e`.

The package builder recursively resolved local includes, rejected external imports/includes and active-EA/send dependencies, compared every archived source byte with the current source, checked the exact member list, compared instructions/manifests, and passed `unzip -t`. Full manifest: `/private/tmp/tradeops-capture-3wW0A6/package-report.json`. No EX5, credentials, actual account data, FileStore owner or production network adapter is included. Native adapter source is compiled as a dependency but the self-test uses synthetic broker data and memory storage only.

Windows handoff: copy the complete versioned folder into the test terminal's `MQL5/Scripts`, open its nested `Scripts/TradeOpsTelemetryCaptureSelfTest.mq5` in MetaEditor and compile. Expect0 errors/0 warnings; do not guess fixes if compilation fails. After a clean compile, run the script with no inputs and copy the full final `TOV2_CAPTURE_PASS checks=<count> failures=0` line (or the full FAIL/check diagnostics).

No native MQL compilation or execution has occurred on this Mac. Native worst-case memory/performance, Windows synthetic execution and later actual read-only demo comparison remain unverified and required. Do not interpret host source tests as an MQL interpreter or as proof of a working EX5. Keep the running EA unchanged in DRY_RUN; this bundle does not connect financial data to the dashboard. Stage3D production transport/lifecycle and later rollout remain separate work.
