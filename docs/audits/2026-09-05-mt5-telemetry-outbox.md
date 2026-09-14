# MT5 telemetry durable outbox — isolated source checkpoint

## Operator update — 2026-09-07

The user reports compilation with `0 0` (zero errors/warnings) and subsequently reports test completion with `checks=8081` after the isolated outbox run instructions. The full final PASS/failures marker, raw compiler/runtime log and EX5 hash were not supplied; preserve this as operator-reported native completion, not independent source-to-binary verification. The earlier sections below record the evidence available when the source ZIP was handed off on September 5.

The user has authorized continuing into the read-only [capture checkpoint](../superpowers/plans/2026-09-07-mt5-telemetry-capture.md). No repeat outbox run or active-EA replacement is needed for local implementation.

## Outcome and evidence boundary

The authorized local outbox checkpoint is implemented, independently reviewed and packaged for isolated Windows testing. It persists one exact pending request, supports byte-identical retry, commits a correlated ACK before retiring its selected events, and permits narrowly validated envelope replacement.

This is **not** a production release or a native-runtime pass. The adapter in this checkpoint is explicitly synthetic. No MQL5 compiler or native outbox execution was available on the macOS host. The active EA, production receiver and frontend were not changed by this checkpoint. No commit, staging, push, deployment, broker action or installed-EA replacement was performed.

The prior Windows file-store evidence is recorded separately in [the native storage audit](2026-09-05-mt5-native-storage-windows.md). Its READ_FIXTURE result is operator-reported PASS with four checks, not an independently captured final native marker or EX5 identity. That evidence is not relabeled as an outbox result.

## Source/worktree identity

- Backend worktree: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`.
- Branch retained: `codex/mt5-stale-payload-recovery`.
- HEAD retained: `8a801423bc19b3bb27c8e24f45d2800a9deb6881`.
- Docs worktree: `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`.
- Baseline evidence: `/private/tmp/tradeops-outbox-RPWXbJ/baseline.json`.
- Final scope evidence: `/private/tmp/tradeops-outbox-RPWXbJ/scope-report.json`.

The comparison checks all 508 baseline files, not only tracked git diffs: 504 remain byte-identical, four intentionally changed, and five new files were added. All existing dirty user work was preserved. The staged diff is empty and HEAD is unchanged.

## Implementation

- New closed typed outbox contract and orchestrator; State remains the only commit writer. Callers cannot replace complete state, choose storage paths/locators/transitions, submit a numeric ACK or set a validation-approval flag.
- Verified context reads load at most 32 selected event payloads. Selection is contiguous, stops at a repeated deal, and shrinks only for an explicit encoded-size outcome. An oversized head event returns LIMIT instead of repeatedly sending an empty heartbeat.
- Pending bytes are read from committed storage before invoking a builder. Frozen prefix/counters remain intact behind later appends.
- ACK validation uses the actual persisted pending bytes and binds identity, registration, request sequence, body digest, full pending-frame digest and exact final event ACK. An identical retained ACK is checked before association with newer pending.
- PREPARE and REPLACE use normal budgets; ACK retains the existing reserve allowance. Pending/ACK ordinals remain 1/2. Existing codec, record format and compaction classification are unchanged.
- State blocks callback reentrancy during adapter/payload validation. Root association and pointer validity are checked across builder/validator boundaries.
- The synthetic adapter validates its complete synthetic DRY_RUN/null-command response and exact rejection proof. It is not the production canonical JSON/HTTP adapter; generic receiver errors cannot be treated as replacement authorization.

## Intentional predecessor changes

Only three of the FileStore source test's fifteen predecessor source pins changed. The other twelve pins were retained. The pin test itself is the fourth changed baseline file.

| Source | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `Include/TradeOpsTelemetryStorage.mqh` | `81f6933aed79623c89c3f87091de52be6a631c1cf596c1eaecdb4790751977e2` | `4a215232ec12b0941ef6f4c3139eb7730d4b9773d982117693d0fb51cf668a4c` |
| `Include/TradeOpsTelemetryState.mqh` | `de27eddd0bef585edf4df345def79642599574ec813ae7a0c82cdbc3a00820a9` | `5bf3c5be8d65af19776c1e1fbb8f48b279f7a4a4bced275ca4c5619a69061e90` |
| `Scripts/TradeOpsTelemetryStateSelfTest.mq5` | `af6b0681240ca76ddb6590bc466e555198d9f914c3e4cea61e5e1c05b7fb9e2d` | `29cae6ac060d5416e71d4fdfc601baaa62c28d7dad6da7d1c4dfa3eebe2c62fe` |

The State self-test change permits a frozen pending producer counter behind the current producer while still checking the persisted pending metadata. Storage admits only the closed runtime transitions. State adds the closed outbox methods and callback guards.

Pin test SHA-256: `2e0b07073b5920be52fe9dd4fef2205256290d6d1bb4f6a0fa46d32ae45375ff` → `771b453435a8fd125e7d1cfb6ac6903a293774dfa5c367dc33054b230c761e4c`.

Frozen active EA SHA-256: `4d3058b7ada9d2a2de5ab7bd864225e9120f645cf084e75e731ba747983b12b9`.
Frozen native FileStore SHA-256: `e6d065d5634e1cd941a66d07ed1d6e6686c46d5b3e5b69632ec624ab247b9bad`.

## Verification actually executed

Controller checks in the backend worktree:

| Check | Actual result |
| --- | --- |
| `npm test --prefix apps/execution-edge` | 35 test files, 574 tests passed; final runtime-source run 50.99 seconds |
| Focused final outbox/state/FileStore source suites | 3 files, 22 tests passed after the final native fixture correction |
| `npm run typecheck --prefix apps/execution-edge` | Exit 0 |
| `npm run lint --prefix apps/execution-edge` | Exit 0; this script is TypeScript checking, not an MQL linter |
| `node scripts/verify-mt5-dry-run-boundary.mjs` | Passed |
| Baseline scope script | 504 unchanged / 4 changed / 5 new; HEAD unchanged, nothing staged |
| `git diff --check` | Exit 0 |
| ZIP integrity and member/source comparison | All 12 archive members passed integrity; all 10 MQL source members matched the reviewed worktree byte-for-byte |

The initial static outbox seam failed before runtime implementation. Native fault scenarios were authored alongside implementation; they were not executed as a red/green MQL test cycle. The host tests enforce static source contracts and execute existing TypeScript backend behavior, not MQL persistence behavior.

## Independent review

Separate specification and code-quality reviewers returned PASS on the final source. Neither reviewer compiled or executed MQL5. The skill-directed independent reviews materially led to callback/reentrancy hardening, explicit REPLACE-budget and request-counter exhaustion fixtures, stale caller-output sentinels, and corrected compaction fault-boundary coverage.

Native harness source includes fresh-instance recovery across CREATE before/after object, state and commit boundaries for PREPARE/ACK/REPLACE; read/revalidation faults; corrupted highest commit; correlated/invalid/partial ACKs; duplicate ACK with newer pending; tail/frozen-state behavior; encoded-size/repeated-deal/32-event limits; nonzero heartbeat ACK; ownership/identity and counter limits; ACK reserve; and cleanup interruptions. DELETE fixtures cover four boundaries without newer pending and two with newer pending, asserting injected IO_ERROR, reload requirement and retained exact bytes after recovery. These are **authored scenarios awaiting native execution**, not observed Windows results.

Final reviewed new-file SHA-256 values:

```text
Include/TradeOpsTelemetryOutbox.mqh
82075afa44a5951ccfd00b222c350ece3a8ce7c320a6ff9767d2cad5508f6efd
Include/TradeOpsTelemetryOutboxContract.mqh
dc1d2eae2bb11187e3225ec0c5fa0bc3d383c3ec2fe93242c4a66f83ea024440
Scripts/Support/TradeOpsTelemetrySyntheticOutbox.mqh
e3525ab55984249c4f3704a9e2a2d32d4a613d539ff25a25f1332af53c899a2e
Scripts/TradeOpsTelemetryOutboxSelfTest.mq5
f818e64072ea28b8827b3e07f0f1d6e69a47079e3fd7a65caa062d0060c1c888
apps/execution-edge/test/mt5-telemetry-outbox-v2-source.test.ts
db1d8484e223f286a919dfdcfb87217c16675a6138772c23ee398995d05512b0
```

## Windows handoff

Source-only ZIP: [TradeOpsTelemetryOutbox-6452160a72f9.zip](/private/tmp/tradeops-outbox-RPWXbJ/TradeOpsTelemetryOutbox-6452160a72f9.zip).

Archive SHA-256: `ca46e2a5bb5ef158db99abea9c105bc2376510619548759b99211a790a139434`.

The archive contains 10 required MQL source files, `SHA256SUMS.txt` and `START-HERE.txt`. No EA executable/source replacement, credentials, deployment configuration, production wire adapter or native FileStore is included.

Use the **first test-only MT5**, leaving the second MT5 and running TradeOpsAgent alone. Back up same-named source files, merge the archive's Include/Scripts contents into that terminal's MQL5 folders, then compile only `TradeOpsTelemetryOutboxSelfTest.mq5` with F7. Collect compiler output/build identity. With zero errors and warnings, run on an unused chart with Allow Algo Trading unchecked; this script has no TestMode/HoldSeconds inputs. Collect the final `TOV2_OUTBOX_PASS` marker with positive checks and zero failures, or every failure line.

No old native namespace or owner.lock deletion is required. Retain the previous WRITE_FIXTURE evidence.

After native outbox verification, account/history capture (Stage 3C), production canonical wire/network handling (3D), full-EA lifecycle integration and dashboard account/journal verification remain future checkpoints. No rollout is authorized by this audit.
