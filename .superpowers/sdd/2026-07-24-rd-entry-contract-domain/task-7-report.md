# Task 7 report — RD multi-entry golden oracle

## Outcome

Implemented the strict accumulated RD entry event-stream oracle, froze 24 manually
reviewed raw/Edge/Pine cases, generated the scanner-free cross-language vector
document and JSON Schema, registered the schema, and added the vector freshness
check to `make verify-generated`.

The oracle composes the existing public scanner, matcher, and arbitrator. It does
not reimplement their matching or selection policies. It additionally owns the
stream-level invariants from the task brief: deterministic event ordering and
idempotence, immutable attempt facts, first semantic candidate per model,
dependent-record suppression, monotonic terminal facts, the single eligible
post-terminal wick-handling window, and stable accumulated serialization.

The fixture parser and generated-vector model are closed and strict. They reject
unknown or missing fields, non-canonical scalar types, invalid or conflicting
stable IDs, mixed raw/expanded proof surfaces, bad replay windows, dangling
records, reused setup IDs across initial/re-entry attempts, and Pine promotion.

## TDD evidence

- RED: the initial focused test failed to import
  `prop_trading.domain.rd_entry_oracle`.
- GREEN: raw fixtures replayed through the composed scanner/matcher/arbitrator
  and matched both literal `expected` and literal `pine_expected`.
- RED: scanner-free Edge input had no strict parser; added
  `EntryOracleCase.from_edge_mapping` and semantic transcript revalidation.
- RED: the vector builder/schema modules were absent; added the strict builder,
  Pydantic document model, registry entry, generated vector, and generated schema.
- RED: duplicate expected IDs were initially accepted; added unique, ID-sorted
  record validation.
- RED: one event stream could change immutable setup/attempt facts; added the
  cross-event immutable-fact guard.
- RED: a same-event creation of both active models incorrectly received terminal
  wick grace; restricted grace to the required ordering where HTF existed before
  the close event.
- RED: nested fixture expectations accepted unknown fields and a forged
  `candidate_id`; added strict nested record parsing and identity recomputation.
- Initial focused oracle result: 62 passed.

### Fix round 1 — expanded evidence payload integrity

- RED: a fixture expectation with a forged `payload_sha256` was accepted when
  `evidence_id`, dependent `handling_id`, and dependent `selection_id` were
  coordinately recomputed.
- RED: the independently loaded strict generated-vector model accepted the same
  coordinated forgery.
- GREEN: added the shared canonical `evidence_payload_sha256(...)` helper for
  the frozen expanded evidence fields. The matcher now uses this helper for
  authoritative evidence construction.
- GREEN: both `EntryOracleCase.from_mapping(...)` and
  `RDEntryArbitrationVectorsV2` recompute the expanded payload digest and reject
  a mismatch before trusting the evidence identity chain.
- The 24 literal fixture cases, generated vectors, strategy behavior, and Pine
  fail-closed results are unchanged.
- Fix-round focused oracle/matcher/contract result: 132 passed.

## Manual review of the 24 frozen cases

Each raw view was read against its event order, integer candle facts, expected
transcripts, candidate/evidence/handling graph, and canonical selection. Each Pine
view was separately checked after changing only inherited common fidelity to
`UNRESOLVED`.

| Case | Reviewed Edge/domain outcome | Reviewed current Pine outcome |
| --- | --- | --- |
| `dir-close-engagement` | Engagement-bar exact `DIR_CLOSE`; paper eligible. | Same observation is unresolved and shadow only. |
| `dir-close-later` | Later confirmed exact `DIR_CLOSE`; paper eligible. | Unresolved and shadow only. |
| `pre-entry-invalidation` | No candidate; `SETUP_INVALIDATED` selects `NONE`. | Same fail-closed invalidation result. |
| `htf-flip-15m` | Exact distinct-child 15m flip; `HTF_FLIP` paper eligible. | Unresolved and shadow only. |
| `htf-flip-30m` | Exact distinct-child 30m flip; `HTF_FLIP` paper eligible. | Unresolved and shadow only. |
| `htf-flip-60m` | Exact distinct-child 60m flip; `HTF_FLIP` paper eligible. | Unresolved and shadow only. |
| `htf-flip-multi-context` | Exact 15m/30m/60m proof set combines into one flip; paper eligible. | Combined observation remains unresolved and shadow only. |
| `htf-flip-distinct-children` | Contact then recross in different children is exact; paper eligible. | Unresolved and shadow only. |
| `htf-flip-same-child-ambiguous` | Same-child order ambiguity produces blocked/unresolved flip; shadow only. | Same shadow-only ambiguity. |
| `htf-flip-missing-coverage` | Permanent gap with no valid retained lifecycle produces no candidate. | Same `NONE`/`NO_CANDIDATE` result. |
| `htf-flip-partial-coverage` | Pre-gap contact is cleared; a later bare recross cannot match, while a new post-gap contact/recross remains blocked/unresolved because the gap is permanent. | Same unresolved shadow-only result. |
| `exact-flip-then-close` | Both exact candidates retained; earlier flip is canonical by `EARLIEST_EXACT_TRIGGER`. | Both observations fail promotion; shadow only. |
| `exact-close-then-later-flip` | Both exact candidates retained; earlier close stays canonical. | Both observations fail promotion; shadow only. |
| `shadow-flip-then-close-fallback` | Ambiguous flip is blocked; exact close wins via `FALLBACK_TO_CONFIRMED_CLOSE`. | Inherited fidelity makes all evidence non-exact; shadow only. |
| `non-exact-only` | Calibrated close is retained but cannot authorize paper; shadow only. | Unresolved and shadow only. |
| `generic-break-rejected` | Legacy break observation is retained as rejected and excluded from selection; `NONE`. | Same non-active rejection result. |
| `htf-break-normalized` | Break aligned to the exact HTF identity becomes one normalized `HTF_FLIP`; paper eligible. | Normalized observation remains non-promotable and shadow only. |
| `rejection-respect-rejected` | Legacy rejection/respect observation is rejected and excluded; `NONE`. | Same non-active rejection result. |
| `next-candle-wick-handling` | Exact close remains the sole candidate; only a strict contiguous counter-wick adds discretionary `NEXT_CANDLE_WICK` handling. | Candidate is unresolved; wick remains handling-only; selection is shadow only. |
| `initial-attempt` | Distinct initial attempt scope, ordinal 1; exact close is paper eligible. | Unresolved and shadow only. |
| `re-entry-attempt` | Separate attempt-scoped setup ID, `RE_ENTRY`, ordinal 2; domain result is exact/paper eligible. | Explicitly unsupported by current Pine and non-promotable. |
| `replay-realtime-one-candidate` | Realtime-only provenance is unresolved; one close candidate is shadow only. | Explicitly unsupported and remains shadow only. |
| `duplicate-event-idempotent` | Identical duplicate event contributes no duplicate records; exact close remains canonical. | Idempotent unresolved shadow-only view. |
| `out-of-order-events-deterministic` | Event sorting is deterministic; exact flip precedes exact close and remains canonical. | Deterministic unresolved shadow-only view. |

## Generated artifacts and integration

- `contracts/vectors/rd-entry-arbitration-v2.json` contains exactly 24 cases and
  preserves the raw input plus scanner-free `edge_input` and `pine_edge_input`.
- No `children` or `htf_scan_requests` occur below either generated Edge input.
- Edge and Pine event IDs/order are preserved exactly from the raw fixture.
- The only Edge/Pine input differences are the expected
  `setup.common_fidelity` paths.
- `contracts/schema/rd-entry-arbitration-vectors-v2.schema.json` is exported
  through the focused schema registry. `scripts/export_schemas.py` required no
  special-case logic because it already consumes that registry.
- `Makefile` now checks the RD vector before schema freshness.

## Formatter debt

Per the task instruction, Ruff mechanically reformatted exactly these three
pre-existing debt files with no semantic changes:

- `src/prop_trading/contracts/rd_strategy_v2.py`
- `src/prop_trading/domain/rd_entry_models.py`
- `tests/unit/test_rd_entry_models.py`

## Final verification

- `uv run ruff format --check .` — passed; 72 files already formatted.
- `uv run ruff check .` — passed.
- `uv run mypy` — passed; no issues in 29 source files.
- Required seven-file contract/domain matrix — 219 passed.
- `uv run pytest -q` — 422 passed.
- Vector generation and `--check` — passed.
- Schema export and `--check` — passed.
- `make verify-generated` — passed; the expected Phase 0 artifact assertion
  reports the exact 13-gate set as `BLOCKED` with no `VERIFIED` claims.
- `git diff --check` — passed.

## Concerns

No implementation blocker remains. Current Pine is intentionally fail-closed:
all Pine selections are non-promotable, and only `re-entry-attempt` and
`replay-realtime-one-candidate` are marked unsupported.
