# Durability contract before Phase 1A traffic

Phase 0 creates only a local append-only evidence table and contracts. It does not claim the
following production durability exists.

Tier 0 safety/audit facts include accepted receipts/input events, stream gaps/checkpoints,
action-grant consumption and commands, arming/freeze/safety-epoch/reservation transitions,
dispatch authorizations and attempts, raw outcomes, broker callbacks/deals/fills, synchronization
cursors/evidence, and their outbox/audit facts.

Before Phase 1A accepts traffic, Tier 0 PostgreSQL must synchronously confirm remote apply or
quorum to a durable standby in a separate failure domain. No ingress success, external cursor
advance, broker authorization, risk release, or completeness publication can precede that
confirmation. Standby/link loss makes readiness false and freezes allocation without async
downgrade. Failover must fence the old primary and verify replay LSN before arming.

Acknowledged Tier 0 facts target RPO zero for primary host/site loss. Tier 1 projections,
dashboard models, telemetry copies, cached aggregates, and derived reports target RPO at most
five minutes and cannot inform safety until rebuilt from Tier 0. Encrypted continuous WAL/PITR
must report correlated-disaster RPO separately. Both tiers target total RTO at most 60 minutes.

The Phase 1A pre-traffic proof must include isolated restore, projection rebuild, primary
fencing, synchronous-link failure at every acknowledgement boundary, capacity/retention alarms,
and forward-only expand/contract application rollback. None of those gates is implied by the
local Compose PostgreSQL service.

The Phase 0 migration stores authoritative canonical UTF-8 text and computes SHA-256 from those
exact bytes in PostgreSQL; JSONB is a derived projection. `recorded_at` and the hash are database
controlled. Row-level UPDATE/DELETE and statement-level TRUNCATE triggers reject mutation. Public
privileges are revoked, and the `phase0_runtime` NOLOGIN role receives SELECT plus EXECUTE on one
`SECURITY DEFINER` append function—not direct table INSERT. That function has a fixed safe search
path, re-canonicalizes the payload, and binds the envelope evidence/gate identifiers to its JSON.
A future deployment login must explicitly assume the runtime role and must not own the table or
hold superuser/DDL privileges. These controls enforce a least-privilege runtime boundary; they are
not cryptographic immutability, and a table owner or PostgreSQL superuser can remove or bypass
database controls. Remote durable storage and independently controlled retention remain gates.
