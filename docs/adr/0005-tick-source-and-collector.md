# ADR 0005: tick-source qualification

Status: `CANDIDATE ONLY / STRATEGY PROMOTION BLOCKED`

## Decision

The first collection candidate is the MetaApi realtime EURUSD demo stream. Official price-stream
documentation reviewed on 2026-07-22 describes packet sequence metadata and price/tick payloads:
<https://metaapi.cloud/docs/client/websocket/marketDataStreaming/prices/>. It does not constitute a
legal license review or prove that every upstream quote has a loss-detecting sequence with replay
and reconnect coverage.

Every interval is classified as:

- `SEQUENCE_COMPLETE`: upstream sequence/order contract, contiguous coverage, reconnect backfill,
  connection/clock/collector coverage, and checksums all proved;
- `CONTINUOUS_OBSERVED`: continuously received engineering evidence without upstream completeness;
- `INCOMPLETE`: any gap, disconnect, corruption, clock alarm, or coverage failure.

Only the first class can support exact path-dependent replay/promotion. Broker history cannot
upgrade a tape. The local collector writer is fixture-only, append-only, and cannot pass this gate.

## Blocking proof

Capture/retention/replay/derived-statistics rights and redistribution prohibition are not legally
approved. No target VPS collector, authenticated clock proof, encrypted store, alignment manifest,
five-day pilot, rollover interval, disconnect fixture, or restore exists. The recorded pilot count
is zero and remains a hard blocker.
