# Console reliability implementation — 2026-09-02

Status: implemented and verified locally; no deployment performed.

Branch: `codex/console-reliability`

Base: `d4466766085ff432b507f7f6ab18413dbc0c32f2`

## Scope

This implements the first batch from the migration optimization audit: A01, A02,
and A03. It changes only operations-console request handling, polling, and stale
state controls. It does not change Pine detection, entry rules, risk settings,
broker execution, Cloudflare bindings or secrets, or D1 schema.

## Changes

- **A01 — bounded response consumption:** deadlines and caller cancellation now
  cover response bodies as well as headers. Reads retain their bounded retry
  policy. Control POSTs are never automatically replayed; an already cancelled
  POST is not dispatched.
- **A02 — authoritative control refresh:** a control operation cancels obsolete
  reads and blocks overlapping polls. After either POST outcome, the console
  attempts an authoritative read before making controls available again. Failed
  reconciliation leaves evidence marked stale and controls disabled. Locking or
  unmounting prevents a late result from restoring a previous session.
- **A03 — visibility-aware polling:** hidden or offline pages stop polling and
  cancel active reads. Recovery triggers one immediate refresh. Stale evidence
  is explicitly identified, and controls stay disabled until fresh readiness is
  available. Recovery never resends a control POST.

## Verification

Executed in `apps/operations-console` against the final implementation:

- `npm test`: 139 tests passed across 11 files.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

Executed at repository root:

- `python3 scripts/static_boundary_check.py --root .`: passed; no broker command
  or live/import configuration surface detected.
- `git diff --check`: passed.

New regressions cover stalled response bodies, cancellation, mutation/read races,
hidden and offline transitions, failed reconciliation, and session cleanup.
Independent code review identified a reconnect-during-pending-POST recovery gap;
it was reproduced with a failing test, fixed, and re-reviewed with no remaining
actionable findings. These are local automated checks, not proof of deployed
behavior or end-to-end broker execution.

## Handoff

No Pine replacement or TradingView alert refresh is needed for this batch.
Production remains unchanged. The next planned optimization batch is A04–A06:
reduce repeated readiness scans and decision-query fan-out, with separate tests
and review before any rollout.
