# Three-model signal evidence bridge

Date: 2026-09-14
Status: Source-tested implementation and independent final review completed on 2026-09-14. Native Pine compilation and external acceptance remain pending; no deployment or trade activation.
Parent: `2026-09-14-three-model-demo-completion-design.md`.

## Objective and scope

Define and implement one account-free evidence bridge for BOC, DIR_CLOSE and
HTF_FLIP, retaining the existing V3 signal rules and earliest-valid-event
arbitration. Its output is eligible for later demo admission evaluation, not an
order or a guarantee of admission. No account, volume, execution permission,
broker stop/target or command is accepted in this evidence contract.

Deliver the pure parser/validator, immutable evidence projection, literal
fixtures and generated-Pine producer support. Do not attach it to a public route,
dispatch candidates, deploy a Worker, modify an existing alert, or change the EA
in this stage. Integration subsequently requires durable admission and risk
authorization, as specified below. All three models must pass the same contract
suite; a DIR_CLOSE-only bridge is not acceptance.

## Repository evidence and approach

The existing execution proposal/candidate V1 and V2 contracts are DIR_CLOSE-only,
PAPER_ONLY and replayable-only. Preserve them byte-for-byte.

`apps/observation-edge/src/rd-entry-wire-v3.ts` already strictly parses V3.1
observations, validates common and model evidence, verifies canonical digests and
recomputes selection through `rd-entry-arbitrator-v3.ts`. Reuse that validation
boundary, with an explicit new bridge policy. Do not call its internal arbitration
function directly with an unvalidated array of producer claims.

Important: `validateEntryV3Payload` deliberately does not enforce reviewed hash
identity. Current paper-store code owns that check. The new bridge must separately
compare source identity against server-owned reviewed configuration; merely
passing the wire parser never constitutes reviewed-producer approval.

Recommended approach: wrap the existing observation evidence with stable formation
facts, then derive a new versioned evidence artifact. This avoids a second detector
while leaving all old protocol meanings intact. Alternative: independent raw
tick/event protocol and evaluator; more duplication and a much larger producer
change. Alternative: widen the existing DIR_CLOSE execution enums; rejected because
their replayable candle/geometry assumptions do not represent BOC or flip.

## New producer envelope

Use `schema_version = "TradeOpsSignalEvidenceInputV1"` with closed fields:

- `schema_version`;
- `observation`: the existing credential-free V3.1 payload;
- `formations`: one formation descriptor per observation setup, exact coverage,
  no duplicate or unmatched descriptors.

Each formation descriptor has exactly `setup_id`, `origin_epoch`,
`confirmation_epoch`, `direction`, `variant`, `origin_open_ticks`,
`origin_high_ticks`, `origin_low_ticks`, `origin_close_ticks` and
`formation_source_id`. `variant` is STANDARD or ACCURACY. Epochs are integer
seconds; prices use the observation's source tick size. Direction must match the
setup. Origin candle OHLC and chronological relations must be valid; origin and
confirmation are aligned to five-minute boundaries and confirmation cannot be
after engagement. The producer supplies frozen formation facts, never a moving
chart-window reconstruction. The implementation plan must trace these fields to
the existing RawZone/formation source fields and test unit conversion explicitly.

`formation_source_id` is retained for diagnostics and provenance, not sufficient
by itself for economic deduplication. Do not use truncated identifiers as unique
keys. Reject malformed identifiers rather than silently truncating them.

Authentication credentials remain in a future transport wrapper and must be
removed before entering this pure contract. Reject unknown keys, including
account/order fields. Never preserve secret-bearing input in error messages.

## Stable identity and conflicts

The current Pine `entrySetupId` includes `zone.id`, a chart-local number. It is
not adequate as the sole restart-stable economic identity. The bridge derives:

`attempt_key = SHA256(canonical({domain:"tradeops-demo-attempt-v1",
strategy_id, ticker_id, feed, timeframe:"5", origin_epoch,
confirmation_epoch, direction, variant, attempt_kind:"INITIAL"}))`.

Do not include producer generation, chart-local setup ID, selected model,
settings hash, price geometry or current time in this economic identity. Thus
reloads, policy changes and competing models cannot alone produce a new attempt.
STANDARD and ACCURACY remain distinct variants as the existing strategy specifies;
portfolio risk treatment of overlapping variants belongs to account admission.

Record a separate formation-body digest over origin OHLC, origin/confirmation
epochs, direction, variant, source tick size and zone bounds. Exclude chart-local
setup IDs and diagnostic formation_source_id. Same attempt key with a different immutable body is a
conflict, never a fresh attempt. A corrected feed history therefore blocks and
requires reconciliation instead of permitting a duplicate trade.

Derive `evidence_id` from a separate domain, reviewed producer namespace,
producer instance, event ID, producer sequence and attempt key. Derive
`evidence_body_sha256` separately from the complete normalized evidence artifact
excluding that digest. Identical transport retries reproduce the same ID and
body. Different observations can provide further evidence for the same attempt;
the later durable admission layer, not this pure helper, enforces one economic
action per attempt.

Canonical JSON is UTF-8 with lexically sorted object keys, preserved array order,
no whitespace, safe integer numeric fields and exact string values. Normalize
candidate/evidence/formation arrays to documented ID order before hashing; preserve
semantic event sequence values. Hash domains and preimages receive literal test
vectors. Never confuse transport bytes with semantic canonical digests.

## Validation pipeline and trust limits

The public input is bytes, not caller-supplied objects branded as validated.
Bound input to 262144 bytes as a project-owned parser limit, decode UTF-8 fatally,
and use the existing strict JSON parser. Retain its depth/node limits and the
nested observation's existing 35000-character limit. Reject duplicate keys,
invalid integer tokens, unsafe arithmetic, unknown keys and malformed UTF-8.
These limits are defensive choices, not claims about platform capacity.

1. Validate envelope and exact formation coverage.
2. Require observation schema 3.1 with its exact existing strategy tuple;
   reject legacy 3.0 for this new path, without changing its old reader.
3. Run `validateEntryV3Payload`, not a TypeScript cast or trusted producer
   `selection_proposal` shortcut.
4. Compare ticker, feed, source symbol, canonical tick size, detector digest and
   settings digest against a complete immutable reviewed binding passed separately
   from server configuration. Missing/UNREVIEWED/mismatched binding blocks output.
5. Require realtime ENTRY_DECISION, no exit followup, strict TWO_PLUS_CANDLES,
   exact common fidelity, valid engagement and no invalidation.
6. Project only the edge-derived exact selected event, retaining the full validated
   candidate/evidence set and co-triggers for audit. No selected event produces a
   typed non-candidate result, not an order-shaped empty object.
7. Apply model evidence rules below, build stable identities, and return frozen
   detached data. Include literal `authority:"EVIDENCE_ONLY"` and
   `execution_allowed:false` in every successful artifact.

Do not infer authentication, persistent stream continuity, freshness at execution,
or broker validity from a shape-valid message. The pure result states only what
was validated and which reviewed binding was used. It contains no trusted
`authenticated:true` or `contiguous:true` field supplied by the producer.

## Model evidence and arbitration

| Model | Accepted source evidence | Explicit rejection |
|---|---|---|
| BOC | Existing exact HTF_TIMED reference-candle crossing in continuous realtime observation | Discretionary tier, missing reference, wrong HTF boundary, historical/range-only claim |
| DIR_CLOSE | Existing exact confirmed five-minute qualifying candle observed in a realtime entry decision | Unconfirmed/misaligned candle, wrong direction/boundary, historical backfill |
| HTF_FLIP | Existing exact ordered HTF open/contact/recross with complete lifecycle and no coverage gap | Recross before contact, missing anchor/contact, ambiguous order, historical/range-only claim |

For BOC/flip retain REALTIME_TICK plus LIVE_EXACT_NON_REPLAYABLE. This is a
reviewed producer's contemporaneous observation, not an independently archived
tick proof or a claim that OHLC can reconstruct it. Do not fabricate replayability
to satisfy old execution proposal contracts. Historical replay remains useful for
research but cannot create a new realtime execution attempt through this path.

Reuse existing earliest-exact-event and same-event co-trigger arbitration. Retain
all considered models; do not impose BOC > FLIP > DIR_CLOSE ranking. Conflicting
same-event prices block the candidate. Subsequent evidence cannot imply a second
initial action; durable reservation/freeze is an integration requirement.

Existing paper `trade_plan` is retained only inside source evidence and its digest.
It is not copied into executable stop/target fields or connected to the previous
fixed-tick configuration helper. Actual broker geometry remains a separate,
owner-selected policy and validation stage.

## Producer implementation boundary

Author changes in `SND_RD_5M_V3_THREE_ENTRY_LAB.pine` and regenerate
`SND_RD_5M_V3_RELEASE.pine` through `scripts/generate_rd_v3_release.py`.
Add a separate default-off evidence emitter that uses the same observation
serialization with frozen formation descriptors. Existing paper and DIR_CLOSE proposal
emitters must remain behaviorally unchanged when the new emitter is disabled.
The new emitter has its own producer namespace and delivery sequence. Refactor
serialization into a pure builder receiving explicit instance/sequence values;
do not call the current side-effecting entryPayload builder and inadvertently
advance the paper stream. Existing emitters retain their original counter behavior.
Advance the new counter only when invoking its alert emission, not for rejected
or oversized envelopes. An alert invocation is not a delivery acknowledgement;
the later durable receiver must detect delivery gaps. Document delivery sequences
separately from tick order.
No new `strategy.*` orders, account settings or broker commands belong in Pine.

This stage emits locally testable message bytes only; it does not create a live
TradingView alert. Record native Pine compilation as pending until actually run.

## Mandatory integration prerequisites

Before any production consumer uses this artifact, a separate durable admission
transaction must authenticate the producer, pin its reviewed namespace/generation,
enforce sequence continuity and body-conflict detection, persist original evidence
and receipt, enforce attempt uniqueness and freeze, and create a delivery outbox
atomically. A missing first message or gap blocks admission; a producer reload
requires an explicit new-generation admission, never an automatic history reset.

Admission must compare selected trigger time and receipt time against configured
freshness limits and recheck expiry before any command. No stale catch-up trades.
Commands additionally require account/installation pins, broker symbol/quote and
geometry checks, risk reservation, demo-only verification and durable send recovery.
Neither a paper position nor this evidence artifact bypasses these prerequisites.

## Acceptance and verification

- Long/short literal positive vectors for all three models, plus same-event
  co-trigger; selected output is derived independently of the proposed selection.
- Negative vectors: one-candle, discretionary BOC, historical observation,
  exit followup, incomplete flip, incorrect crossing, digest/binding mismatch,
  malformed formations, unknown keys, bad encoding/numbers and size boundaries.
- Mutation tests prove changed immutable facts change body digest but do not
  create a new economic attempt; model or producer restart changes also preserve
  attempt key. Variant and genuine formation-time changes distinguish attempts.
- Retry and ordering fixtures prove canonical byte stability; extra candidate
  evidence remains distinguishable without implying duplicate trade authority.
- LAB/release generation parity and static emitter tests; old emitters and old
  protocol fixtures still pass. Native Pine compilation is separately evidenced.
- A capability/source test proves no route import, network dispatch, account
  policy connection, trade command or EA change in this stage.

No remote tests, no deployment, no credentials, no commits/staging/merge and no
cleanup of existing dirty work. The parent project remains unfinished until all
later integration and external demo acceptance gates pass.
