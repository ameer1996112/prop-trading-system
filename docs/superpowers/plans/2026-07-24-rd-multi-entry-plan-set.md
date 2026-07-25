# RD Multi-Entry Plan Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved RD 5m multi-entry design as four independently testable increments, ending in a shadow canary and a fail-closed paper-selection gate.

**Architecture:** A Python contract/domain oracle freezes source authority, candidate identity, matching, and arbitration. The Cloudflare edge mirrors the frozen vectors and owns durable candidate/evidence/selection storage; a new Pine V3 producer exports compact proof facts; the console exposes the resulting audit trail. Rollout remains dual-version and fail-closed.

**Tech Stack:** Python 3.12, Pydantic 2, pytest, Cloudflare Workers/D1, TypeScript 5.9, Vitest, Next.js 16, React 19, Pine Script v6

## Global Constraints

- Strategy scope is RD Forex/RD Concepts 5-minute behavior only.
- Official source channel is exactly `@RD_Forex`, channel ID `UC54xbL96tU58iez3YbTVTAg`.
- Active entry models are exactly `DIR_CLOSE` and `HTF_FLIP`.
- Post-arbitration entry methods are exactly `INTRABAR_FLIP`,
  `CLOSE_CONFIRMATION`, and profile-gated `NEXT_CANDLE_WICK`.
- One setup may produce at most one paper trade across all entry methods.
- Generic 5m break-candle and rejection/respect-only patterns are rejected legacy observations.
- An HTF-timed break normalizes to `HTF_FLIP`.
- First touch emits `ZONE_ENGAGED`, never an entry.
- Preserve every candidate and append-only evidence record; select at most one canonical candidate.
- Only complete `EXACT` replayable evidence may be paper-eligible.
- Realtime-only, missing-coverage, same-child-order, calibrated, discretionary, and unresolved evidence is shadow-only.
- One flip may retain `15m`, `30m`, and `1h` contexts without timeframe priority.
- The exact earlier `HTF_FLIP` wins; an exact `DIR_CLOSE` is the fallback when flip proof is non-exact.
- Schema `1.0`, `1.1`, and `1.2` compatibility remains intact.
- New rule contract is `2.0.0`; new observation schema is `2.0`; producer strategy version is `2.0.0-contract2`.
- Canonical arbitration policy version is exactly `rd-entry-arbitration-v2`.
- The existing V2 Pine source remains unchanged; schema 2.0 uses a separate V3 Pine source and alert.
- Real execution remains prohibited and no schema may express a broker action.
- One semantic candidate is recorded per active model per setup attempt. Matching continues until both active models are observed, the setup is invalidated, or bounded retention explicitly evicts it; evidence is capped independently.
- Setup-attempt terminality is explicit and immutable: `INVALIDATED`, `BOTH_ACTIVE_MODELS_OBSERVED`, or `RETENTION_EVICTED`, with a terminal epoch. There is no inferred wall-clock expiry in this increment.
- `invalidated_before_entry` means invalidated before the first active-model candidate. A later invalidation ends observation but preserves any earlier candidate and selection.
- Every `setup_id` identifies one setup attempt. `trigger_ordinal=1` is
  `INITIAL`; an isolated future re-entry attempt uses its own attempt-scoped
  `setup_id`, `attempt_kind=RE_ENTRY`, and ordinal `>=2`. Pine emits only
  `INITIAL`/ordinal `1` in this increment.
- Existing V2 common setup provenance cannot prove the complete exact common
  gate. V3 therefore maps it to `UNRESOLVED`, never `EXACT`. This implementation
  can complete observation and detector parity, but producer
  `2.0.0-contract2` is structurally non-promotable. Paper selection remains off
  until a separately reviewed successor contract and producer prove complete
  exact common-setup provenance.
- Golden vectors carry two explicit reviewed views of the same market events:
  `edge_input`/`expected` for the declared domain fidelity and
  `pine_edge_input`/`pine_expected` for current V3 with common fidelity forced
  to `UNRESOLVED`. Edge authority uses the first; Pine parity uses the second.
- The FastAPI/PostgreSQL observation ingress remains v1-only and is outside this rollout; the production v2 path is the Cloudflare observation edge.
- Pine emits semantic batch and diagnostic references; the edge computes every authoritative SHA-256 ID.
- Schema-2 wire kinds are exactly lowercase `snapshot` and `incremental`. The semantic batch key is `producer_instance_id:sequence:kind:bar_close_epoch`; only `chunk_index` is appended for per-chunk idempotency.
- Emit at most one semantic batch per confirmed 5m close. Within one producer
  instance, sequence starts positive, never resets, and uniquely identifies one
  batch; rollout hard-fails sequence gaps/conflicts and independently compares
  V3 heartbeats with compatible V2/market-bar receipts to detect a missing tail.
  A canary cannot pass with zero independent heartbeat reference bars.
- Terminality stops trigger matching. When the event that first completes both
  active models also introduces `DIR_CLOSE`, exactly one immediately following
  confirmed-bar event may be consumed for `NEXT_CANDLE_WICK` handling only.
  That grace event cannot add candidates, evidence, lifecycle facts, or a new
  selection; any later event is rejected.
- Detector and settings identities are strict 64-character lowercase SHA-256 values; placeholder labels fail closed.
- `RD_ENTRY_CANONICAL_PAPER_ENABLED` defaults to `false`; schema-2 observation stays active while paper eligibility is shadowed.
- Environment flags alone cannot approve paper eligibility. Runtime compares
  each batch's contract/producer, detector hash, and settings hash with a
  generated reviewed successor binding whose deployed build identity is tied to
  the evidence commit. The current binding is null.
- Confirmed-bar candidates anchor to the 5m bar open. HTF flips anchor to the relevant HTF open and store the recross child close separately as the observed trigger epoch.
- Wire limits are fixed at fewer than `35,000` Pine characters, at most `12` chunks, at most `256` setup bundles, at most `4` rolling confirmed-bar facts and `3` HTF transcripts per setup, at most `4` candidates and `16` evidence records per setup, at most `4` evidence records per candidate, and at most `4` handling records per setup.
- Forward capture uses a closed `[since, until)` window only after a fixed `900`-second chunk-completion grace. An in-window batch still incomplete after that grace fails the canary.

---

## Plan order

1. [Contract, domain matcher, arbitration, and oracle](./2026-07-24-rd-entry-contract-domain.md)
2. [Three entry-method companion plan](./2026-07-26-rd-three-entry-methods.md)
3. [Observation edge, D1 storage, API, and operations console](./2026-07-24-rd-entry-edge-console.md)
4. [Pine V3 multi-entry detector and parity capture](./2026-07-24-rd-entry-pine-parity.md)
5. [Shadow canary and guarded paper rollout](./2026-07-24-rd-entry-shadow-rollout.md)

The three-method plan is a companion with explicit checkpoints: its domain/vector
Tasks 1–3 run before the edge plan, its edge Tasks 4–5 interleave after the named
edge checkpoints, its Pine Task 6 runs after the named Pine checkpoint, and its
rollout Task 7 completes before the shadow rollout. All other dependencies remain
ordered by their targeted tests and commit gates.

## Cross-plan interfaces

Plan 1 produces:

- `RDStrategyRuleContractV2`;
- Python candidate/evidence/handling/selection dataclasses;
- `candidate_id()`, `evidence_id()`, `handling_id()`, and `selection_id()`;
- `match_entry_candidates()`;
- `scan_htf_flip()`;
- `arbitrate_entry_candidates()`;
- `contracts/vectors/rd-entry-arbitration-v2.json`.

That vector file includes both reviewed views above; neither consumer may
silently substitute one for the other.

The three-method companion produces:

- immutable `RDEntryFillProfileV1` values;
- post-arbitration `EntryMethodDecision` values;
- `resolve_entry_method()` and `resolve_wick_fill()`;
- `contracts/vectors/rd-entry-method-v1.json`;
- edge parity, D1 method decisions, and console method state;
- immediate shadow wick diagnostics plus replay-only wick resolution.

Plan 2 consumes the generated arbitration vectors and produces:

- strict schema 2.0 wire validation;
- D1 candidate/evidence/selection/handling projections;
- the canonical TypeScript matcher/arbitrator;
- `GET /api/v1/observation-entry-evaluations`;
- the operations-console entry evaluation panel.

Plan 3 consumes the rule catalog and wire shape and produces:

- `SND_RD_5M_V3_MULTI_ENTRY_LAB.pine`;
- compact candidate proof facts;
- deterministic chunk metadata;
- Pine/oracle parity captures.

Plan 4 consumes all three tested deliverables and produces:

- migration/deployment evidence;
- dual-version receipt proof;
- historical and forward parity reports;
- a shadow canary runbook;
- a current-producer `COLLECTING` decision plus a dormant, fail-closed successor
  promotion template.

## Global completion command

Run from the repository root:

```bash
make verify-observation
```

Expected final line:

```text
OBSERVATION VERIFICATION PASSED — ingress records metadata and no execution surface exists
```
