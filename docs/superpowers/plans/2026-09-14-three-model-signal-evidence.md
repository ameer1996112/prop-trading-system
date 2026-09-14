# Three-model signal evidence implementation plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task with independent reviews, or superpowers:executing-plans for an explicitly requested inline execution.

**Goal:** Produce strictly validated, immutable, account-free BOC, DIR_CLOSE and HTF_FLIP evidence from the existing V3.1 detector without enabling trades.

**Architecture:** A bytes-only bridge wraps the existing observation validator with reviewed source binding and restart-stable formation identity. A separately gated Pine emitter reuses a pure serialization builder. There is no route, database, execution-policy or EA integration in this milestone.

**Tech Stack:** Existing TypeScript/Vitest/Web Crypto in observation-edge; Pine LAB source and Python release generator.

**Spec:** `../specs/2026-09-14-three-model-signal-evidence-design.md` (approved).

## Global constraints and checkout

- Implement in `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/mt5-stale-payload-recovery`, branch `codex/mt5-stale-payload-recovery`. Verify branch and dirty status first. Do not use the older checkout in the desktop CWD.
- This plan and final audit live in `/Users/ameeramer/.config/superpowers/worktrees/prop-trading-system/tradeops-dashboard-migration`.
- Paths below are relative to the implementation worktree unless explicitly called documentation paths.
- Preserve all existing changes. No staging, commits, cleanup, deployment, network delivery, credentials, alert changes, EA changes or orders. No dependency installation.
- Existing execution V1/V2 contracts and their fixtures are unchanged. Do not wire in the completed `demo-geometry-policy-v1` or readiness helpers.
- Preserve the existing model rules and arbitration, including rules that currently block a variant. Representing ACCURACY formation identity does not grant ACCURACY eligibility.
- Use the public `validateEntryV3Payload` over strictly parsed input. Its reviewed-hashes argument does NOT enforce binding. Do not substitute direct arbitration of caller objects.
- Tests against generated text are not native Pine compilation. Record native compilation as pending until actual TradingView evidence is available.

## Reviewed subagent workflow

Execute Tasks 1–3 sequentially: each establishes an interface used by the next. Task 4 is the integrated acceptance gate. For each task, give a bounded implementer the task, spec, checkout, file ownership and current diff; then use an independent reviewer for spec compliance and code quality. Fix and re-review material findings before advancing. Workers must not delegate further or commit. Keep a task brief, report and review ledger under `.superpowers/sdd/2026-09-14-three-model-signal-evidence/` in the implementation worktree. Use fresh agents for independent reviews, including a final whole-change review. Do not resume the completed policy-foundation ledger as though it were this plan.

## Contract decisions to implement

### Public boundary and result

The only public bridge entry point is:

```ts
export async function validateSignalEvidenceV1(
  inputBytes: Uint8Array,
  reviewedBindingBytes: Uint8Array,
): Promise<SignalEvidenceResultV1>;
```

The second argument is separately supplied server configuration, never a field extracted from the producer message. Use bytes for it too, avoiding accessors, proxies or caller-created validation brands. Copy both byte arrays synchronously before the first await. Input maximum is 262144 bytes; binding maximum is 4096 bytes. Both use `parseStrictJson`, which already fatally decodes UTF-8 and enforces duplicate-key, depth and node limits. Reject empty/oversized inputs before parsing. Strict integer fields must be branded strict-parser integer tokens and safe integers; exponent/fraction spellings are not accepted for integer fields. Return fixed reason codes, never input text or upstream exception messages.

The closed binding has exactly:

```ts
type ReviewedBindingV1 = Readonly<{
  schema_version: "TradeOpsSignalEvidenceBindingV1";
  producer_namespace: string;
  ticker_id: string;
  feed: string;
  symbol: string;
  tick_size: string;
  detector_code_hash: string;
  settings_hash: string;
}>;
```

Namespace and symbol identifiers: nonempty printable ASCII, no whitespace/control characters, at most 256 characters. Formation diagnostic ID: same constraints, at most 1024 characters; never truncate. Validate tick strings with the observation validator's positive decimal grammar (maximum 64 characters), then canonicalize by removing trailing fractional zeroes and a resulting trailing decimal point, using string operations only. Require the binding string itself to be canonical; compare the canonical observation tick string to it and use that canonical value in the formation digest. Thus 0.010 and 0.01 use the same source unit without floating-point conversion. Preserve the original validated source payload for audit. Digests are lowercase 64-character nonzero hex, never UNREVIEWED. The binding is a reviewed expectation, not authentication or permission.

Result is a discriminated union:

```ts
type SignalEvidenceResultV1 =
  | Readonly<{ status: "REJECTED"; code: SignalEvidenceRejectCodeV1 }>
  | Readonly<{
      status: "VALIDATED";
      authority: "EVIDENCE_ONLY";
      execution_allowed: false;
      entries: readonly SignalEvidenceEntryV1[];
    }>;
```

Reject codes: `INPUT_SIZE`, `BINDING_SIZE`, `INVALID_JSON`, `INVALID_BINDING`, `INVALID_ENVELOPE`, `UNSUPPORTED_OBSERVATION`, `INVALID_OBSERVATION`, `BINDING_MISMATCH`, `INVALID_FORMATION`, `INELIGIBLE_SOURCE`, `INELIGIBLE_EVIDENCE`. Malformed input or a failed strict-policy check rejects the entire envelope; do not return a partially successful batch. A structurally valid, policy-eligible setup with no exact selected candidate yields a `NO_CANDIDATE` entry, not a malformed order. Same-event conflicting-price arbitration therefore produces no candidate, never an arbitrary model winner.

Each entry contains `schema_version: "TradeOpsSignalEvidenceV1"`, authority and false execution flag; `status: "SELECTED" | "NO_CANDIDATE"`; `attempt_key`, `formation_body_sha256`, `evidence_id`, `evidence_body_sha256`; the normalized `formation`; `reviewed_binding`; `source_observation`; `edge_evaluation`; and `selected`.

`source_observation` is the detached canonical payload returned by the wire validator, not raw transport or credentials. `edge_evaluation` is the corresponding bundle's recomputed evaluation, including all validated candidates, evidence, selection and co-triggers. `selected` is null for NO_CANDIDATE; otherwise it contains only the canonical candidate and matching evidence from that evaluation. It adds no broker geometry, volume, account or command. The source paper trade_plan stays solely in source_observation. Define types from existing validator/domain types, not duplicate loose `any` structures. Deep-freeze every reachable output array/object, including rejected results.

### Hash preimages and normalization

Reuse `canonicalStringifyRdEntry` from `rd-entry-domain.ts` and `canonicalSha256` from `rd-entry-policy.ts`. Do not import execution-edge or invent a second JSON serializer.

- Attempt: the exact preimage in the approved spec, with domain `tradeops-demo-attempt-v1` and attempt_kind INITIAL.
- Formation body: `{domain:"tradeops-demo-formation-v1", origin_epoch, confirmation_epoch, direction, variant, origin_open_ticks, origin_high_ticks, origin_low_ticks, origin_close_ticks, tick_size, zone_top_ticks, zone_bottom_ticks}`.
- Evidence ID: `{domain:"tradeops-signal-evidence-id-v1", producer_namespace, producer_instance_id, event_id, producer_sequence, attempt_key}`.
- Evidence body: hash the complete entry without `evidence_body_sha256`. The entry schema version supplies body versioning; do not silently omit diagnostic/source fields from this digest.

Sort envelope entries by setup_id; source setups by setup_id; formation descriptors by setup_id; candidate arrays by candidate_id; evidence arrays by evidence_id; candidate_ids_considered lexically; co_triggered_models lexically. Apply the same normalization to nested source and edge evaluation copies. Preserve semantic candle/event order and all other arrays, including source claims and rule lists. Sorting uses explicit code-unit comparison, not localeCompare. Reject duplicate identities rather than sorting them away. Literal vectors include canonical strings and hashes so tests cannot compute their own expected hashes with the implementation under test.

### Formation mapping

| New field | Frozen Pine RawZone source |
|---|---|
| setup_id | entrySetupId(zone), used only for envelope joining |
| origin_epoch | originTime / 1000, exact integer seconds |
| confirmation_epoch | confirmationTime / 1000, exact integer seconds |
| direction | demand ? LONG : SHORT |
| variant | geometry, exact STANDARD or ACCURACY |
| origin OHLC ticks | originOpen/High/Low/Close converted with existing source tick conversion |
| formation_source_id | full formationId, not a bounded/truncated helper |

Require positive safe integer epochs, origin < confirmation, both divisible by 300, confirmation <= zone_engaged_epoch, positive safe integer tick prices and low <= open/close <= high with low < high. Demand origin must be opposite-direction (close < open), supply close > open. Zone bounds must match frozen geometry: STANDARD high/low; demand ACCURACY max(open,close)/low; supply ACCURACY high/min(open,close). Reject zero-width bounds. Identity tests may use ACCURACY structural formation fixtures without falsely asserting that current common rules select them.

## Task 1 — Strict formation and identity primitives

**Create:**
- `apps/observation-edge/src/signal-evidence-identity-v1.ts`
- `apps/observation-edge/test/signal-evidence-identity-v1.test.ts`
- `contracts/vectors/signal-evidence-identity-v1.json`

**Read:** strict-json.ts; rd-entry-domain.ts canonical serializer; rd-entry-policy.ts hash helper; the approved spec. Keep parser helpers internal to this module or the bridge; no public object-to-validated-artifact factory.

1. Write failing tests for formation closed keys, strict token integers, OHLC/geometry/direction, alignment, chronology and exact descriptor-to-setup coverage. Use literal JSON bytes via strict parser, not unbranded number lookalikes. Include duplicate setup descriptors and unmatched setup IDs.
2. Define readonly formation and identity types plus `deriveSignalEvidenceIdentityV1` for bridge-internal validated values. Implement the exact three preimages above. It must not validate or authorize an observation by itself.
3. Store a literal baseline preimage and SHA-256 in the fixture. Independently calculate goldens once with a separate standard SHA-256 implementation over manually specified canonical strings; then paste fixed strings/digests. Never regenerate expected values during the test run.
4. Test identity invariants: changing chart setup ID, diagnostic formation ID, producer instance, selected model or reviewed settings preserves attempt_key; namespace/producer/event changes change evidence_id; OHLC or bounds changes preserve attempt_key but change formation digest; direction, variant and actual formation epochs change attempt_key. Different setup IDs alone do not change formation digest.
5. Red then green:

```sh
cd apps/observation-edge
npm test -- test/signal-evidence-identity-v1.test.ts
npm run typecheck
```

**Review gate:** all spec exclusions are exercised, all hash preimages literal and domain-separated, no time/randomness or chart-local identity in attempt_key, safe comparisons instead of overflow-prone arithmetic. No change to existing contracts.

## Task 2 — Bytes-to-evidence bridge for all models

**Create:**
- `apps/observation-edge/src/signal-evidence-v1.ts`
- `apps/observation-edge/test/signal-evidence-v1.test.ts`
- `contracts/vectors/signal-evidence-v1.json`

**Read, do not rewrite:** `rd-entry-wire-v3.ts`, `rd-entry-domain-v3.ts`, `rd-entry-arbitrator-v3.ts`, `test/rd-entry-wire-v3.test.ts`, `test/rd-entry-pine-v3-parity.test.ts`, existing `rd-entry-arbitration-v3.json` vectors.

1. Add failing public-API tests and literal V3.1 envelopes for long/short BOC, DIR_CLOSE and HTF_FLIP. Use existing strict_long_boc_only/strict_short_boc_only/boc_before_close/flip_before_boc/boc_flip_same_event vectors as source examples, not as dynamically generated expected outputs. Supply frozen formation facts consistent with each setup. Add any missing short-model literals explicitly. Pine-like EDGE_DERIVED references may be used where the existing validator supports them.
2. Implement the pipeline in this order: bounded byte copies → strict parse closed binding/envelope → exact 3.1 tuple → existing public wire validation → explicit reviewed binding equality → formation validation/coverage → strict source policy → edge-selected model proof policy → detached normalization/hashes/freeze.
3. Source policy requires realtime ENTRY_DECISION, no exits, TWO_PLUS_CANDLES, exact common fidelity, passed required common rules, engagement, noninvalidated setup. Do not let one_candle_enabled change cohort admission. Reuse validated evidence semantics rather than introducing a different crossing detector.
4. Resolve the selected IDs only from bundle.evaluation.selection and look up the matching validated candidate/evidence. Require exact eligible selection. BOC must retain HTF_TIMED with reference crossing; flip complete ordered lifecycle/no gap; both REALTIME_TICK and LIVE_EXACT_NON_REPLAYABLE. DIR_CLOSE must retain its exact confirmed realtime five-minute evidence. Never relabel proof planes to satisfy an old execution contract.
5. Add typed NO_CANDIDATE tests for valid unselected setup and same-event price conflict; assert selected is null, no executable fields and false authority. Invalid selected proof returns INELIGIBLE_EVIDENCE, not a fallback to another model. Proposal tampering either fails existing validation or cannot change the recomputed winner.
6. Adversarial matrix: schema3.0, wrong tuple, UNREVIEWED/zero/mismatched digests, wrong ticker/feed/symbol/tick, missing binding, one-candle, discretionary BOC, historical, exits, invalidation, absent engagement, wrong crossing, incomplete/reversed flip, unknown credential/account/order keys, duplicate JSON keys, invalid UTF-8, exponent/fraction integers, unsafe integers, depth/node limits, size boundaries. For depth/node cases, keep under byte limit to exercise the intended parser gate. Retain the nested observation's existing <35000-character rule.
7. Test complete detachment/freeze and byte-mutation across await: mutate original input/binding arrays immediately after invocation and verify output reflects the initial copies. Assert errors contain only codes. Retry input produces identical canonical output; reordering only the documented unordered arrays preserves output; changing diagnostic data changes body digest without changing economic identity.

```ts
const result = await validateSignalEvidenceV1(vector.inputBytes, bindingBytes);
expect(result.status).toBe("VALIDATED");
if (result.status !== "VALIDATED") throw new Error("fixture rejected");
expect(result.execution_allowed).toBe(false);
expect(result.entries[0].attempt_key).toBe(vector.expected.attempt_key);
expect(result.entries[0].evidence_body_sha256).toBe(vector.expected.evidence_body_sha256);
expect(Object.isFrozen(result.entries[0].source_observation)).toBe(true);
```

8. Red/green focused command, then existing wire/arbitration regressions and typecheck:

```sh
cd apps/observation-edge
npm test -- test/signal-evidence-v1.test.ts test/signal-evidence-identity-v1.test.ts
npm test -- test/rd-entry-wire-v3.test.ts test/rd-entry-pine-v3-parity.test.ts
npm run typecheck
```

**Review gate:** all six directional positives plus co-trigger pass, no trusted selection shortcut, wire-hash argument not mistaken for binding, no partially accepted malformed envelope, output cannot authorize execution. Do not add an HTTP consumer to demonstrate it.

## Task 3 — Independent default-off Pine evidence emitter

**Modify:** `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`, generated `SND_RD_5M_V3_RELEASE.pine`, and the protected-region golden in `tests/unit/test_generate_rd_v3_release.py` after independent review of the intended source change.
**Create:** `tests/unit/test_signal_evidence_pine.py` and `apps/observation-edge/test/signal-evidence-pine-parity.test.ts`.
**Reuse:** `scripts/generate_rd_v3_release.py`, `tests/unit/test_generate_rd_v3_release.py`, Task 2 literal fixture contract.

1. Write failing source/fixture tests before changing Pine. Assert flag defaults false; independent namespace/counter; exact formation fields; old serialization stable for identical explicit inputs; no new strategy orders; LAB/release parity. Model field/unit conversion in literal examples and validate their emitted JSON through the real bytes bridge in the TS parity test. State clearly that these are parity/static tests, not Pine execution.
2. Split current `entryPayload` into `entryPayloadForStream(attempt, zone, exitEvents, exitFollowup, producerInstanceId, producerSequence)` with no sequence writes, and the old wrapper that calls `nextEntrySequence()` exactly as before. Preserve field order and all old serialization values. Do not alter existing paper counter-on-oversize semantics while refactoring.
3. Add `emitSignalEvidenceV1` default false and an explicit evidence producer tag; construct a separate nontruncated, validated instance ID prefixed `signal-evidence-v1:` with its own start epoch. Keep new delivery sequence in its own varip integer array. This is stream identity only; it does not admit a generation. Reject unsafe/oversized identifiers rather than truncate. Keep tickSequence untouched.
4. Build the credential-free three-key input envelope with one formation for the current zone. Use full formationId and frozen RawZone fields from the mapping table. Refuse invalid millisecond-to-second conversion and invalid tick conversion rather than rounding inconsistent formation facts into acceptance. Use existing price conversion semantics only when representable on source ticks.
5. Emit only on realtime `candidateChanged and bundleReady`, independently of emitEntryV3Events, old credentials and paperDecisionEmitted. Call at the same decision site as the old paper emitter, not from exit monitoring. Build with proposed next evidence sequence; validate bounds/identifiers/length first; invoke `alert(envelope, alert.freq_all)` then commit the new sequence. Using freq_all for the independent event stream avoids falsely treating once-per-bar suppression as emission. Reject counter overflow. No sequence consumption while flag off, historical, invalid or oversized. Log fixed error codes, not payloads. Do not infer network acknowledgement.
6. Keep this new emitter opt-in on an isolated future alert configuration: enabling it alongside an existing Any alert function call stream would mix schemas. Document that limitation; do not change an existing alert or turn the flag on for the user. Other emitters remain unchanged when it is off.
7. The existing generator test hashes the entire model/emitter region, including the functions this task deliberately refactors. Capture the pre-change protected region and review its diff. Add the flag-off serialization/counter regression tests before updating `PROTECTED_REGION_SHA256`; update that golden only for this reviewed change, never to hide altered model rules or an unexpected diff. Regenerate release and run tests:

```sh
python3 scripts/generate_rd_v3_release.py
python3 scripts/generate_rd_v3_release.py --check
python3 -m pytest tests/unit/test_generate_rd_v3_release.py tests/unit/test_signal_evidence_pine.py
cd apps/observation-edge
npm test -- test/signal-evidence-pine-parity.test.ts test/rd-entry-pine-v3-parity.test.ts
npm run typecheck
```

**Review gate:** no dependency on paper delivery counter/credential, flag-off behavior preserved, integer conversion fixtures and all three model envelopes validated, generated file only from generator, no assertion of native compilation. If a native Pine language constraint cannot be established locally, record it as an external acceptance item rather than claiming production readiness.

## Task 4 — Integrated regression, capability audit and handoff

**Create:** `apps/observation-edge/test/signal-evidence-capability-v1.test.ts` and documentation-worktree `docs/audits/2026-09-14-three-model-signal-evidence.md`.

1. Add a capability test that enumerates production imports and fails if the new bridge is imported by a route, worker entry point, store, execution adapter or EA. The only allowed production dependency is bridge → identity/existing observation validation. Check the new modules for network, storage and execution-policy dependencies. Inspect actual imports, not merely a fragile absence-of-the-word-trade assertion.
2. Compare pre-task hashes/diffs of old execution protocol fixtures and EA sources, and confirm only declared source/test/vector files changed relative to the captured baseline. Preserve pre-existing dirty work. Add invariant assertions that every successful entry and container has EVIDENCE_ONLY/false and no account, volume or command fields at its authority-bearing level.
3. Run full observation-edge tests/typecheck, all generator/evidence Python tests, generation check, and diff whitespace check. Capture fresh output; do not reuse the completed policy-foundation test count.

```sh
cd apps/observation-edge
npm test
npm run typecheck
cd ../..
python3 -m pytest tests/unit/test_generate_rd_v3_release.py tests/unit/test_signal_evidence_pine.py
python3 scripts/generate_rd_v3_release.py --check
git diff --check
```

If the worktree cache write is blocked by sandbox permissions, rerun the exact local test command with scoped approval. Do not install dependencies or deploy as a workaround. Record unrelated baseline failures separately and investigate any newly introduced failures.

4. Independent final reviewer reads spec, plan, actual diff, tests and goldens. Review the economic identity exclusions, formation conflict digest, canonical normalization, full proof retention, no-candidate semantics and sequence isolation together. Fix with regression tests and re-review; do not declare completion with material findings open.
5. Audit records changed files, actual commands/results, all six model/direction fixtures, canonical goldens, disabled capabilities, pending native Pine compile and mandatory later admission gates. Explicitly distinguish source-tested completion from external demo readiness. No new ZIP/setup exercise is required from the user in this milestone.

## Plan self-review / acceptance checklist

Planning self-review completed against the approved spec and current source on 2026-09-14. Confirmed the public wire validator, evaluation shape, fatal strict decoder, frozen RawZone mapping and pytest commands. Identified the broad protected-region golden and made its reviewed update explicit. The unchecked items below are implementation acceptance gates, not claims that implementation has already passed.

Implementation acceptance recorded on 2026-09-14 after task reviews and an independent whole-change review with no actionable findings. See `docs/audits/2026-09-14-three-model-signal-evidence.md` for verification and limitations.

- [x] Tasks 1–2 implement all bytes/binding/formation/identity/model/immutability requirements.
- [x] Task 3 preserves legacy emitter source behavior and isolates evidence sequencing; no live alert changes.
- [x] Task 4 records verification and guards against public consumers/command dependencies through static literal-import checks and source review, not runtime proof.
- [x] All three entry models have literal long/short positives, negatives and co-trigger coverage.
- [x] No partial admission, producer-selected winner, default geometry or fabricated replayability.
- [x] No claims of authentication, persistent continuity, freshness, cross-message uniqueness or profitability.
- [ ] External gate: native Pine compilation and runtime acceptance remain pending until observed.

After this milestone, the next design is durable authenticated demo admission (generation/sequence pins, receipts/body conflicts, one INITIAL attempt reservation, freshness, account/broker/risk checks and transactional outbox). It must precede EA execution and dashboard end-to-end activation; this plan does not silently authorize that integration.
