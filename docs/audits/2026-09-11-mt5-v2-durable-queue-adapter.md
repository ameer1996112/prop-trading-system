# MT5 v2 durable-queue adapter — offline source handoff

Date: 2026-09-11. Plan: `../superpowers/plans/2026-09-11-mt5-v2-durable-queue-adapter.md`.

## Result and boundary

The reviewed checkpoint adds the offline v2 durable-queue adapter, restart-verifiable acknowledgment witness handling, receiver-aligned native fixtures, and a reproducible isolated source package. The active EA and receiver contracts are unchanged. This does not install or activate the script, connect to a broker, call HTTP, schedule timers, submit orders, reset a store, deploy, migrate, stage, commit, merge, upload private data, or make the trading system operational. `DRY_RUN` remains the enforced boundary.

Native compilation and execution of `TradeOpsTelemetryOutboxV2SelfTest.mq5` were **NOT RUN**. Every result below is host/source/package evidence only and must not be described as MQL5 compile or runtime success.

## Final host verification

Run after the final reviewed fixture correction in backend worktree `codex/mt5-stale-payload-recovery`, at 12:57:36 on 2026-09-11:

```text
npm --prefix apps/execution-edge test -- --reporter=default
38 test files passed; 679 tests passed; exit 0; duration 42.92s

npm --prefix apps/execution-edge run typecheck -- --pretty false
exit 0; no diagnostics

node scripts/verify-mt5-dry-run-boundary.mjs
MT5 dry-run boundary verification passed.

git diff --check
exit 0; no output
```

The full test run emitted only existing intentional rejection diagnostics and the telemetry budget measurement; it reported no failed tests. Focused TDD evidence for the new package checks was 30 passing / 2 failing at RED because the packager module did not exist, then 32/32 passing after implementation. The focused package test also invokes external `unzip -t`, extracts the archive, and validates `SHA256SUMS.txt` with `shasum -a 256 -c`.

## Final delivered source archive

After the final broad review and one scoped fix/re-review, the controller generated the final Downloads archive with exclusive creation:

```text
/Users/ameeramer/Downloads/tradeops-telemetry-outbox-v2-selftest-v2.0.0-source.zip
SHA-256 31ba1cc0979a407526e28ad7dafcb8a56e5422805e0cb367f6f126e1905990f6
25 ZIP entries
22 MQL source files in the exact transitive include closure
398439 extracted bytes
```

Independent validation of that exact Downloads archive passed external `unzip -t` for all 25 entries. It was extracted into the fresh `/private/tmp/tov2-outbox-final-extracted.esPep0`; from that extraction root, `shasum -a 256 -c SHA256SUMS.txt` reported all 24 listed files `OK`. The package tests verify deterministic output across fresh directories. All MQL source paths stay below `MQL5/Scripts/TradeOpsTelemetryOutboxV2SelfTest-v2.0.0/`; there are no global `MQL5/Include` or `Experts` destinations, binaries, credentials, unresolved includes, symlink escapes, native broker calls, WebRequest, real file APIs, timers, or order APIs.

The executed CLI and destination were:

```sh
node scripts/package-mt5-outbox-v2-selftest.mjs --output-dir /Users/ameeramer/Downloads
# /Users/ameeramer/Downloads/tradeops-telemetry-outbox-v2-selftest-v2.0.0-source.zip
```

The builder uses exclusive creation and will not overwrite an existing versioned artifact. If that destination already exists, stop and choose a fresh version; do not delete or replace it silently. The earlier temporary review archive with SHA-256 `4b5f7fcd73d1ed18c76a10bec12a8438a955ecad8272773ef56ebfe1a15f77e3` predates the last native fixture correction and is not the delivered artifact.

## Baseline classification and compatibility review

The overall baseline `/private/tmp/adapter-source-baseline.json` contains 130 pre-existing source files. The final comparison found exactly 10 changed and zero missing. All 10 are previously reviewed Tasks 1–3 allowlist changes:

- Task 1 State/witness work: `TradeOpsCaptureStateCodec.mqh`, `TradeOpsTelemetryState.mqh`, `TradeOpsTelemetryStateSelfTest.mq5`, `mt5-telemetry-file-store-v2-source.test.ts`, and `mt5-telemetry-state-v2-source.test.ts`.
- Task 2 adapter/canonical encoder compatibility work: `TradeOpsCaptureCodec.mqh`, `TradeOpsTelemetryWireV2.mqh`, and the implementation-status comment in `TradeOpsTelemetryOutboxContract.mqh`.
- Task 3 fault-observation/source checks: `TradeOpsTelemetryMemoryStore.mqh` and `mt5-telemetry-outbox-v2-source.test.ts`.

Task 4 changed only the Task 3-created `mt5-telemetry-outbox-v2-golden.test.ts` and added `scripts/package-mt5-outbox-v2-selftest.mjs`; it changed no additional pre-existing baseline file. The active `mt5/TradeOpsAgent/TradeOpsAgent.mq5` remains SHA-256 `4d3058b7ada9d2a2de5ab7bd864225e9120f645cf084e75e731ba747983b12b9`, exactly matching the overall baseline, and is absent from the archive.

State witness retention was reviewed in the packaged closure and host checks: current- and previous-root witness protection, restart recovery, corruption/deletion refusal, faulted compaction retention, and eventual reclaim remain covered. Encoder compatibility was reviewed through the shared canonical capture builders, exact literal native fixture parity, the TypeScript receiver oracle, and the existing wire goldens. These checks are source/host evidence, not native execution.

## Native evidence and deferred scope

The older wire self-test has separate user-log evidence: `/Users/ameeramer/Downloads/20260911.log` records two `TOV2_WIRE_PASS checks=412 failures=0` results at `09:55:08.441` and `09:55:21.295`, each following `vectors=12`. That log has no cryptographic ZIP/source/compiler binding and does not cover this durable adapter; the wire audit records the distinction.

Automatic stale-envelope recovery remains intentionally deferred. `ValidateReplacement` returns false: a timeout, local age, generic HTTP failure, or uncorrelated `STALE_ENVELOPE` is not proof that immutable pending bytes were never accepted. A later approved lifecycle/transport plan must provide correlated definitive rejection before any replacement behavior. HTTP ownership, production installation, broker/trade testing, and rollout are outside this checkpoint.

Final review found no blocking production-seam issues. Its one Important newer-pending fixture timestamp defect was fixed and independently re-reviewed with no new breakage. The final reviewer retained as non-blocking Minor follow-ups: canonical full-root comparisons, direct exact 262144/262145 and malformed-before-size adapter assertions alongside calibrated shrink tests, and existing intentional host diagnostic noise. The controller explicitly deferred these with costs recorded in the implementation ledger. Large-fixture heap allocation and audit path wording concerns are resolved. Native success is still unclaimed.

## Isolated Windows compile/run steps

1. Extract the final Downloads ZIP for a disposable non-live MT5 terminal; retain the SHA-256 recorded above.
2. If `MQL5\Scripts\TradeOpsTelemetryOutboxV2SelfTest-v2.0.0` already exists, stop and choose a fresh package version. Do not merge it into global Include and do not install it over the running EA.
3. Copy only the extracted `TradeOpsTelemetryOutboxV2SelfTest-v2.0.0` folder into that terminal's `MQL5\Scripts` folder.
4. Compile `MQL5\Scripts\TradeOpsTelemetryOutboxV2SelfTest-v2.0.0\Scripts\TradeOpsTelemetryOutboxV2SelfTest.mq5` in MetaEditor and record compiler build, errors, warnings, and the exact ZIP SHA-256.
5. Only after a successful compile, run that offline script and capture its final `TOV2_OUTBOX_V2_PASS` or `TOV2_OUTBOX_V2_FAIL` line. Do not attach or activate an EA and do not perform a production or trade test.
