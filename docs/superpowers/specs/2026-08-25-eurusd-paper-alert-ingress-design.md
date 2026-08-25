# EURUSD paper-alert ingress design

## Purpose

Prove a single TradingView EURUSD five-minute alert can reach the existing
Cloudflare observation service, be authenticated and recorded, and remain
strictly non-executable. This is the next stage after the MT5 DRY_RUN health
dashboard; it does not alter MetaTrader, broker connectivity, or execution
authority.

## Scope

- One source only: the reviewed EURUSD five-minute TradingView alert.
- Existing Cloudflare observation Worker and its D1 receipt store.
- Authenticated, deduplicated observation receipts and their existing read API.
- Evidence for receipt freshness, accepted/rejected outcomes, and safe recovery
  after a duplicate alert.

## Explicit exclusions

- No live, demo, evaluation, or broker orders.
- No order, fill, position, broker credential, or MetaTrader command route.
- No MT5 Expert Advisor, WebRequest allowlist, Algo Trading, or broker setting
  change.
- No candidate emission or candidate dispatch. Both must remain `false`.
- No additional symbols in this rollout.

## Architecture

TradingView sends its reviewed `alert()` envelope to
`POST /api/v1/tradingview/observations` on the existing observation Worker.
The Worker validates the dedicated TradingView credential by its stored SHA-256
digest, applies the existing strict schema and deduplication rules, and writes
only a redacted receipt into D1. The existing receipt/readiness surfaces show
the outcome. The MT5 DRY_RUN health Worker and its dashboard are independent
and do not receive the observation.

```text
TradingView EURUSD 5m alert
          |
          v
Cloudflare observation ingress -> receipt/audit D1 -> paper-only visibility
          |
          +-> never sends data or commands to MT5, broker, or execution edge
```

## Required configuration

The observation Worker must retain these constraints:

- `TRADINGVIEW_OBSERVATION_INGRESS_ENABLED=true`;
- the raw TradingView credential exists only in the TradingView alert/script
  input, while only its lower-case SHA-256 digest is stored as the Worker
  secret `TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256`;
- `RD_EXECUTION_CANDIDATE_EMISSION_ENABLED=false`;
- `RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED=false`;
- `RD_EXECUTION_RECEIVER_MANIFEST_SHA256=INERT_NOT_CONFIGURED`.

The initial symbol allowlist is EURUSD alone. A second symbol is considered
only after a full trading session yields current, accepted receipts and the
receipt/recovery tests pass.

## Rollout and acceptance gates

1. Verify the reviewed local source and existing observation tests on a clean
   worktree.
2. Inspect the remote Worker bindings by name only; never print a raw
   credential.
3. Apply only any currently pending observation D1 migrations after specific
   approval, without deleting or modifying existing records.
4. Deploy the paper-only observation Worker with candidate emission and
   dispatch still disabled.
5. Create one reviewed TradingView EURUSD five-minute alert using the supplied
   endpoint and dedicated credential.
6. Prove one accepted receipt, one idempotent duplicate receipt, and a current
   receipt heartbeat. Confirm that no MT5 or broker-facing endpoint was called.
7. Leave the integration under observation for one market session before
   discussing a second pair.

## Failure handling

Authentication, schema, identity, stale, or replay conflicts fail closed and
are recorded only as redacted receipt outcomes. Missing/expired receipt
freshness marks paper readiness degraded; it must not trigger a fallback,
retry-to-execution, or MT5 action. Any attempt to enable candidate emission,
dispatch, execution authority, or to add a second symbol stops this rollout
and requires a separate written design and approval.

## Verification

Acceptance requires a passing local observation verification, the deployed
Worker retaining all four non-execution controls above, and remote evidence of
accepted EURUSD receipts with no execution-related action. MT5 health remains
independently online, but it is not part of this alert path.
