# MT5 v2 wire contract — source-only Windows handoff

Date: 2026-09-10. Plan: `../superpowers/plans/2026-09-10-mt5-v2-wire-contract.md`.

## Result and boundary

Implemented the offline request encoder/decoder and correlated response verifier, shared receiver vectors, native test harness, and deterministic source package builder in the existing `codex/mt5-stale-payload-recovery` worktree. All three tasks passed independent static review, followed by a whole-checkpoint review. No Critical or Important findings remain for source-only Windows validation.

This is not HTTP integration, an installable binary, or permission to trade. Host and package checks are not native evidence; separate user-supplied native wire log evidence is recorded below. No private account upload, broker/order operation, deployment, migration, active EA change, staging, commit or merge occurred. Existing v1 and capture source files remain unchanged; the 123-file pre-existing source baseline check passed. HEAD remains `8a801423bc19b3bb27c8e24f45d2800a9deb6881`.

New implementation files under backend:

- `mt5/TradeOpsAgent/Include/TradeOpsTelemetryWireTypes.mqh`
- `mt5/TradeOpsAgent/Include/TradeOpsTelemetryWireV2.mqh`
- `mt5/TradeOpsAgent/Include/TradeOpsTelemetryResponseV2.mqh`
- `mt5/TradeOpsAgent/Scripts/TradeOpsTelemetryWireSelfTest.mq5`
- `mt5/TradeOpsAgent/fixtures/telemetry-wire-v2.json`
- `apps/execution-edge/test/mt5-telemetry-wire-v2-golden.test.ts`
- `scripts/package-mt5-wire-selftest.mjs`

## Verification evidence

Controller's final run after the isolated-layout fix:

```text
npm test --prefix apps/execution-edge
37 files passed; 644 tests passed; duration 59.32s
npm run typecheck --prefix apps/execution-edge -- --pretty false
exit 0, no diagnostics
node scripts/verify-mt5-dry-run-boundary.mjs
MT5 dry-run boundary verification passed.
pre-existing source baseline: 123 files, 0 changed
native/JSON literal parity: 12 vectors exact
git diff --check: no output
```

Host tests exercise the real TypeScript receiver and packaging, not MQL5 execution. At the original handoff, the new MQL source was statically reviewed only. Compiler build/version and a cryptographic binding from compiled sources to the delivered ZIP remain unavailable. No performance claim is made.

## Later native wire log evidence (not source-hash bound)

The user-provided `/Users/ameeramer/Downloads/20260911.log` contains two runs identified as `TradeOpsTelemetryWireSelfTest (EURUSD,M5)`. Each starts with `TOV2_WIRE_START vectors=12 offline=1` and ends with `TOV2_WIRE_PASS checks=412 failures=0`, at `09:55:08.441` and `09:55:21.295` on 2026-09-11.

This is native runtime evidence for the wire self-test behavior represented by that log. It is not evidence for the later durable-queue adapter self-test, and it does not cryptographically bind the executed sources or compiler output to `tradeops-telemetry-wire-selftest-v2.0.0-source.zip`. The log does not record a source ZIP SHA-256 or compiler/source hash, so this audit makes no exact-artifact or compiler-binding claim.

## Exact handoff artifact

`/Users/ameeramer/Downloads/tradeops-telemetry-wire-selftest-v2.0.0-source.zip`

SHA256: `86ea81fcfffd898e2132b81800c01a3aaaa5b96c6edcdccbfc87bef47dca23e6`

11 entries: 8 MQL source files in the exact include closure, README, manifest and SHA sums; 208525 extracted bytes. The final Downloads archive passed builder CRC/extracted-byte validation, external `unzip -t`, and external extraction followed by `shasum -a 256 -c SHA256SUMS.txt` (all 10 listed hashes OK). Extracted verification copy: `/private/tmp/tov2-final-extracted.tWvi4S`.

Archive paths are isolated beneath `MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/{Include,Scripts}`. The initially unsafe global Include mapping was corrected and independently re-reviewed before this final artifact was generated. Do not use earlier temporary package variants.

## Windows operator steps

1. Extract the ZIP. In the disposable non-live MT5 terminal choose File > Open Data Folder.
2. Copy ONLY the extracted `TradeOpsTelemetryWireSelfTest-v2.0.0` folder from the archive's `MQL5/Scripts` into that terminal's `MQL5/Scripts`.
3. If that exact versioned folder exists, stop and compare package hashes; do not overwrite it. Do not replace global Include or merge the entire MQL5 tree.
4. Compile `MQL5/Scripts/TradeOpsTelemetryWireSelfTest-v2.0.0/Scripts/TradeOpsTelemetryWireSelfTest.mq5` in MetaEditor. Record compiler build/errors/warnings.
5. After successful compilation, run only this offline script, capture `TOV2_WIRE_START` and the final PASS/FAIL line. It needs no account connection, credentials or trading activation. Do not activate an EA.

## Review notes and remaining work

A deferred Minor remains in the package builder: its internal verifier checks local records/CRCs/extracted bytes, but does not structurally validate central-directory/EOCD fields. Final review accepted deferral because the exact handoff archive separately passed a standard unzip reader and extracted hashes. Future builds must keep this independent validation until the automated verifier is strengthened.

The durable production outbox adapter is covered by the separate 2026-09-11 offline checkpoint. A later, separately approved plan is still required for a single controlled HTTP/lifecycle owner. Synthetic CPEND1/CACK1 stay test-only. Generic STALE_ENVELOPE errors do not provide correlated definitive rejection proof and cannot authorize pending-byte replacement. No such transport or rollout was started here.

Full task reports, snapshots, preflight decisions and review packages are retained under backend `.superpowers/sdd/2026-09-10-mt5-v2-wire-contract/`. The intentionally dirty worktree is kept as-is; no integration or cleanup is authorized by this checkpoint.
