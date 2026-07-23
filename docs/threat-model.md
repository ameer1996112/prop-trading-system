# Phase 0 threat model

## Assets and invariants

Protected assets are legacy evidence integrity, activation-gate truth, canonical hash stability,
future Tier 0 audit history, and the structural absence of broker authority. The primary invariant
is stronger than “disabled”: the repository cannot construct or transmit a broker mutation.

## Trust boundaries

1. The legacy repository is user-owned, dirty, and read-only. Only nine authorized paths were
   inspected. A working-file digest is never attributed to its repository HEAD unless bytes and
   cleanliness both prove that claim.
2. TradingView/operator artifacts are declarations. They cannot attest to the running alert,
   settings, or source. Redacted configuration and alert recreation evidence are required.
3. Provider documentation establishes candidate capability only. Provisioning and credentialed
   spikes are separate evidence and remain absent.
4. The browser trusts only server APIs. No admin credential or provider secret is browser state.
5. A process heartbeat is liveness, not dependency readiness. Unknown values stay unknown.

## Threats and controls

| Threat | Phase 0 control |
| --- | --- |
| Dirty evidence is presented as committed | Separate HEAD/working hashes and status; copied Pine has no claimed commit |
| Float or JSON variation changes a digest | Frozen canonical serializer, strict schemas, shared cross-language vectors |
| A timestamp or healthy connection passes broker truth | Gate requires start/end cursors, page completion, buffered updates, contiguous fold, history coverage, and durability |
| Observed ticks are relabeled exact | Classification ceiling; upstream sequence contract and spike required |
| Missing provider state looks healthy | Evidence status is `UNVERIFIED`/`BLOCKED`; readiness is false |
| A secret reaches source, logs, or UI | No credential settings, placeholders only, secret scan, canary-redaction test |
| Phase 0 accidentally gains execution | No SDK/ports/routes plus source/config static scan |
| UI hides dependency failure as empty data | Explicit `UNCONFIGURED`/`API_UNAVAILABLE`, degraded/unknown rendering |
| Evidence or tick fixture is overwritten | Exclusive append-only files and PostgreSQL mutation trigger |

## No-secret boundary

Normal tables, schemas, APIs, browser code, logs, traces, examples, fixtures, and the evidence
inventory contain no credential value. The local PostgreSQL password is supplied through a
Docker secret file that is ignored. Future account secrets require a versioned secret reference;
actual values may only cross a scoped credential-broker boundary after its provider gate passes.

## Explicit residual risks

Every external Phase 0 capability remains a kill criterion: provider candidates are documented,
but none is provisioned or spiked; the MetaApi tenant and accounts are absent; the Pine is dirty;
the operator artifacts are absent; no collector ran; no five-day corpus exists. The correct
response is continued blockage, not compensating code or operator acknowledgement.
