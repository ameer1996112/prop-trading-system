# Demo-only read-only capture report

## Prior checkpoint evidence

The operator reported `PASS` and confirmed 1671 checks after using the reset-fix package `TradeOpsTelemetryCapture-reset-bbb7f63e4f1b.zip`. No complete final PASS log or binary hash was uploaded for that successful run; retain this as operator-reported synthetic completion, not independent execution evidence. The preceding uploaded September 10 log recorded 21 failing assertions in the earlier bundle. The reset fix explicitly assigns an empty checkpoint identity after ZeroMemory; the self-test assertions were not weakened.

## Approved scope

The operator approved a separate demo-only diagnostic: balance/equity, positions, pending orders and last 24 hours of history. No live-account operation, orders, EA changes, telemetry enrollment/persistence, HTTP transport, deployment or dashboard integration. New files are in the isolated `mt5-stale-payload-recovery` worktree, not the older conversation checkout. Existing intentionally dirty work is preserved; no commit/staging performed.

The script checks connected demo mode before running, executes 38 synthetic preflight assertions, waits at most 15 seconds for a fresh server quote, then stages the report through the existing native broker/account snapshot adapter. It rechecks demo identity/currency and connection before publishing. The exact 24-hour interval ends at the freshly observed quote's whole server second, inclusive, and is printed in server-time/millisecond form. Limits remain 128 positions, 128 pending orders and 256 history deals. Oversized, unsupported, malformed or failed reads abort without publishing partial report data. The adapter's history selection may change the terminal's selected history range; installation instructions disclose this.

`REPORT_COMPLETE` means collection succeeded, not that an operator comparison passed. Floating values can move between reads and screenshots. Zero positions/orders/deals are valid but do not demonstrate nonempty coverage. Diagnostic deal revision 1 is an encoder convention, not a journal/enrollment record. Reports use terminal Experts logging only, with last-four login and private demo financial/ticket details; instructions request reviewing logs before sharing.

## Implementation and review

Added `Scripts/TradeOpsDemoReadOnlyReport.mq5`, `Scripts/Support/TradeOpsDemoReport.mqh`, `Scripts/Support/TradeOpsDemoReportTests.mqh`, and a closure-based safety checker `scripts/verify-mt5-demo-report-boundary.mjs` in the backend worktree.

Synthetic behavioral cases were authored before the helper but cannot be run on this Mac. The host boundary check initially failed because the new entry point was absent, then passed on the 10-file closure; its negative controls reject trading, DLL imports, network and custom file access. This is source-policy evidence, not native behavioral RED/GREEN or an MQL emulator.

Independent source review found that existing validators allow individual `READ_FAILED` readings while the overall capture can succeed. The new diagnostic now rejects these in every account/position/order/deal reading before publication, preserving legitimate NOT_SET/NOT_APPLICABLE/UNAVAILABLE values. Eighteen dedicated field-failure preflight cases were added. The reviewer rechecked the correction and found no remaining blocker to Windows handoff; native compilation/execution is still pending.

All 17 source/fixture files from the prior reset-fix package were compared byte-for-byte against this worktree and are unchanged. Active EA SHA256 remains `4d3058b7ada9d2a2de5ab7bd864225e9120f645cf084e75e731ba747983b12b9`.

## Artifact

Downloads ZIP: `/Users/ameeramer/Downloads/TradeOpsDemoReadOnly-95153f2f03c0.zip`

SHA256: `933314511adc7cc2ca5d18c2d7e35ead0535fdde7904d08ccb6e98accb7e6bd3`

Target folder: `MQL5/Scripts/TradeOpsDemoReadOnly-95153f2f03c0`

All 12 members (10 source files plus instructions/manifest), archive CRCs and extracted bytes were verified. Source SHA256s are included in SHA256SUMS.txt. No EA, EX5, credentials or telemetry namespace is included. Source-only package: Windows compilation and the real demo comparison remain pending.

Host regression, TypeScript typecheck, dry-run boundary and whitespace checks are separate from native validation. The operator's next step is to compile the new script in the connected DEMO terminal, then run it on a spare chart without changing TradeOpsAgent or its DRY_RUN setting. Ask for the COMPLETE/ABORT line before comparison details. Financial dashboard connection remains a later checkpoint.
