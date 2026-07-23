# ADR 0004: MetaApi tenant and authoritative synchronization

Status: `UNVERIFIED / PHASE 1C BLOCKED`

## Decision

MetaApi remains the future demo adapter candidate only if a separately provisioned tenant/identity
contains exclusively demo-provisioned MT5 retail-hedging accounts, disables arbitrary import, has
no live-capable credential, and isolates account credentials.

Official streaming documentation reviewed on 2026-07-22 contains synchronization IDs and packet
sequence numbers, history-completion events, and terminal update packets:

- <https://metaapi.cloud/docs/client/websocket/synchronizing/synchronizationStarted/>
- <https://metaapi.cloud/docs/client/websocket/synchronizing/update/>
- <https://metaapi.cloud/docs/client/websocket/usingStreamingApi/>
- <https://metaapi.cloud/docs/client/websocket/synchronizing/ordersHistory/>

Those pages do not by themselves prove the plan's cross-resource common cursor/barrier. The
required spike must establish one start cursor, stable complete pages/history, buffered concurrent
updates, one common end cursor, and a gapless fold through that end with Tier 0 durability. A
timestamp, healthy connection, repeated identical reads, `synchronizing=false`, or generic
synchronized flag is explicitly insufficient.

## Blocking proof

No tenant/account/token exists in this repository and no MetaApi request was made. Tenant isolation,
import prevention, token scope, margin mode, pagination under mutation, reconnect behavior,
cross-resource cursor semantics, and history coverage are therefore blocked. A negative spike is
a kill criterion; it may not be redesigned into polling freshness.
