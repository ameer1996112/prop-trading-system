# Phase 0 architecture

## Scope and dependency direction

This is a modular monolith scaffold with a deliberately narrow runtime:

```text
operations console -> FastAPI presentation -> application services -> domain contracts
                                             -> observation-only adapters
```

`prop_trading.domain` imports no framework. `prop_trading.contracts` owns strict versioned wire
schemas. `prop_trading.application` evaluates evidence and readiness. `prop_trading.adapters`
owns PostgreSQL metadata, safe provider probes, and immutable tick-fixture storage. API handlers
only render application results.

All runtime I/O boundaries are async. Settings are read once through `prop_trading.config`; no
other runtime module reads the environment. PostgreSQL is represented as the future correctness
boundary. Redis is absent and can never be necessary for correctness.

## Structural paper-only isolation

Phase 0 is incapable of sending a broker command:

- no broker SDK is a dependency;
- no provider token, account secret, live/imported-account variable, or onboarding schema exists;
- no order/position command port or method exists;
- no traffic-ingress route exists;
- provider probes return evidence only and the default probe performs no network request;
- static verification scans runtime sources and configuration for forbidden execution surfaces.

Future execution capability is not an extension of a Phase 0 adapter. It belongs to a separately
reviewed Phase 1C slice after the tenant, secret, synchronization, platform, and strategy gates.

## Deterministic contracts

Canonical serialization uses UTF-8 JSON, ASCII-profile sorted object keys, no insignificant
whitespace, safe-range integers, and strings for exact fixed-scale decimals. Binary float,
`Decimal` objects, NaN/infinity, exponent numbers, duplicate input keys, non-list sequences, and
integers outside the cross-language safe range are rejected. SHA-256 is lower-case hexadecimal
over the exact canonical bytes. Python and TypeScript consume the same golden-vector file.

Prices are integer ticks, volume is integer lot steps, money is integer minor units plus currency
scale, and ratios/tick sizes are fixed-scale decimal strings. A string is not automatically a
valid decimal: schema validators pin its required scale and plain notation.

## Checkpoint and gap foundation

Contracts freeze one heartbeat per confirmed five-minute bar and a checkpoint every 12 bars.
Checkpoint chunks are staged only, bounded by the candidate approved-alert manifest, and carry
the confirmed bar close and logical sequence plus per-chunk and full-set SHA-256 metadata. The
typed chunk body includes each active setup's natural key, exact active state, reason, integer-tick
zone/liquidity geometry, and source candle. It verifies exact canonical byte length and digest,
natural-key-derived ordering/identities/bounds, negative-oracle geometry, and single-chunk full-set
count/digest. Multi-chunk assembly still requires every declared index
and full-set verification in a future Phase 1A stream-lock transaction. A 720-second timeout is
permanent for that checkpoint.

A gap declaration always freezes allocations, permanently taints setups spanning the gap and
those restored by its checkpoint, and forbids retrospective execution. Recovery can reach only
`ACTIVE_FOR_NEW_LIFECYCLES`, and only with a complete checkpoint identifier. Phase 0 defines and
tests these schemas; it does not accept traffic or mutate projections.

## Tick collector foundation

The immutable writer accepts typed fixture observations, canonicalizes them to JSONL, hashes the
exact bytes, and atomically renames a fully durable staging directory into its final append-only
name. A per-chunk advisory file lock serializes conforming threads/processes, so an orphan is
recovered or quarantined only after exclusive ownership is established. Every successful return
re-reads the final pair and verifies the manifest hash against final payload bytes. File-safe
identifiers and resolved-parent checks prevent root escape.

One chunk contains exactly one feed and account-capability ID. Ingest order, monotonic and UTC
receive order, connection generation, clock tolerance, licensing, reconnect backfill, collector
coverage, clock synchronization, storage encryption, and fixture status are persisted. Exact
eligibility is derived from all of them; contiguous sequence numbers alone are insufficient and
fixtures are capped at `CONTINUOUS_OBSERVED`.

Rule-pack risk periods are not accepted as documentary offset claims. The typed validator loads
the declared IANA zone from pinned bundled `tzdata==2025.2`, derives gap-forward/fold-early reset
instants, and checks the local label, UTC bounds, offset, resolution, uniqueness, and adjacency.
