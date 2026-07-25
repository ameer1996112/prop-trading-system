# RD Entry Pine V3 and Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate Pine V3 observation producer that records every supported 5m entry candidate with replayable proof, emits compact schema-2.0 shadow bundles, and proves its output against the Python oracle.

**Architecture:** Preserve the deployed V2 Pine bytes and fork them into a V3 producer. V3 keeps the confirmed-5m setup engine, adds bounded candidate/evidence collections and one chronological 1m request, treats realtime `varip` evidence as permanently shadow-only, and emits diagnostic selections that the backend may compare but never trust. A hash-bound TradingView capture is normalized and compared with the Python oracle into a committed parity report.

**Tech Stack:** Pine Script v6, Python 3.12, pytest 8.4, canonical JSON/SHA-256, TradingView Pine Logs and Bar Replay

## Global Constraints

- Preserve `scripts/pinescript/SND_RD_5M_V2_LAB.pine` byte-for-byte at SHA-256 `dbdf8e5470b843348677e6bcc9c284e7d3c6c91410dfc92ec22794b06d9dddff`.
- New Pine source is exactly `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine`.
- New observation schema is exactly `2.0`.
- New rule contract version is exactly `2.0.0`.
- New producer strategy version is exactly `2.0.0-contract2`.
- Confirmed chart timeframe is exactly 5 minutes.
- Lower-timeframe proof resolution is exactly 1 minute.
- Use exactly one `request.security_lower_tf()` call returning one tuple of time, time-close, OHLC, and coverage arrays.
- Active entry models are exactly `DIR_CLOSE` and `HTF_FLIP`.
- Legacy entry models are exactly `LEGACY_BREAK_CANDLE` and `LEGACY_REJECTION_RESPECT`.
- One semantic candidate is recorded per model per setup attempt; evidence is append-only and independently capped.
- Matching continues after the first active candidate until both active models
  have a non-rejected candidate, the setup is invalidated, or bounded retention
  evicts it. There is no wall-clock expiry.
- A single flip retains all matching 15m, 30m, and 60m contexts without ranking them.
- HTF contexts are reduced independently of scan order: group by opening anchor
  plus recross-child close, merge contexts only when every other proof field is
  equivalent, and retain distinct evidence when proof fields differ.
- Only replayable ordered child evidence may be marked `EXACT`.
- A same-child event is exact only when the child opens inside the zone, proving
  contact before the wick recross. Other same-child ordering, missing coverage,
  and realtime-only evidence are shadow-only.
- Realtime evidence uses isolated `varip` state and may never upgrade replay evidence.
- Webhook transport is permanently eligible only for an attempt whose zone was
  created on a realtime confirmed bar and whose formation close is at or after
  the current producer instance's start time. Historical zones calculated while
  a live alert starts remain observable on-chart but can never enter `eb`.
- Pine exports immutable identity facts; Python and the edge compute authoritative SHA-256 candidate and evidence IDs.
- Pine selection is always labeled `PINE_DIAGNOSTIC_ONLY` and cannot authorize paper or real execution.
- Pine emits `attempt_kind=INITIAL`; re-entry detection is outside this producer increment.
- Every Pine diagnostic candidate uses `trigger_ordinal=1`.
- Every HTF transcript has `coverage_end_epoch=scan_cutoff_epoch` (`ce=cu`),
  including gap transcripts.
- `NEXT_CANDLE_WICK` is an observation-only handling fact on the immediately
  following confirmed bar after `DIR_CLOSE`; it never creates a candidate.
- A terminal event is the final normal matcher event and is emitted/logged
  exactly once. The sole post-terminal exception is one contiguous
  handling-only grace event immediately after a `DIR_CLOSE` that completed
  `BOTH_ACTIVE_MODELS_OBSERVED`; it may add only `NEXT_CANDLE_WICK`, never facts
  that create a candidate, HTF proof, terminal mutation, or selection change.
- Every emitted envelope is strictly below the exact 35,000-character ceiling.
- A setup bundle is atomic and may never be split between chunks.
- Candidate retention is exactly 4 candidates per setup.
- Evidence retention is exactly 4 records per candidate.
- Handling retention is exactly 4 records per setup.
- Realtime diagnostic retention is exactly 3 records per setup, one per HTF
  context, in a store isolated from replay and terminal state.
- Authoritative confirmed-bar fact retention is exactly 4 records per setup.
- Authoritative HTF transcript retention is exactly 3 records per setup: one each
  for 15m, 30m, and 60m.
- One batch contains at most 256 setup bundles and 12 chunks.
- The schema-2.0 payload's top-level setup array key is exactly `eb`; `bundles`
  is never a wire key.
- At most one entry batch is emitted per confirmed 5m close. All
  terminal/eviction bundles on that close are coalesced into that batch.
- The 12-chunk cap is a safety margin below TradingView's documented automatic
  alert stop after more than 15 triggers in three minutes:
  <https://www.tradingview.com/support/solutions/43000597494-alerts-on-alert-function/>.
- Bundle `facts` are authoritative matcher inputs. Pine-produced
  candidate/evidence/handling/selection objects are diagnostics only; the edge
  reconstructs all authoritative domain objects from `facts`.
- The script contains no `strategy.entry`, `strategy.exit`, `OPEN`, `SETTLE`, broker command, or live-execution action.
- Bar Replay proves detector parity only; it is not webhook-delivery evidence.

---

## Planned file map

- `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine` — isolated V3 detector, replay scanner, realtime shadow plane, compact exporter, and parity log producer.
- `tests/static/test_rd_multi_entry_pine.py` — byte freeze, Pine structure, bounds, safety, and serialization assertions.
- `scripts/compare_rd_pine_parity.py` — canonical Pine-log/oracle comparator and report writer.
- `scripts/normalize_rd_pine_log.py` — deterministic TradingView Pine Log normalization.
- `scripts/build_rd_pine_parity_manifest.py` — source/settings/capture digest manifest builder and replay-window printer.
- `tests/unit/test_rd_pine_parity_tools.py` — comparator, normalizer, manifest, and report-contract tests.
- `config/phase0/rd-entry-pine-v3-parity-settings.json` — reviewed TradingView parity profile.
- `config/phase0/rd-entry-pine-v3-forward-settings.json` — separate reviewed
  live shadow profile with webhook export enabled.
- `tests/fixtures/rd_pine_parity/events.jsonl` — normalized historical Pine events.
- `tests/fixtures/rd_pine_parity/manifest.json` — hash-bound capture manifest and oracle case bindings.
- `reports/rd-entry-historical-parity-v2.json` — committed historical parity result.
- `docs/runbooks/rd-entry-pine-v3-parity.md` — exact manual compile, replay, normalization, and comparison procedure.
- `Makefile` — deterministic parity check in repository verification.
- `README.md` and `docs/development.md` — V2/V3 role and parity-command documentation.

### Task 1: Fork the immutable V2 producer into a fail-closed V3 shell

**Files:**
- Create: `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine`
- Create: `tests/static/test_rd_multi_entry_pine.py`
- Preserve: `scripts/pinescript/SND_RD_5M_V2_LAB.pine`

**Interfaces:**
- Consumes: the confirmed-5m zone/liquidity engine in V2.
- Produces: a separate V3 script with schema/version constants and hard resource caps used by every later task.

- [ ] **Step 1: Write the failing byte-freeze and V3-shell tests**

Create `tests/static/test_rd_multi_entry_pine.py`:

```python
from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
V2 = ROOT / "scripts/pinescript/SND_RD_5M_V2_LAB.pine"
V3 = ROOT / "scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine"
V2_SHA256 = "dbdf8e5470b843348677e6bcc9c284e7d3c6c91410dfc92ec22794b06d9dddff"


def source() -> str:
    return V3.read_text(encoding="utf-8")


def pine_function_body(name: str) -> str:
    lines = source().splitlines()
    signature = f"{name}("
    for index, line in enumerate(lines):
        if line.startswith(signature) and line.endswith("=>"):
            body: list[str] = []
            for candidate in lines[index + 1 :]:
                if candidate and not candidate[0].isspace():
                    break
                body.append(candidate)
            return "\n".join(body)
    raise AssertionError(f"Pine function not found: {name}")


def test_v2_source_is_byte_frozen() -> None:
    assert hashlib.sha256(V2.read_bytes()).hexdigest() == V2_SHA256


def test_v3_shell_has_exact_versions_and_bounds() -> None:
    text = source()
    assert 'indicator("SND RD 5M V3 MULTI ENTRY LAB"' in text
    assert 'const string SETUP_EXPORT_SCHEMA = "2.0"' in text
    assert 'const string RD_RULE_CONTRACT_VERSION = "2.0.0"' in text
    assert 'const string SETUP_EXPORT_STRATEGY_VERSION = "2.0.0-contract2"' in text
    assert "const int ENTRY_EXPORT_MAX_PAYLOAD_CHARS = 35000" in text
    assert "const int ENTRY_MAX_CANDIDATES_PER_SETUP = 4" in text
    assert "const int ENTRY_MAX_EVIDENCE_PER_CANDIDATE = 4" in text
    assert "const int ENTRY_MAX_EVIDENCE_PER_SETUP = 16" in text
    assert "const int ENTRY_MAX_HANDLING_PER_SETUP = 4" in text
    assert "const int ENTRY_MAX_REALTIME_OBSERVATIONS_PER_SETUP = 3" in text
    assert "const int ENTRY_EXPORT_MAX_SETUP_BUNDLES = 256" in text
    assert "const int ENTRY_MAX_CONFIRMED_FACTS_PER_SETUP = 4" in text
    assert "const int ENTRY_MAX_HTF_TRANSCRIPTS_PER_SETUP = 3" in text
    assert "const int ENTRY_EXPORT_MAX_CHUNKS = 12" in text


def test_v3_shell_has_no_execution_surface() -> None:
    text = source()
    prohibited = (
        "strategy.entry",
        "strategy.exit",
        '\\"action\\":\\"OPEN\\"',
        '\\"action\\":\\"SETTLE\\"',
        "paper_commands",
        "queuePaperOpen",
        "broker",
    )
    for token in prohibited:
        assert token not in text
```

- [ ] **Step 2: Run the static test and verify the V3 file is missing**

Run:

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py -v
```

Expected: `test_v2_source_is_byte_frozen` passes and V3 tests fail with
`FileNotFoundError: SND_RD_5M_V3_MULTI_ENTRY_LAB.pine`.

- [ ] **Step 3: Create V3 from the frozen V2 bytes and replace only shell constants**

Use `apply_patch` to add
`scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine` with the complete current
V2 source as its initial content. Do not use `cp`, `cat`, redirection, or a
filesystem-writing script. Before changing the declarations, verify the added
file has the frozen bytes:

```bash
shasum -a 256 scripts/pinescript/SND_RD_5M_V2_LAB.pine \
  scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine
```

Expected: both lines report
`dbdf8e5470b843348677e6bcc9c284e7d3c6c91410dfc92ec22794b06d9dddff`.
Then use `apply_patch` to apply these exact V3 declarations in the new file:

```pine
//@version=6
indicator("SND RD 5M V3 MULTI ENTRY LAB", overlay = true, max_bars_back = 5000, max_boxes_count = 300, max_labels_count = 300, max_lines_count = 500)

const string RD_RULE_CONTRACT_VERSION = "2.0.0"
const string SETUP_EXPORT_SCHEMA = "2.0"
const string SETUP_EXPORT_STRATEGY_ID = "rd_liquidity_sd_5m_v1"
const string SETUP_EXPORT_STRATEGY_VERSION = "2.0.0-contract2"
const int ENTRY_EXPORT_MAX_PAYLOAD_CHARS = 35000
const int ENTRY_MAX_CANDIDATES_PER_SETUP = 4
const int ENTRY_MAX_EVIDENCE_PER_CANDIDATE = 4
const int ENTRY_MAX_EVIDENCE_PER_SETUP = 16
const int ENTRY_MAX_HANDLING_PER_SETUP = 4
const int ENTRY_MAX_REALTIME_OBSERVATIONS_PER_SETUP = 3
const int ENTRY_MAX_CONFIRMED_FACTS_PER_SETUP = 4
const int ENTRY_MAX_HTF_TRANSCRIPTS_PER_SETUP = 3
const int ENTRY_EXPORT_MAX_SETUP_BUNDLES = 256
const int ENTRY_EXPORT_MAX_CHUNKS = 12
const int ENTRY_LTF_CALC_BARS = 5000
const string ENTRY_LTF_TIMEFRAME = "1"
```

Keep the existing V2 export functions temporarily; later tasks replace their
schema-1.2 body in V3 only.

- [ ] **Step 4: Run shell tests**

Run:

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py -v
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit the isolated V3 shell**

```bash
git add scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  tests/static/test_rd_multi_entry_pine.py
git commit -m "feat: fork immutable Pine V3 entry lab"
```

### Task 2: Replace singular entry state with bounded candidate collections

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine:constants, UDTs, buildConfirmedZone(), updateSetupState(), confirmed-bar loop`
- Modify: `tests/static/test_rd_multi_entry_pine.py`

**Interfaces:**
- Consumes: V3 `RawZone`, confirmed 5m OHLC, existing zone engagement and invalidation facts.
- Produces: `EntryCandidateV2`, `EntryEvidenceV2`, `EntryHandlingV2`, `HtfFlipTrackerV2`, `appendEntryCandidate()`, `appendEntryEvidence()`, `appendEntryHandling()`, and nonterminal candidate observation.

- [ ] **Step 1: Add failing static tests for collection identity and lifecycle**

Append:

```python
def test_v3_uses_bounded_candidate_and_evidence_collections() -> None:
    text = source()
    for declaration in (
        "type EntryCandidateV2",
        "type EntryEvidenceV2",
        "type EntryHandlingV2",
        "type EntryConfirmedFactV2",
        "type HtfFlipTrackerV2",
        "array<EntryCandidateV2> entryCandidates",
        "array<EntryEvidenceV2> entryEvidence",
        "array<EntryHandlingV2> entryHandling",
        "array<EntryConfirmedFactV2> entryConfirmedFacts",
        "array<HtfFlipTrackerV2> htfTrackers",
    ):
        assert declaration in text
    assert "setupEntryModel" not in text
    assert "setupEntryConfirmedTime" not in text


def test_candidate_append_is_idempotent_and_first_match_is_not_terminal() -> None:
    append_candidate = pine_function_body("appendEntryCandidate")
    observation_open = pine_function_body("entryObservationOpen")
    update = pine_function_body("updateSetupState")
    assert "findEntryCandidateIndex" in append_candidate
    assert "ENTRY_MAX_CANDIDATES_PER_SETUP" in append_candidate
    assert "array.push(zone.entryCandidates" in append_candidate
    assert "not zone.entryObservationClosed" in observation_open
    assert "candidate.state != CANDIDATE_REJECTED" in pine_function_body(
        "hasEntryCandidateModel"
    )
    assert "SETUP_SHADOW_ONLY or zone.setupState == SETUP_REJECTED" not in update
    assert "appendEntryCandidate(" not in update


def test_transport_eligibility_is_frozen_at_realtime_birth() -> None:
    text = source()
    build = pine_function_body("buildConfirmedZone")
    scheduled = pine_function_body("emitScheduledEntryBatch")
    assert "bool entryTransportEligible" in text
    assert "entryTransportEligibleAtBirth" in build
    assert "barstate.isrealtime" in build
    assert "zone.confirmationTime" in build
    assert "setupExportProducerStartedAt" in build
    assert "zone.entryTransportEligible" in scheduled
    assert text.count("zone.entryTransportEligible :=") == 1


def test_transport_birth_truth_table_is_closed() -> None:
    helper = pine_function_body("entryTransportEligibleAtBirth")
    assert (
        "realtimeAtBirth and bornAtMillis >= producerStartedAtMillis"
        in helper
    )
    cases = (
        (False, 2_000, 1_000, False),
        (True, 999, 1_000, False),
        (True, 1_000, 1_000, True),
        (True, 2_000, 1_000, True),
    )
    for realtime_at_birth, born_at, started_at, expected in cases:
        assert (
            realtime_at_birth and born_at >= started_at
        ) is expected


def test_first_touch_is_lifecycle_only_and_close_is_independent() -> None:
    engagement = pine_function_body("recordEntryZoneEngagement")
    close_match = pine_function_body("collectDirectionalCloseCandidate")
    assert "SETUP_ZONE_ENGAGED" in engagement
    assert "appendEntryCandidate" not in engagement
    assert "ENTRY_MODEL_DIR_CLOSE" in close_match
    assert "PROOF_CONFIRMED_5M" in close_match
    assert "HANDLING_CLOSE_CONFIRMATION" in close_match


def test_next_candle_wick_is_immediate_shadow_handling_only() -> None:
    wick = pine_function_body("collectNextCandleWickHandling")
    assert "epochSeconds(time) == closeEvidence.observedTriggerEpoch" in wick
    assert (
        "epochSeconds(time_close) == closeEvidence.observedTriggerEpoch + 300"
        in wick
    )
    assert "lowTicks < math.min(openTicks, closeTicks)" in wick
    assert "highTicks > math.max(openTicks, closeTicks)" in wick
    assert "HANDLING_NEXT_CANDLE_WICK" in wick
    assert "FIDELITY_DISCRETIONARY" in wick
    assert "nextCandleWickSourceClaims" in wick
    assert "entryAttemptKindAtClose" in wick
    assert "ATTEMPT_INITIAL" not in wick
    assert "appendEntryHandling" in wick
    assert "appendEntryCandidate" not in wick
    assert "appendEntryEvidence" not in wick


def test_every_diagnostic_candidate_ordinal_is_initial_one() -> None:
    append_candidate = pine_function_body("appendEntryCandidate")
    assert "triggerOrdinal == 1" in append_candidate
    assert "ATTEMPT_INITIAL" in source()


def test_legacy_observations_build_rejected_candidate_and_evidence() -> None:
    rejected = pine_function_body("appendRejectedLegacyCandidateEvidence")
    rejection = pine_function_body("collectLegacyRejectionCandidate")
    legacy_break = pine_function_body("collectLegacyBreakCandidate")
    assert "CANDIDATE_REJECTED" in rejected
    assert "PROOF_CONFIRMED_5M" in rejected
    assert "fact.openEpoch" in rejected
    assert "fact.closeEpoch" in rejected
    assert "fact.attemptKind" in rejected
    assert "array.from(failedRuleId)" in rejected
    assert "appendEntryHandling" not in rejected
    assert "ENTRY_REJECTION_RESPECT_DISABLED" in rejection
    assert "ENTRY_BREAK_CANDLE_NORMALIZATION" in legacy_break
    assert "hasNormalizedHtfBreakForConfirmedEvent" in legacy_break


def test_terminal_is_last_normal_event_with_one_wick_grace() -> None:
    text = source()
    normal = pine_function_body("entryNormalCollectionOpen")
    grace = pine_function_body("entryNextCandleWickGraceDue")
    parity = pine_function_body("emitEntryParityEventOnce")
    assert "not zone.entryObservationClosed" in normal
    assert "ENTRY_TERMINAL_BOTH_ACTIVE" in grace
    assert "zone.entryNextCandleWickGraceOpenEpoch" in grace
    assert "epochSeconds(time_close) ==" in grace
    assert "zone.entryTerminalParityEmitted" in parity
    assert "zone.entryNextCandleWickGraceParityEmitted" in parity
    assert "collectConfirmedEntryFact" not in grace
    assert "scanHtfTrackerChildren" not in grace
    assert "appendEntryCandidate" not in grace


def test_source_claim_tuples_match_the_domain_contract() -> None:
    text = source()
    for claim in (
        "standard-close-2024-03",
        "closure-or-flip-2025-03",
        "directional-close-2025-08",
        "directional-close-required-2026-06",
        "model-continuation-2026-07",
        "htf-flip-2024-03",
        "htf-context-set-2025-08",
        "htf-flip-definition-2025-08",
        "pure-flip-narrowing-2026-05",
        "gold-break-exception-2025-03",
        "discretionary-break-2025-11",
        "reject-non-htf-break-2026-05",
        "break-normalized-to-flip-2026-06",
        "htf-boundary-caution-2025-08",
        "next-candle-wick-2025-05",
        "prompt-close-2025-05",
        "close-fallback-2025-11",
    ):
        assert claim in text


def test_confirmed_fact_window_records_every_open_post_engagement_bar() -> None:
    collect = pine_function_body("collectConfirmedEntryFact")
    append = pine_function_body("appendEntryConfirmedFact")
    assert "if not na(zone.entryZoneEngagedEpoch)" in collect
    assert "bool relevant" not in collect
    assert "lastFact.closeEpoch != fact.openEpoch" in append
    assert "array.clear(zone.entryConfirmedFacts)" in append
    assert "array.remove(zone.entryConfirmedFacts, 0)" in append
    assert "entryCollectionOverflow" not in append
    assert "entryNormalCollectionOpen(zone)" in collect
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py \
  -k "collections or idempotent or first_touch or next_candle_wick or diagnostic_candidate_ordinal or source_claim or confirmed_fact_window" -v
```

Expected: 7 failures naming missing V3 types, functions, source claims,
initial-only ordinals, or the rolling confirmed-fact window.

- [ ] **Step 3: Add closed constants and UDTs**

Add these constants:

```pine
const string ENTRY_DIRECTION_LONG = "LONG"
const string ENTRY_DIRECTION_SHORT = "SHORT"
const string ENTRY_MODEL_DIR_CLOSE = "DIR_CLOSE"
const string ENTRY_MODEL_HTF_FLIP = "HTF_FLIP"
const string ENTRY_MODEL_LEGACY_BREAK = "LEGACY_BREAK_CANDLE"
const string ENTRY_MODEL_LEGACY_REJECTION = "LEGACY_REJECTION_RESPECT"
const string CANDIDATE_MATCHED = "MATCHED"
const string CANDIDATE_BLOCKED = "BLOCKED"
const string CANDIDATE_REJECTED = "REJECTED"
const string CANDIDATE_NORMALIZED = "NORMALIZED"
const string FIDELITY_EXACT = "EXACT"
const string FIDELITY_DISCRETIONARY = "DISCRETIONARY"
const string FIDELITY_UNRESOLVED = "UNRESOLVED"
const string PROOF_CONFIRMED_5M = "CONFIRMED_5M"
const string PROOF_LOWER_TIMEFRAME_REPLAY = "LOWER_TIMEFRAME_REPLAY"
const string PROOF_REALTIME_TICK = "REALTIME_TICK"
const string HANDLING_CLOSE_CONFIRMATION = "CLOSE_CONFIRMATION"
const string HANDLING_INTRABAR_FLIP = "INTRABAR_FLIP"
const string HANDLING_NEXT_CANDLE_WICK = "NEXT_CANDLE_WICK"
const string ATTEMPT_INITIAL = "INITIAL"
const string SETUP_ZONE_ENGAGED = "ZONE_ENGAGED"
const string ENTRY_TERMINAL_INVALIDATED = "INVALIDATED"
const string ENTRY_TERMINAL_BOTH_ACTIVE = "BOTH_ACTIVE_MODELS_OBSERVED"
const string ENTRY_TERMINAL_RETENTION_EVICTED = "RETENTION_EVICTED"
const string SOURCE_STANDARD_CLOSE = "standard-close-2024-03"
const string SOURCE_CLOSURE_OR_FLIP = "closure-or-flip-2025-03"
const string SOURCE_DIRECTIONAL_CLOSE = "directional-close-2025-08"
const string SOURCE_DIRECTIONAL_CLOSE_REQUIRED = "directional-close-required-2026-06"
const string SOURCE_MODEL_CONTINUATION = "model-continuation-2026-07"
const string SOURCE_HTF_FLIP_ORIGIN = "htf-flip-2024-03"
const string SOURCE_HTF_CONTEXT_SET = "htf-context-set-2025-08"
const string SOURCE_HTF_FLIP_DEFINITION = "htf-flip-definition-2025-08"
const string SOURCE_PURE_FLIP_NARROWING = "pure-flip-narrowing-2026-05"
const string SOURCE_GOLD_BREAK_EXCEPTION = "gold-break-exception-2025-03"
const string SOURCE_DISCRETIONARY_BREAK = "discretionary-break-2025-11"
const string SOURCE_REJECT_NON_HTF_BREAK = "reject-non-htf-break-2026-05"
const string SOURCE_BREAK_NORMALIZED_TO_FLIP = "break-normalized-to-flip-2026-06"
const string SOURCE_HTF_BOUNDARY_CAUTION = "htf-boundary-caution-2025-08"
const string SOURCE_NEXT_CANDLE_WICK = "next-candle-wick-2025-05"
const string SOURCE_PROMPT_CLOSE = "prompt-close-2025-05"
const string SOURCE_CLOSE_FALLBACK = "close-fallback-2025-11"
```

Add these UDTs immediately before `RawZone`:

```pine
type EntryCandidateV2
    string localRef
    string model
    string state
    int eventAnchorEpoch
    int triggerOrdinal
    string normalizedFrom
    array<string> sourceClaimIds

type EntryEvidenceV2
    string localRef
    string candidateRef
    int observedTriggerEpoch
    int observedTriggerTicks
    array<int> htfContextMinutes
    string fidelity
    string proofPlane
    int proofResolutionSeconds
    int coverageStartEpoch
    int coverageEndEpoch
    array<string> ambiguityCodes
    array<string> passedRuleIds
    array<string> failedRuleIds
    array<string> sourceClaimIds

type EntryHandlingV2
    string candidateRef
    string evidenceRef
    string handlingMode
    string attemptKind
    int observedEpoch
    int observedTicks
    string fidelity
    array<string> sourceClaimIds

type EntryConfirmedFactV2
    int openEpoch
    int closeEpoch
    int openTicks
    int highTicks
    int lowTicks
    int closeTicks
    bool genericBreakDetected
    bool rejectionRespectDetected
    string attemptKind

type EntryNextCandleWickGraceV2
    int openEpoch
    int closeEpoch
    int openTicks
    int highTicks
    int lowTicks
    int closeTicks
    string attemptKind

type HtfFlipTrackerV2
    int contextMinutes
    int anchorEpoch
    int openTicks
    bool armedAtBoundary
    bool coverageComplete
    int coverageStartEpoch
    int coverageEndEpoch
    bool destinationSeenBeforeContact
    bool contactSeen
    int contactChildEpoch
    bool candidateRecorded
    varip bool realtimeContactSeen
    varip bool realtimeFlipSeen
```

Replace the two singular entry fields in `RawZone` with:

```pine
    array<EntryCandidateV2> entryCandidates
    array<EntryEvidenceV2> entryEvidence
    array<EntryHandlingV2> entryHandling
    array<EntryConfirmedFactV2> entryConfirmedFacts
    array<HtfFlipTrackerV2> htfTrackers
    bool entryTransportEligible
    bool entryObservationClosed
    bool entryCollectionOverflow
    bool entryInvalidatedBeforeEntry
    string entryTerminalReason
    int entryTerminalEpoch
    bool entryTerminalSnapshotEmitted
    bool entryTerminalParityEmitted
    int entryNextCandleWickGraceOpenEpoch
    bool entryNextCandleWickGraceConsumed
    bool entryNextCandleWickGraceTransportEmitted
    bool entryNextCandleWickGraceParityEmitted
    EntryNextCandleWickGraceV2 entryNextCandleWickGraceFact
    int entryZoneEngagedEpoch
    int entryEngagementHighTicks
    int entryEngagementLowTicks
```

Initialize every collection independently in `buildConfirmedZone()`:

```pine
    zone.entryCandidates := array.new<EntryCandidateV2>()
    zone.entryEvidence := array.new<EntryEvidenceV2>()
    zone.entryHandling := array.new<EntryHandlingV2>()
    zone.entryConfirmedFacts := array.new<EntryConfirmedFactV2>()
    zone.htfTrackers := array.from(
        HtfFlipTrackerV2.new(15, na, na, false, false, na, na, false, false, na, false, false, false),
        HtfFlipTrackerV2.new(30, na, na, false, false, na, na, false, false, na, false, false, false),
        HtfFlipTrackerV2.new(60, na, na, false, false, na, na, false, false, na, false, false, false)
    )
    zone.entryTransportEligible := entryTransportEligibleAtBirth(
        barstate.isrealtime,
        zone.confirmationTime,
        setupExportProducerStartedAt
    )
    zone.entryObservationClosed := false
    zone.entryCollectionOverflow := false
    zone.entryInvalidatedBeforeEntry := false
    zone.entryTerminalReason := ""
    zone.entryTerminalEpoch := na
    zone.entryTerminalSnapshotEmitted := false
    zone.entryTerminalParityEmitted := false
    zone.entryNextCandleWickGraceOpenEpoch := na
    zone.entryNextCandleWickGraceConsumed := false
    zone.entryNextCandleWickGraceTransportEmitted := false
    zone.entryNextCandleWickGraceParityEmitted := false
    zone.entryNextCandleWickGraceFact := na
    zone.entryZoneEngagedEpoch := na
    zone.entryEngagementHighTicks := na
    zone.entryEngagementLowTicks := na
```

Define transport birth before `buildConfirmedZone()` and never mutate the
stored result afterward:

```pine
entryTransportEligibleAtBirth(bool realtimeAtBirth, int bornAtMillis, int producerStartedAtMillis) =>
    realtimeAtBirth and bornAtMillis >= producerStartedAtMillis
```

`zone.confirmationTime` and inherited `setupExportProducerStartedAt` are both
milliseconds. Do not pass either through `epochSeconds()` in this predicate.
The live script's historical calculation therefore creates only
`entryTransportEligible=false` zones. A pre-start zone that taps after the
alert becomes realtime remains ineligible; engagement time cannot upgrade it.

- [ ] **Step 4: Implement deterministic local identity and bounded append functions**

Add:

```pine
priceToEntryTicks(float value) =>
    int(math.round(value / syminfo.mintick))

entryDirection(RawZone zone) =>
    zone.demand ? ENTRY_DIRECTION_LONG : ENTRY_DIRECTION_SHORT

entryFidelityRank(string fidelity) =>
    fidelity == FIDELITY_EXACT ? 0 :
     fidelity == FIDELITY_DISCRETIONARY ? 1 : 2

entryCommonFidelity(RawZone zone) =>
    // V2 has no complete EXACT setup-qualification provenance. Its
    // CALIBRATED distance guidance remains shadow-only in the V3 contract.
    FIDELITY_UNRESOLVED

entryCombineFidelity(string proofFidelity, string commonFidelity) =>
    entryFidelityRank(proofFidelity) >= entryFidelityRank(commonFidelity) ? proofFidelity : commonFidelity

dirCloseSourceClaims() =>
    array.from(SOURCE_STANDARD_CLOSE, SOURCE_CLOSURE_OR_FLIP, SOURCE_DIRECTIONAL_CLOSE, SOURCE_DIRECTIONAL_CLOSE_REQUIRED, SOURCE_MODEL_CONTINUATION)

htfFlipSourceClaims() =>
    array.from(SOURCE_HTF_FLIP_ORIGIN, SOURCE_HTF_CONTEXT_SET, SOURCE_HTF_FLIP_DEFINITION, SOURCE_PURE_FLIP_NARROWING, SOURCE_MODEL_CONTINUATION)

legacyBreakSourceClaims() =>
    array.from(SOURCE_GOLD_BREAK_EXCEPTION, SOURCE_DISCRETIONARY_BREAK, SOURCE_REJECT_NON_HTF_BREAK, SOURCE_BREAK_NORMALIZED_TO_FLIP)

legacyRejectionSourceClaims() =>
    array.from(SOURCE_CLOSURE_OR_FLIP, SOURCE_DIRECTIONAL_CLOSE, SOURCE_DIRECTIONAL_CLOSE_REQUIRED)

nextCandleWickSourceClaims() =>
    array.from(SOURCE_NEXT_CANDLE_WICK, SOURCE_PROMPT_CLOSE, SOURCE_CLOSE_FALLBACK)

htfEvidenceSourceClaims(bool normalizedFromBreak, bool boundaryUncertain) =>
    array<string> claims = htfFlipSourceClaims()
    if normalizedFromBreak
        array<string> breakClaims = legacyBreakSourceClaims()
        for claimIndex = 0 to array.size(breakClaims) - 1
            array.push(claims, array.get(breakClaims, claimIndex))
    if boundaryUncertain
        array.push(claims, SOURCE_HTF_BOUNDARY_CAUTION)
    claims

entryCandidateLocalRef(string model, int eventAnchorEpoch, int triggerOrdinal) =>
    model + ":" + str.tostring(eventAnchorEpoch) + ":" + str.tostring(triggerOrdinal)

findEntryCandidateIndex(RawZone zone, string localRef) =>
    int result = na
    int candidateCount = array.size(zone.entryCandidates)
    if candidateCount > 0
        for candidateIndex = 0 to candidateCount - 1
            if na(result) and array.get(zone.entryCandidates, candidateIndex).localRef == localRef
                result := candidateIndex
    result

findEntryCandidateModelIndex(RawZone zone, string model) =>
    int result = na
    int candidateCount = array.size(zone.entryCandidates)
    if candidateCount > 0
        for candidateIndex = 0 to candidateCount - 1
            if na(result) and array.get(zone.entryCandidates, candidateIndex).model == model
                result := candidateIndex
    result

hasEntryCandidateModel(RawZone zone, string model) =>
    bool result = false
    int candidateCount = array.size(zone.entryCandidates)
    if candidateCount > 0
        for candidateIndex = 0 to candidateCount - 1
            EntryCandidateV2 candidate = array.get(zone.entryCandidates, candidateIndex)
            if candidate.model == model and candidate.state != CANDIDATE_REJECTED
                result := true
    result

hasAnyEntryCandidateModel(RawZone zone, string model) =>
    not na(findEntryCandidateModelIndex(zone, model))

closeEntryObservation(RawZone zone, string reason, int terminalEpoch) =>
    bool closedNow = false
    if not zone.entryObservationClosed
        bool validReason = reason == ENTRY_TERMINAL_INVALIDATED or reason == ENTRY_TERMINAL_BOTH_ACTIVE or reason == ENTRY_TERMINAL_RETENTION_EVICTED
        if validReason
            zone.entryObservationClosed := true
            zone.entryTerminalReason := reason
            zone.entryTerminalEpoch := terminalEpoch
            bool activeCandidateAlreadyExists = hasEntryCandidateModel(zone, ENTRY_MODEL_DIR_CLOSE) or hasEntryCandidateModel(zone, ENTRY_MODEL_HTF_FLIP)
            zone.entryInvalidatedBeforeEntry := reason == ENTRY_TERMINAL_INVALIDATED and not activeCandidateAlreadyExists
            closedNow := true
    closedNow

appendEntryCandidate(RawZone zone, string model, string state, int eventAnchorEpoch, int triggerOrdinal, string normalizedFrom, array<string> sourceClaimIds) =>
    string localRef = entryCandidateLocalRef(model, eventAnchorEpoch, triggerOrdinal)
    bool initialOrdinal = triggerOrdinal == 1
    int existingIndex = findEntryCandidateIndex(zone, localRef)
    if na(existingIndex)
        existingIndex := findEntryCandidateModelIndex(zone, model)
        if not na(existingIndex)
            localRef := array.get(zone.entryCandidates, existingIndex).localRef
    bool appended = false
    if not initialOrdinal
        zone.entryCollectionOverflow := true
    else if na(existingIndex)
        if array.size(zone.entryCandidates) < ENTRY_MAX_CANDIDATES_PER_SETUP
            EntryCandidateV2 candidate = EntryCandidateV2.new(localRef, model, state, eventAnchorEpoch, triggerOrdinal, normalizedFrom, array.copy(sourceClaimIds))
            array.push(zone.entryCandidates, candidate)
            appended := true
        else
            zone.entryCollectionOverflow := true
    [localRef, appended]

findEntryEvidenceIndex(RawZone zone, string localRef) =>
    int result = na
    int evidenceCount = array.size(zone.entryEvidence)
    if evidenceCount > 0
        for evidenceIndex = 0 to evidenceCount - 1
            if na(result) and array.get(zone.entryEvidence, evidenceIndex).localRef == localRef
                result := evidenceIndex
    result

entryEvidenceCountForCandidate(RawZone zone, string candidateRef) =>
    int result = 0
    int evidenceCount = array.size(zone.entryEvidence)
    if evidenceCount > 0
        for evidenceIndex = 0 to evidenceCount - 1
            if array.get(zone.entryEvidence, evidenceIndex).candidateRef == candidateRef
                result += 1
    result

appendEntryEvidence(RawZone zone, EntryEvidenceV2 evidence) =>
    bool appended = false
    if na(findEntryEvidenceIndex(zone, evidence.localRef))
        if entryEvidenceCountForCandidate(zone, evidence.candidateRef) < ENTRY_MAX_EVIDENCE_PER_CANDIDATE
            array.push(zone.entryEvidence, evidence)
            appended := true
        else
            zone.entryCollectionOverflow := true
    appended

findEntryHandlingIndex(RawZone zone, EntryHandlingV2 handling) =>
    int result = na
    int handlingCount = array.size(zone.entryHandling)
    if handlingCount > 0
        for handlingIndex = 0 to handlingCount - 1
            EntryHandlingV2 existing = array.get(zone.entryHandling, handlingIndex)
            bool sameIdentityFacts = existing.candidateRef == handling.candidateRef and existing.evidenceRef == handling.evidenceRef and existing.handlingMode == handling.handlingMode and existing.attemptKind == handling.attemptKind and existing.observedEpoch == handling.observedEpoch
            if na(result) and sameIdentityFacts
                result := handlingIndex
    result

appendEntryHandling(RawZone zone, EntryHandlingV2 handling) =>
    bool appended = false
    if na(findEntryHandlingIndex(zone, handling)) and array.size(zone.entryHandling) < ENTRY_MAX_HANDLING_PER_SETUP
        array.push(zone.entryHandling, handling)
        appended := true
    else if na(findEntryHandlingIndex(zone, handling))
        zone.entryCollectionOverflow := true
    appended
```

The compact Pine common-fidelity wire is intentionally binary. This V3 fork has
no complete `EXACT` provenance for every inherited setup-qualification rule, so
the existing V2 `CALIBRATED`, `DISCRETIONARY`, `UNRESOLVED`, and unknown values
all map to `UNRESOLVED`. In particular, `CALIBRATED` must never be upgraded to
`EXACT`. Pine never emits `CALIBRATED` or `DISCRETIONARY` in `f.cf`. A future
contract may emit `EXACT` only after a separate reviewed implementation proves
the complete common setup lifecycle; this plan does not add a manual override.

Construct every nested array with `array.from()` or `array.new<type>()`; never
share one mutable array between two candidate or evidence objects.

- [ ] **Step 5: Decouple engagement and confirmed-close matching from setup terminality**

Add:

```pine
recordEntryZoneEngagement(RawZone zone) =>
    bool firstEngagement = na(zone.entryZoneEngagedEpoch)
    if firstEngagement
        zone.entryZoneEngagedEpoch := epochSeconds(time_close)
        zone.entryEngagementHighTicks := priceToEntryTicks(high)
        zone.entryEngagementLowTicks := priceToEntryTicks(low)
        transitionSetup(zone, SETUP_ZONE_ENGAGED, TAP_POST_CONFIRM_OVERLAP)
    firstEngagement

entryNormalCollectionOpen(RawZone zone) =>
    not zone.entryObservationClosed

entryObservationOpen(RawZone zone) =>
    entryNormalCollectionOpen(zone)

closeEntryObservationIfComplete(RawZone zone, bool dirCloseAppendedNow) =>
    bool bothActiveModelsObserved = hasEntryCandidateModel(zone, ENTRY_MODEL_DIR_CLOSE) and hasEntryCandidateModel(zone, ENTRY_MODEL_HTF_FLIP)
    bool closedNow = bothActiveModelsObserved ?
      closeEntryObservation(
        zone,
        ENTRY_TERMINAL_BOTH_ACTIVE,
        epochSeconds(time_close)
      ) : false
    if closedNow and dirCloseAppendedNow
        // The terminal remains immutable at this close. Only the following
        // contiguous bar may contribute the isolated handling grace fact.
        zone.entryNextCandleWickGraceOpenEpoch := epochSeconds(time_close)
    closedNow

appendEntryConfirmedFact(RawZone zone, EntryConfirmedFactV2 fact) =>
    int factCount = array.size(zone.entryConfirmedFacts)
    if factCount > 0
        EntryConfirmedFactV2 lastFact = array.get(
            zone.entryConfirmedFacts,
            factCount - 1
        )
        if lastFact.closeEpoch != fact.openEpoch
            array.clear(zone.entryConfirmedFacts)
            factCount := 0
    bool duplicate = false
    if factCount > 0
        for factIndex = 0 to factCount - 1
            duplicate := duplicate or array.get(zone.entryConfirmedFacts, factIndex).openEpoch == fact.openEpoch
    bool appended = false
    if not duplicate
        if factCount == ENTRY_MAX_CONFIRMED_FACTS_PER_SETUP
            array.remove(zone.entryConfirmedFacts, 0)
        array.push(zone.entryConfirmedFacts, fact)
        appended := true
    appended

collectConfirmedEntryFact(RawZone zone) =>
    bool directionalClose = directionalCloseConfirmedForZone(zone)
    bool afterEngagementBar = epochSeconds(time) >= zone.entryZoneEngagedEpoch
    bool genericBreak = afterEngagementBar and (zone.demand ? priceToEntryTicks(high) > zone.entryEngagementHighTicks : priceToEntryTicks(low) < zone.entryEngagementLowTicks)
    bool engagementBar = epochSeconds(time_close) == zone.entryZoneEngagedEpoch
    bool respectsZone = zone.demand ? priceToEntryTicks(close) > priceToEntryTicks(zone.top) : priceToEntryTicks(close) < priceToEntryTicks(zone.bottom)
    bool rejectionRespect = engagementBar and respectsZone and not directionalClose
    bool factAppended = false
    if entryNormalCollectionOpen(zone) and not na(zone.entryZoneEngagedEpoch)
        EntryConfirmedFactV2 fact = EntryConfirmedFactV2.new(
            epochSeconds(time),
            epochSeconds(time_close),
            priceToEntryTicks(open),
            priceToEntryTicks(high),
            priceToEntryTicks(low),
            priceToEntryTicks(close),
            genericBreak,
            rejectionRespect,
            ATTEMPT_INITIAL
        )
        factAppended := appendEntryConfirmedFact(zone, fact)
    [factAppended, directionalClose, genericBreak, rejectionRespect]

entryAttemptKindAtClose(RawZone zone, int closeEpoch) =>
    string result = ""
    int factCount = array.size(zone.entryConfirmedFacts)
    if factCount > 0
        for factIndex = 0 to factCount - 1
            EntryConfirmedFactV2 fact = array.get(
                zone.entryConfirmedFacts,
                factIndex
            )
            if fact.closeEpoch == closeEpoch
                result := fact.attemptKind
    result

entryAttemptKindContainingEpoch(RawZone zone, int observedEpoch) =>
    string result = ""
    int factCount = array.size(zone.entryConfirmedFacts)
    if factCount > 0
        for factIndex = 0 to factCount - 1
            EntryConfirmedFactV2 fact = array.get(
                zone.entryConfirmedFacts,
                factIndex
            )
            if fact.openEpoch < observedEpoch and
              observedEpoch <= fact.closeEpoch
                result := fact.attemptKind
    result

collectDirectionalCloseCandidate(RawZone zone) =>
    bool matched = entryNormalCollectionOpen(zone) and not na(zone.entryZoneEngagedEpoch) and directionalCloseConfirmedForZone(zone)
    bool candidateAppended = false
    if matched and not hasEntryCandidateModel(zone, ENTRY_MODEL_DIR_CLOSE)
        array<string> claims = dirCloseSourceClaims()
        int eventAnchorEpoch = epochSeconds(time)
        int observedTriggerEpoch = epochSeconds(time_close)
        string attemptKind = entryAttemptKindAtClose(
            zone,
            observedTriggerEpoch
        )
        if attemptKind != ATTEMPT_INITIAL
            zone.entryCollectionOverflow := true
        string fidelity = entryCombineFidelity(FIDELITY_EXACT, entryCommonFidelity(zone))
        [candidateRef, appended] = appendEntryCandidate(zone, ENTRY_MODEL_DIR_CLOSE, CANDIDATE_MATCHED, eventAnchorEpoch, 1, "", claims)
        candidateAppended := appended
        if appended
            string evidenceRef = candidateRef + ":" + PROOF_CONFIRMED_5M + ":" + str.tostring(observedTriggerEpoch)
            EntryEvidenceV2 evidence = EntryEvidenceV2.new(
                evidenceRef,
                candidateRef,
                observedTriggerEpoch,
                priceToEntryTicks(close),
                array.new<int>(),
                fidelity,
                PROOF_CONFIRMED_5M,
                300,
                epochSeconds(time),
                observedTriggerEpoch,
                array.new<string>(),
                array.from("ENTRY_DIR_CLOSE"),
                array.new<string>(),
                array.copy(claims)
            )
            bool evidenceAppended = appendEntryEvidence(zone, evidence)
            if evidenceAppended
                EntryHandlingV2 handling = EntryHandlingV2.new(candidateRef, evidenceRef, HANDLING_CLOSE_CONFIRMATION, attemptKind, observedTriggerEpoch, priceToEntryTicks(close), fidelity, array.copy(claims))
                appendEntryHandling(zone, handling)
    [matched, candidateAppended]

appendRejectedLegacyCandidateEvidence(RawZone zone, string model, string failedRuleId, array<string> claims, EntryConfirmedFactV2 fact) =>
    bool changed = false
    [candidateRef, candidateAppended] = appendEntryCandidate(
        zone,
        model,
        CANDIDATE_REJECTED,
        fact.openEpoch,
        1,
        "",
        claims
    )
    if candidateAppended
        string evidenceRef =
          candidateRef + ":" + PROOF_CONFIRMED_5M + ":" +
          str.tostring(fact.closeEpoch) + ":" + failedRuleId
        string fidelity = entryCombineFidelity(
            FIDELITY_EXACT,
            entryCommonFidelity(zone)
        )
        EntryEvidenceV2 evidence = EntryEvidenceV2.new(
            evidenceRef,
            candidateRef,
            fact.closeEpoch,
            fact.closeTicks,
            array.new<int>(),
            fidelity,
            PROOF_CONFIRMED_5M,
            300,
            fact.openEpoch,
            fact.closeEpoch,
            array.new<string>(),
            array.new<string>(),
            array.from(failedRuleId),
            array.copy(claims)
        )
        changed := appendEntryEvidence(zone, evidence)
    changed

latestEntryConfirmedFact(RawZone zone) =>
    int factCount = array.size(zone.entryConfirmedFacts)
    factCount == 0 ? na :
      array.get(zone.entryConfirmedFacts, factCount - 1)

collectLegacyRejectionCandidate(RawZone zone) =>
    bool changed = false
    EntryConfirmedFactV2 fact = latestEntryConfirmedFact(zone)
    if entryNormalCollectionOpen(zone) and not na(fact) and
      fact.rejectionRespectDetected and
      not hasAnyEntryCandidateModel(zone, ENTRY_MODEL_LEGACY_REJECTION)
        changed := appendRejectedLegacyCandidateEvidence(
            zone,
            ENTRY_MODEL_LEGACY_REJECTION,
            "ENTRY_REJECTION_RESPECT_DISABLED",
            legacyRejectionSourceClaims(),
            fact
        )
    changed

hasNormalizedHtfBreakForConfirmedEvent(RawZone zone, int confirmedCloseEpoch) =>
    bool result = false
    int candidateIndex = findEntryCandidateModelIndex(
        zone,
        ENTRY_MODEL_HTF_FLIP
    )
    if not na(candidateIndex)
        EntryCandidateV2 candidate = array.get(
            zone.entryCandidates,
            candidateIndex
        )
        bool normalizedBreak =
          candidate.state == CANDIDATE_NORMALIZED and
          candidate.normalizedFrom == ENTRY_MODEL_LEGACY_BREAK
        int evidenceCount = array.size(zone.entryEvidence)
        if normalizedBreak and evidenceCount > 0
            for evidenceIndex = 0 to evidenceCount - 1
                EntryEvidenceV2 evidence = array.get(
                    zone.entryEvidence,
                    evidenceIndex
                )
                result := result or (
                  evidence.candidateRef == candidate.localRef and
                  evidence.observedTriggerEpoch == confirmedCloseEpoch and
                  evidence.proofPlane == PROOF_LOWER_TIMEFRAME_REPLAY
                )
    result

collectLegacyBreakCandidate(RawZone zone) =>
    bool changed = false
    EntryConfirmedFactV2 fact = latestEntryConfirmedFact(zone)
    bool normalizedSameEvent = not na(fact) and
      hasNormalizedHtfBreakForConfirmedEvent(zone, fact.closeEpoch)
    if entryNormalCollectionOpen(zone) and not na(fact) and
      fact.genericBreakDetected and not normalizedSameEvent and
      not hasAnyEntryCandidateModel(zone, ENTRY_MODEL_LEGACY_BREAK)
        changed := appendRejectedLegacyCandidateEvidence(
            zone,
            ENTRY_MODEL_LEGACY_BREAK,
            "ENTRY_BREAK_CANDLE_NORMALIZATION",
            legacyBreakSourceClaims(),
            fact
        )
    changed

findDirectionalCloseEvidenceIndex(RawZone zone, string candidateRef) =>
    int result = na
    int evidenceCount = array.size(zone.entryEvidence)
    if evidenceCount > 0
        for evidenceIndex = 0 to evidenceCount - 1
            EntryEvidenceV2 evidence = array.get(zone.entryEvidence, evidenceIndex)
            if na(result) and evidence.candidateRef == candidateRef and evidence.proofPlane == PROOF_CONFIRMED_5M
                result := evidenceIndex
    result

collectNextCandleWickHandling(RawZone zone) =>
    bool observed = false
    int candidateIndex = findEntryCandidateModelIndex(zone, ENTRY_MODEL_DIR_CLOSE)
    if not na(candidateIndex)
        EntryCandidateV2 candidate = array.get(zone.entryCandidates, candidateIndex)
        int evidenceIndex = findDirectionalCloseEvidenceIndex(zone, candidate.localRef)
        if not na(evidenceIndex)
            EntryEvidenceV2 closeEvidence = array.get(zone.entryEvidence, evidenceIndex)
            string attemptKind = entryAttemptKindAtClose(
                zone,
                closeEvidence.observedTriggerEpoch
            )
            if attemptKind != ATTEMPT_INITIAL
                zone.entryCollectionOverflow := true
            bool immediatelyFollowing =
              epochSeconds(time) == closeEvidence.observedTriggerEpoch and
              epochSeconds(time_close) == closeEvidence.observedTriggerEpoch + 300
            int openTicks = priceToEntryTicks(open)
            int highTicks = priceToEntryTicks(high)
            int lowTicks = priceToEntryTicks(low)
            int closeTicks = priceToEntryTicks(close)
            bool strictCounterWick = zone.demand ?
              lowTicks < math.min(openTicks, closeTicks) :
              highTicks > math.max(openTicks, closeTicks)
            if immediatelyFollowing and strictCounterWick
                int observedTicks = zone.demand ? lowTicks : highTicks
                string fidelity = FIDELITY_DISCRETIONARY
                EntryHandlingV2 handling = EntryHandlingV2.new(
                    candidate.localRef,
                    closeEvidence.localRef,
                    HANDLING_NEXT_CANDLE_WICK,
                    attemptKind,
                    epochSeconds(time_close),
                    observedTicks,
                    fidelity,
                    nextCandleWickSourceClaims()
                )
                observed := appendEntryHandling(zone, handling)
    observed

entryNextCandleWickGraceDue(RawZone zone) =>
    zone.entryObservationClosed and
      zone.entryTerminalReason == ENTRY_TERMINAL_BOTH_ACTIVE and
      not zone.entryNextCandleWickGraceConsumed and
      not na(zone.entryNextCandleWickGraceOpenEpoch) and
      epochSeconds(time) == zone.entryNextCandleWickGraceOpenEpoch and
      epochSeconds(time_close) ==
        zone.entryNextCandleWickGraceOpenEpoch + 300

collectNextCandleWickGrace(RawZone zone) =>
    bool graceEventRecorded = false
    if entryNextCandleWickGraceDue(zone)
        string attemptKind = entryAttemptKindAtClose(
            zone,
            zone.entryNextCandleWickGraceOpenEpoch
        )
        if attemptKind == ATTEMPT_INITIAL
            zone.entryNextCandleWickGraceFact :=
              EntryNextCandleWickGraceV2.new(
                epochSeconds(time),
                epochSeconds(time_close),
                priceToEntryTicks(open),
                priceToEntryTicks(high),
                priceToEntryTicks(low),
                priceToEntryTicks(close),
                attemptKind
              )
            collectNextCandleWickHandling(zone)
            graceEventRecorded := true
        else
            zone.entryCollectionOverflow := true
        zone.entryNextCandleWickGraceConsumed := true
    else if zone.entryObservationClosed and
      not zone.entryNextCandleWickGraceConsumed and
      not na(zone.entryNextCandleWickGraceOpenEpoch) and
      epochSeconds(time) > zone.entryNextCandleWickGraceOpenEpoch
        // A session gap or a missed immediate candle consumes the only grace.
        zone.entryNextCandleWickGraceConsumed := true
    graceEventRecorded
```

In the confirmed-bar zone loop:

1. call `recordEntryZoneEngagement(zone)` when the existing engine first changes
   the zone to `STATE_TAPPED`;
2. freeze `normalOpenAtBarStart=entryNormalCollectionOpen(zone)`. If it is
   false, call only `collectNextCandleWickGrace(zone)`; never call the ordinary
   fact, HTF, candidate, legacy, realtime, or handling collectors again;
3. while `normalOpenAtBarStart` is true, call
   `collectConfirmedEntryFact(zone)` on every post-engagement confirmed bar
   before HTF scanning so a generic-break fact can normalize only the HTF
   event with the same boundary and recross close. Keep the newest four bars in
   chronological order by removing index 0 before appending a fifth. When the
   new bar does not open at the prior retained bar's close—such as after a
   legitimate market-session closure—clear the rolling `b` window before
   appending the new bar. The new window then contains only post-gap bars;
   serialized HTF transcripts from before the discontinuity no longer map into
   it, and the HTF tracker records the missing lifecycle slice separately.
   Rolling or resetting this fact window is not setup retention eviction;
4. call `collectNextCandleWickHandling(zone)` before applying a terminal
   invalidation. This lets an immediately following candle contribute the
   handling observation even when that same confirmed close invalidates the
   still-open attempt. It cannot create a candidate or evidence;
5. if `SETUP_REJECTED` or `STATE_INVALIDATED` is reached on this bar, call
   `closeEntryObservation(zone, ENTRY_TERMINAL_INVALIDATED,
   epochSeconds(time_close))` after the fact/wick work and skip DIR/HTF/legacy
   candidate collectors for that bar;
6. otherwise call `collectDirectionalCloseCandidate(zone)`, then scan all HTF
   contexts, then call `collectLegacyRejectionCandidate(zone)` and
   `collectLegacyBreakCandidate(zone)` in that exact order. The break collector
   must run after HTF scanning because append-only storage cannot emit a
   rejected break and later retract it when the same event normalizes to
   `HTF_FLIP`;
7. keep `SETUP_SHADOW_ONLY` observable and use bounded retention as the only
   expiry path;
8. `collectNextCandleWickHandling(zone)` may inspect only the immediately following bar
   (`current open epoch == DIR_CLOSE evidence trigger epoch`). For demand the
   strict counter-wick predicate is
   `low_ticks < min(open_ticks, close_ticks)`; for supply it is
   `high_ticks > max(open_ticks, close_ticks)`. Equality, the second-or-later
   bar, and a body-only counter move do not qualify. No wick-size threshold is
   invented. The result is one idempotent `NEXT_CANDLE_WICK` handling row on
   the existing `DIR_CLOSE` candidate/evidence with the official
   `next-candle-wick-2025-05`, `prompt-close-2025-05`, and
   `close-fallback-2025-11` claims. Handling fidelity describes the handling
   rule itself, so export `DISCRETIONARY` exactly as the domain oracle does;
   candidate/evidence common fidelity remains independently `UNRESOLVED`. Never
   append a candidate or evidence row. Its `attemptKind` is looked up from the
   confirmed fact that created the referenced close evidence; do not hardcode a
   second `INITIAL` value at the wick call site;
9. after all candidate collectors, call
   `closeEntryObservationIfComplete(zone, dirCloseAppendedNow)`;
   `BOTH_ACTIVE_MODELS_OBSERVED` is immutable and occurs when both active model
   candidates exist in any non-`REJECTED` state, including `BLOCKED`, regardless
   of fidelity. When the newly appended DIR close completes BOTH, freeze exactly
   one grace open at that terminal close. On the contiguous next confirmed bar,
   populate only `entryNextCandleWickGraceFact`, run the wick helper, and consume
   the grace whether or not a strict wick exists. A gap consumes it without an
   event. The ordinary `entryConfirmedFacts`/HTF/candidate collectors stay
   closed;
10. set `entryInvalidatedBeforeEntry` only when neither active model already
   exists; retain an earlier active candidate when invalidation happens while
   waiting for the second model. On bounded retention eviction, call the same
   helper with `ENTRY_TERMINAL_RETENTION_EVICTED`. Retention eviction is the only
   expiry mechanism; never infer expiry from wall-clock time;
11. remove every read/write of `setupEntryModel` and
   `setupEntryConfirmedTime`;
12. make `updateSetupState()` lifecycle-only so candidate creation cannot turn the
   setup terminal.

Emit every open attempt as an `incremental` setup bundle on every confirmed bar,
even when all `gb`/`rr` flags are false and no diagnostic candidate changed.
The edge accumulates this ordered event stream. Prune an HTF transcript from the
serialized `f.x` window once its `scanCutoffEpoch` no longer belongs to one of
the retained `f.b` candles; do not erase already emitted replay evidence or
diagnostic candidates. A mid-attempt `snapshot` is valid only when the edge
already holds the preceding incrementals; otherwise the edge fails it closed as
incomplete history.

`appendRejectedLegacyCandidateEvidence()` is the only legacy constructor.
Record a rejected `LEGACY_REJECTION_RESPECT` on the first engagement bar when
the zone is respected but `DIR_CLOSE` is false. Record a rejected
`LEGACY_BREAK_CANDLE` when a later 5m bar trades through the engagement candle's
directional extreme. Evaluate these booleans independently of `DIR_CLOSE`.
`LEGACY_REJECTION_RESPECT` uses `legacyRejectionSourceClaims()` and failed rule
`ENTRY_REJECTION_RESPECT_DISABLED`; `LEGACY_BREAK_CANDLE` uses
`legacyBreakSourceClaims()` and failed rule
`ENTRY_BREAK_CANDLE_NORMALIZATION`. Each rejected legacy candidate has
`state=REJECTED`, `trigger_ordinal=1`, `normalized_from=null`, and exactly one
`CONFIRMED_5M` evidence record with trigger epoch/ticks equal to the source
bar's close epoch/ticks, 300-second resolution, coverage equal to that bar,
empty HTF contexts/ambiguity/passed rules, the one failed rule above, the
model's exact source-claim tuple, and no handling record. The evidence and any
later handling inherit `fact.attemptKind`; this increment accepts only
`INITIAL`.
Suppress the rejected break candidate only when an HTF proof has the same HTF
opening boundary and recross child close; Task 3 then emits the single normalized
`HTF_FLIP`. Normalization is semantic and does not imply exact fidelity: an
ambiguous or incomplete matching proof remains `UNRESOLVED` and shadow-only.
No legacy observation creates a paper-eligible action.

For `DIR_CLOSE`, `LEGACY_REJECTION_RESPECT`, and `LEGACY_BREAK_CANDLE`, set
`eventAnchorEpoch` to the confirmed 5m bar's open epoch and
`observedTriggerEpoch` to that bar's close epoch. The close epoch is proof, not
semantic candidate identity.

- [ ] **Step 6: Run V2 and V3 static tests**

Run:

```bash
uv run pytest tests/static/test_paper_automation_pine.py \
  tests/static/test_rd_multi_entry_pine.py -v
```

Expected: all tests pass and the V2 SHA assertion remains green.

- [ ] **Step 7: Commit nonterminal candidate collection**

```bash
git add scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  tests/static/test_rd_multi_entry_pine.py
git commit -m "feat: collect bounded Pine entry candidates"
```

### Task 3: Add one chronological 1m request and replayable HTF proof

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine:request block, HTF scanner, confirmed-bar loop`
- Modify: `tests/static/test_rd_multi_entry_pine.py`
- Consume: `src/prop_trading/domain/rd_intrabar_oracle.py`
- Consume: `contracts/vectors/rd-entry-arbitration-v2.json`

**Interfaces:**
- Consumes: Python `scan_htf_flip(request: HTFFlipScanRequest) -> HTFFlipProof`
  and
  `validate_htf_flip_transcript(setup: SetupEntryFacts, transcript: HTFFlipProofTranscript) -> HTFFlipProof`.
- Produces: `lowerTimeframeCoverageExact()`, `resetHtfTracker()`,
  `scanHtfTrackerChildren()`, a bounded authoritative HTF transcript, and one
  correctly classified `HTF_FLIP` candidate with combined contexts.

- [ ] **Step 1: Write failing tests for the single request and fail-closed scanner**

Append:

```python
def test_v3_has_exactly_one_bounded_lower_timeframe_tuple_request() -> None:
    text = source()
    assert text.count("request.security_lower_tf(") == 1
    assert (
        "[childTimes, childCloseTimes, childOpens, childHighs, childLows, childCloses] = "
        "request.security_lower_tf("
    ) in text
    assert "ENTRY_LTF_TIMEFRAME" in text
    assert "[time, time_close, open, high, low, close]" in text
    assert "calc_bars_count = ENTRY_LTF_CALC_BARS" in text
    assert text.count("ta.valuewhen(") >= 3
    assert 'time("15")' in text
    assert 'time("30")' in text
    assert 'time("60")' in text


def test_ltf_scanner_is_chronological_and_fails_closed() -> None:
    coverage = pine_function_body("lowerTimeframeCoverageExact")
    scanner = pine_function_body("scanHtfTrackerChildren")
    assert "childCount == 5" in coverage
    assert "array.get(childTimes, 0) == time" in coverage
    assert "array.get(childCloseTimes, childCount - 1) == time_close" in coverage
    assert "previousClose == childOpenTime" in coverage
    assert "for childIndex = 0 to childCount - 1" in scanner
    assert "SHADOW_SAME_CHILD_BAR_ORDER" in scanner
    assert "SHADOW_MISSING_INTRABAR_COVERAGE" in scanner
    assert "childHighTicks > tracker.openTicks" in scanner
    assert "childLowTicks < tracker.openTicks" in scanner
    assert "zoneBottomTicks <= childOpenTicks and childOpenTicks <= zoneTopTicks" in scanner
    assert "childLowTicks <= zoneTopTicks and childHighTicks >= zoneBottomTicks" in scanner
    assert "tracker.coverageEndEpoch == epochSeconds(time)" in scanner
    assert "epochSeconds(tracker.anchorEpoch)" not in scanner
    assert "int scanCutoffEpoch = epochSeconds(time_close)" in scanner
    assert "scanCutoffEpoch := matchedTriggerEpoch" not in scanner


def test_htf_contexts_are_reduced_without_priority_or_scan_order() -> None:
    text = source()
    assert "array.from(15, 30, 60)" in text
    combine = pine_function_body("appendOrMergeHtfEvidence")
    assert "array.includes(retained.htfContextMinutes, contextMinutes)" in combine
    assert "array.sort(retained.htfContextMinutes)" in combine
    assert "htfEvidenceProofEquivalent" in combine
    strongest = pine_function_body("upsertHtfCandidateFromProof")
    assert "htfCandidateProofRank" in strongest
    assert "triggerProofExact" in strongest
    assert "strongestRetainedHtfTriggerProofExact" in strongest
    assert "currentRank < retainedRank" in strongest
    assert "HTF_PRIORITY" not in text


def test_htf_transcript_is_bounded_and_contains_independent_proof_facts() -> None:
    text = source()
    for declaration in (
        "type CompactChildCandleV2",
        "type HtfProofTranscriptV2",
        "array<HtfProofTranscriptV2> htfTranscripts",
        "ENTRY_MAX_HTF_TRANSCRIPTS_PER_SETUP",
        "expectedChildCount",
        "observedChildCount",
        "gapPresent",
        "fullLifecycleOrdered",
        "destinationSeenBeforeContact",
        "contactCandle",
        "recrossCandle",
        "sameChild",
    ):
        assert declaration in text
    upsert = pine_function_body("upsertHtfTranscript")
    assert "transcript.coverageEndEpoch == transcript.scanCutoffEpoch" in upsert


def test_pure_flip_and_break_normalization_are_distinct() -> None:
    scanner = pine_function_body("scanHtfTrackerChildren")
    assert "genericBreakSharesHtfEvent" in scanner
    assert "CANDIDATE_MATCHED" in scanner
    assert "CANDIDATE_NORMALIZED" in scanner
    assert "ENTRY_MODEL_LEGACY_BREAK" in scanner
    assert "normalizedFromBreak ? ENTRY_MODEL_LEGACY_BREAK : \"\"" in scanner
    assert "exactReplay and genericBreakSharesHtfEvent" not in scanner


def test_setup_armed_after_htf_boundary_is_shadowed_not_silenced() -> None:
    scanner = pine_function_body("scanHtfTrackerChildren")
    assert "if not tracker.candidateRecorded" in scanner
    assert "if tracker.armedAtBoundary and not tracker.candidateRecorded" not in scanner
    assert "not tracker.armedAtBoundary" in scanner
    assert "SOURCE_HTF_BOUNDARY_CAUTION" in source()


def test_missing_coverage_never_synthesizes_an_htf_candidate() -> None:
    missing = pine_function_body("recordMissingCoverageHtfTranscript")
    assert "upsertHtfTranscript" in missing
    assert "tracker.contactSeen := false" in missing
    assert "tracker.contactChildEpoch := na" in missing
    assert "appendEntryCandidate" not in missing
    assert "appendEntryEvidence" not in missing
    assert "appendEntryHandling" not in missing


def test_contact_gap_then_recross_cannot_reuse_pre_gap_contact() -> None:
    missing = pine_function_body("recordMissingCoverageHtfTranscript")
    scanner = pine_function_body("scanHtfTrackerChildren")
    assert "tracker.contactSeen := false" in missing
    assert "emptyCompactChild()" in missing
    assert "if not prior.gapPresent and tracker.contactSeen" in scanner
    assert "prior.contactCandle" in scanner
```

- [ ] **Step 2: Run the scanner tests and verify they fail**

Run:

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py \
  -k "lower_timeframe or scanner or htf_contexts or htf_transcript or pure_flip or setup_armed or missing_coverage or contact_gap" -v
```

Expected: 8 failures for the absent request, scanner, transcript, and
classification logic.

- [ ] **Step 3: Add the single top-level tuple request**

Place this declaration outside every loop and conditional, after the input block:

```pine
[childTimes, childCloseTimes, childOpens, childHighs, childLows, childCloses] = request.security_lower_tf(
    syminfo.tickerid,
    ENTRY_LTF_TIMEFRAME,
    [time, time_close, open, high, low, close],
    ignore_invalid_symbol = false,
    ignore_invalid_timeframe = false,
    calc_bars_count = ENTRY_LTF_CALC_BARS
)
```

Do not add another `request.*` call for HTF opens. Derive each fixed HTF anchor
with `time("15")`, `time("30")`, and `time("60")`; on the first 5m slice of a new
anchor, the chart `open` is the fixed HTF open. Cache those three series at
top-level so a setup armed later in the HTF candle still uses its boundary open:

```pine
int htf15AnchorMillis = time("15")
int htf30AnchorMillis = time("30")
int htf60AnchorMillis = time("60")
int htf15OpenTicks = ta.valuewhen(ta.change(htf15AnchorMillis) != 0, priceToEntryTicks(open), 0)
int htf30OpenTicks = ta.valuewhen(ta.change(htf30AnchorMillis) != 0, priceToEntryTicks(open), 0)
int htf60OpenTicks = ta.valuewhen(ta.change(htf60AnchorMillis) != 0, priceToEntryTicks(open), 0)
```

If a cached open is `na` because calculation began mid-boundary with no prior
boundary bar, do not create a tracker or candidate for that context. Wait for
the next true boundary; never substitute the current 5m open.

- [ ] **Step 4: Implement exact coverage validation**

Add:

```pine
lowerTimeframeCoverageExact(array<int> childTimes, array<int> childCloseTimes, array<float> childOpens, array<float> childHighs, array<float> childLows, array<float> childCloses) =>
    int childCount = array.size(childTimes)
    bool lengthsMatch = childCount == array.size(childCloseTimes) and childCount == array.size(childOpens) and childCount == array.size(childHighs) and childCount == array.size(childLows) and childCount == array.size(childCloses)
    bool exact = lengthsMatch and childCount == 5
    if exact
        exact := array.get(childTimes, 0) == time and array.get(childCloseTimes, childCount - 1) == time_close
    if exact
        for childIndex = 0 to childCount - 1
            int childOpenTime = array.get(childTimes, childIndex)
            int childCloseTime = array.get(childCloseTimes, childIndex)
            float childOpen = array.get(childOpens, childIndex)
            float childHigh = array.get(childHighs, childIndex)
            float childLow = array.get(childLows, childIndex)
            float childClose = array.get(childCloses, childIndex)
            int previousClose = childIndex == 0 ? time : array.get(childCloseTimes, childIndex - 1)
            bool durationExact = childCloseTime - childOpenTime == 60000
            bool contiguous = previousClose == childOpenTime
            bool ohlcValid = childHigh >= math.max(childOpen, math.max(childLow, childClose)) and childLow <= math.min(childOpen, math.min(childHigh, childClose))
            exact := exact and durationExact and contiguous and ohlcValid
    exact
```

The check proves one closed 5m slice. `HtfFlipTrackerV2.coverageStartEpoch` and
`coverageEndEpoch` then prove that every slice from the HTF boundary through the
confirmed scan cutoff was received contiguously. The recross child close remains
the separate observed trigger epoch.

- [ ] **Step 5: Implement persistent HTF trackers and a bounded proof transcript**

Add the authoritative compact transcript types:

```pine
type CompactChildCandleV2
    int openEpoch
    int closeEpoch
    int openTicks
    int highTicks
    int lowTicks
    int closeTicks

type HtfProofTranscriptV2
    int contextMinutes
    int htfOpenEpoch
    int htfOpenTicks
    int scanCutoffEpoch
    int proofResolutionSeconds
    int coverageStartEpoch
    int coverageEndEpoch
    int expectedChildCount
    int observedChildCount
    bool gapPresent
    bool fullLifecycleOrdered
    bool destinationSeenBeforeContact
    CompactChildCandleV2 contactCandle
    CompactChildCandleV2 recrossCandle
    bool sameChild
```

Extend `RawZone` with
`array<HtfProofTranscriptV2> htfTranscripts` and initialize it with
`array.new<HtfProofTranscriptV2>()`. This array is keyed by context and must
never exceed `ENTRY_MAX_HTF_TRANSCRIPTS_PER_SETUP`. It retains no raw child
array. At most one full contact child and one full recross child are retained per
context.

Add these exact helpers:

```pine
emptyCompactChild() =>
    CompactChildCandleV2.new(na, na, na, na, na, na)

compactChildAt(int childIndex, array<int> childTimes, array<int> childCloseTimes, array<float> childOpens, array<float> childHighs, array<float> childLows, array<float> childCloses) =>
    CompactChildCandleV2.new(
        epochSeconds(array.get(childTimes, childIndex)),
        epochSeconds(array.get(childCloseTimes, childIndex)),
        priceToEntryTicks(array.get(childOpens, childIndex)),
        priceToEntryTicks(array.get(childHighs, childIndex)),
        priceToEntryTicks(array.get(childLows, childIndex)),
        priceToEntryTicks(array.get(childCloses, childIndex))
    )

findHtfTranscriptIndex(RawZone zone, int contextMinutes) =>
    int result = na
    int transcriptCount = array.size(zone.htfTranscripts)
    if transcriptCount > 0
        for transcriptIndex = 0 to transcriptCount - 1
            if na(result) and array.get(zone.htfTranscripts, transcriptIndex).contextMinutes == contextMinutes
                result := transcriptIndex
    result

upsertHtfTranscript(RawZone zone, HtfProofTranscriptV2 transcript) =>
    bool cutoffExact = transcript.coverageEndEpoch == transcript.scanCutoffEpoch
    int existingIndex = findHtfTranscriptIndex(zone, transcript.contextMinutes)
    if not cutoffExact
        zone.entryCollectionOverflow := true
    else if na(existingIndex)
        if array.size(zone.htfTranscripts) < ENTRY_MAX_HTF_TRANSCRIPTS_PER_SETUP
            array.push(zone.htfTranscripts, transcript)
        else
            zone.entryCollectionOverflow := true
    else
        array.set(zone.htfTranscripts, existingIndex, transcript)
    not zone.entryCollectionOverflow

resetHtfTracker(HtfFlipTrackerV2 tracker, int anchorEpoch, int openTicks, bool armedAtBoundary) =>
    tracker.anchorEpoch := anchorEpoch
    tracker.openTicks := openTicks
    tracker.armedAtBoundary := armedAtBoundary
    tracker.coverageComplete := armedAtBoundary
    tracker.coverageStartEpoch := anchorEpoch
    tracker.coverageEndEpoch := anchorEpoch
    tracker.destinationSeenBeforeContact := false
    tracker.contactSeen := false
    tracker.contactChildEpoch := na
    tracker.candidateRecorded := false
    tracker.realtimeContactSeen := false
    tracker.realtimeFlipSeen := false
    true

genericBreakSharesHtfEvent(RawZone zone, int anchorEpoch, int contextMinutes, int observedTriggerEpoch) =>
    bool result = false
    int factCount = array.size(zone.entryConfirmedFacts)
    if factCount > 0
        for factIndex = 0 to factCount - 1
            EntryConfirmedFactV2 fact = array.get(zone.entryConfirmedFacts, factIndex)
            bool insideBoundary = fact.openEpoch >= anchorEpoch and fact.closeEpoch <= anchorEpoch + contextMinutes * 60
            if fact.genericBreakDetected and fact.closeEpoch == observedTriggerEpoch and insideBoundary
                result := true
    result

entryStringArrayKey(array<string> values) =>
    string result = ""
    int valueCount = array.size(values)
    if valueCount > 0
        for valueIndex = 0 to valueCount - 1
            string value = array.get(values, valueIndex)
            result += (valueIndex == 0 ? "" : "|") + value
    result

compactChildProofKey(CompactChildCandleV2 child) =>
    na(child.openEpoch) ? "null" :
     str.tostring(child.openEpoch) + ":" +
     str.tostring(child.closeEpoch) + ":" +
     str.tostring(child.openTicks) + ":" +
     str.tostring(child.highTicks) + ":" +
     str.tostring(child.lowTicks) + ":" +
     str.tostring(child.closeTicks)

htfEvidenceProofKey(HtfProofTranscriptV2 transcript, EntryEvidenceV2 evidence) =>
    // Context minutes are intentionally excluded. Everything else that can
    // change proof meaning is included, so only equivalent proofs merge.
    evidence.candidateRef + ":" +
     str.tostring(evidence.observedTriggerEpoch) + ":" +
     str.tostring(evidence.observedTriggerTicks) + ":" +
     evidence.fidelity + ":" + evidence.proofPlane + ":" +
     str.tostring(evidence.proofResolutionSeconds) + ":" +
     str.tostring(evidence.coverageStartEpoch) + ":" +
     str.tostring(evidence.coverageEndEpoch) + ":" +
     entryStringArrayKey(evidence.ambiguityCodes) + ":" +
     entryStringArrayKey(evidence.passedRuleIds) + ":" +
     entryStringArrayKey(evidence.failedRuleIds) + ":" +
     entryStringArrayKey(evidence.sourceClaimIds) + ":" +
     str.tostring(transcript.htfOpenEpoch) + ":" +
     str.tostring(transcript.htfOpenTicks) + ":" +
     str.tostring(transcript.scanCutoffEpoch) + ":" +
     str.tostring(transcript.expectedChildCount) + ":" +
     str.tostring(transcript.observedChildCount) + ":" +
     str.tostring(transcript.gapPresent) + ":" +
     str.tostring(transcript.fullLifecycleOrdered) + ":" +
     str.tostring(transcript.destinationSeenBeforeContact) + ":" +
     compactChildProofKey(transcript.contactCandle) + ":" +
     compactChildProofKey(transcript.recrossCandle) + ":" +
     str.tostring(transcript.sameChild)

htfEvidenceProofEquivalent(EntryEvidenceV2 left, EntryEvidenceV2 right) =>
    left.localRef == right.localRef

appendOrMergeHtfEvidence(RawZone zone, EntryEvidenceV2 evidence, int contextMinutes) =>
    bool accepted = false
    int evidenceCount = array.size(zone.entryEvidence)
    if evidenceCount > 0
        for evidenceIndex = 0 to evidenceCount - 1
            EntryEvidenceV2 retained = array.get(zone.entryEvidence, evidenceIndex)
            if not accepted and htfEvidenceProofEquivalent(retained, evidence)
                if not array.includes(retained.htfContextMinutes, contextMinutes)
                    array.push(retained.htfContextMinutes, contextMinutes)
                    array.sort(retained.htfContextMinutes)
                    array.set(zone.entryEvidence, evidenceIndex, retained)
                accepted := true
    if not accepted
        accepted := appendEntryEvidence(zone, evidence)
    accepted

htfCandidateProofRank(bool triggerProofExact, string state) =>
    int fidelityRank = triggerProofExact ? 0 : 10
    int stateRank = state == CANDIDATE_NORMALIZED ? 0 :
      state == CANDIDATE_MATCHED ? 1 : 2
    fidelityRank + stateRank

strongestRetainedHtfTriggerProofExact(RawZone zone, string candidateRef) =>
    bool result = false
    int evidenceCount = array.size(zone.entryEvidence)
    if evidenceCount > 0
        for evidenceIndex = 0 to evidenceCount - 1
            EntryEvidenceV2 evidence = array.get(zone.entryEvidence, evidenceIndex)
            bool exactTriggerProof =
              evidence.candidateRef == candidateRef and
              evidence.proofPlane == PROOF_LOWER_TIMEFRAME_REPLAY and
              array.includes(evidence.passedRuleIds, "ENTRY_HTF_FLIP") and
              array.size(evidence.ambiguityCodes) == 0 and
              array.size(evidence.failedRuleIds) == 0
            result := result or exactTriggerProof
    result

upsertHtfCandidateFromProof(RawZone zone, string state, int anchorEpoch, string normalizedFrom, bool triggerProofExact, array<string> sourceClaimIds) =>
    string desiredRef = entryCandidateLocalRef(ENTRY_MODEL_HTF_FLIP, anchorEpoch, 1)
    [candidateRef, appended] = appendEntryCandidate(
        zone,
        ENTRY_MODEL_HTF_FLIP,
        state,
        anchorEpoch,
        1,
        normalizedFrom,
        sourceClaimIds
    )
    bool accepted = candidateRef == desiredRef
    if accepted and not appended
        int candidateIndex = findEntryCandidateIndex(zone, candidateRef)
        EntryCandidateV2 retained = array.get(zone.entryCandidates, candidateIndex)
        bool retainedTriggerProofExact =
          strongestRetainedHtfTriggerProofExact(zone, candidateRef)
        int retainedRank =
          htfCandidateProofRank(retainedTriggerProofExact, retained.state)
        int currentRank = htfCandidateProofRank(triggerProofExact, state)
        if currentRank < retainedRank
            retained.state := state
            retained.normalizedFrom := normalizedFrom
            array.set(zone.entryCandidates, candidateIndex, retained)
    [candidateRef, accepted, appended]
```

All tracker epochs are integer seconds. Reset a context with
`epochSeconds(time("15"))`, `epochSeconds(time("30"))`, or
`epochSeconds(time("60"))` exactly once at its boundary. Never pass a
millisecond timestamp into `resetHtfTracker()` and never call `epochSeconds()` on
`tracker.anchorEpoch`, `tracker.coverageStartEpoch`, or
`tracker.coverageEndEpoch`.

Use the cached per-context anchor/open pair when initializing a newly created
zone mid-boundary. Set `armedAtBoundary=true` only when the setup's frozen armed
epoch is less than or equal to the seconds-valued HTF anchor; otherwise retain
the correct fixed open but force the boundary-caution shadow path.

Define and use one closed context list for tracker initialization, reset, scan,
and serialization-order tests:

```pine
entryHtfContextMinutes() =>
    array.from(15, 30, 60)
```

Do not duplicate a different context list or infer timeframe priority from this
iteration order.

Implement `scanHtfTrackerChildren()` with this state order:

```pine
scanHtfTrackerChildren(RawZone zone, HtfFlipTrackerV2 tracker, bool sliceCoverageExact, array<int> childTimes, array<int> childCloseTimes, array<float> childOpens, array<float> childHighs, array<float> childLows, array<float> childCloses) =>
    bool matched = false
    bool sameChildAmbiguous = false
    int matchedTriggerEpoch = na
    CompactChildCandleV2 contactCandle = emptyCompactChild()
    CompactChildCandleV2 recrossCandle = emptyCompactChild()
    int previousTranscriptIndex = findHtfTranscriptIndex(zone, tracker.contextMinutes)
    int priorObservedCount = 0
    bool priorGap = false
    if not na(previousTranscriptIndex)
        HtfProofTranscriptV2 prior = array.get(zone.htfTranscripts, previousTranscriptIndex)
        if prior.htfOpenEpoch == tracker.anchorEpoch
            priorObservedCount := prior.observedChildCount
            priorGap := prior.gapPresent
            if not prior.gapPresent and tracker.contactSeen
                contactCandle := prior.contactCandle
    if not tracker.candidateRecorded
        bool sliceContiguous = sliceCoverageExact and tracker.coverageEndEpoch == epochSeconds(time)
        tracker.coverageComplete := tracker.coverageComplete and sliceContiguous
        int childCount = array.size(childTimes)
        int observedThroughCutoff = priorObservedCount + childCount
        int scanCutoffEpoch = epochSeconds(time_close)
        if sliceCoverageExact
            int zoneBottomTicks = priceToEntryTicks(zone.bottom)
            int zoneTopTicks = priceToEntryTicks(zone.top)
            for childIndex = 0 to childCount - 1
                CompactChildCandleV2 child = compactChildAt(childIndex, childTimes, childCloseTimes, childOpens, childHighs, childLows, childCloses)
                int childOpenTicks = child.openTicks
                int childHighTicks = child.highTicks
                int childLowTicks = child.lowTicks
                bool contactAtOpen = zoneBottomTicks <= childOpenTicks and childOpenTicks <= zoneTopTicks
                bool contactByRange = childLowTicks <= zoneTopTicks and childHighTicks >= zoneBottomTicks
                bool recrossByRange = zone.demand ? childHighTicks > tracker.openTicks : childLowTicks < tracker.openTicks
                bool destinationByRange = recrossByRange
                if not tracker.contactSeen and not contactByRange and destinationByRange
                    tracker.destinationSeenBeforeContact := true
                if not tracker.contactSeen and contactByRange
                    contactCandle := child
                    tracker.contactSeen := true
                    tracker.contactChildEpoch := child.openEpoch
                    if recrossByRange
                        recrossCandle := child
                        matchedTriggerEpoch := child.closeEpoch
                        if contactAtOpen
                            matched := true
                        else
                            sameChildAmbiguous := true
                else if tracker.contactSeen and recrossByRange
                    recrossCandle := child
                    matched := true
                    matchedTriggerEpoch := child.closeEpoch
        tracker.coverageEndEpoch := scanCutoffEpoch
        bool gapPresent = priorGap or not sliceContiguous
        int expectedChildCount = int((scanCutoffEpoch - tracker.anchorEpoch) / 60)
        bool fullLifecycleOrdered = tracker.armedAtBoundary and not gapPresent
        bool sameChild = not na(contactCandle.openEpoch) and not na(recrossCandle.openEpoch) and contactCandle.openEpoch == recrossCandle.openEpoch and contactCandle.closeEpoch == recrossCandle.closeEpoch
        HtfProofTranscriptV2 transcript = HtfProofTranscriptV2.new(
            tracker.contextMinutes,
            tracker.anchorEpoch,
            tracker.openTicks,
            scanCutoffEpoch,
            60,
            tracker.anchorEpoch,
            scanCutoffEpoch,
            expectedChildCount,
            observedThroughCutoff,
            gapPresent,
            fullLifecycleOrdered,
            tracker.destinationSeenBeforeContact,
            contactCandle,
            recrossCandle,
            sameChild
        )
        upsertHtfTranscript(zone, transcript)
        if matched or sameChildAmbiguous
            bool exactReplay = matched and fullLifecycleOrdered and expectedChildCount == observedThroughCutoff and not tracker.destinationSeenBeforeContact
            bool normalizedFromBreak = genericBreakSharesHtfEvent(zone, tracker.anchorEpoch, tracker.contextMinutes, matchedTriggerEpoch)
            string state = normalizedFromBreak ? CANDIDATE_NORMALIZED : (exactReplay ? CANDIDATE_MATCHED : CANDIDATE_BLOCKED)
            string normalizedFrom = normalizedFromBreak ? ENTRY_MODEL_LEGACY_BREAK : ""
            array<string> candidateClaims = htfFlipSourceClaims()
            array<string> ambiguityCodes = array.new<string>()
            array<string> failedRuleIds = array.new<string>()
            if sameChildAmbiguous
                array.push(ambiguityCodes, "SHADOW_SAME_CHILD_BAR_ORDER")
            if gapPresent or expectedChildCount != observedThroughCutoff
                array.push(ambiguityCodes, "SHADOW_MISSING_INTRABAR_COVERAGE")
            if tracker.destinationSeenBeforeContact
                array.push(failedRuleIds, "ENTRY_HTF_ZONE_SIDE_FIRST")
            string proofFidelity = exactReplay ? FIDELITY_EXACT : FIDELITY_UNRESOLVED
            string fidelity = entryCombineFidelity(proofFidelity, entryCommonFidelity(zone))
            array<string> passedRuleIds = exactReplay ? array.from("ENTRY_HTF_FLIP") : array.new<string>()
            array<string> evidenceClaims = htfEvidenceSourceClaims(normalizedFromBreak, not tracker.armedAtBoundary)
            [candidateRef, candidateAccepted, candidateAppended] = upsertHtfCandidateFromProof(
                zone,
                state,
                tracker.anchorEpoch,
                normalizedFrom,
                exactReplay,
                candidateClaims
            )
            EntryEvidenceV2 evidence = EntryEvidenceV2.new(
                "",
                candidateRef,
                matchedTriggerEpoch,
                tracker.openTicks,
                array.from(tracker.contextMinutes),
                fidelity,
                PROOF_LOWER_TIMEFRAME_REPLAY,
                60,
                tracker.anchorEpoch,
                scanCutoffEpoch,
                ambiguityCodes,
                passedRuleIds,
                failedRuleIds,
                evidenceClaims
            )
            evidence.localRef := htfEvidenceProofKey(transcript, evidence)
            if candidateAccepted
                bool evidenceAppended = appendOrMergeHtfEvidence(
                    zone,
                    evidence,
                    tracker.contextMinutes
                )
                if evidenceAppended and exactReplay
                    string attemptKind =
                      entryAttemptKindContainingEpoch(
                        zone,
                        matchedTriggerEpoch
                      )
                    if attemptKind == ATTEMPT_INITIAL
                        EntryHandlingV2 handling = EntryHandlingV2.new(candidateRef, evidence.localRef, HANDLING_INTRABAR_FLIP, attemptKind, matchedTriggerEpoch, tracker.openTicks, fidelity, array.copy(candidateClaims))
                        appendEntryHandling(zone, handling)
                    else
                        zone.entryCollectionOverflow := true
            tracker.candidateRecorded := true
        else
            tracker.coverageEndEpoch := epochSeconds(time_close)
    [tracker, matched]
```

Before scanning a zone on a confirmed bar, reset each tracker when its
seconds-valued anchor changes. Pass `armedAtBoundary=true` only when the setup
was already armed at the HTF opening boundary. Still scan a setup armed after
the boundary: a recognizable contact/recross becomes `BLOCKED/UNRESOLVED`, its
transcript has `fullLifecycleOrdered=false`, and its evidence appends
`SOURCE_HTF_BOUNDARY_CAUTION`. It is never silently discarded or upgraded to
exact. Scan 15, 30, and 60 contexts independently. Combine contexts through
`appendOrMergeHtfEvidence()` only when anchor, recross child close, fidelity,
coverage/counts, ambiguity/rule/source claims, lifecycle flags, opening ticks,
and full contact/recross candles are equivalent. Its proof key excludes only
the context number. Contexts sharing a boundary but crossing on different child
closes—or differing in any other proof field—remain separate evidence records
on the same candidate.

Order independence is mandatory. `upsertHtfCandidateFromProof()` compares raw
trigger-proof rank rather than effective common fidelity or scan order: an
exact/order-proven trigger outranks an ambiguous trigger, then `NORMALIZED`,
`MATCHED`, and `BLOCKED` break equal-trigger-proof ties. This raw bit is derived
from replay rule/ambiguity facts and is not exported as an authoritative
fidelity claim. Thus a later exact context upgrades a blocked first context even
though current common setup provenance makes both effective evidence rows
`UNRESOLVED`; a later ambiguous context cannot downgrade the exact trigger
observation. The semantic candidate is
still keyed only by `HTF_FLIP:anchor:1`; a different anchor is a later
first-model-wins event and cannot attach dependent evidence to the retained
candidate. The executable
`test_htf_projection_is_identical_for_all_six_context_orders` in Task 6 feeds
the same 15/30/60 observations in all six orders and asserts byte-identical
candidate state, sorted context arrays, and evidence partitioning. The frozen
vector comparison additionally asserts byte-identical selection.

The Python oracle must use the same intrabar predicates: demand recross is child
`high_ticks > htf_open_ticks`; supply recross is child
`low_ticks < htf_open_ticks`. A close-only predicate is not parity.

- [ ] **Step 6: Record missing coverage without synthesizing a candidate**

When `sliceCoverageExact` is false, use this exact confirmed-5m possibility
predicate:

```pine
int zoneBottomTicks = priceToEntryTicks(zone.bottom)
int zoneTopTicks = priceToEntryTicks(zone.top)
int parentHighTicks = priceToEntryTicks(high)
int parentLowTicks = priceToEntryTicks(low)
bool contactPossible = parentLowTicks <= zoneTopTicks and parentHighTicks >= zoneBottomTicks
bool recrossPossible = zone.demand ? parentHighTicks > tracker.openTicks : parentLowTicks < tracker.openTicks
bool flipPossible = contactPossible and recrossPossible
```

Implement the helper:

```pine
recordMissingCoverageHtfTranscript(RawZone zone, HtfFlipTrackerV2 tracker, int returnedChildCount) =>
    tracker.contactSeen := false
    tracker.contactChildEpoch := na
    int priorObservedCount = 0
    int priorIndex = findHtfTranscriptIndex(zone, tracker.contextMinutes)
    if not na(priorIndex)
        HtfProofTranscriptV2 prior = array.get(zone.htfTranscripts, priorIndex)
        if prior.htfOpenEpoch == tracker.anchorEpoch
            priorObservedCount := prior.observedChildCount
    int scanCutoffEpoch = epochSeconds(time_close)
    HtfProofTranscriptV2 transcript = HtfProofTranscriptV2.new(
        tracker.contextMinutes,
        tracker.anchorEpoch,
        tracker.openTicks,
        scanCutoffEpoch,
        60,
        tracker.anchorEpoch,
        scanCutoffEpoch,
        int((scanCutoffEpoch - tracker.anchorEpoch) / 60),
        priorObservedCount + returnedChildCount,
        true,
        false,
        tracker.destinationSeenBeforeContact,
        emptyCompactChild(),
        emptyCompactChild(),
        false
    )
    upsertHtfTranscript(zone, transcript)
```

Always call it when slice validation fails. It upserts the context transcript
with `gapPresent=true`,
`fullLifecycleOrdered=false`, `contactCandle=emptyCompactChild()`,
`recrossCandle=emptyCompactChild()`, and `sameChild=false`. Set
`scanCutoffEpoch=coverageEndEpoch=epochSeconds(time_close)`,
`expectedChildCount=(scanCutoffEpoch-tracker.anchorEpoch)/60`, and
`observedChildCount` to the actual number of returned children accumulated for
that boundary. It also clears `tracker.contactSeen` and
`tracker.contactChildEpoch`; a contact observed before a coverage gap may never
be paired with a recross observed after that gap.

At the confirmed-bar call site, dispatch exactly once:

```pine
if sliceCoverageExact
    [updatedTracker, matched] = scanHtfTrackerChildren(
        zone,
        tracker,
        true,
        childTimes,
        childCloseTimes,
        childOpens,
        childHighs,
        childLows,
        childCloses
    )
    tracker := updatedTracker
else
    tracker.coverageComplete := false
    tracker.coverageEndEpoch := epochSeconds(time_close)
    recordMissingCoverageHtfTranscript(zone, tracker, array.size(childTimes))
```

Do not call `scanHtfTrackerChildren()` for that context on the same bar after
the missing-coverage branch. This prevents a second upsert from restoring an
old child candle or synthesizing a candidate from a failed slice.

`flipPossible` may drive a local label stating
`SHADOW_MISSING_INTRABAR_COVERAGE`, but it never creates
`EntryCandidateV2`, `EntryEvidenceV2`, or `EntryHandlingV2`. With null contact
and recross children, Plan 1 transcript validation returns `matched=false`.
Parent 5m OHLC never synthesizes child ordering, a trigger epoch, or
normalization. A nonexact HTF candidate requires retained contact and recross
children, as in the same-child or boundary-shadow paths.

Freeze the existing oracle/vector case `htf-flip-partial-coverage` as: a valid
contact occurs, the next 5m slice has incomplete 1m coverage, and a later complete slice
contains a strict recross but no new contact. Require `matched=false`, no
`HTF_FLIP` candidate/evidence/handling, a gap transcript with null
contact/recross, and `coverage_end_epoch == scan_cutoff_epoch`. The Pine static
test above and the Plan 1 vector must both cover this exact chronology.

- [ ] **Step 7: Run Pine structure tests and Python oracle tests**

Run:

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py \
  tests/unit/test_rd_intrabar_oracle.py \
  tests/unit/test_rd_entry_matcher.py -v
```

Expected: all tests pass.

- [ ] **Step 8: Commit replayable HTF proof**

```bash
git add scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  tests/static/test_rd_multi_entry_pine.py
git commit -m "feat: add replayable Pine HTF flip proof"
```

### Task 4: Add an isolated realtime plane that can only produce shadow evidence

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine:inputs, realtime block, evidence append`
- Modify: `tests/static/test_rd_multi_entry_pine.py`

**Interfaces:**
- Consumes: the semantic HTF candidate local reference and per-context `varip` tracker fields.
- Produces: a separate bounded `RealtimeEntryObservationV2` diagnostic carrying
  only `SHADOW_REALTIME_ONLY_NOT_REPLAYABLE`; it never enters replay candidate,
  evidence, facts, arbitration, or terminal state.

- [ ] **Step 1: Write failing tests for realtime isolation**

Append:

```python
def test_realtime_plane_is_optional_varip_and_permanently_shadow() -> None:
    text = source()
    realtime = pine_function_body("observeRealtimeHtfFlip")
    assert 'observeRealtimeEntryTicks = input.bool(false' in text
    assert "varip bool realtimeContactSeen" in text
    assert "varip bool realtimeFlipSeen" in text
    assert "PROOF_REALTIME_TICK" in realtime
    assert "FIDELITY_UNRESOLVED" in realtime
    assert "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE" in realtime
    assert "FIDELITY_EXACT" not in realtime
    assert "PAPER_ELIGIBLE" not in realtime


def test_realtime_plane_does_not_mutate_replay_proof() -> None:
    realtime = pine_function_body("observeRealtimeHtfFlip")
    assert "appendRealtimeEntryObservation" in realtime
    assert "appendEntryCandidate" not in realtime
    assert "appendEntryEvidence" not in realtime
    assert "appendEntryHandling" not in realtime
    assert "closeEntryObservation" not in realtime
    assert "PROOF_LOWER_TIMEFRAME_REPLAY" not in realtime
    assert "array.set(zone.entryEvidence" not in realtime
    assert "array.push(zone.entryCandidates" not in realtime


def test_realtime_store_is_bounded_and_excluded_from_canonical_diagnostic() -> None:
    text = source()
    assert "type RealtimeEntryObservationV2" in text
    assert "varip array<RealtimeEntryObservationV2> realtimeEntryObservations" in text
    assert "varip bool realtimeEntryObservationSaturated" in text
    assert "ENTRY_MAX_REALTIME_OBSERVATIONS_PER_SETUP" in text
    append = pine_function_body("appendRealtimeEntryObservation")
    assert "existing.contextMinutes == observation.contextMinutes" in append
    assert "realtimeEntryObservationEquivalent" in append
    assert "array.set(" in append
    assert "zone.realtimeEntryObservations" in append
    assert "realtimeEntryObservationCorrelated" in append
    assert "not existingCorrelated" in append
    assert "entryNormalCollectionOpen(zone)" in pine_function_body(
        "observeRealtimeHtfFlip"
    )
```

- [ ] **Step 2: Run and verify realtime tests fail**

Run:

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py -k realtime -v
```

Expected: 3 failures for the absent input, isolated store, or function.

- [ ] **Step 3: Add the disabled-by-default input and realtime observer**

Add:

```pine
observeRealtimeEntryTicks = input.bool(false, "Observe realtime HTF ticks", group = "Automation", tooltip = "Diagnostic shadow evidence only. Realtime ticks are not replayable after reload.")
```

Add this separate UDT and `RawZone` field:

```pine
type RealtimeEntryObservationV2
    string localRef
    int contextMinutes
    int eventAnchorEpoch
    int observedTriggerEpoch
    int observedTriggerTicks
    string proofPlane
    string fidelity
    string ambiguityCode
    array<string> sourceClaimIds
```

Add to `RawZone`:

```pine
    varip array<RealtimeEntryObservationV2> realtimeEntryObservations
    varip bool realtimeEntryObservationSaturated
```

Initialize it with `array.new<RealtimeEntryObservationV2>()` and initialize
`realtimeEntryObservationSaturated=false`. Both fields are explicitly `varip`,
so object-field changes survive rollback across executions of the open realtime
bar. Add an idempotent `appendRealtimeEntryObservation()` keyed by context
minutes. Retain the latest uncorrelated anchor for each of exactly `15`, `30`,
and `60`; once an observation correlates to retained replay evidence, pin it
for the rest of the attempt rather than replacing it with a later uncorrelated
anchor. Accept an identical replay, reject a
conflicting observation at the same context/anchor, and never let repeated
anchors for one context consume all three slots. Overflow or conflict marks the
diagnostic store with `realtimeEntryObservationSaturated=true` but must not set
`entryCollectionOverflow`, because realtime diagnostics cannot suppress replay
exports.

Add:

```pine
realtimeEntryObservationEquivalent(
  RealtimeEntryObservationV2 left,
  RealtimeEntryObservationV2 right
) =>
    left.localRef == right.localRef and
      left.contextMinutes == right.contextMinutes and
      left.eventAnchorEpoch == right.eventAnchorEpoch and
      left.observedTriggerEpoch == right.observedTriggerEpoch and
      left.observedTriggerTicks == right.observedTriggerTicks and
      left.proofPlane == right.proofPlane and
      left.fidelity == right.fidelity and
      left.ambiguityCode == right.ambiguityCode and
      entryStringArrayKey(left.sourceClaimIds) ==
        entryStringArrayKey(right.sourceClaimIds)

realtimeEntryObservationCorrelated(
  RawZone zone,
  RealtimeEntryObservationV2 observation
) =>
    bool result = false
    int evidenceCount = array.size(zone.entryEvidence)
    if evidenceCount > 0
        for evidenceIndex = 0 to evidenceCount - 1
            EntryEvidenceV2 evidence = array.get(
                zone.entryEvidence,
                evidenceIndex
            )
            result := result or (
              evidence.candidateRef == observation.localRef and
              evidence.proofPlane == PROOF_LOWER_TIMEFRAME_REPLAY and
              array.includes(
                evidence.htfContextMinutes,
                observation.contextMinutes
              )
            )
    result

appendRealtimeEntryObservation(RawZone zone, RealtimeEntryObservationV2 observation) =>
    int retainedIndex = na
    int observationCount = array.size(zone.realtimeEntryObservations)
    if observationCount > 0
        for observationIndex = 0 to observationCount - 1
            RealtimeEntryObservationV2 existing = array.get(zone.realtimeEntryObservations, observationIndex)
            if na(retainedIndex) and
              existing.contextMinutes == observation.contextMinutes
                retainedIndex := observationIndex
    bool appended = false
    if not na(retainedIndex)
        RealtimeEntryObservationV2 existing = array.get(
            zone.realtimeEntryObservations,
            retainedIndex
        )
        bool existingCorrelated =
          realtimeEntryObservationCorrelated(zone, existing)
        if observation.eventAnchorEpoch > existing.eventAnchorEpoch and
          not existingCorrelated
            array.set(
                zone.realtimeEntryObservations,
                retainedIndex,
                observation
            )
            appended := true
        else if observation.eventAnchorEpoch == existing.eventAnchorEpoch and
          not realtimeEntryObservationEquivalent(existing, observation)
            zone.realtimeEntryObservationSaturated := true
    else
        if observationCount < ENTRY_MAX_REALTIME_OBSERVATIONS_PER_SETUP
            array.push(zone.realtimeEntryObservations, observation)
            appended := true
        else
            zone.realtimeEntryObservationSaturated := true
    appended

observeRealtimeHtfFlip(RawZone zone, HtfFlipTrackerV2 tracker) =>
    bool recorded = false
    if entryNormalCollectionOpen(zone) and observeRealtimeEntryTicks and barstate.isrealtime and tracker.armedAtBoundary and not tracker.realtimeFlipSeen
        int currentTicks = priceToEntryTicks(close)
        bool touchesZone = priceToEntryTicks(zone.bottom) <= currentTicks and currentTicks <= priceToEntryTicks(zone.top)
        bool crossesOpen = zone.demand ? currentTicks > tracker.openTicks : currentTicks < tracker.openTicks
        if touchesZone
            tracker.realtimeContactSeen := true
        else if tracker.realtimeContactSeen and crossesOpen
            tracker.realtimeFlipSeen := true
            array<string> claims = htfFlipSourceClaims()
            int anchorEpoch = tracker.anchorEpoch
            int tickEpoch = int(timenow / 1000)
            string localRef = entryCandidateLocalRef(ENTRY_MODEL_HTF_FLIP, anchorEpoch, 1)
            RealtimeEntryObservationV2 observation = RealtimeEntryObservationV2.new(
                localRef,
                tracker.contextMinutes,
                anchorEpoch,
                tickEpoch,
                currentTicks,
                PROOF_REALTIME_TICK,
                FIDELITY_UNRESOLVED,
                "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE",
                claims
            )
            recorded := appendRealtimeEntryObservation(zone, observation)
    [tracker, recorded]
```

Invoke this function outside the `barstate.isconfirmed` block so it can observe
multiple realtime executions. Reset `varip` fields only on a new HTF anchor. Do
not call `collectDirectionalCloseCandidate()` or the replay scanner from the
realtime block. Realtime and replay evidence for the same HTF boundary must use
the same `entryCandidateLocalRef(ENTRY_MODEL_HTF_FLIP, anchorEpoch, 1)`;
realtime arrival time belongs only in the isolated observation and never
changes semantic candidate identity. The realtime observation has
`normalized_from=null`; only a
confirmed generic-break fact and replay proof sharing boundary and recross may
set normalization. Never read `realtimeEntryObservations` from facts,
per-model dedupe, terminal transitions, replay
evidence, handling, or `diagnosticEntrySelectionPayload()`. It may be displayed
in a clearly labeled on-chart realtime diagnostic. Task 5 also transports a
bounded observation in diagnostic `e[]` only after replay facts independently
created the same semantic candidate reference and retained replay evidence for
that exact HTF context; candidate-only, different-context, and unmatched
realtime-only
observations remain on-chart only. The edge partitions those rows from replay
parity. They are absent from historical Bar Replay capture and can never become
authoritative facts, evidence, terminal state, or selection input.

- [ ] **Step 4: Run realtime and safety tests**

Run:

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py \
  -k "realtime or execution_surface" -v
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit the shadow realtime plane**

```bash
git add scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  tests/static/test_rd_multi_entry_pine.py
git commit -m "feat: observe realtime flips as shadow evidence"
```

### Task 5: Emit compact schema-2.0 setup bundles with deterministic chunks

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine:JSON helpers, collection, snapshot/incremental envelopes, emission`
- Modify: `tests/static/test_rd_multi_entry_pine.py`

**Interfaces:**
- Consumes: bounded authoritative facts/transcripts, diagnostic candidates,
  evidence, handling, setup identity, and the schema-2.0 edge contract.
- Produces: `setupEntryBundlePayload()`, `buildEntryChunks()`, `entryExportEnvelope()`, and `diagnosticEntrySelectionPayload()`.

The compact bundle wire contract is:

```text
bundle.s               setup ID
bundle.d               LONG or SHORT
bundle.f               authoritative proof-input facts
facts.zb               zone bottom in integer ticks
facts.zt               zone top in integer ticks
facts.ge               engagement epoch or null
facts.iv               invalidated-before-entry boolean
facts.cf               EXACT or UNRESOLVED common fidelity
facts.ak               INITIAL
facts.tr               terminal reason or null
facts.te               terminal epoch or null
facts.b[]              rolling post-engagement confirmed-5m facts, 1 to 4
facts.ng               nullable isolated next-candle grace fact
confirmed.oe           open epoch
confirmed.ce           close epoch
confirmed.o/h/l/c      OHLC integer ticks
confirmed.gb           generic-break fact
confirmed.rr           rejection/respect fact
grace.oe/ce/o/h/l/c    immediate next-bar epochs and OHLC ticks
grace.ak               attempt kind inherited from the prior DIR close
facts.x[]              HTF proof transcripts, maximum 3
transcript.m           15, 30, or 60 context minutes
transcript.ae          HTF opening epoch
transcript.ao          HTF opening ticks
transcript.cu          scan cutoff epoch
transcript.rs          proof resolution seconds
transcript.cs/ce       coverage start/end epoch
transcript.ec/oc       expected/observed child counts
transcript.gp          coverage-gap boolean
transcript.lo          full-lifecycle-ordered boolean
transcript.db          destination-seen-before-contact boolean
transcript.cc          contact child candle or null
transcript.rc          recross child candle or null
transcript.sb          same-child boolean
child.oe/ce/o/h/l/c    child open/close epoch and OHLC ticks
bundle.c[]             diagnostic candidates
candidate.i            local candidate index
candidate.m            model
candidate.st           candidate state
candidate.a            event anchor epoch
candidate.o            trigger ordinal
candidate.n            normalized-from model or null
candidate.sc[]         official source claim IDs
bundle.e[]             diagnostic evidence
evidence.i             local evidence index
evidence.ci            referenced local candidate index
evidence.t             observed trigger epoch
evidence.px            observed trigger ticks
evidence.h[]           HTF context minutes
evidence.f             fidelity
evidence.p             proof plane
evidence.r             proof resolution seconds
evidence.cs            coverage start epoch
evidence.ce            coverage end epoch
evidence.ac[]          ambiguity codes
evidence.pr[]          passed rule IDs
evidence.fr[]          failed rule IDs
evidence.sc[]          official source claim IDs
realtime evidence      same e[] shape with p=REALTIME_TICK, r=0,
                       f=UNRESOLVED, one h context, and permanent
                       SHADOW_REALTIME_ONLY_NOT_REPLAYABLE ambiguity
bundle.h[]             diagnostic handling observations
handling.ci            referenced local candidate index
handling.ei            referenced local evidence index
handling.m             handling mode
handling.a             attempt kind
handling.t             observation epoch
handling.px            observation ticks
handling.f             fidelity
handling.sc[]          official source claim IDs
bundle.q               diagnostic selection
selection.v            PINE_DIAGNOSTIC_ONLY
selection.k            selected semantic local key or null
selection.m            selected model or null
selection.a            selected event anchor epoch or null
selection.o            selected trigger ordinal or null
selection.r            closed selection reason
selection.f            selected replayable fidelity or null
selection.x            SHADOW_ONLY or NONE
```

`f` is the only matcher input accepted from Pine. The edge validates it and
reconstructs candidate, evidence, handling, and selection identities. `c`,
`e`, `h`, and `q` are parity diagnostics; disagreement is recorded but can
never replace edge reconstruction.

`f.ak`, every diagnostic `c[].o`, every `h[].a`, and non-null `q.o` are closed
initial-only values: `INITIAL`, `1`, `INITIAL`, and `1`, respectively. The
comparator propagates `f.ak` into `EntryMatchRequest.attempt_kind`, propagates
`c[].o` into candidate identity, and propagates `h[].a` into handling identity;
it never substitutes defaults for missing wire values. `f.ng.ak` must equal
the prior DIR-close fact's `attemptKind`, and the derived
`NEXT_CANDLE_WICK` handling inherits that value.

`f.ng` is normally `null`. It is non-null only on the one permitted
post-terminal handling grace event: the preceding normal event terminalized
with `BOTH_ACTIVE_MODELS_OBSERVED`, newly added `DIR_CLOSE`, and has
`te == ng.oe`; `ng.ce == ng.oe + 300` equals the grace envelope close.
The grace event repeats the immutable terminal pair and retained diagnostic
objects, may add only the deterministic `NEXT_CANDLE_WICK` handling row, and
must leave candidates, evidence, selection, and `f.b` byte-identical to the
terminal event. Pine itself never re-enters the matcher for `ng`. Plan 2
validates `ng` and
projects it into the ordinary Plan-1-shaped internal grace event solely so the
Edge/Python stream can derive the same handling row; that projection carries
empty trigger inputs and never enters normal matching or arbitration.

For `x[].cc` and `x[].rc`, a child candle is exactly the named object
`{"oe":int,"ce":int,"o":int,"h":int,"l":int,"c":int}`. When contact and
recross occur in one child, repeat the exact same object in both fields and set
`sb=true`. Otherwise set `sb=false`; a fact not observed is JSON `null`. The
edge rejects `sb` unless both candle intervals are identical and recomputes
contact-at-open, contact-by-range, and recross from the candle OHLC and zone
bounds.

- [ ] **Step 1: Write failing wire and chunking tests**

Append:

```python
def test_schema_20_bundle_has_compact_closed_fields() -> None:
    bundle = pine_function_body("setupEntryBundlePayload")
    for key in ('\\"s\\":', '\\"d\\":', '\\"f\\":', '\\"c\\":', '\\"e\\":', '\\"h\\":', '\\"q\\":'):
        assert key in bundle
    facts = pine_function_body("entryAuthoritativeFactsPayload")
    for key in ('\\"zb\\":', '\\"zt\\":', '\\"ge\\":', '\\"iv\\":', '\\"cf\\":', '\\"ak\\":', '\\"tr\\":', '\\"te\\":', '\\"b\\":', '\\"ng\\":', '\\"x\\":'):
        assert key in facts
    assert "joinCurrentHtfTranscriptPayloads" in facts
    grace = pine_function_body("nextCandleWickGracePayload")
    for key in ('\\"oe\\":', '\\"ce\\":', '\\"o\\":', '\\"h\\":', '\\"l\\":', '\\"c\\":', '\\"ak\\":'):
        assert key in grace
    transcript = pine_function_body("htfTranscriptPayload")
    for key in ('\\"m\\":', '\\"ae\\":', '\\"ao\\":', '\\"cu\\":', '\\"rs\\":', '\\"cs\\":', '\\"ce\\":', '\\"ec\\":', '\\"oc\\":', '\\"gp\\":', '\\"lo\\":', '\\"db\\":', '\\"cc\\":', '\\"rc\\":', '\\"sb\\":'):
        assert key in transcript
    candidate = pine_function_body("entryCandidatePayload")
    for key in ('\\"i\\":', '\\"m\\":', '\\"st\\":', '\\"a\\":', '\\"o\\":', '\\"n\\":', '\\"sc\\":'):
        assert key in candidate
    evidence = pine_function_body("entryEvidencePayload")
    for key in ('\\"i\\":', '\\"ci\\":', '\\"t\\":', '\\"px\\":', '\\"h\\":', '\\"f\\":', '\\"p\\":', '\\"r\\":', '\\"cs\\":', '\\"ce\\":', '\\"ac\\":', '\\"pr\\":', '\\"fr\\":', '\\"sc\\":'):
        assert key in evidence
    handling = pine_function_body("entryHandlingPayload")
    for key in ('\\"ci\\":', '\\"ei\\":', '\\"m\\":', '\\"a\\":', '\\"t\\":', '\\"px\\":', '\\"f\\":', '\\"sc\\":'):
        assert key in handling


def test_initial_only_values_are_carried_not_defaulted() -> None:
    facts = pine_function_body("entryAuthoritativeFactsPayload")
    candidate = pine_function_body("entryCandidatePayload")
    handling = pine_function_body("entryHandlingPayload")
    selection = pine_function_body("diagnosticEntrySelectionPayload")
    assert "entrySetupAttemptKind(zone)" in facts
    assert "candidate.triggerOrdinal" in candidate
    assert "handling.attemptKind" in handling
    assert "selected.triggerOrdinal" in selection
    assert '\\"ak\\":\\"INITIAL\\"' not in facts


def test_post_terminal_grace_is_handling_only_and_one_shot() -> None:
    valid = pine_function_body("entryAuthoritativeFactsValid")
    payload = pine_function_body("entryAuthoritativeFactsPayload")
    scheduled = pine_function_body("emitScheduledEntryBatch")
    assert "entryNextCandleWickGraceFact" in valid
    assert "ENTRY_TERMINAL_BOTH_ACTIVE" in valid
    assert "grace.openEpoch == zone.entryTerminalEpoch" in valid
    assert "grace.closeEpoch == grace.openEpoch + 300" in valid
    assert "nextCandleWickGracePayload" in payload
    assert "entryNextCandleWickGraceTransportEmitted" in scheduled
    assert "entryNextCandleWickGraceConsumed" in scheduled


def test_selection_is_diagnostic_only() -> None:
    selection = pine_function_body("diagnosticEntrySelectionPayload")
    assert "PINE_DIAGNOSTIC_ONLY" in selection
    for key in ('\\"v\\":', '\\"k\\":', '\\"m\\":', '\\"a\\":', '\\"o\\":', '\\"r\\":', '\\"f\\":', '\\"x\\":'):
        assert key in selection
    assert "SHADOW_ONLY" in selection
    assert "NONE" in selection
    assert "PAPER_ELIGIBLE" not in selection
    assert "REAL_EXECUTION" not in selection
    assert "candidate_id" not in selection
    assert "evidence_id" not in selection
    assert "realtimeEntryObservations" not in selection


def test_chunks_are_built_before_emit_and_never_split_bundles() -> None:
    build = pine_function_body("buildEntryChunks")
    emit = pine_function_body("emitEntryBatch")
    assert "ENTRY_EXPORT_MAX_PAYLOAD_CHARS" in build
    assert "ENTRY_EXPORT_MAX_CHUNKS" in build
    assert "ENTRY_EXPORT_MAX_SETUP_BUNDLES" in build
    assert "SETUP_EXPORT_BUNDLE_TOO_LARGE" in build
    assert "array.push(currentChunkBundles, bundle)" in build
    assert "str.substring(bundle" not in build
    assert "entryAuthoritativeFactsPayload" in source()
    assert "buildEntryChunks" in emit
    assert emit.index("buildEntryChunks") < emit.index("alert(")
    assert "chunkCount = array.size(chunks)" in emit
    assert "entryExportEnvelope" in emit


def test_top_level_payload_uses_eb_inside_credential_envelope() -> None:
    payload = pine_function_body("entryExportPayload")
    envelope = pine_function_body("entryExportEnvelope")
    assert '\\"eb\\":[' in payload
    assert '\\"bundles\\":' not in payload
    assert '\\"credential\\":' in envelope
    assert "jsonString(setupExportCredential)" in envelope
    assert '\\"payload\\":' in envelope
    assert "setupExportCredential" not in payload


def test_correlated_realtime_observations_use_diagnostic_evidence_only() -> None:
    join = pine_function_body("joinRealtimeEntryEvidencePayloads")
    payload = pine_function_body("realtimeEntryEvidencePayload")
    assert "realtimeEntryObservations" in join
    assert "orderedCandidateIndex" in join
    assert "realtimeEntryObservationCorrelated" in join
    assert "ENTRY_MAX_EVIDENCE_PER_SETUP" in join
    assert "PROOF_REALTIME_TICK" in payload
    assert "SHADOW_REALTIME_ONLY_NOT_REPLAYABLE" in payload
    assert "entryAuthoritativeFactsPayload" not in join
    assert "appendEntryEvidence" not in join


def test_all_export_helpers_have_executable_bodies() -> None:
    for helper in (
        "entryAuthoritativeFactsValid",
        "entryChunkEstimatedChars",
        "orderedEntryCandidates",
        "joinEntryCandidatePayloads",
        "joinEntryEvidencePayloads",
        "joinRealtimeEntryEvidencePayloads",
        "joinEntryHandlingPayloads",
        "joinConfirmedEntryFactPayloads",
        "joinSetupBundles",
        "jsonStringArray",
        "jsonIntArray",
        "diagnosticSelectedCandidateIndex",
        "diagnosticSelectionReason",
        "diagnosticCandidateFidelity",
        "setupExportSetupId",
    ):
        assert len(pine_function_body(helper).strip()) > 20


def test_chunk_identity_is_semantic_and_index_derived() -> None:
    context = pine_function_body("entryExportContextFields")
    assert "setupExportProducerInstanceId" in context
    assert '\\"sequence\\":' in context
    assert '\\"kind\\":' in context
    assert '\\"bar_close_epoch\\":' in context
    assert '\\"chunk_index\\":' in context
    assert '\\"chunk_count\\":' in context
    assert '\\"batch_id\\":' not in context


def test_export_kinds_and_hashes_are_closed_and_fail_closed() -> None:
    text = source()
    assert 'entryDetectorCodeHash = input.string("",' in text
    assert 'entrySettingsHash = input.string("",' in text
    assert 'kind == "snapshot" or kind == "incremental"' in text
    assert "entryLowerHexDigestValid" in text
    assert "str.length(value) == 64" in pine_function_body("entryLowerHexDigestValid")
    context = pine_function_body("entryExportContextFields")
    assert "setupContractDigestLabel" not in context
    assert "entryDetectorCodeHash" in context
    assert "entrySettingsHash" in context


def test_entry_string_order_covers_the_closed_identifier_alphabet() -> None:
    ordering = pine_function_body("entryStringBefore")
    assert (
        '" +-.0123456789:@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz|"'
        in ordering
    )


def test_terminal_and_eviction_bundles_are_coalesced_once_per_bar() -> None:
    eviction = pine_function_body("evictEntryZoneAfterTerminalSnapshot")
    scheduled = pine_function_body("emitScheduledEntryBatch")
    assert "ENTRY_TERMINAL_RETENTION_EVICTED" in eviction
    assert "appendUniqueEntryZoneIndex(terminalZoneIndexes, zoneIndex)" in eviction
    assert "appendUniqueEntryZoneIndex(archivedRemovalZoneIndexes, zoneIndex)" in eviction
    assert "array.remove(zones" not in eviction
    assert "emitEntryBatch" not in eviction
    assert "emitEntryBatch" in scheduled
    assert scheduled.count("emitEntryBatch") == 1
    assert '"snapshot"' in scheduled
    assert "entryTerminalSnapshotEmitted" in scheduled
    assert "not zone.entryTerminalSnapshotEmitted" in scheduled
    assert "localRemovalZoneIndexes" in scheduled
    assert "for zoneIndex = zoneCount - 1 to 0" in scheduled
    assert scheduled.index("emitEntryBatch") < scheduled.index("array.remove")


def test_v3_removes_every_inherited_alert_emitter() -> None:
    text = source()
    assert "emitSetupExportSnapshot" not in text
    assert "emitSetupExportIncremental" not in text
    assert "setupExportSnapshotPayload" not in text
    assert "setupExportIncrementalPayload" not in text
    assert "alert(batchPayload" not in text
    assert text.count("alert(") == 1


def test_confirmed_bar_delivery_marks_facts_and_schedules_once() -> None:
    text = source()
    collect = pine_function_body("collectConfirmedEntryFact")
    assert "factAppended := appendEntryConfirmedFact(zone, fact)" in collect
    assert "if factAppended and not zone.entryTerminalSnapshotEmitted" in text
    assert "appendUniqueEntryZoneIndex(changedZoneIndexes, zoneIndex)" in text
    assert "if terminalNow" in text
    assert "appendUniqueEntryZoneIndex(terminalZoneIndexes, zoneIndex)" in text
    assert text.count("emitScheduledEntryBatch(") == 2  # definition + one call
    assert (
        "barstate.isconfirmed and isFiveMinute and validationReady"
        in text
    )
    assert "if entryExportReady" in text


def test_htf_wire_excludes_transcripts_outside_rolling_bar_window() -> None:
    window = pine_function_body("joinCurrentHtfTranscriptPayloads")
    validation = pine_function_body("entryAuthoritativeFactsValid")
    ordering = pine_function_body("orderedHtfTranscripts")
    assert "current.contextMinutes" in ordering
    assert "orderedHtfTranscripts(transcripts)" in window
    assert "orderedHtfTranscripts(zone.htfTranscripts)" in validation
    assert "fact.openEpoch < transcript.scanCutoffEpoch" in window
    assert "transcript.scanCutoffEpoch <= fact.closeEpoch" in window
    assert "if cutoffContained" in window
    assert "htfTranscriptPayload(transcript)" in window
```

- [ ] **Step 2: Run and verify serialization tests fail**

Run:

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py \
  -k "schema_20 or diagnostic_only or chunks or top_level_payload or export_helpers or chunk_identity or export_kinds or terminal_and_eviction or inherited_alert or htf_wire" -v
```

Expected: 10 failures for absent V3 export, hash, rolling-window,
legacy-emitter removal, or terminal-snapshot functions.

Before adding schema 2.0, remove every inherited V2 alert emitter and call site
from the V3 file only: `emitSetupExportSnapshot`,
`emitSetupExportIncremental`, their schema-1.x payload builders, and the
separate inherited `alert(batchPayload, ...)` path. Preserve the byte-frozen V2
file. After this task, the only `alert(` call in V3 is inside
`emitEntryBatch()`; Pine Logs used for parity are emitted with logging APIs, not
alerts. This prevents one V3 TradingView alert from sending legacy and schema-2
payloads to the same endpoint or exceeding the one-semantic-batch-per-close
contract.

- [ ] **Step 3: Implement deterministic candidate/evidence/handling serialization**

Canonical candidate order is:

```pine
entryModelOrder() =>
    array.from(ENTRY_MODEL_DIR_CLOSE, ENTRY_MODEL_HTF_FLIP, ENTRY_MODEL_LEGACY_BREAK, ENTRY_MODEL_LEGACY_REJECTION)
```

Within one model, order by `eventAnchorEpoch`, `triggerOrdinal`, then `localRef`.
Evidence order is referenced candidate index, proof-plane value, coverage start,
coverage end, trigger epoch, then local reference. Handling order is referenced
candidate index, referenced evidence index, observation epoch, then handling
mode.

Implement:

```pine
jsonStringArray(array<string> values) =>
    string result = "["
    int valueCount = array.size(values)
    if valueCount > 0
        for valueIndex = 0 to valueCount - 1
            result += (valueIndex == 0 ? "" : ",") +
              jsonString(array.get(values, valueIndex))
    result + "]"

jsonIntArray(array<int> values) =>
    string result = "["
    int valueCount = array.size(values)
    if valueCount > 0
        for valueIndex = 0 to valueCount - 1
            result += (valueIndex == 0 ? "" : ",") +
              str.tostring(array.get(values, valueIndex))
    result + "]"

entryModelRank(string model) =>
    model == ENTRY_MODEL_DIR_CLOSE ? 0 :
     model == ENTRY_MODEL_HTF_FLIP ? 1 :
     model == ENTRY_MODEL_LEGACY_BREAK ? 2 : 3

entryStringBefore(string left, string right) =>
    // Exact ASCII order for every character allowed by
    // setupContractIdentifier() plus the proof-key separators.
    const string alphabet = " +-.0123456789:@ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz|"
    bool result = false
    bool decided = false
    int sharedLength = math.min(str.length(left), str.length(right))
    if sharedLength > 0
        for charIndex = 0 to sharedLength - 1
            if not decided
                int leftRank = str.pos(
                    alphabet,
                    str.substring(left, charIndex, charIndex + 1)
                )
                int rightRank = str.pos(
                    alphabet,
                    str.substring(right, charIndex, charIndex + 1)
                )
                if leftRank != rightRank
                    result := leftRank < rightRank
                    decided := true
    if not decided
        result := str.length(left) < str.length(right)
    result

entryCandidateBefore(EntryCandidateV2 left, EntryCandidateV2 right) =>
    int leftModel = entryModelRank(left.model)
    int rightModel = entryModelRank(right.model)
    leftModel != rightModel ? leftModel < rightModel :
     left.eventAnchorEpoch != right.eventAnchorEpoch ?
       left.eventAnchorEpoch < right.eventAnchorEpoch :
     left.triggerOrdinal != right.triggerOrdinal ?
       left.triggerOrdinal < right.triggerOrdinal :
     entryStringBefore(left.localRef, right.localRef)

orderedEntryCandidates(RawZone zone) =>
    array<EntryCandidateV2> ordered = array.copy(zone.entryCandidates)
    int count = array.size(ordered)
    if count > 1
        for sourceIndex = 1 to count - 1
            EntryCandidateV2 current = array.get(ordered, sourceIndex)
            int cursor = sourceIndex - 1
            while cursor >= 0
                EntryCandidateV2 previous = array.get(ordered, cursor)
                if entryCandidateBefore(current, previous)
                    array.set(ordered, cursor + 1, previous)
                    cursor -= 1
                else
                    break
            array.set(ordered, cursor + 1, current)
    ordered

orderedCandidateIndex(array<EntryCandidateV2> candidates, string localRef) =>
    int result = na
    int count = array.size(candidates)
    if count > 0
        for index = 0 to count - 1
            if na(result) and array.get(candidates, index).localRef == localRef
                result := index
    result

entrySortEpoch(int value) =>
    na(value) ? 2147483647 : value

entryEvidenceBefore(EntryEvidenceV2 left, EntryEvidenceV2 right, array<EntryCandidateV2> candidates) =>
    int leftCandidate = orderedCandidateIndex(candidates, left.candidateRef)
    int rightCandidate = orderedCandidateIndex(candidates, right.candidateRef)
    int leftTrigger = entrySortEpoch(left.observedTriggerEpoch)
    int rightTrigger = entrySortEpoch(right.observedTriggerEpoch)
    leftCandidate != rightCandidate ? leftCandidate < rightCandidate :
     left.proofPlane != right.proofPlane ?
       entryStringBefore(left.proofPlane, right.proofPlane) :
     left.coverageStartEpoch != right.coverageStartEpoch ?
       left.coverageStartEpoch < right.coverageStartEpoch :
     left.coverageEndEpoch != right.coverageEndEpoch ?
       left.coverageEndEpoch < right.coverageEndEpoch :
     leftTrigger != rightTrigger ? leftTrigger < rightTrigger :
     entryStringBefore(left.localRef, right.localRef)

orderedEntryEvidence(RawZone zone, array<EntryCandidateV2> candidates) =>
    array<EntryEvidenceV2> ordered = array.copy(zone.entryEvidence)
    int count = array.size(ordered)
    if count > 1
        for sourceIndex = 1 to count - 1
            EntryEvidenceV2 current = array.get(ordered, sourceIndex)
            int cursor = sourceIndex - 1
            while cursor >= 0
                EntryEvidenceV2 previous = array.get(ordered, cursor)
                if entryEvidenceBefore(current, previous, candidates)
                    array.set(ordered, cursor + 1, previous)
                    cursor -= 1
                else
                    break
            array.set(ordered, cursor + 1, current)
    ordered

orderedEvidenceIndex(array<EntryEvidenceV2> evidence, string localRef) =>
    int result = na
    int count = array.size(evidence)
    if count > 0
        for index = 0 to count - 1
            if na(result) and array.get(evidence, index).localRef == localRef
                result := index
    result

entryHandlingBefore(EntryHandlingV2 left, EntryHandlingV2 right, array<EntryCandidateV2> candidates, array<EntryEvidenceV2> evidence) =>
    int leftCandidate = orderedCandidateIndex(candidates, left.candidateRef)
    int rightCandidate = orderedCandidateIndex(candidates, right.candidateRef)
    int leftEvidence = orderedEvidenceIndex(evidence, left.evidenceRef)
    int rightEvidence = orderedEvidenceIndex(evidence, right.evidenceRef)
    leftCandidate != rightCandidate ? leftCandidate < rightCandidate :
     leftEvidence != rightEvidence ? leftEvidence < rightEvidence :
     left.observedEpoch != right.observedEpoch ?
       left.observedEpoch < right.observedEpoch :
     entryStringBefore(left.handlingMode, right.handlingMode)

orderedEntryHandling(RawZone zone, array<EntryCandidateV2> candidates, array<EntryEvidenceV2> evidence) =>
    array<EntryHandlingV2> ordered = array.copy(zone.entryHandling)
    int count = array.size(ordered)
    if count > 1
        for sourceIndex = 1 to count - 1
            EntryHandlingV2 current = array.get(ordered, sourceIndex)
            int cursor = sourceIndex - 1
            while cursor >= 0
                EntryHandlingV2 previous = array.get(ordered, cursor)
                if entryHandlingBefore(current, previous, candidates, evidence)
                    array.set(ordered, cursor + 1, previous)
                    cursor -= 1
                else
                    break
            array.set(ordered, cursor + 1, current)
    ordered

nullableEntryInt(int value) =>
    na(value) ? "null" : str.tostring(value)

entryCandidatePayload(EntryCandidateV2 candidate, int localIndex) =>
    "{" +
     "\"i\":" + str.tostring(localIndex) + "," +
     "\"m\":" + jsonString(candidate.model) + "," +
     "\"st\":" + jsonString(candidate.state) + "," +
     "\"a\":" + str.tostring(candidate.eventAnchorEpoch) + "," +
     "\"o\":" + str.tostring(candidate.triggerOrdinal) + "," +
     "\"n\":" + (str.length(candidate.normalizedFrom) == 0 ? "null" : jsonString(candidate.normalizedFrom)) + "," +
     "\"sc\":" + jsonStringArray(candidate.sourceClaimIds) + "}"

entryEvidencePayload(EntryEvidenceV2 evidence, int localIndex, int candidateIndex) =>
    "{" +
     "\"i\":" + str.tostring(localIndex) + "," +
     "\"ci\":" + str.tostring(candidateIndex) + "," +
     "\"t\":" + nullableEntryInt(evidence.observedTriggerEpoch) + "," +
     "\"px\":" + nullableEntryInt(evidence.observedTriggerTicks) + "," +
     "\"h\":" + jsonIntArray(evidence.htfContextMinutes) + "," +
     "\"f\":" + jsonString(evidence.fidelity) + "," +
     "\"p\":" + jsonString(evidence.proofPlane) + "," +
     "\"r\":" + str.tostring(evidence.proofResolutionSeconds) + "," +
     "\"cs\":" + str.tostring(evidence.coverageStartEpoch) + "," +
     "\"ce\":" + str.tostring(evidence.coverageEndEpoch) + "," +
     "\"ac\":" + jsonStringArray(evidence.ambiguityCodes) + "," +
     "\"pr\":" + jsonStringArray(evidence.passedRuleIds) + "," +
     "\"fr\":" + jsonStringArray(evidence.failedRuleIds) + "," +
     "\"sc\":" + jsonStringArray(evidence.sourceClaimIds) + "}"

entryHandlingPayload(EntryHandlingV2 handling, int candidateIndex, int evidenceIndex) =>
    "{" +
     "\"ci\":" + str.tostring(candidateIndex) + "," +
     "\"ei\":" + str.tostring(evidenceIndex) + "," +
     "\"m\":" + jsonString(handling.handlingMode) + "," +
     "\"a\":" + jsonString(handling.attemptKind) + "," +
     "\"t\":" + str.tostring(handling.observedEpoch) + "," +
     "\"px\":" + nullableEntryInt(handling.observedTicks) + "," +
     "\"f\":" + jsonString(handling.fidelity) + "," +
     "\"sc\":" + jsonStringArray(handling.sourceClaimIds) + "}"

joinEntryCandidatePayloads(array<EntryCandidateV2> candidates) =>
    string result = ""
    int count = array.size(candidates)
    if count > 0
        for index = 0 to count - 1
            result += (index == 0 ? "" : ",") +
              entryCandidatePayload(array.get(candidates, index), index)
    result

joinEntryEvidencePayloads(RawZone zone, array<EntryCandidateV2> candidates) =>
    string result = ""
    array<EntryEvidenceV2> evidence = orderedEntryEvidence(zone, candidates)
    int count = array.size(evidence)
    if count > 0
        for index = 0 to count - 1
            EntryEvidenceV2 item = array.get(evidence, index)
            int candidateIndex = orderedCandidateIndex(candidates, item.candidateRef)
            if na(candidateIndex)
                zone.entryCollectionOverflow := true
            else
                result += (str.length(result) == 0 ? "" : ",") +
                  entryEvidencePayload(item, index, candidateIndex)
    result

realtimeEntryEvidencePayload(RealtimeEntryObservationV2 observation, int localIndex, int candidateIndex) =>
    "{" +
     "\"i\":" + str.tostring(localIndex) + "," +
     "\"ci\":" + str.tostring(candidateIndex) + "," +
     "\"t\":" + str.tostring(observation.observedTriggerEpoch) + "," +
     "\"px\":" + str.tostring(observation.observedTriggerTicks) + "," +
     "\"h\":[" + str.tostring(observation.contextMinutes) + "]," +
     "\"f\":" + jsonString(FIDELITY_UNRESOLVED) + "," +
     "\"p\":" + jsonString(PROOF_REALTIME_TICK) + "," +
     "\"r\":0," +
     "\"cs\":" + str.tostring(observation.observedTriggerEpoch) + "," +
     "\"ce\":" + str.tostring(observation.observedTriggerEpoch) + "," +
     "\"ac\":[" +
       jsonString("SHADOW_REALTIME_ONLY_NOT_REPLAYABLE") + "]," +
     "\"pr\":[]," +
     "\"fr\":[\"ENTRY_HTF_FLIP\"]," +
     "\"sc\":" + jsonStringArray(observation.sourceClaimIds) + "}"

joinRealtimeEntryEvidencePayloads(RawZone zone, array<EntryCandidateV2> candidates, int firstLocalIndex) =>
    string result = ""
    int nextLocalIndex = firstLocalIndex
    int observationCount = array.size(zone.realtimeEntryObservations)
    if observationCount > 0
        for observationIndex = 0 to observationCount - 1
            RealtimeEntryObservationV2 observation = array.get(
                zone.realtimeEntryObservations,
                observationIndex
            )
            int candidateIndex = orderedCandidateIndex(
                candidates,
                observation.localRef
            )
            bool correlated = not na(candidateIndex) and
              realtimeEntryObservationCorrelated(zone, observation)
            bool withinWireBound =
              nextLocalIndex < ENTRY_MAX_EVIDENCE_PER_SETUP
            if correlated and withinWireBound
                result += (str.length(result) == 0 ? "" : ",") +
                  realtimeEntryEvidencePayload(
                    observation,
                    nextLocalIndex,
                    candidateIndex
                  )
                nextLocalIndex += 1
    result

joinEntryHandlingPayloads(RawZone zone, array<EntryCandidateV2> candidates) =>
    string result = ""
    array<EntryEvidenceV2> evidence = orderedEntryEvidence(zone, candidates)
    array<EntryHandlingV2> handling = orderedEntryHandling(
        zone,
        candidates,
        evidence
    )
    int count = array.size(handling)
    if count > 0
        for index = 0 to count - 1
            EntryHandlingV2 item = array.get(handling, index)
            int candidateIndex = orderedCandidateIndex(candidates, item.candidateRef)
            int evidenceIndex = orderedEvidenceIndex(evidence, item.evidenceRef)
            bool referenceValid = not na(candidateIndex) and not na(evidenceIndex)
            if referenceValid
                EntryEvidenceV2 referenced = array.get(evidence, evidenceIndex)
                referenceValid := referenced.candidateRef == item.candidateRef
            if not referenceValid
                zone.entryCollectionOverflow := true
            else
                result += (str.length(result) == 0 ? "" : ",") +
                  entryHandlingPayload(item, candidateIndex, evidenceIndex)
    result
```

`jsonStringArray()` and `jsonIntArray()` must emit `[]` for empty arrays and may
not add whitespace. Build local-reference-to-index maps from both sorted
candidate and sorted evidence lists. Reject an evidence whose candidate
reference is absent. Reject a handling record unless both its candidate and
evidence references resolve and the referenced evidence points to that same
candidate. These checks are required before any batch chunk is emitted.
Append correlated realtime observations after the sorted replay evidence, using
the next dense `i`. Keep the combined `e[]` length at or below 16. An unmatched
realtime local reference is omitted without setting authoritative overflow; it
remains an isolated on-chart diagnostic. Realtime rows may not be referenced by
`h[]` or `q`.

- [ ] **Step 4: Serialize the bounded authoritative proof inputs**

Sort confirmed facts by `openEpoch`, then `closeEpoch`. Sort transcripts by
`contextMinutes`; duplicate contexts are invalid. Implement:

```pine
jsonBool(bool value) =>
    value ? "true" : "false"

compactChildPayload(CompactChildCandleV2 child) =>
    na(child.openEpoch) ? "null" :
     "{" +
      "\"oe\":" + str.tostring(child.openEpoch) + "," +
      "\"ce\":" + str.tostring(child.closeEpoch) + "," +
      "\"o\":" + str.tostring(child.openTicks) + "," +
      "\"h\":" + str.tostring(child.highTicks) + "," +
      "\"l\":" + str.tostring(child.lowTicks) + "," +
      "\"c\":" + str.tostring(child.closeTicks) + "}"

confirmedEntryFactPayload(EntryConfirmedFactV2 fact) =>
    "{" +
     "\"oe\":" + str.tostring(fact.openEpoch) + "," +
     "\"ce\":" + str.tostring(fact.closeEpoch) + "," +
     "\"o\":" + str.tostring(fact.openTicks) + "," +
     "\"h\":" + str.tostring(fact.highTicks) + "," +
     "\"l\":" + str.tostring(fact.lowTicks) + "," +
     "\"c\":" + str.tostring(fact.closeTicks) + "," +
     "\"gb\":" + jsonBool(fact.genericBreakDetected) + "," +
     "\"rr\":" + jsonBool(fact.rejectionRespectDetected) + "}"

entrySetupAttemptKind(RawZone zone) =>
    int factCount = array.size(zone.entryConfirmedFacts)
    factCount == 0 ? "" :
      array.get(zone.entryConfirmedFacts, 0).attemptKind

nextCandleWickGracePayload(EntryNextCandleWickGraceV2 grace) =>
    "{" +
     "\"oe\":" + str.tostring(grace.openEpoch) + "," +
     "\"ce\":" + str.tostring(grace.closeEpoch) + "," +
     "\"o\":" + str.tostring(grace.openTicks) + "," +
     "\"h\":" + str.tostring(grace.highTicks) + "," +
     "\"l\":" + str.tostring(grace.lowTicks) + "," +
     "\"c\":" + str.tostring(grace.closeTicks) + "," +
     "\"ak\":" + jsonString(grace.attemptKind) + "}"

entryConfirmedFactBefore(EntryConfirmedFactV2 left, EntryConfirmedFactV2 right) =>
    left.openEpoch != right.openEpoch ?
      left.openEpoch < right.openEpoch :
      left.closeEpoch < right.closeEpoch

orderedConfirmedEntryFacts(array<EntryConfirmedFactV2> facts) =>
    array<EntryConfirmedFactV2> ordered = array.copy(facts)
    int count = array.size(ordered)
    if count > 1
        for sourceIndex = 1 to count - 1
            EntryConfirmedFactV2 current = array.get(ordered, sourceIndex)
            int cursor = sourceIndex - 1
            while cursor >= 0
                EntryConfirmedFactV2 previous = array.get(ordered, cursor)
                if entryConfirmedFactBefore(current, previous)
                    array.set(ordered, cursor + 1, previous)
                    cursor -= 1
                else
                    break
            array.set(ordered, cursor + 1, current)
    ordered

joinConfirmedEntryFactPayloads(array<EntryConfirmedFactV2> facts) =>
    string result = ""
    array<EntryConfirmedFactV2> ordered = orderedConfirmedEntryFacts(facts)
    int count = array.size(ordered)
    if count > 0
        for index = 0 to count - 1
            result += (index == 0 ? "" : ",") +
              confirmedEntryFactPayload(array.get(ordered, index))
    result

htfTranscriptPayload(HtfProofTranscriptV2 transcript) =>
    "{" +
     "\"m\":" + str.tostring(transcript.contextMinutes) + "," +
     "\"ae\":" + str.tostring(transcript.htfOpenEpoch) + "," +
     "\"ao\":" + str.tostring(transcript.htfOpenTicks) + "," +
     "\"cu\":" + str.tostring(transcript.scanCutoffEpoch) + "," +
     "\"rs\":" + str.tostring(transcript.proofResolutionSeconds) + "," +
     "\"cs\":" + str.tostring(transcript.coverageStartEpoch) + "," +
     "\"ce\":" + str.tostring(transcript.coverageEndEpoch) + "," +
     "\"ec\":" + str.tostring(transcript.expectedChildCount) + "," +
     "\"oc\":" + str.tostring(transcript.observedChildCount) + "," +
     "\"gp\":" + jsonBool(transcript.gapPresent) + "," +
     "\"lo\":" + jsonBool(transcript.fullLifecycleOrdered) + "," +
     "\"db\":" + jsonBool(transcript.destinationSeenBeforeContact) + "," +
     "\"cc\":" + compactChildPayload(transcript.contactCandle) + "," +
     "\"rc\":" + compactChildPayload(transcript.recrossCandle) + "," +
     "\"sb\":" + jsonBool(transcript.sameChild) + "}"

orderedHtfTranscripts(array<HtfProofTranscriptV2> transcripts) =>
    array<HtfProofTranscriptV2> ordered = array.copy(transcripts)
    int count = array.size(ordered)
    if count > 1
        for sourceIndex = 1 to count - 1
            HtfProofTranscriptV2 current = array.get(ordered, sourceIndex)
            int cursor = sourceIndex - 1
            while cursor >= 0 and
              current.contextMinutes <
                array.get(ordered, cursor).contextMinutes
                array.set(
                    ordered,
                    cursor + 1,
                    array.get(ordered, cursor)
                )
                cursor -= 1
            array.set(ordered, cursor + 1, current)
    ordered

joinCurrentHtfTranscriptPayloads(array<HtfProofTranscriptV2> transcripts, array<EntryConfirmedFactV2> facts) =>
    string result = ""
    bool first = true
    array<HtfProofTranscriptV2> ordered =
      orderedHtfTranscripts(transcripts)
    int transcriptCount = array.size(ordered)
    int factCount = array.size(facts)
    if transcriptCount > 0 and factCount > 0
        for transcriptIndex = 0 to transcriptCount - 1
            HtfProofTranscriptV2 transcript = array.get(ordered, transcriptIndex)
            bool cutoffContained = false
            for factIndex = 0 to factCount - 1
                EntryConfirmedFactV2 fact = array.get(facts, factIndex)
                cutoffContained := cutoffContained or (fact.openEpoch < transcript.scanCutoffEpoch and transcript.scanCutoffEpoch <= fact.closeEpoch)
            if cutoffContained
                result += (first ? "" : ",") + htfTranscriptPayload(transcript)
                first := false
    result

entryOhlcTicksValid(int openTicks, int highTicks, int lowTicks, int closeTicks) =>
    highTicks >= math.max(openTicks, math.max(lowTicks, closeTicks)) and
      lowTicks <= math.min(openTicks, math.min(highTicks, closeTicks))

compactChildIsNull(CompactChildCandleV2 child) =>
    na(child.openEpoch) and na(child.closeEpoch) and na(child.openTicks) and
      na(child.highTicks) and na(child.lowTicks) and na(child.closeTicks)

compactChildValid(CompactChildCandleV2 child, int coverageStart, int coverageEnd) =>
    bool nullChild = compactChildIsNull(child)
    bool completeChild = not na(child.openEpoch) and not na(child.closeEpoch) and
      not na(child.openTicks) and not na(child.highTicks) and
      not na(child.lowTicks) and not na(child.closeTicks)
    nullChild or (
      completeChild and
      child.closeEpoch - child.openEpoch == 60 and
      child.openEpoch >= coverageStart and
      child.closeEpoch <= coverageEnd and
      entryOhlcTicksValid(
        child.openTicks,
        child.highTicks,
        child.lowTicks,
        child.closeTicks
      )
    )

compactChildrenEqual(CompactChildCandleV2 left, CompactChildCandleV2 right) =>
    left.openEpoch == right.openEpoch and left.closeEpoch == right.closeEpoch and
      left.openTicks == right.openTicks and left.highTicks == right.highTicks and
      left.lowTicks == right.lowTicks and left.closeTicks == right.closeTicks

entryAuthoritativeFactsValid(RawZone zone) =>
    array<EntryConfirmedFactV2> facts = orderedConfirmedEntryFacts(
        zone.entryConfirmedFacts
    )
    int factCount = array.size(facts)
    bool valid = priceToEntryTicks(zone.bottom) <= priceToEntryTicks(zone.top)
    valid := valid and not na(zone.entryZoneEngagedEpoch)
    valid := valid and (
      entryCommonFidelity(zone) == FIDELITY_EXACT or
      entryCommonFidelity(zone) == FIDELITY_UNRESOLVED
    )
    valid := valid and factCount >= 1 and factCount <=
      ENTRY_MAX_CONFIRMED_FACTS_PER_SETUP
    if valid
        for factIndex = 0 to factCount - 1
            EntryConfirmedFactV2 fact = array.get(facts, factIndex)
            valid := valid and fact.attemptKind == ATTEMPT_INITIAL
            valid := valid and fact.closeEpoch - fact.openEpoch == 300
            valid := valid and entryOhlcTicksValid(
                fact.openTicks,
                fact.highTicks,
                fact.lowTicks,
                fact.closeTicks
            )
            if factIndex > 0
                EntryConfirmedFactV2 previous = array.get(facts, factIndex - 1)
                valid := valid and previous.closeEpoch == fact.openEpoch
        EntryConfirmedFactV2 lastFact = array.get(facts, factCount - 1)
        bool gracePresent = not na(zone.entryNextCandleWickGraceFact)
        bool normalEvent =
          lastFact.openEpoch == epochSeconds(time) and
          lastFact.closeEpoch == epochSeconds(time_close) and
          not gracePresent
        bool graceEvent = false
        if gracePresent
            EntryNextCandleWickGraceV2 grace =
              zone.entryNextCandleWickGraceFact
            graceEvent :=
              zone.entryTerminalReason == ENTRY_TERMINAL_BOTH_ACTIVE and
              zone.entryTerminalEpoch == lastFact.closeEpoch and
              grace.openEpoch == zone.entryTerminalEpoch and
              grace.closeEpoch == grace.openEpoch + 300 and
              grace.openEpoch == epochSeconds(time) and
              grace.closeEpoch == epochSeconds(time_close) and
              grace.attemptKind == lastFact.attemptKind and
              grace.attemptKind == ATTEMPT_INITIAL and
              entryOhlcTicksValid(
                grace.openTicks,
                grace.highTicks,
                grace.lowTicks,
                grace.closeTicks
              )
        valid := valid and (normalEvent or graceEvent)
    int candidateCount = array.size(zone.entryCandidates)
    if candidateCount > 0
        for candidateIndex = 0 to candidateCount - 1
            valid := valid and
              array.get(zone.entryCandidates, candidateIndex).triggerOrdinal == 1
    int handlingCount = array.size(zone.entryHandling)
    if handlingCount > 0
        for handlingIndex = 0 to handlingCount - 1
            valid := valid and
              array.get(zone.entryHandling, handlingIndex).attemptKind ==
                ATTEMPT_INITIAL
    array<HtfProofTranscriptV2> orderedTranscripts =
      orderedHtfTranscripts(zone.htfTranscripts)
    int transcriptCount = array.size(orderedTranscripts)
    valid := valid and transcriptCount <= ENTRY_MAX_HTF_TRANSCRIPTS_PER_SETUP
    int previousContext = 0
    if transcriptCount > 0
        for transcriptIndex = 0 to transcriptCount - 1
            HtfProofTranscriptV2 transcript = array.get(
                orderedTranscripts,
                transcriptIndex
            )
            bool contextValid = transcript.contextMinutes == 15 or
              transcript.contextMinutes == 30 or transcript.contextMinutes == 60
            valid := valid and contextValid and
              transcript.contextMinutes > previousContext
            previousContext := transcript.contextMinutes
            valid := valid and transcript.proofResolutionSeconds == 60
            valid := valid and transcript.coverageStartEpoch ==
              transcript.htfOpenEpoch
            valid := valid and transcript.coverageEndEpoch ==
              transcript.scanCutoffEpoch
            int coverageSeconds = transcript.scanCutoffEpoch -
              transcript.htfOpenEpoch
            valid := valid and coverageSeconds > 0 and
              coverageSeconds <= transcript.contextMinutes * 60 and
              coverageSeconds % transcript.proofResolutionSeconds == 0
            int expected = int(
                coverageSeconds / transcript.proofResolutionSeconds
            )
            valid := valid and transcript.expectedChildCount == expected
            valid := valid and transcript.observedChildCount >= 0 and
              transcript.observedChildCount <= expected
            valid := valid and transcript.gapPresent ==
              (transcript.observedChildCount != expected)
            valid := valid and (
              not transcript.fullLifecycleOrdered or not transcript.gapPresent
            )
            bool contactValid = compactChildValid(
                transcript.contactCandle,
                transcript.coverageStartEpoch,
                transcript.coverageEndEpoch
            )
            bool recrossValid = compactChildValid(
                transcript.recrossCandle,
                transcript.coverageStartEpoch,
                transcript.coverageEndEpoch
            )
            valid := valid and contactValid and recrossValid
            bool sameChildActual =
              not compactChildIsNull(transcript.contactCandle) and
              not compactChildIsNull(transcript.recrossCandle) and
              compactChildrenEqual(
                transcript.contactCandle,
                transcript.recrossCandle
              )
            valid := valid and transcript.sameChild == sameChildActual
            int containingFacts = 0
            for factIndex = 0 to factCount - 1
                EntryConfirmedFactV2 fact = array.get(facts, factIndex)
                if fact.openEpoch < transcript.scanCutoffEpoch and
                  transcript.scanCutoffEpoch <= fact.closeEpoch
                    containingFacts += 1
            valid := valid and containingFacts <= 1
    bool terminalReasonNull = str.length(zone.entryTerminalReason) == 0
    bool terminalEpochNull = na(zone.entryTerminalEpoch)
    valid := valid and terminalReasonNull == terminalEpochNull
    if not terminalReasonNull
        bool terminalReasonValid =
          zone.entryTerminalReason == ENTRY_TERMINAL_INVALIDATED or
          zone.entryTerminalReason == ENTRY_TERMINAL_BOTH_ACTIVE or
          zone.entryTerminalReason == ENTRY_TERMINAL_RETENTION_EVICTED
        bool currentTerminal =
          zone.entryTerminalEpoch == epochSeconds(time_close)
        bool graceTerminal =
          not na(zone.entryNextCandleWickGraceFact) and
          zone.entryTerminalReason == ENTRY_TERMINAL_BOTH_ACTIVE and
          zone.entryTerminalEpoch ==
            zone.entryNextCandleWickGraceFact.openEpoch
        valid := valid and terminalReasonValid and
          (currentTerminal or graceTerminal)
    bool priorActive = hasEntryCandidateModel(zone, ENTRY_MODEL_DIR_CLOSE) or
      hasEntryCandidateModel(zone, ENTRY_MODEL_HTF_FLIP)
    valid := valid and (
      not zone.entryInvalidatedBeforeEntry or
      (
        zone.entryTerminalReason == ENTRY_TERMINAL_INVALIDATED and
        not priorActive
      )
    )
    valid and not zone.entryCollectionOverflow

entryAuthoritativeFactsPayload(RawZone zone) =>
    string terminalReason = str.length(zone.entryTerminalReason) == 0 ? "null" : jsonString(zone.entryTerminalReason)
    string gracePayload = na(zone.entryNextCandleWickGraceFact) ?
      "null" :
      nextCandleWickGracePayload(zone.entryNextCandleWickGraceFact)
    "{" +
     "\"zb\":" + str.tostring(priceToEntryTicks(zone.bottom)) + "," +
     "\"zt\":" + str.tostring(priceToEntryTicks(zone.top)) + "," +
     "\"ge\":" + nullableEntryInt(zone.entryZoneEngagedEpoch) + "," +
     "\"iv\":" + jsonBool(zone.entryInvalidatedBeforeEntry) + "," +
     "\"cf\":" + jsonString(entryCommonFidelity(zone)) + "," +
     "\"ak\":" + jsonString(entrySetupAttemptKind(zone)) + "," +
     "\"tr\":" + terminalReason + "," +
     "\"te\":" + nullableEntryInt(zone.entryTerminalEpoch) + "," +
     "\"b\":[" + joinConfirmedEntryFactPayloads(zone.entryConfirmedFacts) + "]," +
     "\"ng\":" + gracePayload + "," +
     "\"x\":[" + joinCurrentHtfTranscriptPayloads(zone.htfTranscripts, zone.entryConfirmedFacts) + "]}"
```

Before serializing, `entryAuthoritativeFactsValid(zone)` must verify:

- zone bottom is less than or equal to zone top;
- `ak` is read from the retained confirmed facts and is exactly `INITIAL`;
- `cf` is exactly `EXACT` or `UNRESOLVED`;
- confirmed facts contain 1 to 4 unique, contiguous, chronological valid 5m
  OHLC candles. On a normal event the last candle equals the envelope's bar
  open/close epoch and `ng=null`;
- a non-null `ng` is accepted only for the one BOTH grace described above:
  it is a valid contiguous 5m candle, starts at the immutable terminal epoch,
  ends at the current envelope close, inherits the prior close's `INITIAL`
  attempt, and leaves `b` ending at the terminal event;
- transcripts are unique by context, sorted 15/30/60, resolution 60, and capped
  at 3;
- every transcript has `cs=ae` and `ce=cu`; a partial coverage window may be
  represented only by its child counts/gap flag, never by shortening `ce`
  behind the scan cutoff;
- every transcript has `ec=(cu-ae)/rs`, `0<=oc<=ec`, and
  `gp == (oc != ec)`; `lo=true` requires `gp=false`;
- transcript child candles have valid OHLC and 60-second duration;
- `sb` is true exactly when both non-null child intervals are identical;
- every diagnostic candidate has `o=1`, and every diagnostic handling row has
  `a=INITIAL`;
- terminal reason and epoch are either both null or both present. Ordinarily
  the epoch equals the envelope close; on the explicit grace event it equals
  `ng.oe`, exactly 300 seconds before the envelope close;
- terminal reason is one of `INVALIDATED`,
  `BOTH_ACTIVE_MODELS_OBSERVED`, or `RETENTION_EVICTED`;
- `iv=true` implies terminal reason `INVALIDATED` and no previous non-rejected
  active candidate; `INVALIDATED` with an earlier matched, normalized, or
  blocked active candidate keeps `iv=false`.

Any failure marks the run invalid and suppresses the entire batch.
`joinCurrentHtfTranscriptPayloads()` includes only transcripts whose
`scanCutoffEpoch` is contained by exactly one retained confirmed candle
(`openEpoch < scanCutoffEpoch <= closeEpoch`), so each incremental bundle is
self-consistent. Earlier incrementals remain the history of transcripts that
roll out of the local four-bar window.

- [ ] **Step 5: Implement diagnostic-only arbitration serialization**

Use the approved ordering to choose the diagnostic candidate, but force the wire
action to shadow:

```pine
diagnosticReplayObserved(EntryEvidenceV2 evidence) =>
    evidence.proofPlane != PROOF_REALTIME_TICK and
      not na(evidence.observedTriggerEpoch)

diagnosticExactEvidence(EntryEvidenceV2 evidence) =>
    diagnosticReplayObserved(evidence) and
      evidence.fidelity == FIDELITY_EXACT and
      array.size(evidence.ambiguityCodes) == 0

diagnosticEvidenceBefore(EntryEvidenceV2 left, EntryEvidenceV2 right) =>
    left.observedTriggerEpoch != right.observedTriggerEpoch ?
      left.observedTriggerEpoch < right.observedTriggerEpoch :
     left.proofResolutionSeconds != right.proofResolutionSeconds ?
      left.proofResolutionSeconds < right.proofResolutionSeconds :
     array.size(left.htfContextMinutes) != array.size(right.htfContextMinutes) ?
      array.size(left.htfContextMinutes) > array.size(right.htfContextMinutes) :
     left.coverageEndEpoch != right.coverageEndEpoch ?
      left.coverageEndEpoch < right.coverageEndEpoch :
     entryStringBefore(left.localRef, right.localRef)

diagnosticCanonicalExactEvidenceIndex(RawZone zone, string candidateRef) =>
    int result = na
    int evidenceCount = array.size(zone.entryEvidence)
    if evidenceCount > 0
        for evidenceIndex = 0 to evidenceCount - 1
            EntryEvidenceV2 evidence = array.get(zone.entryEvidence, evidenceIndex)
            if evidence.candidateRef == candidateRef and
              diagnosticExactEvidence(evidence)
                if na(result) or diagnosticEvidenceBefore(
                  evidence,
                  array.get(zone.entryEvidence, result)
                )
                    result := evidenceIndex
    result

diagnosticCandidateFidelity(RawZone zone, string candidateRef) =>
    na(diagnosticCanonicalExactEvidenceIndex(zone, candidateRef)) ?
      FIDELITY_UNRESOLVED : FIDELITY_EXACT

diagnosticCandidateActive(EntryCandidateV2 candidate) =>
    (
      candidate.model == ENTRY_MODEL_DIR_CLOSE or
      candidate.model == ENTRY_MODEL_HTF_FLIP
    ) and candidate.state != CANDIDATE_REJECTED

diagnosticCandidateExact(RawZone zone, EntryCandidateV2 candidate) =>
    diagnosticCandidateActive(candidate) and not na(
      diagnosticCanonicalExactEvidenceIndex(zone, candidate.localRef)
    )

diagnosticEarlierNonExactFlip(
  RawZone zone,
  array<EntryCandidateV2> orderedCandidates,
  int exactCloseIndex
) =>
    bool result = false
    if not na(exactCloseIndex)
        EntryCandidateV2 closeCandidate = array.get(
            orderedCandidates,
            exactCloseIndex
        )
        int closeEvidenceIndex = diagnosticCanonicalExactEvidenceIndex(
            zone,
            closeCandidate.localRef
        )
        if not na(closeEvidenceIndex)
            int closeTrigger = array.get(
                zone.entryEvidence,
                closeEvidenceIndex
            ).observedTriggerEpoch
            int candidateCount = array.size(orderedCandidates)
            if candidateCount > 0
                for candidateIndex = 0 to candidateCount - 1
                    EntryCandidateV2 candidate = array.get(
                        orderedCandidates,
                        candidateIndex
                    )
                    bool nonExactFlip =
                      candidate.model == ENTRY_MODEL_HTF_FLIP and
                      diagnosticCandidateActive(candidate) and
                      not diagnosticCandidateExact(zone, candidate)
                    if nonExactFlip
                        int evidenceCount = array.size(zone.entryEvidence)
                        if evidenceCount > 0
                            for evidenceIndex = 0 to evidenceCount - 1
                                EntryEvidenceV2 evidence = array.get(
                                    zone.entryEvidence,
                                    evidenceIndex
                                )
                                bool nonExactReplayObserved =
                                  evidence.candidateRef == candidate.localRef and
                                  diagnosticReplayObserved(evidence) and
                                  not diagnosticExactEvidence(evidence)
                                result := result or (
                                  nonExactReplayObserved and
                                  evidence.observedTriggerEpoch < closeTrigger
                                )
    result

diagnosticSelectedCandidateIndex(RawZone zone, array<EntryCandidateV2> orderedCandidates) =>
    int selected = na
    int exactClose = na
    int exactCount = 0
    int selectedTrigger = na
    bool equalTimeDifferentModel = false
    int candidateCount = array.size(orderedCandidates)
    if not zone.entryInvalidatedBeforeEntry and candidateCount > 0
        for candidateIndex = 0 to candidateCount - 1
            EntryCandidateV2 candidate = array.get(
                orderedCandidates,
                candidateIndex
            )
            if diagnosticCandidateExact(zone, candidate)
                exactCount += 1
                int evidenceIndex = diagnosticCanonicalExactEvidenceIndex(
                    zone,
                    candidate.localRef
                )
                int trigger = array.get(
                    zone.entryEvidence,
                    evidenceIndex
                ).observedTriggerEpoch
                if candidate.model == ENTRY_MODEL_DIR_CLOSE
                    exactClose := candidateIndex
                if na(selectedTrigger) or trigger < selectedTrigger
                    selected := candidateIndex
                    selectedTrigger := trigger
                    equalTimeDifferentModel := false
                else if trigger == selectedTrigger
                    EntryCandidateV2 prior = array.get(
                        orderedCandidates,
                        selected
                    )
                    if candidate.model != prior.model
                        equalTimeDifferentModel := true
                    else if entryStringBefore(candidate.localRef, prior.localRef)
                        selected := candidateIndex
    if diagnosticEarlierNonExactFlip(zone, orderedCandidates, exactClose)
        selected := exactClose
    else if equalTimeDifferentModel
        selected := na
    exactCount == 0 ? na : selected

diagnosticSelectionReason(RawZone zone, array<EntryCandidateV2> orderedCandidates, int selectedIndex) =>
    int activeCount = 0
    int exactCount = 0
    int exactClose = na
    int firstExactTrigger = na
    int secondExactTrigger = na
    string firstExactModel = ""
    string secondExactModel = ""
    int candidateCount = array.size(orderedCandidates)
    if candidateCount > 0
        for candidateIndex = 0 to candidateCount - 1
            EntryCandidateV2 candidate = array.get(
                orderedCandidates,
                candidateIndex
            )
            if diagnosticCandidateActive(candidate)
                activeCount += 1
            if diagnosticCandidateExact(zone, candidate)
                exactCount += 1
                int evidenceIndex = diagnosticCanonicalExactEvidenceIndex(
                    zone,
                    candidate.localRef
                )
                int trigger = array.get(
                    zone.entryEvidence,
                    evidenceIndex
                ).observedTriggerEpoch
                if candidate.model == ENTRY_MODEL_DIR_CLOSE
                    exactClose := candidateIndex
                if na(firstExactTrigger) or trigger < firstExactTrigger
                    secondExactTrigger := firstExactTrigger
                    secondExactModel := firstExactModel
                    firstExactTrigger := trigger
                    firstExactModel := candidate.model
                else
                    secondExactTrigger := trigger
                    secondExactModel := candidate.model
    zone.entryInvalidatedBeforeEntry ? "SETUP_INVALIDATED" :
     activeCount == 0 ? "NO_CANDIDATE" :
     exactCount == 0 ? "NO_EXACT_CANDIDATE" :
     diagnosticEarlierNonExactFlip(
       zone,
       orderedCandidates,
       exactClose
     ) ? "FALLBACK_TO_CONFIRMED_CLOSE" :
     exactCount == 1 ? "ONLY_EXACT_TRIGGER" :
     firstExactTrigger == secondExactTrigger and
       firstExactModel != secondExactModel ?
       "UNRESOLVED_SOURCE_PRIORITY" :
     "EARLIEST_EXACT_TRIGGER"

diagnosticEntrySelectionPayload(RawZone zone, array<EntryCandidateV2> orderedCandidates) =>
    int selectedIndex = diagnosticSelectedCandidateIndex(zone, orderedCandidates)
    string reason = diagnosticSelectionReason(zone, orderedCandidates, selectedIndex)
    string selectedKey = "null"
    string selectedModel = "null"
    string selectedAnchor = "null"
    string selectedOrdinal = "null"
    string fidelity = "null"
    string action = na(selectedIndex) ? "NONE" : "SHADOW_ONLY"
    if not na(selectedIndex)
        EntryCandidateV2 selected = array.get(orderedCandidates, selectedIndex)
        selectedKey := jsonString(selected.localRef)
        selectedModel := jsonString(selected.model)
        selectedAnchor := str.tostring(selected.eventAnchorEpoch)
        selectedOrdinal := str.tostring(selected.triggerOrdinal)
        fidelity := jsonString(diagnosticCandidateFidelity(zone, selected.localRef))
    "{" +
     "\"v\":\"PINE_DIAGNOSTIC_ONLY\"," +
     "\"k\":" + selectedKey + "," +
     "\"m\":" + selectedModel + "," +
     "\"a\":" + selectedAnchor + "," +
     "\"o\":" + selectedOrdinal + "," +
     "\"r\":" + jsonString(reason) + "," +
     "\"f\":" + fidelity + "," +
     "\"x\":" + jsonString(action) + "}"
```

Ignore `REALTIME_TICK` evidence when deriving diagnostic fidelity and ordering.
The edge must validate that `k` equals
`entryCandidateLocalRef(m, a, o)`, compute the authoritative candidate SHA-256
from bundle `s`, bundle `d`, `m`, `a`, and `o`, and compare that derived ID with
its own arbitration. Pine never emits `candidate_id`, `evidence_id`, or any
64-hex hash for an entry fact.
Use these exact reasons:

```text
ONLY_EXACT_TRIGGER
EARLIEST_EXACT_TRIGGER
FALLBACK_TO_CONFIRMED_CLOSE
NO_EXACT_CANDIDATE
UNRESOLVED_SOURCE_PRIORITY
SETUP_INVALIDATED
NO_CANDIDATE
```

- [ ] **Step 6: Build one atomic setup bundle**

Implement:

```pine
setupExportSetupId(RawZone zone) =>
    setupContractIdentifier(syminfo.ticker) + ":" +
     entryDirection(zone) + ":" +
     setupExportZoneKey(zone) + ":" +
     setupExportLiquidityKey(zone) + ":" +
     str.tostring(epochSeconds(zone.confirmationTime))

setupEntryBundlePayload(RawZone zone) =>
    array<EntryCandidateV2> candidates = orderedEntryCandidates(zone)
    string candidatePayloads = joinEntryCandidatePayloads(candidates)
    string evidencePayloads = joinEntryEvidencePayloads(zone, candidates)
    string realtimePayloads = joinRealtimeEntryEvidencePayloads(
        zone,
        candidates,
        array.size(zone.entryEvidence)
    )
    if str.length(realtimePayloads) > 0
        evidencePayloads += (
          str.length(evidencePayloads) == 0 ? "" : ","
        ) + realtimePayloads
    string handlingPayloads = joinEntryHandlingPayloads(zone, candidates)
    "{" +
     "\"s\":" + jsonString(setupExportSetupId(zone)) + "," +
     "\"d\":" + jsonString(entryDirection(zone)) + "," +
     "\"f\":" + entryAuthoritativeFactsPayload(zone) + "," +
     "\"c\":[" + candidatePayloads + "]," +
     "\"e\":[" + evidencePayloads + "]," +
     "\"h\":[" + handlingPayloads + "]," +
     "\"q\":" + diagnosticEntrySelectionPayload(zone, candidates) + "}"
```

`setupExportSetupId(zone)` must be derived solely from symbol, side, frozen zone
key, frozen liquidity key, and formation close epoch. It must not contain proof
plane, candidate, or arrival-order fields. Do not serialize an entry bundle
before its first post-engagement confirmed fact exists; thereafter emit it in
every confirmed-bar incremental batch until terminal handling completes.

- [ ] **Step 7: Implement two-pass deterministic chunk construction**

Use arrays of complete bundle strings:

```pine
buildEntryChunks(array<string> bundles, int sequence) =>
    array<string> chunks = array.new<string>()
    array<string> currentChunkBundles = array.new<string>()
    bool valid = array.size(bundles) <= ENTRY_EXPORT_MAX_SETUP_BUNDLES
    int bundleCount = array.size(bundles)
    if valid and bundleCount > 0
        for bundleIndex = 0 to bundleCount - 1
            string bundle = array.get(bundles, bundleIndex)
            array<string> trial = array.copy(currentChunkBundles)
            array.push(trial, bundle)
            string trialBody = joinSetupBundles(trial)
            bool fits = entryChunkEstimatedChars(trialBody, sequence) < ENTRY_EXPORT_MAX_PAYLOAD_CHARS
            if fits
                array.push(currentChunkBundles, bundle)
            else if array.size(currentChunkBundles) == 0
                valid := false
                setupExportRunInvalid("SETUP_EXPORT_BUNDLE_TOO_LARGE", sequence, str.length(bundle), ENTRY_EXPORT_MAX_PAYLOAD_CHARS)
            else
                array.push(chunks, joinSetupBundles(currentChunkBundles))
                array.clear(currentChunkBundles)
                bool fitsAlone = entryChunkEstimatedChars(bundle, sequence) < ENTRY_EXPORT_MAX_PAYLOAD_CHARS
                if fitsAlone
                    array.push(currentChunkBundles, bundle)
                else
                    valid := false
                    setupExportRunInvalid("SETUP_EXPORT_BUNDLE_TOO_LARGE", sequence, str.length(bundle), ENTRY_EXPORT_MAX_PAYLOAD_CHARS)
        if valid and array.size(currentChunkBundles) > 0
            array.push(chunks, joinSetupBundles(currentChunkBundles))
    if valid and bundleCount == 0
        array.push(chunks, "")
    if array.size(chunks) > ENTRY_EXPORT_MAX_CHUNKS
        valid := false
        setupExportRunInvalid("SETUP_EXPORT_CHUNK_LIMIT_EXCEEDED", sequence, array.size(chunks), ENTRY_EXPORT_MAX_CHUNKS)
    [chunks, valid]
```

`entryChunkEstimatedChars()` must reserve the full fixed context plus two decimal
digits for both chunk fields. After `chunk_count` is known, construct every final
envelope and recheck `str.length(envelope) < 35000` before emitting the first
alert. If any final envelope fails, emit no chunk from that batch. Place
`joinSetupBundles()`, `entryExportContextFields()`, `entryExportPayload()`,
`entryExportEnvelope()`, and `entryChunkEstimatedChars()` before
`buildEntryChunks()` in the Pine source even though the plan presents their
contracts together below.

Add fail-closed inputs and validators:

```pine
entryDetectorCodeHash = input.string("", "Detector code SHA-256", group = "Automation", tooltip = "Required lowercase 64-character SHA-256 of this saved V3 source.")
entrySettingsHash = input.string("", "Settings SHA-256", group = "Automation", tooltip = "Required lowercase 64-character SHA-256 printed by the parity manifest builder.")
var bool entryExportRunFailed = false
var int entryExportSequence = 1

entryLowerHexDigestValid(string value) =>
    bool valid = str.length(value) == 64 and value != str.repeat("0", 64)
    if valid
        for characterIndex = 0 to 63
            string character = str.substring(value, characterIndex, characterIndex + 1)
            valid := valid and str.contains("0123456789abcdef", character)
    valid

entryExportKindValid(string kind) =>
    kind == "snapshot" or kind == "incremental"
```

No `unverified`, shortened label, uppercase hex, or unknown kind may reach an
alert. Context fields are:

```pine
entryExportContextFields(int sequence, int chunkIndex, int chunkCount, string kind) =>
    string semanticKey = setupExportProducerInstanceId + ":" + str.tostring(sequence) + ":" + kind + ":" + str.tostring(epochSeconds(time_close))
    string idempotencyKey = semanticKey + ":" + str.tostring(chunkIndex)
    "\"schema_version\":\"2.0\"," +
     "\"strategy_id\":\"rd_liquidity_sd_5m_v1\"," +
     "\"strategy_version\":\"2.0.0-contract2\"," +
     "\"rule_contract_version\":\"2.0.0\"," +
     "\"execution_mode\":\"OBSERVATION_ONLY\"," +
     "\"producer_instance_id\":" + jsonString(setupExportProducerInstanceId) + "," +
     "\"sequence\":" + str.tostring(sequence) + "," +
     "\"kind\":" + jsonString(kind) + "," +
     "\"chunk_index\":" + str.tostring(chunkIndex) + "," +
     "\"chunk_count\":" + str.tostring(chunkCount) + "," +
     "\"idempotency_key\":" + jsonString(idempotencyKey) + "," +
     "\"symbol\":" + jsonString(setupContractIdentifier(syminfo.ticker)) + "," +
     "\"ticker_id\":" + jsonString(setupContractIdentifier(syminfo.tickerid)) + "," +
     "\"feed\":" + jsonString(setupContractIdentifier(syminfo.prefix)) + "," +
     "\"timeframe\":\"5\"," +
     "\"tick_size\":" + jsonString(str.tostring(syminfo.mintick, format.mintick)) + "," +
     "\"bar_open_epoch\":" + str.tostring(epochSeconds(time)) + "," +
     "\"bar_close_epoch\":" + str.tostring(epochSeconds(time_close)) + "," +
     "\"detector_code_hash\":" + jsonString(entryDetectorCodeHash) + "," +
     "\"settings_hash\":" + jsonString(entrySettingsHash)

joinSetupBundles(array<string> bundles) =>
    string result = ""
    int bundleCount = array.size(bundles)
    if bundleCount > 0
        for bundleIndex = 0 to bundleCount - 1
            result += (bundleIndex == 0 ? "" : ",") +
              array.get(bundles, bundleIndex)
    result

entryExportPayload(string chunkBody, int sequence, int chunkIndex, int chunkCount, string kind) =>
    "{" +
     entryExportContextFields(sequence, chunkIndex, chunkCount, kind) + "," +
     "\"eb\":[" + chunkBody + "]}"

entryExportEnvelope(string payload) =>
    "{" +
     "\"credential\":" + jsonString(setupExportCredential) + "," +
     "\"payload\":" + payload + "}"

entryChunkEstimatedChars(string chunkBody, int sequence) =>
    // 99/99 and the longer kind conservatively reserve both two-digit fields.
    str.length(
      entryExportEnvelope(
        entryExportPayload(chunkBody, sequence, 99, 99, "incremental")
      )
    )
```

Every chunk repeats the identical `producer_instance_id`, `sequence`, `kind`, and
`bar_close_epoch`. Those four fields are the semantic batch identity. The edge
canonicalizes them and derives the authoritative 64-hex `batch_id`; Pine does not
emit `batch_id`. Only `chunk_index`, per-chunk `idempotency_key`, and the bundle
slice differ between chunks.
`sequence` is a positive, strictly increasing per-producer counter shared by
both kinds; a snapshot does not reset it.
`setupExportProducerInstanceId` is generated once per runtime from the required,
sanitized operator-supplied `setupExportProducerTag` plus the script-start
`timenow`, matching the inherited producer identity mechanism. The operator
supplies the stable tag, not the full instance ID. A script/alert restart resets
`entryExportSequence` and necessarily creates a new start-stamped instance ID,
so the edge opens a new continuity scope. Reusing a previously emitted full
instance ID is prohibited. Within one instance, each sequence identifies
exactly one semantic batch.

Kinds are lowercase JSON strings exactly `snapshot` and `incremental`.
Incremental and snapshot payloads both use the top-level `eb` array; snapshot includes
all retained post-engagement setup bundles with at least one fact, while
incremental includes
bundles whose facts or diagnostic revision changed. An empty incremental
`eb` array remains the confirmed-bar delivery heartbeat. `bundles` is only a
local variable name and is never serialized.

- [ ] **Step 8: Emit only after every chunk passes the final bound**

Implement:

```pine
emitEntryBatch(array<string> bundles, int sequence, string kind, bool factsValid) =>
    [chunks, chunksValid] = buildEntryChunks(bundles, sequence)
    bool valid = not entryExportRunFailed and
      str.length(setupExportCredential) > 0 and
      sequence > 0 and chunksValid and factsValid and
      entryExportKindValid(kind) and
      entryLowerHexDigestValid(entryDetectorCodeHash) and
      entryLowerHexDigestValid(entrySettingsHash)
    array<string> envelopes = array.new<string>()
    int chunkCount = array.size(chunks)
    if valid
        for chunkIndex = 0 to chunkCount - 1
            string payload = entryExportPayload(array.get(chunks, chunkIndex), sequence, chunkIndex, chunkCount, kind)
            string envelope = entryExportEnvelope(payload)
            if str.length(envelope) >= ENTRY_EXPORT_MAX_PAYLOAD_CHARS
                valid := false
            array.push(envelopes, envelope)
    if valid
        for chunkIndex = 0 to chunkCount - 1
            alert(array.get(envelopes, chunkIndex), alert.freq_all)
    valid
```

If `zone.entryCollectionOverflow` is true for any bundle in a batch, mark the run
invalid and emit no partial candidate batch. Schedule at most one batch per
confirmed 5m close. If a terminal transition and incremental revision occur on
the same close, coalesce them into one `snapshot` batch; do not emit a second
batch. Together with the 12-chunk cap, this stays below TradingView's documented
more-than-15-alerts-in-three-minutes auto-stop threshold.

After the current confirmed-bar scan has completed and before bounded eviction,
use:

```pine
appendUniqueEntryZoneIndex(array<int> indexes, int zoneIndex) =>
    if not array.includes(indexes, zoneIndex)
        array.push(indexes, zoneIndex)
    true

entryTransportArchived(RawZone zone) =>
    bool graceFinished =
      na(zone.entryNextCandleWickGraceOpenEpoch) or
      (
        zone.entryNextCandleWickGraceConsumed and
        (
          na(zone.entryNextCandleWickGraceFact) or
          zone.entryNextCandleWickGraceTransportEmitted
        )
      )
    zone.entryTerminalSnapshotEmitted and graceFinished

evictEntryZoneAfterTerminalSnapshot(array<RawZone> zones, int zoneIndex, array<int> terminalZoneIndexes, array<int> archivedRemovalZoneIndexes) =>
    RawZone zone = array.get(zones, zoneIndex)
    if entryTransportArchived(zone)
        // Its immutable terminal was already stored. Local visual-retention
        // cleanup is queued so collected indexes remain stable for this bar.
        appendUniqueEntryZoneIndex(archivedRemovalZoneIndexes, zoneIndex)
    else if not zone.entryTerminalSnapshotEmitted
        if not zone.entryObservationClosed
            closeEntryObservation(
                zone,
                ENTRY_TERMINAL_RETENTION_EVICTED,
                epochSeconds(time_close)
            )
        array.set(zones, zoneIndex, zone)
        appendUniqueEntryZoneIndex(terminalZoneIndexes, zoneIndex)
    // A successfully emitted BOTH terminal with one pending wick-grace bar is
    // neither re-terminalized nor removed. It becomes archived next close.

orderedEntryBatchZoneIndexes(array<RawZone> zones, array<int> sourceIndexes) =>
    array<int> ordered = array.copy(sourceIndexes)
    int count = array.size(ordered)
    if count > 1
        for sourceIndex = 1 to count - 1
            int current = array.get(ordered, sourceIndex)
            string currentId = setupExportSetupId(array.get(zones, current))
            int cursor = sourceIndex - 1
            while cursor >= 0
                int previous = array.get(ordered, cursor)
                string previousId = setupExportSetupId(
                    array.get(zones, previous)
                )
                if entryStringBefore(currentId, previousId)
                    array.set(ordered, cursor + 1, previous)
                    cursor -= 1
                else
                    break
            array.set(ordered, cursor + 1, current)
    ordered

emitScheduledEntryBatch(array<RawZone> zones, array<int> changedZoneIndexes, array<int> terminalZoneIndexes, array<int> archivedRemovalZoneIndexes, int sequence) =>
    bool snapshot = array.size(terminalZoneIndexes) > 0
    array<int> selectedIndexes = array.new<int>()
    int zoneCount = array.size(zones)
    if snapshot
        if zoneCount > 0
            for zoneIndex = 0 to zoneCount - 1
                RawZone zone = array.get(zones, zoneIndex)
                bool currentTerminal =
                  array.includes(terminalZoneIndexes, zoneIndex)
                bool transportActive =
                  not entryTransportArchived(zone) or currentTerminal
                if transportActive and
                  array.size(zone.entryConfirmedFacts) > 0
                    array.push(selectedIndexes, zoneIndex)
    else
        int changedCount = array.size(changedZoneIndexes)
        if changedCount > 0
            for changedIndex = 0 to changedCount - 1
                int zoneIndex = array.get(changedZoneIndexes, changedIndex)
                RawZone zone = array.get(zones, zoneIndex)
                if not entryTransportArchived(zone) and
                  not array.includes(selectedIndexes, zoneIndex) and
                  array.size(zone.entryConfirmedFacts) > 0
                    array.push(selectedIndexes, zoneIndex)
    selectedIndexes := orderedEntryBatchZoneIndexes(zones, selectedIndexes)
    array<string> bundles = array.new<string>()
    bool factsValid = sequence > 0
    int selectedCount = array.size(selectedIndexes)
    if selectedCount > 0
        for selectedIndex = 0 to selectedCount - 1
            RawZone zone = array.get(
                zones,
                array.get(selectedIndexes, selectedIndex)
            )
            factsValid := factsValid and entryAuthoritativeFactsValid(zone)
            string bundle = setupEntryBundlePayload(zone)
            // Serialization can discover a dangling diagnostic local reference.
            // Recheck after construction so no partial diagnostic bundle emits.
            factsValid := factsValid and
              not zone.entryCollectionOverflow and
              entryAuthoritativeFactsValid(zone)
            array.push(bundles, bundle)
    string kind = snapshot ? "snapshot" : "incremental"
    bool emitted = emitEntryBatch(bundles, sequence, kind, factsValid)
    array<int> localRemovalZoneIndexes =
      array.copy(archivedRemovalZoneIndexes)
    if emitted and snapshot and zoneCount > 0
        for zoneIndex = zoneCount - 1 to 0
            if array.includes(terminalZoneIndexes, zoneIndex)
                RawZone zone = array.get(zones, zoneIndex)
                zone.entryTerminalSnapshotEmitted := true
                if zone.entryTerminalReason == ENTRY_TERMINAL_RETENTION_EVICTED
                    appendUniqueEntryZoneIndex(
                        localRemovalZoneIndexes,
                        zoneIndex
                    )
                array.set(zones, zoneIndex, zone)
    if emitted and selectedCount > 0
        for selectedIndex = 0 to selectedCount - 1
            int zoneIndex = array.get(selectedIndexes, selectedIndex)
            RawZone zone = array.get(zones, zoneIndex)
            if zone.entryNextCandleWickGraceConsumed and
              not na(zone.entryNextCandleWickGraceFact)
                zone.entryNextCandleWickGraceTransportEmitted := true
                if entryTransportArchived(zone)
                    appendUniqueEntryZoneIndex(
                        localRemovalZoneIndexes,
                        zoneIndex
                    )
                array.set(zones, zoneIndex, zone)
    // No removal occurs until every batch index has been consumed. Descending
    // removal keeps all lower indexes stable while a higher one is removed.
    if zoneCount > 0
        for zoneIndex = zoneCount - 1 to 0
            if array.includes(localRemovalZoneIndexes, zoneIndex)
                array.remove(zones, zoneIndex)
    [emitted, not emitted]
```

Collect `changedZoneIndexes` and `terminalZoneIndexes` during the current
confirmed-bar scan. `INVALIDATED`, `BOTH_ACTIVE_MODELS_OBSERVED`, and every
retention eviction all enter the terminal set; no collector calls
`emitEntryBatch()`. A terminal transition selects one aggregate `snapshot`
containing every transport-active post-engagement bundle plus all terminals
that occurred on the current close. A terminal bundle successfully emitted in
an earlier snapshot is transport-archived and excluded from later snapshots;
its immutable edge record remains stored, and its stale terminal epoch cannot
invalidate a later batch. An ordinary bar selects one `incremental` containing
changed bundles or an empty `eb` heartbeat. Call
`emitScheduledEntryBatch()` exactly once after all zones are scanned, then
update the global latch only at that caller:

```pine
// Place this entire block inside the inherited
// `if barstate.isconfirmed and isFiveMinute and validationReady` block.
// Recreate these local schedules once per confirmed chart bar, before the zone
// scan. A successful fact append always marks its non-archived setup changed,
// even when gb/rr are both false and no diagnostic candidate changed.
array<int> changedZoneIndexes = array.new<int>()
array<int> terminalZoneIndexes = array.new<int>()
array<int> archivedRemovalZoneIndexes = array.new<int>()
// Inside the zone loop:
bool normalOpenAtBarStart = entryNormalCollectionOpen(zone)
if normalOpenAtBarStart
    [factAppended, directionalClose, genericBreak, rejectionRespect] =
      collectConfirmedEntryFact(zone)
    if factAppended and not entryTransportArchived(zone)
        appendUniqueEntryZoneIndex(changedZoneIndexes, zoneIndex)
    // Run the ordinary HTF/candidate/legacy/terminal collectors here.
else
    bool graceEventRecorded = collectNextCandleWickGrace(zone)
    if graceEventRecorded
        appendUniqueEntryZoneIndex(changedZoneIndexes, zoneIndex)
// Combine the invalidation/completion/retention return values at the actual
// collector call sites.
if terminalNow
    appendUniqueEntryZoneIndex(terminalZoneIndexes, zoneIndex)

// Exactly one call after the loop. Historical parity keeps exportSetupEvents
// false; the forward alert uses its separately hashed true profile.
bool entryExportReady =
  exportSetupEvents and barstate.isrealtime and
  str.length(setupExportCredential) > 0 and
  entryLowerHexDigestValid(entryDetectorCodeHash) and
  entryLowerHexDigestValid(entrySettingsHash)
if entryExportReady
    [entryBatchEmitted, entryBatchFailed] = emitScheduledEntryBatch(
        zones,
        changedZoneIndexes,
        terminalZoneIndexes,
        archivedRemovalZoneIndexes,
        entryExportSequence
    )
    entryExportRunFailed := entryExportRunFailed or entryBatchFailed
    if entryBatchEmitted
        entryExportSequence += 1

// This bounded visual-retention cleanup is deliberately outside the export
// gate. It never marks transport delivered and never emits an alert.
runEntryVisualRetentionCleanup(zones, maxZones)
```

For `INVALIDATED` and `BOTH_ACTIVE_MODELS_OBSERVED`, set
`entryTerminalSnapshotEmitted=true` only after successful local emission.
An invalidated terminal is then transport-archived. A BOTH terminal with a
pending DIR-close wick grace remains transport-active until the grace is
consumed; if `ng` exists, it is archived only after the grace incremental emits
successfully, while a consumed gap with no `ng` needs no second batch. Remove
retention-evicted zones only after the terminal aggregate emission succeeds.
Terminal reason and epoch never change after first assignment.

Run later visual-retention cleanup in descending zone-index order. If it reaches
a zone for which `entryTransportArchived(zone)` is true, remove that local zone
without changing or
re-emitting its already stored terminal. Only an open attempt being evicted
receives a new `RETENTION_EVICTED` terminal snapshot. An unarchived terminal
already created on the current close may be coalesced into the current terminal
set, but an older immutable terminal is never shifted to the eviction close.
This visual cleanup runs whether or not `entryExportReady` is true. Historical
export-off charts and a misconfigured forward chart therefore stay bounded.
When export is expected but not ready, set the visible/run-failure diagnostic
before cleanup and never mark a terminal or grace as emitted; local removal
cannot be mistaken for webhook delivery. Add a static test that the cleanup
call is outside the `if entryExportReady` block and a behavior test that more
than `maxZones` export-off terminal zones remain bounded without any `alert()`.

Pine has no webhook acknowledgement channel and this producer defines no
application-level retry. If payload construction or local emission validation
fails, set the persistent `entryExportRunFailed` latch, emit no later schema-2
batch under a shifted bar identity, and require an operator restart with a new
producer instance. A duplicate delivery of the original immutable chunk is
safe at the edge. Sequence and independent heartbeat-schedule gates make a
missing delivery fail the canary; a terminal fact is never retried with a new
`bar_close_epoch` or terminal epoch.

- [ ] **Step 9: Run schema, bounds, and safety tests**

Run:

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py \
  tests/static/test_paper_automation_pine.py -v
```

Expected: all tests pass.

- [ ] **Step 10: Commit compact schema-2.0 export**

```bash
git add scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  tests/static/test_rd_multi_entry_pine.py
git commit -m "feat: export compact Pine entry bundles"
```

### Task 6: Add parity logs, a manifest builder, and the frozen comparator CLI

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine:validation payload and log emission`
- Create: `scripts/normalize_rd_pine_log.py`
- Create: `scripts/build_rd_pine_parity_manifest.py`
- Create: `scripts/compare_rd_pine_parity.py`
- Create: `tests/unit/test_rd_pine_parity_tools.py`
- Modify: `tests/static/test_rd_multi_entry_pine.py`

**Interfaces:**
- Consumes: `candidate_id()`, `evidence_id()`, and `handling_id()` from
  `prop_trading.domain.rd_entry_models`; the Plan 1
  `validate_htf_flip_transcript()` bridge; and
  `contracts/vectors/rd-entry-arbitration-v2.json` including
  top-level `pine_edge_input.events[]` plus
  `pine_expected.htf_transcripts`.
- Produces: `normalize_log()`, `build_manifest()`,
  `project_pine_htf_observations()`, `compare_parity()`, and the stable
  comparator CLI consumed by the rollout plan.

The comparator CLI is frozen as:

```bash
uv run python scripts/compare_rd_pine_parity.py \
  --manifest tests/fixtures/rd_pine_parity/manifest.json \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --output reports/rd-entry-historical-parity-v2.json
```

The committed-report check is the same command with `--check`.

- [ ] **Step 1: Write failing comparator and normalization tests**

Create `tests/unit/test_rd_pine_parity_tools.py`:

```python
from __future__ import annotations

import hashlib
import json
from itertools import permutations
from pathlib import Path

import pytest

from scripts.build_rd_pine_parity_manifest import build_manifest
from scripts.compare_rd_pine_parity import (
    compare_parity,
    project_pine_htf_observations,
)
from scripts.normalize_rd_pine_log import normalize_log


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, sort_keys=True) + "\n", encoding="utf-8")


def canonical_sha256(value: object) -> str:
    payload = json.dumps(
        value, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()
    return hashlib.sha256(payload).hexdigest()


def complete_detector_inputs() -> dict[str, object]:
    return {
        "ticker_id": "OANDA:GBPJPY",
        "chart_type": "STANDARD_CANDLES",
        "chart_timeframe_minutes": 5,
        "lower_timeframe_minutes": 1,
        "max_zones": 120,
        "projection_bars": 120,
        "display_mode": "Raw audit",
        "premium_visuals": False,
        "clean_zones_per_level": 1,
        "setup_outcome_bars": 12,
        "show_fresh": True,
        "show_tapped": False,
        "show_invalidated": False,
        "show_liquidity_lines": False,
        "show_liquidity_proof_lines": False,
        "show_status_panel": False,
        "liquidity_pivot_strength": 2,
        "show_labels": False,
        "emit_diagnostics": False,
        "export_setup_events": False,
        "observe_realtime_entry_ticks": False,
        "producer_tag": "rd-entry-v3-historical-parity",
        "execution_mode": "OBSERVATION_ONLY",
    }


def write_parity_settings(path: Path, pine: Path) -> None:
    detector_inputs = complete_detector_inputs()
    write_json(
        path,
        {
            "schema_version": "rd-entry-pine-v3-parity-settings/v2",
            "detector_code_hash": hashlib.sha256(pine.read_bytes()).hexdigest(),
            "settings_hash": canonical_sha256(detector_inputs),
            "detector_inputs": detector_inputs,
            "capture_inputs": {
                "validation_capture": True,
                "validation_case_id_source": "manifest.case_id",
                "validation_setup_id_source": "oracle.setup_id",
                "validation_calculation_start_source": (
                    "oracle.calculation_start_epoch"
                ),
                "validation_emission_start_source": (
                    "oracle.emission_start_epoch"
                ),
                "validation_emission_end_source": (
                    "oracle.emission_end_epoch"
                ),
            },
        },
    )


def pine_event(*, case_id: str, setup_id: str) -> dict[str, object]:
    bar_open_epoch = 1_699_999_700
    bar_close_epoch = 1_700_000_000
    return {
        "schema_version": "rd-entry-pine-parity/v2",
        "case_id": case_id,
        "event_id": f"{setup_id}:{bar_close_epoch}",
        "bar_open_epoch": bar_open_epoch,
        "bar_close_epoch": bar_close_epoch,
        "emission_end_epoch": bar_close_epoch,
        "setup_id": setup_id,
        "direction": "LONG",
        "facts": {
            "zb": 90,
            "zt": 100,
            "ge": bar_open_epoch,
            "iv": False,
            "cf": "UNRESOLVED",
            "ak": "INITIAL",
            "tr": None,
            "te": None,
            "ng": None,
            "b": [
                {
                    "oe": bar_open_epoch,
                    "ce": bar_close_epoch,
                    "o": 105,
                    "h": 106,
                    "l": 101,
                    "c": 104,
                    "gb": False,
                    "rr": False,
                }
            ],
            "x": [],
        },
        "diagnostic_version": "PINE_DIAGNOSTIC_ONLY",
        "candidates": [],
        "evidence": [],
        "handling": [],
        "selection": {
            "v": "PINE_DIAGNOSTIC_ONLY",
            "k": None,
            "m": None,
            "a": None,
            "o": None,
            "r": "NO_CANDIDATE",
            "f": None,
            "x": "NONE",
        },
    }


def edge_input(
    setup_id: str,
    *,
    common_fidelity: str = "EXACT",
) -> dict[str, object]:
    return {
        "setup_id": setup_id,
        "events": [
            {
                "event_id": f"{setup_id}:1700000000",
                "match_request": {
                    "setup": {
                        "setup_id": setup_id,
                        "direction": "LONG",
                        "zone_top_ticks": 100,
                        "zone_bottom_ticks": 90,
                        "zone_engaged_epoch": 1_699_999_700,
                        "invalidated_before_entry": False,
                        "common_fidelity": common_fidelity,
                        "terminal_reason": None,
                        "terminal_epoch": None,
                    },
                    "confirmed_bar": {
                        "open_epoch": 1_699_999_700,
                        "close_epoch": 1_700_000_000,
                        "open_ticks": 105,
                        "high_ticks": 106,
                        "low_ticks": 101,
                        "close_ticks": 104,
                    },
                    "htf_proofs": [],
                    "generic_break_detected": False,
                    "rejection_respect_detected": False,
                    "attempt_kind": "INITIAL",
                    "trigger_ordinal": 1,
                },
            }
        ],
        "setup_invalidated": False,
        "policy_version": "rd-entry-arbitration-v2",
        "revision": 1,
        "evaluated_at_epoch": 1_700_000_000,
    }


def test_htf_projection_is_identical_for_all_six_context_orders() -> None:
    candidate_key = "HTF_FLIP:1699999200:1"
    common = {
        "candidate_key": candidate_key,
        "event_anchor_epoch": 1_699_999_200,
        "observed_trigger_epoch": 1_700_000_020,
        "observed_trigger_ticks": 105,
        "proof_plane": "LOWER_TIMEFRAME_REPLAY",
        "proof_resolution_seconds": 60,
    }
    observations = (
        {
            **common,
            "context_minutes": 15,
            "trigger_proof_exact": False,
            "state": "BLOCKED",
            "proof_partition": "ambiguous-same-child",
        },
        {
            **common,
            "context_minutes": 30,
            "trigger_proof_exact": True,
            "state": "MATCHED",
            "proof_partition": "exact-ordered",
        },
        {
            **common,
            "context_minutes": 60,
            "trigger_proof_exact": True,
            "state": "MATCHED",
            "proof_partition": "exact-ordered",
        },
    )
    rendered = [
        json.dumps(
            project_pine_htf_observations(order),
            sort_keys=True,
            separators=(",", ":"),
        )
        for order in permutations(observations)
    ]
    assert len(rendered) == 6
    assert len(set(rendered)) == 1
    projection = json.loads(rendered[0])
    assert projection["candidate"] == {
        "local_ref": candidate_key,
        "state": "MATCHED",
        "trigger_ordinal": 1,
    }
    assert projection["evidence"] == [
        {
            "htf_context_minutes": [15],
            "proof_partition": "ambiguous-same-child",
        },
        {
            "htf_context_minutes": [30, 60],
            "proof_partition": "exact-ordered",
        },
    ]


def test_normalizer_extracts_only_v2_parity_events(tmp_path: Path) -> None:
    raw = tmp_path / "pine.log"
    raw.write_text(
        '2026-07-24T12:00:00Z info noise\n'
        + "2026-07-24T12:00:01Z info "
        + json.dumps(pine_event(case_id="case-a", setup_id="setup-a"))
        + "\n",
        encoding="utf-8",
    )
    output = tmp_path / "events.jsonl"
    count = normalize_log(raw, output)
    assert count == 1
    assert json.loads(output.read_text(encoding="utf-8"))["case_id"] == "case-a"


def test_manifest_hashes_source_settings_capture_and_binds_cases(tmp_path: Path) -> None:
    pine = tmp_path / "source.pine"
    settings = tmp_path / "settings.json"
    capture = tmp_path / "events.jsonl"
    oracle = tmp_path / "oracle.json"
    pine.write_text("//@version=6\n", encoding="utf-8")
    write_parity_settings(settings, pine)
    capture.write_text(
        json.dumps(pine_event(case_id="case-a", setup_id="setup-a")) + "\n",
        encoding="utf-8",
    )
    write_json(
        oracle,
        {
            "schema_version": "2.0",
            "cases": [
                {
                    "case_id": "case-a",
                    "setup_id": "setup-a",
                    "symbol": "OANDA:GBPJPY",
                    "feed": "OANDA",
                    "calculation_start_epoch": 1_699_999_700,
                    "pine_supported": True,
                    "emission_start_epoch": 1_700_000_000,
                    "emission_end_epoch": 1_700_000_000,
                    "edge_input": edge_input("setup-a"),
                    "pine_edge_input": edge_input(
                        "setup-a",
                        common_fidelity="UNRESOLVED",
                    ),
                    "expected": {"htf_transcripts": []},
                    "pine_expected": {"htf_transcripts": []},
                }
            ],
        },
    )
    manifest = build_manifest(pine, settings, capture, oracle)
    assert manifest["status"] == "CAPTURED"
    assert manifest["pine_source_sha256"] == hashlib.sha256(
        pine.read_bytes()
    ).hexdigest()
    assert manifest["case_ids"] == ["case-a"]


def test_parity_report_has_closed_summary_and_per_case_diagnostics(
    tmp_path: Path,
) -> None:
    oracle = tmp_path / "oracle.json"
    capture = tmp_path / "events.jsonl"
    manifest = tmp_path / "manifest.json"
    pine = tmp_path / "source.pine"
    settings = tmp_path / "settings.json"
    pine.write_text("//@version=6\n", encoding="utf-8")
    write_parity_settings(settings, pine)
    write_json(
        oracle,
        {
            "schema_version": "2.0",
            "cases": [
                {
                    "case_id": "case-a",
                    "setup_id": "setup-a",
                    "symbol": "OANDA:GBPJPY",
                    "feed": "OANDA",
                    "calculation_start_epoch": 1_699_999_700,
                    "pine_supported": True,
                    "emission_start_epoch": 1_700_000_000,
                    "emission_end_epoch": 1_700_000_000,
                    "edge_input": edge_input("setup-a"),
                    "pine_edge_input": edge_input(
                        "setup-a",
                        common_fidelity="UNRESOLVED",
                    ),
                    "expected": {
                        "htf_transcripts": [],
                        "candidates": [],
                        "evidence": [],
                        "handling": [],
                        "selection": {
                            "canonical_candidate_id": None,
                            "reason": "NO_CANDIDATE",
                        },
                    },
                    "pine_expected": {
                        "htf_transcripts": [],
                        "candidates": [],
                        "evidence": [],
                        "handling": [],
                        "selection": {
                            "canonical_candidate_id": None,
                            "reason": "NO_CANDIDATE",
                        },
                    },
                }
            ],
        },
    )
    capture.write_text(
        json.dumps(pine_event(case_id="case-a", setup_id="setup-a")) + "\n",
        encoding="utf-8",
    )
    manifest_value = build_manifest(pine, settings, capture, oracle)
    write_json(manifest, manifest_value)
    report = compare_parity(manifest, oracle)
    assert report["schema_id"] == "phase0.rd-entry-historical-parity.v2"
    assert report["policy_version"] == "rd-entry-arbitration-v2"
    assert report["total_cases"] == 1
    assert report["matched_cases"] == 1
    assert report["case_match_rate_bps"] == 10_000
    assert report["mismatch_count"] == 0
    assert report["mismatches"] == []
    assert report["missing_count"] == 0
    assert report["missing_cases"] == []
    assert report["diagnostics"][0]["status"] == "MATCHED"


def test_conflicting_duplicate_case_event_is_a_mismatch(tmp_path: Path) -> None:
    capture = tmp_path / "events.jsonl"
    first = pine_event(case_id="case-a", setup_id="setup-a")
    second = pine_event(case_id="case-a", setup_id="setup-a")
    second["direction"] = "SHORT"
    capture.write_text(
        json.dumps(first) + "\n" + json.dumps(second) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="conflicting duplicate"):
        normalize_log(capture, tmp_path / "normalized.jsonl")
```

- [ ] **Step 2: Run the tool tests and verify imports fail**

Run:

```bash
uv run pytest tests/unit/test_rd_pine_parity_tools.py -v
```

Expected: collection fails because the three scripts do not exist.

- [ ] **Step 3: Add canonical parity log output to Pine**

Add:

```pine
validationCaseId = input.string("", "Validation case ID", group = "Validation", tooltip = "Required exact case ID printed by the parity manifest builder.")
validationSetupId = input.string("", "Validation setup ID", group = "Validation", tooltip = "Required exact setup ID printed by the parity manifest builder.")
validationEmissionStartEpoch = input.int(0, "Validation emission start epoch", minval = 0, group = "Validation")
validationEmissionEndEpoch = input.int(0, "Validation emission end epoch", minval = 0, group = "Validation")

entryParityEventId(RawZone zone) =>
    setupExportSetupId(zone) + ":" + str.tostring(epochSeconds(time_close))

entryParityPayload(RawZone zone) =>
    "{" +
     "\"schema_version\":\"rd-entry-pine-parity/v2\"," +
     "\"case_id\":" + jsonString(validationCaseId) + "," +
     "\"event_id\":" + jsonString(entryParityEventId(zone)) + "," +
     "\"bar_open_epoch\":" + str.tostring(epochSeconds(time)) + "," +
     "\"bar_close_epoch\":" + str.tostring(epochSeconds(time_close)) + "," +
     "\"emission_end_epoch\":" + str.tostring(validationEmissionEndEpoch) + "," +
     "\"setup_id\":" + jsonString(setupExportSetupId(zone)) + "," +
     "\"direction\":" + jsonString(entryDirection(zone)) + "," +
     "\"facts\":" + entryAuthoritativeFactsPayload(zone) + "," +
     "\"diagnostic_version\":\"PINE_DIAGNOSTIC_ONLY\"," +
     "\"candidates\":[" + joinEntryCandidatePayloads(orderedEntryCandidates(zone)) + "]," +
     "\"evidence\":[" + joinEntryEvidencePayloads(zone, orderedEntryCandidates(zone)) + "]," +
     "\"handling\":[" + joinEntryHandlingPayloads(zone, orderedEntryCandidates(zone)) + "]," +
     "\"selection\":" + diagnosticEntrySelectionPayload(zone, orderedEntryCandidates(zone)) + "}"
```

When `validationCapture` is enabled, require nonempty case/setup IDs and a valid
positive emission range. Log one parity event for the target setup on every
confirmed close in the inclusive emission range:

```pine
bool validationRangeValid = validationEmissionStartEpoch > 0 and validationEmissionEndEpoch >= validationEmissionStartEpoch
bool validationCloseInRange = epochSeconds(time_close) >= validationEmissionStartEpoch and epochSeconds(time_close) <= validationEmissionEndEpoch
if barstate.isconfirmed and validationCapture and validationRangeValid and validationCloseInRange and str.length(validationCaseId) > 0 and setupExportSetupId(zone) == validationSetupId
    log.info(entryParityPayload(zone))
```

Never include the export credential, alert envelope, raw settings, or user
inputs other than the explicit case ID, target setup ID, and emission range in
parity logs. The case ID is an operator binding to the oracle fixture; it is not
derived from a Pine hash or candidate. The comparator requires the emitted
setup ID, event range, and `emission_end_epoch` to equal the oracle case.

Append a static test:

```python
def test_parity_log_is_event_stream_bound_and_secret_free() -> None:
    payload = pine_function_body("entryParityPayload")
    assert "rd-entry-pine-parity/v2" in payload
    assert '\\"case_id\\":' in payload
    assert '\\"event_id\\":' in payload
    assert '\\"bar_open_epoch\\":' in payload
    assert '\\"bar_close_epoch\\":' in payload
    assert '\\"emission_end_epoch\\":' in payload
    assert '\\"setup_id\\":' in payload
    assert '\\"facts\\":' in payload
    assert '\\"candidates\\":' in payload
    assert '\\"evidence\\":' in payload
    assert '\\"handling\\":' in payload
    assert '\\"selection\\":' in payload
    assert "setupExportCredential" not in payload
    assert 'validationCaseId = input.string("",' in source()
    assert 'validationSetupId = input.string("",' in source()
    assert 'validationEmissionStartEpoch = input.int(0,' in source()
    assert 'validationEmissionEndEpoch = input.int(0,' in source()
    assert "entryParityEventId" in source()
    assert "entryParityCaseId" not in source()
```

- [ ] **Step 4: Implement deterministic TradingView log normalization**

`normalize_rd_pine_log.py` must:

1. scan each input line for the first `{`;
2. parse strict JSON from that position;
3. retain only `schema_version=rd-entry-pine-parity/v2`;
4. canonicalize with `canonical_json_bytes()`;
5. deduplicate identical `(case_id,event_id)` payloads;
6. reject conflicting duplicates;
7. sort by `case_id`, `bar_close_epoch`, then `event_id`;
8. write one compact JSON object per line with final newline.

Expose the exact signature
`normalize_log(input_path: Path, output_path: Path) -> int`.

CLI:

```bash
uv run python scripts/normalize_rd_pine_log.py \
  --input /tmp/rd-entry-pine-v3.log \
  --output tests/fixtures/rd_pine_parity/events.jsonl
```

- [ ] **Step 5: Implement the digest-bound manifest builder**

Expose the exact signature
`build_manifest(pine_source: Path, settings: Path, capture: Path, oracle: Path) -> dict[str, object]`.
Implement `sha256_file(path)` as
`hashlib.sha256(path.read_bytes()).hexdigest()`. Parse the oracle cases and set
`oracle_case_ids` to the sorted IDs for which `pine_supported is True`; reject a
case without an explicit boolean support flag. Domain-only re-entry cases remain
in the oracle but are not silently counted as missing Pine cases.

Validate the settings document before building:

- `detector_code_hash == sha256_file(pine_source)`;
- `settings_hash == canonical_sha256(settings["detector_inputs"])`;
- both digests are lowercase 64-character hex and are not all zeroes.

The returned mapping has exactly these keys:

```python
return {
    "schema_version": "rd-entry-pine-parity-manifest/v2",
    "status": "CAPTURED",
    "pine_source_path": pine_source.as_posix(),
    "pine_source_sha256": sha256_file(pine_source),
    "settings_path": settings.as_posix(),
    "settings_sha256": sha256_file(settings),
    "capture_path": capture.as_posix(),
    "capture_sha256": sha256_file(capture),
    "oracle_path": oracle.as_posix(),
    "oracle_sha256": sha256_file(oracle),
    "case_ids": sorted(oracle_case_ids),
}
```

CLI:

```bash
uv run python scripts/build_rd_pine_parity_manifest.py \
  --pine-source scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  --settings config/phase0/rd-entry-pine-v3-parity-settings.json \
  --capture tests/fixtures/rd_pine_parity/events.jsonl \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --output tests/fixtures/rd_pine_parity/manifest.json
```

Add `--print-replay-windows`; this mode does not require the capture file to
exist. It prints case ID, symbol, feed, calculation start, emission start, and
emission end for every `pine_supported=true` case in chronological order.
Each line also prints the oracle's exact setup ID used by the validation input.
Add `--print-required-hashes`; it accepts a settings document that contains
`detector_inputs` but does not yet contain the two digest fields, prints the
current Pine source SHA-256 and canonical `detector_inputs` SHA-256, and performs
no write. Once the fields exist, the same mode validates that they match.

- [ ] **Step 6: Implement canonical ID expansion and parity comparison**

Expose
`project_pine_htf_observations(observations: Sequence[Mapping[str, object]]) ->
dict[str, object]`. Validate the exact observation keys exercised above and
require one semantic candidate key/anchor/trigger. Choose candidate state by
the same raw tuple as Pine:
`(0 if trigger_proof_exact else 1, NORMALIZED=0|MATCHED=1|BLOCKED=2)`.
Partition evidence by `proof_partition` plus every non-context proof field,
merge only distinct context minutes, sort each context list numerically, and
sort evidence partitions by their canonical JSON bytes. Return exactly the
`candidate`/`evidence` mapping asserted by the test. The comparator uses this
helper when projecting `pine_expected`; it is not a test-only mirror.

`compare_rd_pine_parity.py` must:

1. validate manifest schema/status and every SHA-256 before reading events;
2. treat manifest `case_ids` as the complete supported Pine subset, reject an
   empty subset, reject unknown case IDs or duplicate `(case_id,event_id)`
   records, group each case's events chronologically, and require every captured
   setup ID and `emission_end_epoch` to equal its oracle case, and require every
   `bar_close_epoch` to lie inside that case's inclusive
   `[emission_start_epoch, emission_end_epoch]` window;
3. require each event's `facts.b` to contain 1–4 unique contiguous candles in
   chronological order and require its last candle to equal that event's
   `bar_open_epoch`/`bar_close_epoch`. Across ordinary adjacent events, require
   successive windows to overlap exactly (the retained suffix from the prior
   event followed by the current candle). If the current bar opens after the
   prior event's last close because the chart has a market-session
   discontinuity, require `facts.b` to reset to exactly the current bar and
   require no `facts.x` transcript to bridge the gap. Any backward or
   overlapping timestamp remains invalid. Expand only that last candle into the current
   `match_request`; earlier retained candles prove continuity and must not
   create duplicate requests. Require every `facts.x` transcript cutoff to map
   to exactly one retained candle; attach only transcripts mapped to the last
   candle to the current request, while older mapped transcripts must agree
   with the already reconstructed earlier event and must not be replayed as new
   proof. For the one post-terminal grace event, require `facts.b` to end at the
   previously reconstructed BOTH terminal and expand `facts.ng`—not the last
   `b` item—into the following confirmed candle with repeated terminal facts
   and empty trigger inputs. Reject `ng` anywhere else and never run an
   additional normal matcher projection for that payload. Expand compact
   `facts` into `SetupEntryFacts`, the current confirmed `OrderedCandle`, and the Plan 1
   `HTFFlipProofTranscript` type; call the Plan 1 transcript validator rather
   than duplicating HTF rules, and compare the resulting chronological requests
   one-for-one with `pine_edge_input.events[].match_request`; reject a Pine view
   whose setup common fidelity is anything other than `UNRESOLVED`;
4. compare expanded transcripts with each vector's
   `pine_expected.htf_transcripts`, whose values are derived from the vector's
   raw children;
5. run the Plan 1 matcher/oracle from the expanded authoritative facts to
   reconstruct candidate, evidence, handling, and selection domain objects;
6. compute every evidence `payload_sha256` only from the canonical expanded,
   credential-free proof mapping frozen in Plan 1, then construct
   `EntryEvidenceIdentity` and call `evidence_id()`; never hash the receipt,
   chunk, compact diagnostic item, or full parity event for this field;
7. construct handling identity from the authoritative candidate ID,
   authoritative evidence ID, handling mode, attempt, observation, fidelity,
   and full source-claim tuple, then call `handling_id()`;
8. expand Pine diagnostic candidate/evidence/handling indices separately,
   derive their candidate/evidence/handling IDs with the same domain helpers,
   and compare them with the reconstructed authoritative objects;
9. validate Pine's diagnostic selected `k/m/a/o` tuple, derive its candidate
   ID, and compare that ID and reason with authoritative arbitration;
10. report missing, mismatched, and matched cases deterministically.

For every supported case, compare the reconstructed current-producer result
with `pine_expected`, never the authoritative-domain `expected` view. Candidate
identities and trigger chronology may match both views, but effective evidence
fidelity, evidence/handling IDs, selection, and paper eligibility can
legitimately differ because current V3 exports
`common_fidelity=UNRESOLVED`. Reject a vector when `pine_edge_input` differs
from `edge_input` anywhere except common-fidelity paths replaced with
`UNRESOLVED`. Historical parity proves the current fail-closed producer; it is
not permission to reinterpret calibrated setup provenance as exact.

The expanded proof mapping used in step 6 is exactly:

```python
{
    "ambiguity_codes": list(evidence.ambiguity_codes),
    "candidate_id": evidence.candidate_id,
    "coverage_end_epoch": evidence.coverage_end_epoch,
    "coverage_start_epoch": evidence.coverage_start_epoch,
    "failed_rule_ids": list(evidence.failed_rule_ids),
    "fidelity": evidence.fidelity.value,
    "htf_context_minutes": list(evidence.htf_context_minutes),
    "observed_trigger_epoch": evidence.observed_trigger_epoch,
    "observed_trigger_ticks": evidence.observed_trigger_ticks,
    "passed_rule_ids": list(evidence.passed_rule_ids),
    "proof_plane": evidence.proof_plane.value,
    "proof_resolution_seconds": evidence.proof_resolution_seconds,
    "source_claim_ids": list(evidence.source_claim_ids),
}
```

Expose the exact signature
`compare_parity(manifest_path: Path, oracle_path: Path) -> dict[str, object]`.

Return exactly:

```python
{
    "schema_id": "phase0.rd-entry-historical-parity.v2",
    "policy_version": "rd-entry-arbitration-v2",
    "manifest_sha256": manifest_sha256,
    "oracle_sha256": oracle_sha256,
    "total_cases": len(case_ids),
    "matched_cases": matched_count,
    "case_match_rate_bps": matched_count * 10_000 // len(case_ids),
    "mismatch_count": len(mismatch_case_ids),
    "mismatches": sorted(mismatch_case_ids),
    "missing_count": len(missing_case_ids),
    "missing_cases": sorted(missing_case_ids),
    "diagnostics": diagnostics_sorted_by_case_id,
}
```

Each diagnostic contains:

```python
{
    "case_id": case_id,
    "status": "MATCHED" | "MISMATCH" | "MISSING",
    "expected_htf_transcripts": expected_htf_transcripts,
    "actual_htf_transcripts": actual_htf_transcripts,
    "expected_candidate_ids": expected_candidate_ids,
    "actual_candidate_ids": actual_candidate_ids,
    "expected_evidence_ids": expected_evidence_ids,
    "actual_evidence_ids": actual_evidence_ids,
    "expected_handling_ids": expected_handling_ids,
    "actual_handling_ids": actual_handling_ids,
    "expected_selection": expected_selection,
    "actual_selection": actual_selection,
    "mismatch_paths": sorted(mismatch_paths),
}
```

`total_cases` is always derived from manifest `case_ids`; never hardcode 19, 20,
24, or any other fixture total. `missing_count` is relative to that supported
subset, not every domain-only oracle case.

CLI behavior:

- without `--check`, write canonical pretty JSON plus final newline;
- with `--check`, compare generated bytes with the existing output and exit 1 on
  any difference;
- exit 1 when `mismatches` or `missing_cases` is nonempty in both modes.

- [ ] **Step 7: Run parity-tool and Pine-log tests**

Run:

```bash
uv run pytest tests/unit/test_rd_pine_parity_tools.py \
  tests/static/test_rd_multi_entry_pine.py -v
uv run ruff check scripts/normalize_rd_pine_log.py \
  scripts/build_rd_pine_parity_manifest.py \
  scripts/compare_rd_pine_parity.py \
  tests/unit/test_rd_pine_parity_tools.py
uv run mypy
```

Expected: every command passes.

- [ ] **Step 8: Commit the parity toolchain**

```bash
git add scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  scripts/normalize_rd_pine_log.py \
  scripts/build_rd_pine_parity_manifest.py \
  scripts/compare_rd_pine_parity.py \
  tests/static/test_rd_multi_entry_pine.py \
  tests/unit/test_rd_pine_parity_tools.py
git commit -m "test: add Pine oracle parity toolchain"
```

### Task 7: Compile V3 in TradingView and commit a hash-bound historical capture

**Files:**
- Create: `config/phase0/rd-entry-pine-v3-parity-settings.json`
- Create: `tests/fixtures/rd_pine_parity/events.jsonl`
- Create: `tests/fixtures/rd_pine_parity/manifest.json`
- Create: `reports/rd-entry-historical-parity-v2.json`
- Create: `docs/runbooks/rd-entry-pine-v3-parity.md`
- Create: `tests/static/test_rd_pine_parity_runbook.py`
- Modify: `Makefile`

**Interfaces:**
- Consumes: V3 source, oracle vectors, normalization/manifest/comparator CLIs.
- Produces: a reproducible TradingView compile/replay procedure, captured events, and a zero-mismatch historical report used by the rollout plan.

- [ ] **Step 1: Write the failing runbook-contract test**

Create `tests/static/test_rd_pine_parity_runbook.py`:

```python
from pathlib import Path

RUNBOOK = Path("docs/runbooks/rd-entry-pine-v3-parity.md")


def test_runbook_freezes_compile_replay_and_comparator_steps() -> None:
    text = RUNBOOK.read_text(encoding="utf-8")
    for required in (
        "SND_RD_5M_V3_MULTI_ENTRY_LAB.pine",
        "OANDA:GBPJPY",
        "5-minute standard candles",
        "Observe realtime HTF ticks: off",
        "Export non-executable setup events: off",
        "Validation capture: on",
        "Validation case ID",
        "Validation setup ID",
        "Validation emission start epoch",
        "Detector code SHA-256",
        "Settings SHA-256",
        "12 chunks",
        "43000597494",
        "Bar Replay does not prove webhook delivery",
        "normalize_rd_pine_log.py",
        "build_rd_pine_parity_manifest.py",
        "compare_rd_pine_parity.py",
        "--check",
        "total_cases == matched_cases",
        "case_match_rate_bps == 10000",
        "mismatch_count == 0",
        "mismatches == []",
        "missing_count == 0",
        "missing_cases == []",
    ):
        assert required in text
```

- [ ] **Step 2: Run and verify the runbook is absent**

Run:

```bash
uv run pytest tests/static/test_rd_pine_parity_runbook.py -v
```

Expected: failure with `FileNotFoundError`.

- [ ] **Step 3: Freeze the parity settings profile**

Create `config/phase0/rd-entry-pine-v3-parity-settings.json`:

```json
{
  "schema_version": "rd-entry-pine-v3-parity-settings/v2",
  "detector_inputs": {
    "ticker_id": "OANDA:GBPJPY",
    "chart_type": "STANDARD_CANDLES",
    "chart_timeframe_minutes": 5,
    "lower_timeframe_minutes": 1,
    "max_zones": 120,
    "projection_bars": 120,
    "display_mode": "Raw audit",
    "premium_visuals": false,
    "clean_zones_per_level": 1,
    "setup_outcome_bars": 12,
    "show_fresh": true,
    "show_tapped": false,
    "show_invalidated": false,
    "show_liquidity_lines": false,
    "show_liquidity_proof_lines": false,
    "show_status_panel": false,
    "liquidity_pivot_strength": 2,
    "show_labels": false,
    "emit_diagnostics": false,
    "export_setup_events": false,
    "observe_realtime_entry_ticks": false,
    "producer_tag": "rd-entry-v3-historical-parity",
    "execution_mode": "OBSERVATION_ONLY"
  },
  "capture_inputs": {
    "validation_capture": true,
    "validation_case_id_source": "manifest.case_id",
    "validation_setup_id_source": "oracle.setup_id",
    "validation_calculation_start_source": "oracle.calculation_start_epoch",
    "validation_emission_start_source": "oracle.emission_start_epoch",
    "validation_emission_end_source": "oracle.emission_end_epoch"
  }
}
```

Freeze the exact `detector_inputs` key set in
`build_rd_pine_parity_manifest.py` and its unit tests. Reject missing or extra
keys, even when the resulting digest is internally self-consistent. The set
includes every inherited input that can affect zone creation, qualification,
retention, resource pressure, diagnostics, or entry output. Color-only inputs
are explicitly presentation-only and excluded; the raw credential is secret
and excluded; per-case validation IDs/windows live only under `capture_inputs`.
Any later behavior-affecting Pine input requires a reviewed settings-schema
change and a fresh capture rather than silently retaining the old hash.

Run:

```bash
uv run python scripts/build_rd_pine_parity_manifest.py \
  --pine-source scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  --settings config/phase0/rd-entry-pine-v3-parity-settings.json \
  --print-required-hashes
```

Expected: exactly two lowercase 64-hex values labeled `detector_code_hash` and
`settings_hash`. Use `apply_patch` to add those exact literal values as top-level
fields beside `schema_version`; do not use a placeholder, `unverified`, all
zeroes, shell redirection, or a generated value copied from a different source
revision. Rerun the command; it must report both hashes valid.

Run:

```bash
uv run python scripts/build_rd_pine_parity_manifest.py \
  --pine-source scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  --settings config/phase0/rd-entry-pine-v3-parity-settings.json \
  --capture tests/fixtures/rd_pine_parity/events.jsonl \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --print-replay-windows
```

Expected: one chronological replay-window line per supported Pine oracle case. Save the terminal
output with the review evidence; do not invent or widen dates. The tool prints
only manifest-supported Pine cases, so the count derives from the manifest and
is not hardcoded.

- [ ] **Step 4: Save and compile the exact V3 bytes in TradingView**

In TradingView:

1. Open `OANDA:GBPJPY` with 5-minute standard candles.
2. Open Pine Editor and replace the editor contents with the exact bytes from
   `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine`.
3. Save as `SND RD 5M V3 MULTI ENTRY LAB`.
4. Select **Add to chart**.
5. Confirm the editor shows no compile error and the chart status shows
   `SND RD 5M V3 MULTI ENTRY LAB`.
6. Apply every value from
   `config/phase0/rd-entry-pine-v3-parity-settings.json`.
7. Paste the file's exact `detector_code_hash` into **Detector code SHA-256**
   and exact `settings_hash` into **Settings SHA-256**.
8. Leave **Observe realtime HTF ticks** off.
9. Leave **Export non-executable setup events** off.
10. Turn **Validation capture** on.

If compilation fails, stop this task. Fix the repository source, rerun the static
suite, recommit, paste the new exact bytes, and compile again before capturing
logs.

- [ ] **Step 5: Run each exact historical Bar Replay window**

For every window printed in Step 3:

1. set **Validation case ID** and **Validation setup ID** to the printed values,
   and set **Validation emission start epoch** and **Validation emission end
   epoch** to the printed range;
2. set **Calculation start**, **Emission start**, and **Emission end** to the
   printed epochs converted to the chart timezone;
3. start Bar Replay at the printed calculation-start candle;
4. advance through the emission-end candle;
5. confirm the Pine Logs pane includes
   `schema_version":"rd-entry-pine-parity/v2"`;
6. copy the complete Pine Logs output for the window into
   `/tmp/rd-entry-pine-v3.log`, appending subsequent windows without editing JSON.

Bar Replay does not prove webhook delivery. Do not enable the webhook export input
during this capture.

- [ ] **Step 6: Normalize capture and bind source/settings/oracle hashes**

Run:

```bash
uv run python scripts/normalize_rd_pine_log.py \
  --input /tmp/rd-entry-pine-v3.log \
  --output tests/fixtures/rd_pine_parity/events.jsonl
uv run python scripts/build_rd_pine_parity_manifest.py \
  --pine-source scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  --settings config/phase0/rd-entry-pine-v3-parity-settings.json \
  --capture tests/fixtures/rd_pine_parity/events.jsonl \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --output tests/fixtures/rd_pine_parity/manifest.json
```

Expected: both commands exit zero; the manifest status is `CAPTURED`, and all four
digests are lowercase 64-character SHA-256 values.

- [ ] **Step 7: Generate and verify the historical parity report**

Run the frozen command:

```bash
uv run python scripts/compare_rd_pine_parity.py \
  --manifest tests/fixtures/rd_pine_parity/manifest.json \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --output reports/rd-entry-historical-parity-v2.json
```

Expected: exit zero and report invariants:

```text
total_cases == matched_cases
case_match_rate_bps == 10000
mismatch_count == 0
mismatches == []
missing_count == 0
missing_cases == []
```

Run the committed-byte check:

```bash
uv run python scripts/compare_rd_pine_parity.py \
  --manifest tests/fixtures/rd_pine_parity/manifest.json \
  --oracle contracts/vectors/rd-entry-arbitration-v2.json \
  --output reports/rd-entry-historical-parity-v2.json \
  --check
```

Expected: exit zero with no diff.

- [ ] **Step 8: Write the exact parity runbook**

Create `docs/runbooks/rd-entry-pine-v3-parity.md` with:

- the settings file and `OANDA:GBPJPY` 5-minute standard candles;
- the exact compile steps from Step 4;
- the exact replay steps from Step 5;
- the three commands from Steps 6 and 7;
- the statement `Bar Replay does not prove webhook delivery`;
- the six report invariants;
- the rule that any Pine source/settings/oracle byte change invalidates the
  manifest and requires a fresh capture;
- the rule that realtime-only evidence remains shadow and is not part of the
  historical exact-proof gate;
- the exact detector/settings hash entry steps and the fail-closed prohibition
  on `unverified`, empty, uppercase, or non-64-character values;
- the 12-chunk cap, one-batch-per-confirmed-5m-close rule, and the TradingView
  alert-frequency source
  <https://www.tradingview.com/support/solutions/43000597494-alerts-on-alert-function/>.

- [ ] **Step 9: Add parity verification to Make**

Add:

```make
.PHONY: verify-rd-pine-parity

verify-rd-pine-parity:
	$(PYTHON) scripts/compare_rd_pine_parity.py \
		--manifest tests/fixtures/rd_pine_parity/manifest.json \
		--oracle contracts/vectors/rd-entry-arbitration-v2.json \
		--output reports/rd-entry-historical-parity-v2.json --check
```

Add `verify-rd-pine-parity` as a dependency of `verify-observation`.

- [ ] **Step 10: Run capture, runbook, and static verification**

Run:

```bash
uv run pytest tests/static/test_rd_pine_parity_runbook.py \
  tests/static/test_rd_multi_entry_pine.py \
  tests/unit/test_rd_pine_parity_tools.py -v
make verify-rd-pine-parity
```

Expected: every test passes and parity check exits zero.

- [ ] **Step 11: Commit historical parity evidence**

```bash
git add config/phase0/rd-entry-pine-v3-parity-settings.json \
  tests/fixtures/rd_pine_parity/events.jsonl \
  tests/fixtures/rd_pine_parity/manifest.json \
  reports/rd-entry-historical-parity-v2.json \
  docs/runbooks/rd-entry-pine-v3-parity.md \
  tests/static/test_rd_pine_parity_runbook.py Makefile
git commit -m "test: prove Pine V3 historical oracle parity"
```

### Task 8: Document V2/V3 roles and run the complete repository proof

**Files:**
- Modify: `README.md:68`
- Modify: `docs/development.md:76`
- Verify: all files created or modified by Tasks 1–7

**Interfaces:**
- Consumes: passing Pine static tests, Python oracle tests, edge schema-2.0 tests, and committed parity report.
- Produces: a discoverable shadow-only V3 workflow and a full clean verification gate.

- [ ] **Step 1: Write a failing documentation assertion**

Append to `tests/static/test_rd_pine_parity_runbook.py`:

```python
def test_repository_docs_distinguish_live_v2_from_shadow_v3() -> None:
    readme = Path("README.md").read_text(encoding="utf-8")
    development = Path("docs/development.md").read_text(encoding="utf-8")
    for text in (readme, development):
        assert "SND_RD_5M_V2_LAB.pine" in text
        assert "SND_RD_5M_V3_MULTI_ENTRY_LAB.pine" in text
        assert "schema 2.0" in text
        assert "PINE_DIAGNOSTIC_ONLY" in text
        assert "make verify-rd-pine-parity" in text
```

- [ ] **Step 2: Run and verify the documentation assertion fails**

Run:

```bash
uv run pytest tests/static/test_rd_pine_parity_runbook.py \
  -k repository_docs -v
```

Expected: failure because README and development docs do not yet describe V3.

- [ ] **Step 3: Document exact V2/V3 roles**

Add this content to both documents, adapting only surrounding Markdown:

```markdown
`SND_RD_5M_V2_LAB.pine` remains the immutable schema-1.2 producer.
`SND_RD_5M_V3_MULTI_ENTRY_LAB.pine` is the separate schema 2.0 multi-entry
shadow producer. V3 records bounded candidates and proof but labels Pine
selection `PINE_DIAGNOSTIC_ONLY`; the backend remains authoritative and no real
execution action exists.

Run `make verify-rd-pine-parity` to verify the hash-bound TradingView historical
capture against the Python oracle. Recreate the V3 TradingView alert after every
approved source or settings change because existing alerts retain their saved
script snapshot.
```

- [ ] **Step 4: Run targeted formatting, lint, types, and tests**

Run:

```bash
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run pytest tests/static/test_paper_automation_pine.py \
  tests/static/test_rd_multi_entry_pine.py \
  tests/static/test_rd_pine_parity_runbook.py \
  tests/unit/test_rd_entry_models.py \
  tests/unit/test_rd_entry_matcher.py \
  tests/unit/test_rd_intrabar_oracle.py \
  tests/unit/test_rd_entry_arbitrator.py \
  tests/unit/test_rd_entry_oracle.py \
  tests/unit/test_rd_pine_parity_tools.py -v
make verify-rd-pine-parity
```

Expected: every command passes.

- [ ] **Step 5: Run the complete observation proof**

Run:

```bash
make verify-observation
```

Expected final line:

```text
OBSERVATION VERIFICATION PASSED — ingress records metadata and no execution surface exists
```

- [ ] **Step 6: Inspect the final diff for scope and safety**

Run:

```bash
git diff --check
git status --short
git diff -- scripts/pinescript/SND_RD_5M_V2_LAB.pine
rg -n 'strategy\.(entry|exit)|"action":"(OPEN|SETTLE)"|paper_commands|REAL_EXECUTION' \
  scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine
```

Expected:

- `git diff --check` emits no output;
- V2 diff emits no output;
- the prohibited-token search emits no output;
- status lists only intended implementation, tests, fixtures, reports, and docs.

- [ ] **Step 7: Commit documentation and final verification**

```bash
git add README.md docs/development.md \
  tests/static/test_rd_pine_parity_runbook.py
git commit -m "docs: document Pine V3 parity workflow"
```
