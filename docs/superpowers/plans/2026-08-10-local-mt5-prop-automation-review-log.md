# Plan Review Log: Local MT5 Prop-Firm Automation With a Fail-Closed Risk Gateway

Act 1 (grill) complete — plan locked with the user. MAX_ROUNDS=5.

Resolved review inputs:

- `PLAN_FILE=docs/superpowers/plans/2026-08-10-local-mt5-prop-automation.md`
- `LOG_FILE=docs/superpowers/plans/2026-08-10-local-mt5-prop-automation-review-log.md`
- Existing root `PLAN.md` and `PLAN-REVIEW-LOG.md` are preserved historical artifacts and are not review targets for this workstream.

## Review authorization checkpoint

The local managed security reviewer initially blocked the authenticated Codex CLI invocation
because an adversarial reviewer may transmit relevant contents from this private plan and
repository to OpenAI while analyzing them. The user explicitly authorized that data flow. All
review invocations keep the nested Codex repository sandbox read-only.

## Round 1 — Codex

Thread: `019feb12-aae9-76f2-8f90-50f1780c2982`

The initial repository-wide audit exceeded its ten-minute command timeout before writing a formal
answer. The same authenticated thread was resumed with an instruction to stop investigating and
issue its verdict from the evidence already collected.

### Codex critique

1. **TradingView becomes trade authority despite being untrusted.** The edge validates structure,
   but setup facts and “reviewed” hashes are producer declarations protected only by the same
   bearer credential. A compromised TradingView account can forge executable setups. Require
   independent `DIR_CLOSE` and geometry confirmation from trusted broker bars or another
   independent feed before leasing any command.
2. **The proposed executable geometry does not exist.** The plan requires deepest-wick stops and
   4R, while v3 emits configurable fixed 100-tick SL/200-tick TP; the frozen rule contract keeps
   trades shadow-only pending stop provenance. Make a new immutable strategy/wire version with
   reviewed per-symbol stop provenance and 4R arithmetic a prerequisite, then gather fresh paper
   evidence under that exact version.
3. **Candidate predicates use nonexistent or contradictory fields.** `NORMAL_TWO_CANDLE` is not an
   enum; the schema has `ONE_CANDLE` and `TWO_PLUS_CANDLES`. `DIR_CLOSE` is intentionally
   `REPLAYABLE`, while its gap field is null, so “no replay/gap taint” cannot be evaluated as
   written. Define an exact versioned cohort enum and separate historical-ingest replay status
   from evidence replayability, backed by an integrated producer gap/checkpoint ledger.
4. **`ExecutionCandidateV1` crosses the stated trust boundary.** The observation-side candidate
   pins account-specific capability, news, execution-policy, and prop-rule versions even though
   account state belongs only to the execution edge. Keep candidates account-free; pin these
   versions only in the account-specific decision and command.
5. **At-least-once delivery has no durable delivery mechanism.** A service binding is transport,
   not an outbox dispatcher. Specify a transactional outbox drainer with durable alarm ownership,
   claim leases, bounded retry/backoff before TTL, crash recovery, and a non-public service-binding
   RPC entrypoint.
6. **The Durable Object to D1 dual write has a crash window.** Commit an audit-outbox row and an
   `audit_pending` lease block in the same coordinator transaction, then clear it only after
   idempotent D1 acknowledgement.
7. **Owner authentication and action grants do not exist.** The repository records identity, MFA,
   revocation, and grant implementation as blocked. Add owner-auth implementation as a
   prerequisite and store/consume account grants inside the same coordinator transaction as the
   protected mutation.
8. **Account lifecycle cannot recover safely.** Separate immutable lifecycle mode from a
   multi-reason freeze latch and define grant-protected enroll, import, approve, recover, and
   unfreeze transitions with explicit prerequisites.
9. **One command state cannot represent real MT5 execution.** Define separate append-only command,
   request, order, deal, position, protection, close-attempt, and reservation folds plus complete
   transition and invariant tables.
10. **MT5 crash recovery is underspecified and unsafe.** Require write-ahead persistence of received
    commands and pre-submission intent before `OrderSend`, never evict unacknowledged records, keep
    trade handlers O(1), cap synchronous `WebRequest` below the poll interval, and reconcile stable
    overlapping history sweeps before accepting new leases.
11. **“Whenever supported” initial protection contradicts fail-closed operation.** In V1, reject
    symbols/accounts that cannot demonstrate atomic broker-side SL/TP attachment and flatten
    immediately upon a definite unprotected fill.
12. **The proposed experiments cannot use the existing simulator.** Add a separate
    `(candidate_id, variant_id)` counterfactual ledger with an explicit one-minute and cost data
    source, or remove unsupported variants from V1.

`VERDICT: REVISE`

### Codex's response

All twelve findings are accepted. Round 2 will review a revised plan that:

- treats TradingView as a proposal source and requires independently reconstructed broker-bar
  confirmation before a command can be leased;
- introduces a new paper-only strategy/wire version and evidence reset before any execution work;
- uses the existing `TWO_PLUS_CANDLES` enum and adds a separate ingest-integrity ledger;
- keeps observation candidates account-free;
- specifies both sides of the durable outbox/audit-outbox protocols;
- makes owner identity/action grants a prerequisite rather than an existing facility;
- splits lifecycle mode from freeze reasons and splits MT5 execution into independent folds;
- requires durable pre-submit intent, stable reconciliation, and proven atomic SL/TP support; and
- introduces a separate counterfactual ledger instead of overloading the current simulator.

## Round 2 — Codex

### Codex critique

Round 1 findings 1–4 and 6–12 were resolved on paper. Finding 5 and five new boundary
contradictions remained:

1. **At-least-once delivery still permits duplicate execution.** A dispatcher can crash after the
   service RPC commits but before acknowledgement because the receiver lacked a transactional inbox
   and uniqueness constraint. Require stable delivery ID, atomic receiver deduplication before side
   effects, stored-response replay, and a crash-after-commit-before-ack test.
2. **News policy blocks emergency safety actions.** Emergency flattening/protection conflicts with
   the blackout prohibition on closes/modifications. Blackouts must block entries and optional
   management while always allowing required protection and emergency flattening.
3. **Paid rollout conflicts with the executable account guard.** EA prechecks hard-coded
   `MetaQuotes-Demo` although later phases target a paid account. Validate a signed command-pinned
   immutable profile; use distinct demo and paid profiles/capabilities.
4. **Unattributed exposure can bypass portfolio limits.** The plan checked matching magic/comment
   but did not fail closed on manual or foreign-magic exposure. Freeze every unmatched
   order/position/deal and reserve its conservatively modeled exposure until reconciled.
5. **The 1% “worst-case” invariant is impossible.** Finite slippage reserves cannot bound gaps,
   rejected closes, or discontinuous fills. Define a versioned modeled-loss stress policy and a
   separate freeze/escalation path when actual loss exceeds it.
6. **Activation has two schema authorities.** `AccountProfileV1` included activation state while the
   coordinator also owned mutable mode. Remove current state from the profile, retain only an
   immutable authority ceiling, and make coordinator mode authoritative.

`VERDICT: REVISE`

### Codex's response

All six findings are accepted and the plan now:

- commits each candidate into a receiver-side `CandidateInbox` transaction keyed by stable delivery
  ID and digest before any routing, and replays its stored RPC response on exact retry;
- permits only necessary protection/cancel/flatten actions during a news blackout;
- replaces the universal demo guard with exact signed, command-pinned demo or paid account profiles;
- freezes and consumes local risk capacity for every unattributed or unpriced account exposure;
- replaces the unprovable worst-case guarantee with `ModeledLossPolicyV1`, explicit stress inputs,
  and a `MODELED_LOSS_BREACH` recovery path; and
- removes activation from immutable profiles so coordinator mode is the single current authority.

The revision also removes stale hard-coded FundingPips phase targets from the paid gate; phase
simulation now uses the then-current verified rule pack.

## Round 3 — Codex

### Codex critique

The Round 2 fixes materially improved the plan, but three security and durability gaps remained:

1. **Candidate deduplication still treated changed content as a new identity.** The proposed stable
   ID included geometry/body material, so a modified candidate could receive a different ID instead
   of conflicting with the original logical signal. The logical identity must be digest-free, with
   the canonical body digest stored and checked separately.
2. **Inbox commit still had a lost-routing crash window.** Candidate routing happened after the
   inbox transaction without a durable routing obligation. The inbox transaction must create
   per-account routing-outbox rows under a pinned manifest, and coordinators must deduplicate each
   routed delivery before any reservation or decision effect.
3. **The signed account profile was not a verifiable protocol.** The plan did not define the
   signature/MAC algorithm, exact signed bytes, issuer, trust anchor, validity window, key ID,
   rotation, or revocation. Freeze a complete authenticated envelope and cross-runtime test vectors.

`VERDICT: REVISE`

### Codex's response

All three findings are accepted. The plan now:

- derives a digest-free logical candidate ID only from strategy/wire version, ticker, setup
  identity/revision, selection identity, and source-bar close, while storing the canonical body
  SHA-256 separately and quarantining changed bytes under the same identity;
- atomically creates the inbox record, audit obligation, pinned routing-manifest version, and every
  per-account routing-outbox row, then uses coordinator-side transactional deduplication so every
  crash boundary can only replay; and
- freezes `SignedAccountProfileV1` as a canonical HMAC-SHA256 envelope with issuer, key ID,
  validity window, safety epoch, secret trust anchors, explicit rotation/revocation procedure, and
  TypeScript/MQL5 golden verification vectors.

## Round 4 — Codex

### Codex critique

The Round 3 review-log response matches the current plan.

1. **Closed — logical identity:** The candidate key now excludes content, while the body digest is
   stored and compared separately; conflicting content therefore reaches quarantine instead of
   creating another identity.
2. **Closed — durable routing:** The inbox transaction atomically creates pinned per-account
   routing obligations, alarms retry them, and coordinators transactionally deduplicate before
   decisions or reservations.
3. **Closed — authenticated profiles:** `SignedAccountProfileV1` now defines canonical bytes,
   domain-separated HMAC-SHA256, issuer/key identity, validity, safety epoch, trust-anchor storage,
   rotation/revocation, and cross-runtime vectors.
4. **Blocking issues:** None remain within the requested scope; the plan is safe enough to begin
   gated implementation.
5. **Optional improvement:** Promote the routing manifest to a named schema containing its digest,
   immutable account membership, issuer, and validity interval.
6. **Optional improvement:** Explicitly require constant-time MAC comparison,
   per-account/per-installation MAC-key scope, and incident handling for conflicts discovered after
   some routing rows have completed.

`VERDICT: APPROVED`
