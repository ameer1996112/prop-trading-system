# Plan Review Log: Clean Autonomous Multi-Account Prop-Trading System
Act 1 (grill) complete — plan locked with the user on 2026-07-22. MAX_ROUNDS=5.

Resolved review tunables:
- `PLAN_FILE=PLAN-PROP-TRADING-SYSTEM.md`
- `LOG_FILE=PLAN-PROP-TRADING-SYSTEM-REVIEW-LOG.md`
- `MAX_ROUNDS=5`

The existing `PLAN.md` and `PLAN-REVIEW-LOG.md` belong to a separate protected-indicator plan and were preserved unchanged.

## Review attempt 1 — timed out before verdict

- Reviewer model: `gpt-5.6-sol`
- Codex CLI: `0.144.6`
- Read-only thread: `019f8b33-d8ef-74b1-937c-2d2e7110490a`
- The first sandboxed launch failed before session creation because the outer sandbox blocked the in-process app-server client (`Operation not permitted`).
- After explicit approval, the reviewer started outside the outer sandbox while retaining Codex `read-only` mode.
- The mandatory 600-second ceiling expired before a final response was written; `/tmp/codex-prop-trading-verdict.txt` was absent.
- No `VERDICT` was issued, no review round was accepted as complete, and no incomplete findings were used to revise the locked plan.

## Round 1 — Codex

The plan is not implementable safely as written.

1. **Ingress cannot detect permanent silence.** Sequence gaps appear only after another request; the Pine source emits one startup snapshot and then transition-only incrementals, so a dead alert recreates the exact “no data” failure the plan claims to eliminate ([Pine:1353](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/scripts/pinescript/indicators/SND_RD_5M_V1_LAB.pine:1353)).  
   **Fix:** Emit a durable authenticated heartbeat or full checkpoint every N confirmed bars and alert externally on receipt age.

2. **`RESYNC_REQUIRED` is not an executable protocol.** Pine cannot inspect the HTTP response and therefore cannot send the requested snapshot; TradingView retries only selected 5xx responses, repeating the same payload.  
   **Fix:** Use periodic monotonic checkpoints with `stream_generation` and `covers_through_sequence`, rather than response-driven resynchronization.

3. **Ingress sequencing is not serialized correctly.** The plan specifies account-scoped locks, but concurrent webhook batches require an atomic lock and compare-and-advance on the producer stream.  
   **Fix:** Lock the producer-stream row and commit `(generation, last_sequence)`, receipt, and events in one transaction.

4. **The claimed separation between canonical and diagnostic alerts is false.** Both paths call `alert()` in the same Pine script ([Pine:1365](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/scripts/pinescript/indicators/SND_RD_5M_V1_LAB.pine:1365)), while TradingView exposes all such calls through one alert destination.  
   **Fix:** Split canonical and diagnostic emission into separate script/alert instances, or route both through one discriminator-aware ingress and make the modes mutually exclusive.

5. **Webhook authentication and provenance are weaker than claimed.** The Pine script places the credential in the body and accepts operator-entered detector/settings hashes ([Pine:1116](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/scripts/pinescript/indicators/SND_RD_5M_V1_LAB.pine:1116)); those hashes do not attest to the running alert snapshot, and TradingView advises against secrets in webhook messages.  
   **Fix:** Authenticate TradingView at TLS termination, bind each approved alert configuration to a server-side manifest, and treat payload hashes as declarations requiring recorded alert recreation/change control.

6. **“Live execution unreachable” is not structurally enforced.** MetaApi’s normal account metadata does not reliably prove demo status, and an allowlist around a general trading token remains a configuration mistake away from live access.  
   **Fix:** Use a separate MetaApi tenant/token containing only accounts created through the demo-provisioning flow, with narrowed per-account execution tokens and no arbitrary account import.

7. **Dynamic onboarding conflicts with static deployment secrets.** Docker/VPS secret files require external provisioning and usually restart or remount, while a shared token gives every worker access to every account.  
   **Fix:** Either drop dynamic onboarding from V1 or adopt a versioned, audited secret store with per-account least-privilege tokens now.

8. **`TradeIntent` is incorrectly broker-neutral.** Absolute entry, SL, and TP prices originate on the TradingView feed but broker quotes, suffixes, stop levels, and basis differ per account.  
   **Fix:** Store source-feed geometry in the intent and derive broker-specific prices, size, and rejection tolerances in each allocation from a fresh account quote/capability snapshot.

9. **The execution state machine conflates attempts, orders, fills, positions, and close commands.** It cannot represent fill-before-ack, repeated partial fills, late fill after cancel, or reconciliation from `OUTCOME_UNKNOWN`.  
   **Fix:** Define separate versioned state machines for `OrderAttempt`, `BrokerOrder`, and `Position`, folded from immutable broker events.

10. **Worker leases lack fencing.** An expired worker can resume after takeover, while freeze, arming expiry, or rule changes can race a claimed job and still permit submission.  
    **Fix:** Use monotonic claim tokens plus an account `safety_epoch`, and require an atomic CAS/recheck immediately before the sole outbound submission.

11. **Risk reservations have no complete lifecycle.** The plan does not define partial-fill conversion, rejection release, ambiguity retention, or crash recovery, risking both leaked and double-counted exposure.  
    **Fix:** Specify `HELD → COMMITTED_PARTIAL/FULL | RELEASED | RECONCILIATION_REQUIRED` with idempotent adjustments keyed by broker deal IDs.

12. **“One active position” does not block concurrent risk.** Pending, submitting, partially filled, and outcome-unknown orders can all exist before a position becomes active.  
    **Fix:** Enforce a database uniqueness invariant over account/subscription/symbol across every risk-bearing state from reservation through closure.

13. **MetaApi correlation is underspecified.** Its short `clientId` is a tracking tag stored with broker objects, not broker-enforced idempotency, so UUID transmission and automatic duplicate prevention assumptions do not hold.  
    **Fix:** Keep internal UUIDs, map them to collision-tested compact MetaApi IDs, declare `enforces_idempotency=false`, and never retry a trade-affecting request after an ambiguous response.

14. **Broker “freshness” does not establish complete broker truth.** Separate REST reads or incomplete streaming synchronization can look fresh while omitting positions, pages, or dropped packets.  
    **Fix:** Persist synchronization ID/sequence, completion and pagination markers, and infer absence only from a complete synchronized snapshot plus matching history evidence.

15. **Emergency Flatten is not convergent.** A delayed fill can arrive after the command cancels orders and enumerates positions, leaving new exposure behind.  
    **Fix:** Freeze via safety epoch, reconcile in-flight attempts, cancel and close, then loop until consecutive complete snapshots prove zero exposure or return explicit `INCOMPLETE`.

16. **Determinism lacks a numeric contract.** The existing portable schema uses binary floats ([contract:47](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/src/core/rd_setup_contract.py:47)), while the plan never fixes representations or canonical serialization for price, money, volume, and hashes.  
    **Fix:** Use integer ticks/lot steps and fixed-scale decimal money, with one specified canonical serialization and hash algorithm.

17. **The simulator promises information absent from its evidence.** Five-minute OHLC cannot determine intrabar SL/TP ordering, spread paths, latency, or partial fills, and no virtual clock or PRNG specification exists.  
    **Fix:** Separate fault emulation from execution replay and require versioned bid/ask tick tapes, virtual time, deterministic event ordering, and a persisted seed.

18. **The greenfield scope discards an already-built Phase 1A baseline.** The repository already contains the RD contract, ingress API, transactional handoff, migration, and regression tests ([API:71](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/src/api_rd_setups.py:71), [handoff:670](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/src/services/rd_setup_handoff.py:670)).  
    **Fix:** Make Phase 0 produce a port/rewrite/negative-oracle inventory and reuse the existing contract corpus before creating new process boundaries.

19. **Operational safety arrives too late.** Phase 1A claims durable evidence, but backup, restore, external alerting, deployment rollback, retention, and disaster recovery are deferred or undefined.  
    **Fix:** Require encrypted PITR, tested full-system restore, external dead-man monitoring, forward-only deployment rollback, and table retention/capacity limits before accepting Phase 1A traffic.

20. **The promotion gates are not measurable.** “Zero unresolved,” “every state reconciled,” undefined divergence tolerances, and 200 correlated trades provide neither operational SLOs nor statistical evidence; platform completion is also incorrectly coupled to strategy profitability.  
    **Fix:** Define bounded reconciliation/unknown-outcome SLOs, preregister independent-intent OOS statistics and confidence bounds, and separate platform completion from per-strategy promotion.

VERDICT: REVISE

### Primary agent's response

Accepted all 20 findings; none were rejected.

- Replaced response-driven resynchronization with per-bar heartbeats, periodic monotonic covering checkpoints, producer-stream row locking, permanent gap audit markers, and independent dead-man monitoring. Canonical and diagnostic Pine emissions are now separate, mutually exclusive alert instances.
- Replaced body-secret/hash trust with a TLS ingress gateway, one-purpose alert capability, signed internal hop, and server-side approved-alert manifest/change control.
- Made paper-only isolation structural through a separate demo-provisioning-only MetaApi tenant plus managed, audited, versioned per-account secrets; broker metadata and database allowlists are no longer considered sufficient proof.
- Changed `TradeIntent` to source-feed integer-tick geometry and added broker-specific `AccountTradePlan` derivation from complete fresh quotes/capabilities.
- Split attempt, broker-order, position, and close-command state machines; added monotonic worker fencing, account safety epochs, database risk slots, and the complete reservation lifecycle.
- Declared MetaApi tracking IDs correlation-only with `enforces_idempotency=false`; ambiguous trade-affecting requests are never automatically retried.
- Replaced timestamp-only broker freshness with complete synchronization generations, pagination/completion/history watermarks, and evidence-based absence.
- Made Emergency Flatten convergent through safety-epoch freeze, in-flight reconciliation, repeated cancel/close/synchronize, consecutive-zero proof, and explicit `INCOMPLETE` termination.
- Added an integer-tick/integer-lot-step/fixed-decimal numeric contract, canonical JSON/SHA-256 hashing, bid/ask tick-tape replay, virtual time, fixed event ordering, persisted seeds, and a separate fault emulator.
- Added a Phase-0 port/rewrite/negative-oracle inventory so the existing RD contract, handoff, migration, and regression corpus are deliberately reused rather than discarded.
- Moved PITR, restore, rollback compatibility, retention/capacity alarms, and external monitoring ahead of Phase 1A traffic.
- Separated technical platform completion from strategy promotion and added bounded heartbeat, reconciliation, ambiguity, soak, independent-intent, and confidence-bound criteria.

## Round 2 — Codex

Most Round 1 findings are materially addressed. These blockers remain:

1. **Gap recovery can resume execution from incomplete setup histories.** A checkpoint restores current state but cannot prove missed terminal or intermediate transitions, yet automatic allocation recovery is allowed ([plan:68](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:68)).  
   **Fix:** Taint all setups spanning a gap and permit execution only for setup lifecycles beginning entirely after the recovery checkpoint.

2. **Complete checkpoints have no overflow protocol.** Validation alone does not help when the full active-set payload exceeds TradingView limits; recovery then becomes permanently impossible.  
   **Fix:** Prove a hard active-set bound below the payload limit or define digest-verified, transactionally assembled checkpoint chunks.

3. **Fan-out membership is not durable.** A crash or subscription change while creating independent allocations can silently omit or add accounts ([plan:123](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:123)).  
   **Fix:** Snapshot the eligible subscription cohort per intent and enforce `UNIQUE(intent_id, subscription_version_id)` before marking fan-out complete.

4. **The dispatch fence promises an impossible zero-width race.** Safety state can change after the database CAS but before bytes reach MetaApi, regardless of “no await” wording ([plan:124](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:124)).  
   **Fix:** Define the successful fence as irrevocable dispatch authorization and require freeze/flatten to reconcile every already-fenced attempt as in-flight.

5. **State names exist, but event-fold semantics do not.** There is no allowed-transition/precedence matrix for fill-before-ack, late fill, conflicting callbacks, or MetaApi’s HTTP-plus-retcode combinations ([plan:125](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:125)).  
   **Fix:** Add a versioned transition table mapping every broker event and response code to aggregate mutations, idempotency behavior, and safety side effects.

6. **Attached SL/TP is still treated as proof of protection.** The plan does not verify the actual filled position’s normalized protective levels or define recovery when the broker fills without them ([plan:88](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:88)).  
   **Fix:** Add `PROTECTION_UNVERIFIED`, verify SL/TP after every fill/partial fill, and freeze plus bounded amend-or-flatten on mismatch.

7. **Broker identity and account-mode constraints remain undefined.** Order, deal, and position IDs can collide across accounts, while MT5 netting and hedging require different reconciliation semantics.  
   **Fix:** Scope broker identifiers by `(provider, account_id, object_type, broker_id)` and pin one supported margin mode during onboarding or implement separate contracts for both.

8. **Trailing/high-water-mark rules lack continuous coverage semantics.** A complete point-in-time synchronization cannot recover an equity peak missed during disconnection, potentially understating drawdown ([plan:97](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:97)).  
   **Fix:** Either restrict V1 to rules reconstructable from broker history or persist coverage-proven equity updates and fail closed permanently across observation gaps.

9. **Tick-tape replay has no acquisition plan.** Phase 1B depends on complete bid/ask tapes, but no source, collector, clock-alignment method, licensing constraint, or collection start milestone exists.  
   **Fix:** Make Phase 0 prove the tick-data source and collector, timestamp alignment, completeness rules, retention, and a usable calibration corpus.

10. **“Recent MFA” is not an enforceable authorization protocol.** An `aal2` JWT can remain valid long after the actual challenge, which is insufficient for flattening or arming ([plan:155](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:155)).  
    **Fix:** Require a server-issued, single-use action token following a fresh MFA challenge, with a short expiry and command/account binding.

11. **Dynamic execution workers remain operationally ambiguous.** “Per-account workers” does not define bounded process count, broker sessions, database connections, fairness, or backpressure.  
    **Fix:** Specify a bounded worker pool with account-keyed claims, per-account concurrency one, queue limits, connection budgets, and starvation tests.

12. **Promotion evidence lacks a concrete telemetry and escalation system.** Metrics are enumerated, but storage, retention, bounded labels, evidence queries, alert acknowledgement, and a second channel beyond Telegram are unspecified.  
    **Fix:** Select the external telemetry backend in Phase 0 and define retained gate queries plus owned, acknowledged, multi-channel escalation SLOs.

VERDICT: REVISE

### Primary agent's response

Accepted all 12 findings; none were rejected.

- Made every gap-spanning/checkpoint-restored lifecycle permanently `GAP_TAINTED`; only a lifecycle born and observed contiguously after a complete recovery checkpoint may execute.
- Added bounded, canonical, digest-verified checkpoint chunks with durable out-of-order staging, transactional assembly, overflow Freeze, and an incomplete-checkpoint deadline.
- Added immutable intent cohorts pinned to a subscription-catalog revision, with member count/digest and `UNIQUE(intent_id, subscription_version_id)` before dispatch.
- Recast the fence as irrevocable `DISPATCH_AUTHORIZED`; any subsequent Freeze/epoch/crash treats it as in flight and never as safely unsent.
- Added a versioned response classifier/fold table, immutable fact precedence, unknown-response ambiguity, and reorder/duplicate property tests.
- Added `PROTECTION_UNVERIFIED`, exact normalized broker SL/TP verification after every fill, one non-retried amend attempt, and a 30-second amend-or-convergent-flatten deadline.
- Scoped broker IDs by provider/account/object type and pinned V1 to verified MT5 retail-hedging demo accounts; netting is rejected pending a separate contract.
- Restricted executable V1 rule packs to reconstructable rules; trailing/high-water equity remains simulator-only without authoritative or coverage-proven history, and observation gaps permanently fail closed for the affected rule window.
- Added a Phase-0 tick-source licensing/provenance decision, append-only MetaApi-feed candidate collector, clock/alignment/completeness rules, encrypted chunks, five-day pilot, and calibration/holdout corpus requirements.
- Replaced session-AAL trust with nonce-bound, 60-second, single-use action grants tied to challenge, actor, command, account, request digest, version, and safety epoch and atomically consumed with the command.
- Bounded V1 to four executor processes, eight account claims/sessions, one claim per account, explicit database/queue budgets, safety-first fair scheduling, capacity rejection, and starvation/saturation tests.
- Added blocking Phase-0 telemetry/dead-man/email selection, concrete retention and cardinality rules, versioned evidence queries, Telegram-plus-email delivery/acknowledgement/escalation SLOs, and vendor/export/channel failure drills.

## Round 3 — Codex

All 12 Round 2 blockers are materially closed. Five new blockers remain:

1. **Dispatch can use a stale trade plan.** The fence checks general freshness but does not revalidate intent expiry, calendar cutoff, quote age, spread, or price basis after queue delay ([plan:127](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:127)).  
   **Fix:** Store `latest_dispatch_at` and atomically revalidate database time plus a fresh account quote/capability snapshot before authorization.

2. **“Complete broker synchronization” may still be a torn view.** Positions, orders, deals, balance, and paginated history can change while separate pages are collected ([plan:114](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:114)).  
   **Fix:** Establish one broker cursor/barrier, buffer concurrent updates, and mark synchronization complete only after snapshot pages plus updates are folded through a common end cursor without gaps.

3. **Observed-feed coverage cannot prove intrabar ordering.** The plan admits the tick source may lack an upstream sequence but still lets replay determine fills and SL/TP ordering ([plan:143](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:143)).  
   **Fix:** Require sequence-complete ticks for exact outcomes or classify every path-dependent interval as ambiguous and non-promotable using conservative execution assumptions.

4. **Daily-reset semantics remain underspecified.** A timezone/DST field does not define repeated or missing local times, reset identity, or duplicate scheduler execution ([plan:102](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:102)).  
   **Fix:** Pin IANA zone and tzdb version, define half-open UTC risk periods and DST fold/gap rules, and enforce one reset under `UNIQUE(account, rule_version, local_period_date)`.

5. **Five-minute RPO contradicts complete auditability.** A restore may lose acknowledged receipts, commands, or `DISPATCH_AUTHORIZED` facts even though the platform gate requires every action to remain traceable ([plan:178](/Users/ameeramer/dev/projects/galilsoftware/sources/trading/PLAN-PROP-TRADING-SYSTEM.md:178)).  
   **Fix:** Synchronously replicate critical receipts, operator commands, dispatch authorizations, and broker facts off-host before acknowledgement/dispatch; retain five-minute RPO only for rebuildable data.

VERDICT: REVISE

### Primary agent's response

Accepted all five findings; none were rejected.

- Added immutable plan validity/deviation bounds, a fresh persisted `DispatchValidationSnapshot`, PostgreSQL-clock checks for intent/calendar/quote/spread/basis/capability/risk validity, explicit non-dispatch outcomes, and adapter-enforced order bounds. Replanning creates a new plan; it never extends the old one.
- Replaced timestamp freshness with a causal common-cursor broker contract: buffer concurrent updates from `C0`, collect every page at one barrier, fold gaplessly through `C1`, and publish complete only after Tier 0 remote durability. MetaApi without this capability cannot arm or execute new risk.
- Classified tapes as `SEQUENCE_COMPLETE`, `CONTINUOUS_OBSERVED`, or `INCOMPLETE`. Only sequence-complete, path-unambiguous intervals support exact replay/promotion; all ambiguity is persisted, conservatively stress-tested, retained in the campaign denominator, and excluded from exact evidence. No qualifying source means strategy promotion stays blocked.
- Pinned IANA zone/tzdb/reset time and explicit fold/gap resolution; precomputed immutable half-open UTC periods with unique account/rule/local-date identity, idempotent catch-up, adjacency checks, and arming coverage.
- Split durability into Tier 0 safety/audit facts and Tier 1 rebuildable data. Tier 0 requires synchronous off-host remote apply before acknowledgement, cursor advance, broker authorization, risk release, or completeness; link/standby loss freezes without async fallback. RPO is zero for acknowledged Tier 0 facts under primary host/site failure, at most five minutes for Tier 1, and separately measured for correlated disaster.

## Round 4 — Codex

All five Round 3 blockers are materially closed. No remaining or newly introduced implementation blocker meets the stated safety, correctness, or verifiability threshold; unresolved provider capabilities are correctly handled as fail-closed kill criteria.

VERDICT: APPROVED


## Act 3 — Build

- Built the Phase 0 observation-only foundation in the greenfield `prop-trading-system` repository on branch `codex/phase-0-foundation`; the legacy `trading` repository remained an unchanged provenance source.
- The build thread completed an initial implementation and two bounded correction rounds. It produced typed canonical contracts, an append-only exact-byte evidence ledger, fail-closed health/readiness APIs, a server-backed operations console, deterministic tick-fixture durability, frozen evidence registries, locked dependencies, secret scanning, and bounded container verification.
- Primary review hardened unsupported JavaScript state, PostgreSQL-incompatible null code points, authorization redaction, checkpoint timestamp and geometry semantics, repeated crash quarantine recovery, runtime database privileges, envelope binding, frozen-log parsing, lockfile credential detection, and bounded Compose cleanup/diagnostics.
- Cross-runtime canonicalization now accepts only ordinary dense enumerable data arrays and plain data objects; duplicate decoded keys, lone surrogates, unsupported prototypes/accessors/symbols/hidden state, unsafe integers, noncanonical bytes, and PostgreSQL-incompatible null code points fail closed.
- Checkpoint comparisons retain all nine fractional-second digits, equivalent UTC spellings compare by instant, active detector geometry is exactly five minutes, formation cannot follow the confirmed checkpoint bar, and the snapshot candle closes at that confirmed instant.
- The evidence ledger preserves authoritative canonical UTF-8 text and database-generated SHA-256, exposes only SELECT plus the typed append function to the runtime role, rejects unsafe reused roles including ownership of the database or public schema, and blocks direct insert, forged time/hash, schema/envelope mismatch, update, delete, and truncate.
- Focused primary proof passed 106 Python contract/unit/static tests, 20 frontend canonical tests, Ruff format/lint, ESLint, and TypeScript checking. The final acceptance command for this exact tree is `make verify-phase0`.
- All 13 external capability gates intentionally remain `BLOCKED`; readiness remains false, no broker or execution adapter is present, and this phase cannot place or simulate trades.
