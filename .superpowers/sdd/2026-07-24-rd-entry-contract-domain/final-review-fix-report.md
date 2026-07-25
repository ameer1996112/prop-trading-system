# Final branch-review fix report

Workspace: `/private/tmp/prop-trading-system-rd-entry-contract-domain`

Base: `b6ec8551c5b1de023bdef37b9624f7bef29910ea`

## Outcome

The final review findings are closed without changing the 24 reviewed raw,
Edge, or Pine outcomes. Generated vector and schema files reproduce byte-for-byte
with no diff. Pine remains fail-closed and non-promotable, and the two frozen
`pine_supported=false` cases remain unchanged.

## TDD evidence

### Core RED

Before production changes, the focused five-file public batch reported:

```text
30 failed, 181 passed in 1.20s
```

The failures reproduced:

- compact `+180s/count=3` proof acceptance;
- retention creating matcher, raw-oracle, and Edge-oracle trigger records;
- future terminal, engagement, compact proof, and raw proof facts;
- impossible serialized evidence/handling/result times with coordinated IDs;
- same-close order dependence, overlapping bars, early evaluation, and erased
  same-anchor gap/destination history;
- an unbound base-contract digest and duplicate inherited rule IDs.

The direct low-side invalid-OHLC model test already passed because the domain
guard existed; the newly added Edge low-side mutation also exercised that
public parser boundary.

### Core GREEN

After the shared domain fixes, the same batch reported:

```text
211 passed in 1.09s
```

Four old positive tests used inputs made explicitly invalid by the reviewed
contract and were reshaped without changing strategy behavior: a stale terminal
epoch, two future HTF cutoffs, and a retention candle previously treated as
though it completed both active models. A same-candidate multi-context replay
was moved to a distinct non-overlapping confirmed bar.

### Strict-vector RED

After core GREEN and before typed-vector production changes:

```text
18 failed, 3 passed in 1.49s
```

Every failure was `DID NOT RAISE`. Coordinated mutations reached the weak typed
surface for candidate/evidence/handling/selection identity forgery, considered
candidate inconsistency, canonical graph incoherence, foreign handling
ownership, unauthorized Edge/Pine differences, weak compact/raw replay shapes,
typed event-time violations, and a coordinated temporal result graph.

### Strict-vector GREEN

After typed loading reused the canonical domain parsers and result validator:

```text
21 passed in 1.99s
```

An additional canonical-candidate coherence parameter was then added and passed
with the same validator. Final self-review found one more narrow graph gap: an
existing legacy/rejected candidate could be made canonical while absent from
`candidate_ids_considered`. Its coordinated mutation first failed RED with
`DID NOT RAISE`, then passed after canonical membership became explicit. The
final strict-vector semantic selection is **23 passed**.

## Changed invariants

### Retention terminal

- `match_entry_candidates()` now suppresses every trigger/evidence/handling row
  on a contemporaneous `RETENTION_EVICTED` event, matching invalidation.
- The accumulated oracle explicitly requires invalidation and retention to
  leave the active-model set unchanged.
- Only the adjudicated `BOTH_ACTIVE_MODELS_OBSERVED` later-close path can grant
  one post-terminal wick-handling event; retention grants none.

### Replay and event time

- `validate_completed_htf_prefix()` is the shared nonempty completed-5m-prefix
  validator used by raw scans and compact transcript replay. Strict typed
  loading reaches the same validator through the domain parser.
- Engagement may equal the confirmed close or accepted flip trigger, but may
  not follow either.
- Compact and raw scan cutoffs may be older than an event close, but never
  later; compact cutoff remains exactly coverage end.
- Standalone matcher terminal facts must equal the confirmed event close.
- Case evaluation must not precede any accepted event close.
- Same-anchor transcripts advance monotonically, preserve static facts, and
  cannot erase gap/destination history. Post-gap scanner reset remains allowed,
  but permanent gap history prevents an exact upgrade.
- Same-ID events are deduplicated first. Distinct same-close or overlapping bars
  are rejected; non-overlapping input order and market/session gaps remain
  valid. Contiguity remains specific to next-candle wick handling.

### Serialized result graph

`validate_entry_result_graph()` now provides one shared semantic boundary for
fixture parsing and typed vectors. It:

- recomputes all four identity families with the domain constructors;
- recomputes evidence payload digests;
- validates candidate/evidence/handling ownership and the exact active
  `candidate_ids_considered` inventory;
- validates canonical candidate/evidence/model/fidelity coherence and requires
  the canonical candidate to be considered;
- enforces `coverage_start <= trigger <= coverage_end <= observed_at`;
- bounds candidate/evidence/handling records by selection evaluation;
- prevents handling before the referenced evidence trigger (or evidence
  observation when no trigger exists);
- ties `NEXT_CANDLE_WICK` to directional-close confirmed evidence exactly
  `+300s` later.

The handling lower bound intentionally uses `observed_trigger_epoch` when
present. Requiring the serialized evidence `observed_at_epoch` would reject the
approved HTF shape, where intrabar handling occurs at the trigger and replay
evidence is finalized at the later causal cutoff.

### Typed vector trust

- `RDEntryArbitrationVectorsV2.model_validate_json()` independently reuses the
  raw and Edge domain parsers and the shared result graph.
- Edge and Pine inputs must be deeply identical after normalizing only
  `match_request.setup.common_fidelity`.
- Compact transcript semantics, raw child bounds, event causality, identities,
  ownership, and result causality are no longer weaker than the domain surface.
- The module documents that exported JSON Schema is structural only; semantic
  trust requires Pydantic/domain loading.

### Contract closure

- `base_contract_sha256` must equal the byte SHA-256 of
  `config/phase0/rd-strategy-rule-contract.json`:
  `289cbf0bd1a59f3e3ca3ec12450f27bb326d210ec1e2444e17e7f90d10f17e28`.
- Duplicate inherited rule IDs reject before exact set comparison.
- Direct domain and Edge low-side invalid-OHLC mutations are frozen.

## Final verification

- Focused five-file new/core regression batch — **231 passed**.
- Required seven-file contract/domain matrix — **272 passed**.
- Vector generation and `--check` — passed; generated vector unchanged.
- Schema export and `--check` — passed; generated schemas unchanged.
- `make verify-generated` — passed; exact 13-gate set remains `BLOCKED` and the
  registry contains no `VERIFIED` claims.
- `uv run ruff format --check .` — passed; 72 files already formatted.
- `uv run ruff check .` — passed.
- `uv run mypy` — passed; no issues in 29 source files.
- `uv run pytest -q` — **475 passed**.
- `git diff --check` — passed.

## Concerns

No implementation blocker remains. Schema consumers that bypass
`RDEntryArbitrationVectorsV2` still receive structural validation only by
design; semantic consumers must use the documented Pydantic/domain loading
boundary.
