# RD Three Entry Methods Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve every canonical RD entry candidate to exactly one of `INTRABAR_FLIP`, `CLOSE_CONFIRMATION`, or profile-gated `NEXT_CANDLE_WICK` while preserving one trade per setup and replay-only paper eligibility.

**Architecture:** Keep candidate arbitration unchanged: `HTF_FLIP` and `DIR_CLOSE` remain the only active trigger models. Add a separate deterministic method-selection layer after arbitration, backed by immutable pair/session fill profiles and a replay-only wick resolver. Mirror its vectors in the Cloudflare edge, persist the method decision beside the canonical selection, display it in the console, and keep Pine realtime wick touches diagnostic-only.

**Tech Stack:** Python 3.12, dataclasses, Pydantic 2, pytest 8.4, canonical JSON/SHA-256, TypeScript 5.9, Vitest, Cloudflare Workers/D1, Next.js 16, React 19, Pine Script v6

## Global Constraints

- Active trigger models remain exactly `DIR_CLOSE` and `HTF_FLIP`.
- Entry methods are exactly `INTRABAR_FLIP`, `CLOSE_CONFIRMATION`, and `NEXT_CANDLE_WICK`.
- At most one paper trade may be produced for one `setup_id`.
- `HTF_FLIP` maps only to `INTRABAR_FLIP`.
- `DIR_CLOSE` defaults to `CLOSE_CONFIRMATION`.
- `NEXT_CANDLE_WICK` requires exactly one immutable matching `APPROVED` profile.
- A profile matches exact `feed_id`, exact `symbol`, and a half-open UTC minute window.
- `NEXT_CANDLE_WICK` uses a positive integer offset in price ticks and waits exactly `300` seconds.
- Zero matching profiles select `CLOSE_CONFIRMATION`.
- More than one matching profile returns `SHADOW_ONLY/CONFLICTING_FILL_PROFILES`.
- The long wick limit is `confirmed_close_ticks - limit_offset_ticks`; the short limit is `confirmed_close_ticks + limit_offset_ticks`.
- Only the contiguous next five-minute candle may fill the wick limit.
- A complete replayable limit touch fills once at the frozen limit price.
- No touch returns `MISSED_WICK_FILL` and produces no trade.
- Missing coverage, a session gap, or realtime-only evidence remains `SHADOW_ONLY`.
- A live TradingView tick may emit an immediate diagnostic but may not authorize paper or real execution.
- Existing rule contract `2.0.0`, arbitration policy `rd-entry-arbitration-v2`, and candidate IDs remain unchanged.
- Real execution remains prohibited.

## Execution order with the existing plan set

1. Complete Tasks 1–3 in this plan before starting
   `2026-07-24-rd-entry-edge-console.md`.
2. Complete base edge-console Tasks 1–7, then complete Task 4 in this plan.
3. Complete base edge-console Tasks 8–9, then complete Task 5 in this plan.
4. Complete base edge-console Task 10 with Task 5's storage and API included.
5. Complete base Pine parity Tasks 1–5, then complete Task 6 in this plan.
6. Complete base Pine parity Tasks 6–8.
7. Complete Task 7 in this plan before starting
   `2026-07-24-rd-entry-shadow-rollout.md`.

---

### Task 1: Freeze fill-profile and entry-method value objects

**Files:**
- Create: `src/prop_trading/domain/rd_entry_method.py`
- Create: `tests/unit/test_rd_entry_method.py`

**Interfaces:**
- Consumes: `EntryDirection`, `EntryModelV2`, `EntrySelection`, `ProofPlane`, and `SelectionAction` from `rd_entry_models.py`.
- Produces: `EntryMethod`, `EntryMethodAction`, `EntryMethodReason`, `DirectionalCloseMethod`, `RDEntryFillProfileV1`, and UTC profile matching.

- [ ] **Step 1: Write failing enum and profile-shape tests**

```python
import pytest

from prop_trading.domain.rd_entry_method import (
    DirectionalCloseMethod,
    EntryMethod,
    RDEntryFillProfileV1,
)


def test_entry_method_taxonomy_is_closed() -> None:
    assert tuple(EntryMethod) == (
        EntryMethod.INTRABAR_FLIP,
        EntryMethod.CLOSE_CONFIRMATION,
        EntryMethod.NEXT_CANDLE_WICK,
    )


def test_wick_profile_requires_offset_and_exact_300_second_wait() -> None:
    with pytest.raises(ValueError, match="limit_offset_ticks"):
        RDEntryFillProfileV1(
            profile_id="gbpjpy-london-wick-v1",
            version=1,
            feed_id="OANDA",
            symbol="GBPJPY",
            session_start_minute_utc=420,
            session_end_minute_utc=660,
            dir_close_method=DirectionalCloseMethod.NEXT_CANDLE_WICK,
            limit_offset_ticks=None,
            max_wait_seconds=300,
            evidence_manifest_sha256="1" * 64,
            status="APPROVED",
            approved_by="operator",
            approved_at_epoch=1_700_000_000,
        )
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
uv run pytest tests/unit/test_rd_entry_method.py -k "taxonomy or profile" -v
```

Expected: collection fails because `rd_entry_method` does not exist.

- [ ] **Step 3: Add the closed enums and immutable profile**

Implement these exact public enums:

```python
class EntryMethod(StrEnum):
    INTRABAR_FLIP = "INTRABAR_FLIP"
    CLOSE_CONFIRMATION = "CLOSE_CONFIRMATION"
    NEXT_CANDLE_WICK = "NEXT_CANDLE_WICK"


class DirectionalCloseMethod(StrEnum):
    CLOSE_CONFIRMATION = "CLOSE_CONFIRMATION"
    NEXT_CANDLE_WICK = "NEXT_CANDLE_WICK"


class EntryMethodAction(StrEnum):
    PAPER_ELIGIBLE = "PAPER_ELIGIBLE"
    PENDING_WICK = "PENDING_WICK"
    SHADOW_ONLY = "SHADOW_ONLY"
    MISSED = "MISSED"
    NONE = "NONE"


class EntryMethodReason(StrEnum):
    HTF_FLIP_SELECTED = "HTF_FLIP_SELECTED"
    DEFAULT_PROMPT_CLOSE = "DEFAULT_PROMPT_CLOSE"
    PROFILE_PROMPT_CLOSE = "PROFILE_PROMPT_CLOSE"
    PROFILE_WICK_PENDING = "PROFILE_WICK_PENDING"
    WICK_REPLAY_FILLED = "WICK_REPLAY_FILLED"
    MISSED_WICK_FILL = "MISSED_WICK_FILL"
    CONFLICTING_FILL_PROFILES = "CONFLICTING_FILL_PROFILES"
    INCOMPLETE_WICK_REPLAY = "INCOMPLETE_WICK_REPLAY"
    CANDIDATE_NOT_PAPER_ELIGIBLE = "CANDIDATE_NOT_PAPER_ELIGIBLE"
    NO_CANONICAL_CANDIDATE = "NO_CANONICAL_CANDIDATE"
```

Implement `RDEntryFillProfileV1` as a frozen slotted dataclass. Validate:

- `version >= 1`;
- nonempty identifiers;
- `0 <= session_start_minute_utc <= 1439`;
- `0 <= session_end_minute_utc <= 1439`;
- start and end differ;
- `max_wait_seconds == 300`;
- status is exactly `"APPROVED"`;
- wick profiles have a positive `limit_offset_ticks`;
- close profiles have `limit_offset_ticks is None`;
- the evidence digest is nonzero lowercase SHA-256.

- [ ] **Step 4: Add failing UTC-window tests**

```python
@pytest.mark.parametrize(
    ("start", "end", "minute", "expected"),
    (
        (420, 660, 420, True),
        (420, 660, 659, True),
        (420, 660, 660, False),
        (1320, 120, 1380, True),
        (1320, 120, 60, True),
        (1320, 120, 120, False),
    ),
)
def test_profile_session_is_half_open_and_may_wrap_midnight(
    start: int, end: int, minute: int, expected: bool
) -> None:
    assert utc_minute_in_window(minute, start=start, end=end) is expected
```

- [ ] **Step 5: Implement and verify UTC matching**

Implement:

```python
def utc_minute_in_window(minute: int, *, start: int, end: int) -> bool:
    if start < end:
        return start <= minute < end
    return minute >= start or minute < end
```

Run:

```bash
uv run pytest tests/unit/test_rd_entry_method.py -v
```

Expected: all Task 1 tests pass.

- [ ] **Step 6: Commit the value objects**

```bash
git add src/prop_trading/domain/rd_entry_method.py tests/unit/test_rd_entry_method.py
git commit -m "feat: freeze RD entry method profiles"
```

### Task 2: Resolve one method after canonical candidate arbitration

**Files:**
- Modify: `src/prop_trading/domain/rd_entry_method.py`
- Modify: `tests/unit/test_rd_entry_method.py`

**Interfaces:**
- Consumes: an authoritative `EntrySelection`, its canonical `EntryCandidate`, exact feed/symbol/session context, and zero or more profiles.
- Produces: immutable `EntryMethodContext`, `EntryMethodDecision`, `entry_method_decision_id()`, and `resolve_entry_method()`.

- [ ] **Step 1: Write failing priority and one-trade tests**

Add helpers that create authoritative `EntrySelection` and `EntryCandidate` values, then add:

```python
def test_exact_htf_flip_always_selects_intrabar_method() -> None:
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.HTF_FLIP),
        candidate=candidate(model=EntryModelV2.HTF_FLIP),
        context=context(),
        profiles=(wick_profile(),),
    )
    assert result.method is EntryMethod.INTRABAR_FLIP
    assert result.action is EntryMethodAction.PAPER_ELIGIBLE
    assert result.profile_id is None


def test_directional_close_defaults_to_prompt_close() -> None:
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=candidate(model=EntryModelV2.DIR_CLOSE),
        context=context(),
        profiles=(),
    )
    assert result.method is EntryMethod.CLOSE_CONFIRMATION
    assert result.action is EntryMethodAction.PAPER_ELIGIBLE


def test_one_wick_profile_creates_one_pending_fill() -> None:
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=candidate(model=EntryModelV2.DIR_CLOSE),
        context=context(close_ticks=18_500, direction=EntryDirection.LONG),
        profiles=(wick_profile(limit_offset_ticks=3),),
    )
    assert result.method is EntryMethod.NEXT_CANDLE_WICK
    assert result.action is EntryMethodAction.PENDING_WICK
    assert result.limit_ticks == 18_497
    assert result.wait_until_epoch == result.trigger_epoch + 300
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
uv run pytest tests/unit/test_rd_entry_method.py -k "selects or defaults or pending" -v
```

Expected: fail because `resolve_entry_method` and `EntryMethodDecision` are absent.

- [ ] **Step 3: Implement canonical method identity and selection**

Define:

```python
@dataclass(frozen=True, slots=True)
class EntryMethodContext:
    feed_id: str
    symbol: str
    evaluated_at_epoch: int
    trigger_epoch: int
    trigger_ticks: int
    direction: EntryDirection


@dataclass(frozen=True, slots=True)
class EntryMethodDecision:
    decision_id: str
    selection_id: str
    setup_id: str
    candidate_id: str | None
    method: EntryMethod | None
    action: EntryMethodAction
    reason: EntryMethodReason
    profile_id: str | None
    trigger_epoch: int | None
    trigger_ticks: int | None
    limit_ticks: int | None
    wait_until_epoch: int | None
    fill_epoch: int | None
    fill_ticks: int | None
    evaluated_at_epoch: int
```

`entry_method_decision_id()` must hash the canonical mapping with
`canonical_sha256()`. `resolve_entry_method()` must:

1. return `NONE/NO_CANONICAL_CANDIDATE` when the selection has no candidate;
2. return `SHADOW_ONLY/CANDIDATE_NOT_PAPER_ELIGIBLE` unless selection action is
   `PAPER_ELIGIBLE`;
3. map `HTF_FLIP` to `INTRABAR_FLIP`;
4. match profiles by exact feed, symbol, and UTC minute;
5. default zero matches to `CLOSE_CONFIRMATION`;
6. return `SHADOW_ONLY/CONFLICTING_FILL_PROFILES` for two or more matches;
7. honor one close profile;
8. compute one pending wick limit for one wick profile.

For `INTRABAR_FLIP` and `CLOSE_CONFIRMATION`, set `fill_epoch` and
`fill_ticks` equal to the canonical trigger and leave `limit_ticks` and
`wait_until_epoch` null. For `NEXT_CANDLE_WICK`, set only the frozen limit and
deadline; all fill fields remain null until replay resolution.

- [ ] **Step 4: Add conflict and ownership tests**

```python
def test_conflicting_profiles_never_guess_or_open() -> None:
    result = resolve_entry_method(
        selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
        candidate=candidate(model=EntryModelV2.DIR_CLOSE),
        context=context(),
        profiles=(wick_profile(profile_id="a"), wick_profile(profile_id="b")),
    )
    assert result.method is None
    assert result.action is EntryMethodAction.SHADOW_ONLY
    assert result.reason is EntryMethodReason.CONFLICTING_FILL_PROFILES


def test_candidate_must_be_the_selection_owner() -> None:
    with pytest.raises(ValueError, match="canonical candidate"):
        resolve_entry_method(
            selection=paper_selection(model=EntryModelV2.DIR_CLOSE),
            candidate=candidate(model=EntryModelV2.DIR_CLOSE, candidate_id="f" * 64),
            context=context(),
            profiles=(),
        )
```

- [ ] **Step 5: Run all method tests**

```bash
uv run pytest tests/unit/test_rd_entry_method.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit post-arbitration method selection**

```bash
git add src/prop_trading/domain/rd_entry_method.py tests/unit/test_rd_entry_method.py
git commit -m "feat: resolve one RD entry method"
```

### Task 3: Resolve replay-confirmed wick fills and freeze vectors

**Files:**
- Modify: `src/prop_trading/domain/rd_entry_method.py`
- Modify: `tests/unit/test_rd_entry_method.py`
- Create: `tests/fixtures/rd_entry_method_cases_v1.json`
- Create: `scripts/build_rd_entry_method_vectors.py`
- Create: `src/prop_trading/contracts/rd_entry_method_vectors_v1.py`
- Create: `contracts/vectors/rd-entry-method-v1.json`
- Modify: `scripts/export_schemas.py`
- Modify: `Makefile`
- Test: `tests/contract/test_contracts.py`

**Interfaces:**
- Consumes: a pending wick `EntryMethodDecision` and immutable replay coverage.
- Produces: `WickReplayEvidence`, `resolve_wick_fill()`, schema `phase0.rd-entry-method-vectors.v1`, and cross-language golden cases for the edge.

- [ ] **Step 1: Write failing replay resolution tests**

```python
def test_complete_lower_timeframe_touch_fills_once_at_frozen_limit() -> None:
    pending = pending_wick(limit_ticks=18_497)
    result = resolve_wick_fill(
        pending,
        WickReplayEvidence(
            proof_plane=ProofPlane.LOWER_TIMEFRAME_REPLAY,
            coverage_start_epoch=pending.trigger_epoch,
            coverage_end_epoch=pending.wait_until_epoch,
            coverage_complete=True,
            session_gap=False,
            touched_epoch=pending.trigger_epoch + 60,
            observed_low_ticks=18_496,
            observed_high_ticks=18_503,
        ),
    )
    assert result.action is EntryMethodAction.PAPER_ELIGIBLE
    assert result.reason is EntryMethodReason.WICK_REPLAY_FILLED
    assert result.fill_ticks == 18_497


def test_complete_no_touch_misses_without_close_fallback() -> None:
    result = resolve_wick_fill(
        pending_wick(limit_ticks=18_497),
        complete_replay(observed_low_ticks=18_498),
    )
    assert result.action is EntryMethodAction.MISSED
    assert result.reason is EntryMethodReason.MISSED_WICK_FILL
    assert result.method is EntryMethod.NEXT_CANDLE_WICK
    assert result.fill_ticks is None


@pytest.mark.parametrize(
    "evidence",
    (
        incomplete_replay(),
        replay_with_session_gap(),
        realtime_touch(),
    ),
)
def test_unreplayable_wick_never_becomes_paper_eligible(
    evidence: WickReplayEvidence,
) -> None:
    assert resolve_wick_fill(
        pending_wick(),
        evidence,
    ).action is EntryMethodAction.SHADOW_ONLY
```

- [ ] **Step 2: Run and verify RED**

```bash
uv run pytest tests/unit/test_rd_entry_method.py -k "wick or replay" -v
```

Expected: fail because replay resolution is absent.

- [ ] **Step 3: Implement exact wick replay rules**

`WickReplayEvidence` must validate:

- proof plane is `LOWER_TIMEFRAME_REPLAY`, `EXTERNAL_ARCHIVED_TICK`, or
  `REALTIME_TICK`;
- coverage epochs increase;
- optional touch epoch lies inside `[coverage_start_epoch, coverage_end_epoch)`;
- low is not above high.

`resolve_wick_fill()` must reject non-pending decisions, preserve the original
`decision_id` inputs in the new canonical mapping, require exact 300-second
coverage, return shadow for realtime/incomplete/gap evidence, fill a long when
`observed_low_ticks <= limit_ticks`, fill a short when
`observed_high_ticks >= limit_ticks`, and otherwise return `MISSED`.

- [ ] **Step 4: Add the fixture and vector builder**

Create at least these fixture case IDs:

```text
htf_ignores_wick_profile
dir_close_defaults_prompt
dir_close_explicit_prompt
dir_close_wick_pending_long
dir_close_wick_pending_short
conflicting_profiles_shadow
wick_long_filled_exact
wick_short_filled_exact
wick_complete_missed
wick_incomplete_shadow
wick_gap_shadow
wick_realtime_shadow
noneligible_candidate_shadow
no_candidate_none
```

`build_rd_entry_method_vectors.py` must parse the fixture through strict Pydantic
models, call the real domain functions, write canonical sorted JSON, and support
`--check` like `build_rd_entry_oracle_vectors.py`.

- [ ] **Step 5: Export and verify the schema**

Add `RDEntryMethodVectorSetV1` to `scripts/export_schemas.py`, add its generated
schema to `contracts/schema`, and add to `Makefile verify-generated`:

```make
	$(PYTHON) scripts/build_rd_entry_method_vectors.py \
		--fixtures tests/fixtures/rd_entry_method_cases_v1.json \
		--output contracts/vectors/rd-entry-method-v1.json --check
```

Run:

```bash
uv run pytest tests/unit/test_rd_entry_method.py tests/contract/test_contracts.py -v
uv run python scripts/build_rd_entry_method_vectors.py \
  --fixtures tests/fixtures/rd_entry_method_cases_v1.json \
  --output contracts/vectors/rd-entry-method-v1.json --check
uv run python scripts/export_schemas.py --output-dir contracts/schema --check
```

Expected: all tests and generated checks pass.

- [ ] **Step 6: Commit replay resolution and vectors**

```bash
git add src/prop_trading/domain/rd_entry_method.py \
  tests/unit/test_rd_entry_method.py \
  tests/fixtures/rd_entry_method_cases_v1.json \
  scripts/build_rd_entry_method_vectors.py \
  src/prop_trading/contracts/rd_entry_method_vectors_v1.py \
  contracts/vectors/rd-entry-method-v1.json \
  contracts/schema Makefile scripts/export_schemas.py \
  tests/contract/test_contracts.py
git commit -m "feat: freeze RD entry method vectors"
```

### Task 4: Mirror method selection in the Cloudflare edge

**Prerequisite:** Complete Tasks 1–7 of
`docs/superpowers/plans/2026-07-24-rd-entry-edge-console.md`.

**Files:**
- Create: `apps/observation-edge/src/entry-method.ts`
- Create: `apps/observation-edge/test/entry-method.test.ts`
- Modify: `apps/observation-edge/src/rd-entry-domain.ts`
- Modify: `apps/observation-edge/src/types.ts`
- Modify: `apps/observation-edge/test/entry-domain.test.ts`

**Interfaces:**
- Consumes: `contracts/vectors/rd-entry-method-v1.json` and the edge's authoritative canonical candidate selection.
- Produces: TypeScript `resolveEntryMethod()` and `resolveWickFill()` with byte-identical decision IDs and outputs.

- [ ] **Step 1: Add failing vector parity tests**

```typescript
import vectors from "../../../contracts/vectors/rd-entry-method-v1.json";
import {
  resolveEntryMethod,
  resolveWickFill,
} from "../src/entry-method";

describe("RD entry method parity", () => {
  for (const testCase of vectors.cases) {
    it(testCase.case_id, async () => {
      const actual =
        testCase.stage === "METHOD_SELECTION"
          ? await resolveEntryMethod(testCase.input)
          : await resolveWickFill(testCase.input);
      expect(actual).toEqual(testCase.expected);
    });
  }
});
```

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/observation-edge
npm test -- entry-method.test.ts
```

Expected: fail because `src/entry-method.ts` is absent.

- [ ] **Step 3: Implement the strict TypeScript mirror**

Use integer epoch/tick values only. Reject unknown fields and enum values. Use
the existing edge canonical JSON/SHA-256 helper rather than Node-only crypto.
Export these exact functions:

```typescript
export async function resolveEntryMethod(
  input: EntryMethodInput,
): Promise<EntryMethodDecision>;

export async function resolveWickFill(
  input: WickFillInput,
): Promise<EntryMethodDecision>;
```

The TypeScript result must equal every Python vector, including
`decision_id`, null placement, reason, and action.

- [ ] **Step 4: Run vector and base domain tests**

```bash
cd apps/observation-edge
npm test -- entry-method.test.ts entry-domain.test.ts
npm run typecheck
```

Expected: all tests pass with zero type errors.

- [ ] **Step 5: Commit edge parity**

```bash
git add apps/observation-edge/src/entry-method.ts \
  apps/observation-edge/src/rd-entry-domain.ts \
  apps/observation-edge/src/types.ts \
  apps/observation-edge/test/entry-method.test.ts \
  apps/observation-edge/test/entry-domain.test.ts
git commit -m "feat: mirror RD entry method selection at edge"
```

### Task 5: Persist profiles and expose one method decision in the app

**Prerequisite:** Complete Task 4 and base edge-console Tasks 1–9.

**Files:**
- Create: `apps/observation-edge/migrations/0024_rd_entry_fill_profiles.sql`
- Create: `apps/observation-edge/migrations/0025_rd_entry_method_decisions.sql`
- Create: `apps/observation-edge/src/entry-method-queries.ts`
- Modify: `apps/observation-edge/src/index.ts`
- Modify: `apps/observation-edge/src/types.ts`
- Modify: `apps/observation-edge/test/worker.test.ts`
- Modify: `apps/operations-console/src/lib/api.ts`
- Modify: `apps/operations-console/src/components/EntryEvaluations.tsx`
- Modify: `apps/operations-console/tests/entry-evaluations.test.tsx`

**Interfaces:**
- Consumes: authoritative candidate selection plus matching approved fill profiles.
- Produces: immutable profile rows, append-only method decisions, nested
  `entry_method` API output, and a console method/fill state.

- [ ] **Step 1: Write failing migration and API tests**

The migration test must assert:

```typescript
expect(profileMigration).toContain(
  "unique(feed_id, symbol, session_start_minute_utc, session_end_minute_utc, version)",
);
expect(profileMigration).toContain(
  "check(max_wait_seconds = 300)",
);
expect(methodMigration).toContain(
  "unique(setup_id, selection_id, revision)",
);
expect(methodMigration).toContain(
  "check(method in ('INTRABAR_FLIP','CLOSE_CONFIRMATION','NEXT_CANDLE_WICK'))",
);
```

The API test must assert one evaluation contains:

```typescript
expect(body.items[0].entry_method).toMatchObject({
  method: "CLOSE_CONFIRMATION",
  action: "PAPER_ELIGIBLE",
  reason: "DEFAULT_PROMPT_CLOSE",
  profile_id: null,
  fill_ticks: 18500,
});
```

- [ ] **Step 2: Run and verify RED**

```bash
cd apps/observation-edge
npm test -- worker.test.ts
```

Expected: fail because migrations and `entry_method` output do not exist.

- [ ] **Step 3: Add immutable D1 storage**

Profiles are inserted only by reviewed migration data in this increment; do not
add a public profile mutation route. Store every method decision append-only.
Use one D1 transaction to persist the canonical selection and initial method
decision. A later wick replay appends revision `1`; it never updates revision
`0`.

Create the profile table with this exact policy surface:

```sql
CREATE TABLE rd_entry_fill_profiles (
    profile_id TEXT PRIMARY KEY NOT NULL,
    version INTEGER NOT NULL CHECK (version >= 1),
    feed_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    session_start_minute_utc INTEGER NOT NULL
        CHECK (session_start_minute_utc BETWEEN 0 AND 1439),
    session_end_minute_utc INTEGER NOT NULL
        CHECK (session_end_minute_utc BETWEEN 0 AND 1439),
    dir_close_method TEXT NOT NULL
        CHECK (dir_close_method IN ('CLOSE_CONFIRMATION','NEXT_CANDLE_WICK')),
    limit_offset_ticks INTEGER,
    max_wait_seconds INTEGER NOT NULL CHECK (max_wait_seconds = 300),
    evidence_manifest_sha256 TEXT NOT NULL
        CHECK (length(evidence_manifest_sha256) = 64),
    status TEXT NOT NULL CHECK (status = 'APPROVED'),
    approved_by TEXT NOT NULL,
    approved_at_epoch INTEGER NOT NULL CHECK (approved_at_epoch >= 0),
    CHECK (session_start_minute_utc <> session_end_minute_utc),
    CHECK (
      (dir_close_method = 'CLOSE_CONFIRMATION' AND limit_offset_ticks IS NULL)
      OR
      (dir_close_method = 'NEXT_CANDLE_WICK' AND limit_offset_ticks > 0)
    ),
    UNIQUE(feed_id, symbol, session_start_minute_utc, session_end_minute_utc, version)
) STRICT;
```

Create `rd_entry_method_decisions` with the canonical decision fields from Task
2, `revision INTEGER NOT NULL CHECK (revision IN (0,1))`, and foreign keys to
`observation_entry_selections(selection_id)` and
`observation_entry_candidates(candidate_id)`. Its primary key is `decision_id`;
`UNIQUE(setup_id, selection_id, revision)` prevents conflicting replay results.

Add a unique partial invariant that permits at most one
`action='PAPER_ELIGIBLE'` method decision per `setup_id`. Reject a conflicting
insert before any paper intent is created.

```sql
CREATE UNIQUE INDEX uq_rd_entry_method_paper_fill
ON rd_entry_method_decisions(setup_id)
WHERE action = 'PAPER_ELIGIBLE';
```

- [ ] **Step 4: Add API and console method state**

Extend `GET /api/v1/observation-entry-evaluations` with:

```typescript
type EntryMethodReport = {
  decision_id: string;
  method: "INTRABAR_FLIP" | "CLOSE_CONFIRMATION" | "NEXT_CANDLE_WICK" | null;
  action: "PAPER_ELIGIBLE" | "PENDING_WICK" | "SHADOW_ONLY" | "MISSED" | "NONE";
  reason: string;
  profile_id: string | null;
  limit_ticks: number | null;
  wait_until_epoch: number | null;
  fill_epoch: number | null;
  fill_ticks: number | null;
};
```

Render:

- `Entry method`;
- `Immediate`, `Waiting for wick`, `Filled`, `Missed`, or `Shadow`;
- the selected profile ID;
- frozen limit and deadline when pending;
- final fill epoch/ticks when filled;
- the fail-closed reason.

- [ ] **Step 5: Verify edge and console**

```bash
cd apps/observation-edge
npm run lint
npm run typecheck
npm test
npm run build
cd ../operations-console
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all commands exit zero.

- [ ] **Step 6: Commit persistence and UI**

```bash
git add apps/observation-edge/migrations/0024_rd_entry_fill_profiles.sql \
  apps/observation-edge/migrations/0025_rd_entry_method_decisions.sql \
  apps/observation-edge/src/entry-method-queries.ts \
  apps/observation-edge/src/index.ts \
  apps/observation-edge/src/types.ts \
  apps/observation-edge/test/worker.test.ts \
  apps/operations-console/src/lib/api.ts \
  apps/operations-console/src/components/EntryEvaluations.tsx \
  apps/operations-console/tests/entry-evaluations.test.tsx
git commit -m "feat: expose one RD entry method decision"
```

### Task 6: Transport immediate shadow wick observations and replay facts from Pine

**Prerequisite:** Complete Tasks 1–5 of
`docs/superpowers/plans/2026-07-24-rd-entry-pine-parity.md`.

**Files:**
- Modify: `scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine`
- Modify: `tests/static/test_rd_multi_entry_pine.py`
- Modify: `tests/fixtures/rd_pine_parity/events.jsonl`
- Modify: `scripts/compare_rd_pine_parity.py`

**Interfaces:**
- Consumes: the existing V3 `NEXT_CANDLE_WICK` handling fact and realtime diagnostic store.
- Produces: one immediate shadow limit-touch diagnostic and one contiguous next-bar replay fact; Pine never selects a profile or authorizes a fill.

- [ ] **Step 1: Add failing Pine boundary tests**

```python
def test_pine_never_selects_fill_profiles_or_authorizes_wick_fill() -> None:
    text = source()
    assert "RDEntryFillProfile" not in text
    assert "resolveEntryMethod" not in text
    assert "WICK_REPLAY_FILLED" not in text
    assert "PAPER_ELIGIBLE" not in pine_function_body(
        "observeRealtimeNextCandleWick"
    )


def test_next_candle_fact_is_exactly_one_contiguous_bar() -> None:
    body = pine_function_body("collectNextCandleWickHandling")
    assert "time == closeCandidateTriggerEpoch" in body
    assert "time_close == closeCandidateTriggerEpoch + 300000" in body
    assert "later candle" not in body.lower()
```

- [ ] **Step 2: Run and verify RED**

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py -k "fill_profiles or contiguous" -v
```

Expected: fail because the realtime wick observer and exact guards are absent.

- [ ] **Step 3: Add realtime diagnostic and confirmed replay fact**

The realtime observer may emit:

```json
{
  "proof_plane": "REALTIME_TICK",
  "fidelity": "UNRESOLVED",
  "action": "SHADOW_ONLY",
  "reason": "REALTIME_ONLY_NOT_REPLAYABLE",
  "observed_epoch": 1700000060,
  "observed_ticks": 18497
}
```

The confirmed next-bar fact must carry complete 5m OHLC integer ticks and exact
open/close epochs. Pine does not receive profiles, compute a limit, choose a
method, or emit `PAPER_ELIGIBLE`; the edge applies reviewed profiles.

- [ ] **Step 4: Extend parity comparison**

Add one normalized case with a realtime diagnostic and matching confirmed
next-bar fact. Assert the realtime record does not change the authoritative
selection or method decision, while the confirmed fact can resolve the pending
wick through the Python/edge method oracle.

- [ ] **Step 5: Run Pine static and parity tests**

```bash
uv run pytest tests/static/test_rd_multi_entry_pine.py \
  tests/unit/test_rd_pine_parity_tools.py -v
```

Expected: all tests pass.

- [ ] **Step 6: Commit the Pine method evidence**

```bash
git add scripts/pinescript/SND_RD_5M_V3_MULTI_ENTRY_LAB.pine \
  tests/static/test_rd_multi_entry_pine.py \
  tests/fixtures/rd_pine_parity/events.jsonl \
  scripts/compare_rd_pine_parity.py
git commit -m "feat: export replayable RD wick evidence"
```

### Task 7: Keep wick profiles dormant through the shadow canary

**Files:**
- Modify: `docs/superpowers/plans/2026-07-24-rd-entry-shadow-rollout.md`
- Modify: `README.md`
- Modify: `scripts/static_boundary_check.py`
- Modify: `tests/static/test_boundaries.py`

**Interfaces:**
- Consumes: stored entry-method decisions and the existing shadow canary.
- Produces: a canary report split by method, with wick profiles disabled until a separate evidence commit approves them.

- [ ] **Step 1: Add failing rollout safety tests**

```python
def test_wick_profile_cannot_be_enabled_by_environment_flag() -> None:
    source = Path("apps/observation-edge/src/index.ts").read_text()
    assert "RD_NEXT_CANDLE_WICK_ENABLED" not in source
    assert "RDEntryFillProfileV1" in Path(
        "apps/observation-edge/src/entry-method.ts"
    ).read_text()


def test_shadow_rollout_requires_zero_initial_approved_wick_profiles() -> None:
    plan = Path(
        "docs/superpowers/plans/2026-07-24-rd-entry-shadow-rollout.md"
    ).read_text()
    assert "zero approved wick profiles during the first forward canary" in plan
    assert "realtime-to-replay correlation rate" in plan


def test_rollout_has_no_broker_or_real_execution_surface() -> None:
    from scripts.static_boundary_check import check

    check(Path("."))
```

- [ ] **Step 2: Run and verify RED**

```bash
uv run pytest tests/static/test_boundaries.py -k "wick_profile or execution" -v
```

Expected: `test_shadow_rollout_requires_zero_initial_approved_wick_profiles`
fails because the rollout plan does not yet contain the new gate.

- [ ] **Step 3: Freeze rollout requirements**

Update the base rollout plan's runbook task so
`docs/runbooks/rd-entry-v2-shadow-rollout.md` must require:

- zero approved wick profiles during the first forward canary;
- method counts for `INTRABAR_FLIP`, `CLOSE_CONFIRMATION`, and observed
  `NEXT_CANDLE_WICK`;
- realtime-to-replay correlation rate;
- complete next-bar coverage rate;
- conflicting profile count exactly zero;
- more than zero independently referenced heartbeat bars;
- no paper intent creation from schema 2.0;
- a separate reviewed backtest manifest and commit before the first profile row
  may be changed to `APPROVED`.

- [ ] **Step 4: Run the complete local proof**

```bash
make verify-observation
```

Expected final line:

```text
OBSERVATION VERIFICATION PASSED — ingress records metadata and no execution surface exists
```

- [ ] **Step 5: Commit rollout guards**

```bash
git add docs/superpowers/plans/2026-07-24-rd-entry-shadow-rollout.md \
  README.md \
  scripts/static_boundary_check.py tests/static/test_boundaries.py
git commit -m "docs: guard RD three-method shadow rollout"
```

## Final verification

Run:

```bash
uv run pytest tests/unit/test_rd_entry_method.py \
  tests/contract/test_contracts.py \
  tests/static/test_rd_multi_entry_pine.py -v
cd apps/observation-edge && npm test && npm run build
cd ../operations-console && npm test && npm run build
cd ../.. && make verify-observation
git diff --check
git status --short
```

Expected:

- every command exits zero;
- Python and TypeScript method vectors match exactly;
- the console shows one method decision per canonical selection;
- live tick evidence remains shadow-only;
- one setup cannot produce two paper-eligible method decisions;
- the worktree is clean after the final commit.
