# Plan: Local MT5 Prop-Firm Automation With a Fail-Closed Risk Gateway
_Locked via grill — by Codex + Ameer Amer on 2026-08-10_

## Goal

Extend the existing RD five-minute observation and paper-simulation system into a deterministic,
auditable automation pipeline for the user's own `DIR_CLOSE` strategy on a user-owned Windows 11
MT5 machine without a VPN or VPS. TradingView remains an untrusted proposal source, never the sole
trade authority. Before any lease, a new isolated execution edge independently reconstructs the
directional close and stop geometry from authenticated MetaTrader broker bars, enforces account and
prop-firm rules, and issues at most one narrowly scoped command. One personal MQL5 Expert Advisor
polls outbound over HTTPS, revalidates every command, sizes the order, requires broker-side
protection in the initial request, and reports the complete outcome. The current Pine v3 fixed-tick
trade plan is not executable: the first prerequisite is a new immutable paper-only strategy/wire
version containing exact entry-candle provenance and verified 4R arithmetic, followed by fresh
evidence under that exact version. Normal Version 1 automation is activated only on a $50,000
MetaQuotes demo account and the five mapped instruments `EURUSD`, `GBPJPY`, `USDJPY`, `XAUUSD`, and
`USTEC`; a FundingPips 50K 2 Step Standard evaluation is a later manual promotion that requires
both sequential simulated phases, eight weeks of fresh evidence, at least 100 eligible signals,
no unresolved safety incidents, current firm-policy confirmation, and the user's separate
approval. The design minimizes recurring cost while accepting no promise of profit or of passing
a prop-firm evaluation.

## Approach

### 1. Preserve the current observation boundary and create a separate execution workstream

1. Keep `apps/observation-edge`, its D1 database, the Pine v3 producer, paper simulator, operations console, and all existing `paper_only` / `real_execution_allowed=false` contracts broker-free. Do not weaken or delete the boundary tests that forbid broker credentials, broker commands, live orders, or account tokens in that application.
2. Add a new application, `apps/execution-edge`, with its own Wrangler configuration, SQLite-backed Durable Object namespace, execution D1 database, secrets, migrations, test suite, and deployment name. Reusing the Cloudflare account and repository is allowed; sharing public routes, databases, credentials, or mutable domain tables with `observation-edge` is not.
3. Before candidate work, freeze a new `rd-entry-execution-proposal-v1` strategy/wire version. It
   replaces v3's operator-configurable 100-tick stop and 200-tick target with immutable fields for
   the uniquely identified zone-engagement candle, its five-minute OHLC, the direction-specific
   wick reference, the reviewed per-symbol buffer policy, entry price, risk distance, and exact 4R
   target. Its reviewed per-symbol provenance table states how the engagement candle and buffer
   are selected. Until the contract, videos/source citations, golden vectors, Pine/edge parity, and
   owner approval are complete, every proposal remains `PAPER_ONLY`; old v3 observations and paper
   results are ineligible for execution promotion.
4. Let `observation-edge` create only an account-free, versioned `ExecutionCandidateV1` after all of
   these facts are durably present:
   - an authenticated, accepted, confirmed five-minute observation in the new proposal version;
   - an exact canonical `DIR_CLOSE` selection;
   - the existing `TWO_PLUS_CANDLES` liquidity cohort; `ONE_CANDLE` remains shadow-only;
   - reviewed detector and ticker-specific settings hashes plus exact geometry/provenance fields;
   - a producer-integrity record proving `LIVE_CONTIGUOUS` ingest, no producer-sequence gap since
     the last accepted checkpoint, no historical/backfill delivery, and no conflicting duplicate;
   - no diagnostic, shadow-only, fallback, discretionary, BOC, or HTF-flip status.
   Evidence replayability is a separate semantic field: `DIR_CLOSE` may correctly be
   `REPLAYABLE` without being a historical replay delivery.
5. Persist the candidate-outbox row and producer checkpoint in the same D1 atomic batch that links
   the exact selection to its new-version paper result. The digest-free logical candidate ID is
   derived only from strategy/wire version, ticker ID, setup ID and revision, selection ID, and
   source bar close. Store the canonical candidate-body SHA-256 separately. Exact duplicate bytes
   reproduce one logical ID and digest; any changed geometry or other content under that logical ID
   produces a digest conflict and quarantines the producer.
6. Implement at-least-once delivery explicitly. An `ObservationOutboxDispatcher` Durable Object
   owns an alarm, claims due D1 rows with conditional leases, calls a dedicated non-public
   service-binding RPC method, and records acknowledgement. Retry uses bounded exponential backoff
   only before candidate TTL. Each attempt carries the digest-free logical candidate ID as delivery
   ID and the canonical body digest as a separate field. Before evaluating anything, a
   receiver-side `CandidateInbox` Durable Object transaction inserts the unique logical ID, body
   digest, immutable candidate bytes, stored RPC response, audit-outbox row, pinned routing-manifest
   version, and one routing-outbox row for each destination account selected by that manifest.
   Exact retries return the stored response; a different digest under the same logical ID
   quarantines the inbox with no side effects. An inbox alarm delivers each routing row through a
   non-public coordinator RPC keyed by `(logical_candidate_id, account_id,
   routing_manifest_version)`. The destination coordinator transaction deduplicates that key before
   any decision/reservation effect and replays its stored routing result on retry. Delivery
   acknowledgement and routing-row completion are idempotent; a crash before fan-out, after a
   coordinator commit, or before the outer D1 acknowledgement can only cause replay. A scheduled
   recovery tick wakes stale dispatchers/inboxes and releases expired claims. Public internet
   requests cannot invoke either RPC, late rows expire, and no failed row is reconstructed into a
   trade.
7. Keep proposal-version emission and outbox dispatch disabled behind separate observation-side
   flags and a pinned manifest. Existing paper simulation continues unchanged. No old v3 paper
   intent or result can be converted into a candidate.

### 2. Freeze explicit contracts before implementation

8. Define strict JSON schemas and canonical SHA-256 hashing for:
   - `ExecutionCandidateV1` — immutable strategy evidence and source geometry;
   - `BrokerBarEvidenceV1` — bounded, authenticated MT5 M5/M1 broker bars and reconciliation cursor;
   - `AccountProfileV1` — immutable account fingerprint, environment, symbol map, limits, firm phase,
     and maximum authority ceiling; it contains no current activation state;
   - `SignedAccountProfileV1` — exact authenticated envelope for one immutable account profile;
   - `PropRulePackV1` — versioned FundingPips/demo risk and calendar rules;
   - `NewsCalendarPackV1` — operator-attested high-impact events and coverage;
   - `AgentSyncRequestV1` / `AgentSyncResponseV1` — the one outbound agent protocol;
   - `TradeCommandV1` — a leased, expiring authorization, never a generic order API;
   - `AgentEventV1` — append-only terminal/order/deal/protection/reconciliation facts;
   - `ExecutionDecisionV1` — every allowed or blocked risk decision with reason codes.
   Freeze the profile envelope as
   `{schema_version, profile, profile_sha256, issuer_id, key_id, issued_at_epoch,
   not_before_epoch, expires_at_epoch, safety_epoch, mac_alg, mac_hex}` with no unknown fields and
   `mac_alg="HMAC-SHA256"`. `profile_sha256` is SHA-256 over canonical UTF-8 profile bytes.
   `mac_hex` is HMAC-SHA256 over UTF-8
   `"tradeops.account-profile.v1\n" + canonicalStringify(envelope_without_mac)` using a distinct
   random 256-bit profile-MAC key—not the agent bearer. The issuer is the execution-edge profile
   issuer after an account-specific owner grant; the coordinator stores the accepted profile digest,
   key ID, expiry, safety epoch, authority ceiling, and revocation status. The matching trust anchor
   is stored only as a Cloudflare secret and an ACL-restricted local EA secret. Profiles are valid
   only inside their time window and for the exact safety epoch. Rotation requires freeze, no active
   lease, a new key/key ID and profile, safety-epoch increment, local trust-anchor replacement, and
   explicit revocation of the old key ID before recovery. D1/audit/logs contain no MAC key.
9. Reject unknown fields, floats for money/risk, non-canonical decimals, non-UTC wire timestamps,
   unsafe integer ranges, unrecognized enums, invalid hashes, oversized bodies, and timestamps
   outside configured skew. Store every price as integer ticks under an immutable source or broker
   capability version; missing tick-size provenance quarantines the fact.
10. Keep `ExecutionCandidateV1` account-free. It pins only strategy/wire, detector, settings,
    source ticker/feed, source tick capability, rule contract, session cohort, ingest-integrity
    checkpoint, and source geometry. The account-specific `ExecutionDecisionV1` and
    `TradeCommandV1` separately pin account profile, broker symbol capability, independently
    reconstructed broker geometry, news pack, execution policy, prop-rule pack, safety epoch, and
    reservation. Configuration changes create immutable versions and never reinterpret history.
11. Generate golden vectors shared by TypeScript and MQL5 for canonical serialization, candidate
    identity, source-versus-broker bar reconstruction, risk arithmetic, symbol translation, volume
    flooring, wick/buffer/4R geometry, profile SHA/HMAC verification, expired/not-yet-valid/revoked
    key handling, fold transitions, and reason codes. The EA rejects a vector set whose embedded
    digest differs from the edge manifest.

### 3. Serialize every account decision in one Durable Object

12. Create one SQLite-backed `AccountCoordinator` Durable Object per internal account ID. It is the
    sole writer for mode, freeze reasons, owner grants, agent enrollment, daily baselines,
    reservations, command leases, broker-event folds, heartbeat state, and open-risk state.
    `execution-edge` routes every candidate evaluation, owner mutation, and agent sync for an
    account through that object.
13. Make every coordinator mutation atomically create an immutable local audit-outbox record and
    set `audit_pending=true` when the mutation changes safety or broker state. While any required
    audit row is pending, the coordinator cannot create a new reservation or lease. An alarm
    idempotently appends those rows to execution D1, records the D1 acknowledgement identity, then
    clears the corresponding pending bit in one coordinator transaction. A crash anywhere causes
    replay of audit bytes, never replay of a broker command.
14. Separate account mode from safety latches. Mode is one of `REGISTERED`, `SHADOW`, `DRY_RUN`,
    `DEMO_CANARY`, `DEMO_ARMED`, `EVALUATION_PENDING`, `EVALUATION_ARMED`, or `RETIRED`.
    `FROZEN` is derived from a non-empty set of immutable reason instances such as
    `AUDIT_PENDING`, `RECONCILIATION_UNKNOWN`, `STALE_NEWS`, `CAPABILITY_CHANGED`,
    `PROTECTION_FAILURE`, or `OPERATOR_FREEZE`; it is not a linear lifecycle state. Removing a
    reason requires its reason-specific recovery proof and, where operator-controlled, a
    single-use grant. Evaluation modes remain unreachable until section 12's paid gate. Master or
    funded activation is absent from V1. The coordinator is the sole authority for current mode;
    the immutable account profile can only cap which modes are reachable.
15. Model MT5 as related append-only folds rather than one lossy command state:

    | Fold | Required states/facts | Lease/risk consequence |
    | --- | --- | --- |
    | decision | `BLOCKED`, `PENDING`, `AUTHORIZED`, `EXPIRED` | only `AUTHORIZED` may reserve |
    | reservation | `RESERVED`, `PARTIALLY_CONSUMED`, `CONSUMED`, `RELEASED`, `UNRESOLVED` | all but released consume modeled-loss capacity |
    | command lease | `PENDING`, `LEASED`, `EXPIRED_UNSENT`, `SUBMISSION_UNKNOWN`, `TERMINAL` | unknown blocks all new leases |
    | submit intent/request | `JOURNALED`, `SENT`, `ACK_REJECTED`, `ACK_ACCEPTED`, `ACK_UNKNOWN` | sending requires durable `JOURNALED` fact |
    | broker order | zero or more discovered order tickets and ordered status facts | residual volume remains reserved |
    | broker deal | zero or more immutable deal facts, deduplicated by broker identity | every fill consumes reservation |
    | position | `ABSENT`, `OPEN`, `PARTIAL`, `CLOSED`, with volume and weighted fill | open volume consumes risk |
    | protection | `REQUIRED`, `VERIFIED`, `MISSING_DEFINITE`, `UNKNOWN`, `BREACHED` | anything but verified/closed freezes entries |
    | close attempt | `JOURNALED`, `SENT`, `ACK_UNKNOWN`, `RECONCILED` | never blindly retry an ambiguous close |

    Freeze on illegal or contradictory transitions. Partial fills, residual orders, late fills,
    protection changes, and multiple deals coexist as facts; no single enum may erase them.
16. Permit at most one account risk reservation and one active command lease for a strategy trade
    idea. Treat same-symbol/same-direction positions and any reopen within ten minutes of a losing
    close as one prop-firm idea. Pending leases, every broker order, residual volume, partial fills,
    open positions, and unresolved outcomes count toward aggregate risk.
17. Bind each short lease to candidate, command, agent, account fingerprint, safety epoch,
    rule/capability versions, body digest, and expiry. `EXPIRED_UNSENT` may release only after the
    durable EA journal and broker reconciliation prove no send. Any expiry after a possible send is
    `SUBMISSION_UNKNOWN`; it is never renewed and freezes risk until stable history proves the
    request absent or fully accounts for its orders/deals/positions.

### 4. Use one narrow outbound MT5 agent protocol

18. Expose one public authenticated endpoint on `execution-edge`: `POST /api/v1/agent/sync`.
    The Windows EA calls it every five seconds with one heartbeat, monotonic agent sequence, last
    acknowledged server sequence, account snapshot, bounded broker-bar evidence, reconciliation
    cursors, and a bounded batch of durably persisted agent events. The response contains server
    time, mode/freeze reasons, acknowledged event watermark, evidence requests, and at most one
    command. No public endpoint accepts a TradingView proposal or generic order instruction.
19. Before implementing any mutable owner API, complete the repository's blocked identity gate:
    provision the chosen Supabase Auth tenant, verify issuer/JWKS, roles, AAL2 TOTP enrollment,
    challenge freshness, logout/revocation, and recovery in credentialed integration tests. Then
    implement a 256-bit, 60-second, single-use action grant whose digest and bindings live inside
    the target `AccountCoordinator`. The same coordinator transaction consumes the grant and
    performs the exact protected mutation. Until this prerequisite is green, every account is
    structurally limited to `SHADOW`/`DRY_RUN` and owner controls are read-only except an
    authenticated fail-safe `FREEZE` that can only reduce authority.
20. Authenticate the agent with a random 256-bit per-installation bearer credential over HTTPS.
    Store only its SHA-256 digest server-side and plaintext only in an ACL-restricted local file
    outside Git/logs. Initial `ENROLL_AGENT`, rotation, and replacement are grant-protected
    coordinator transitions; rotation increments the safety epoch and invalidates outstanding
    leases. Never embed the token in `.mq5`, `.ex5`, screenshots, command lines, TradingView, or D1.
21. Require installation ID, pinned account fingerprint, monotonic request sequence, nonce, UTC
    timestamp, and exact body digest on every sync. Exact network retries return the original
    response; conflicting reuse is an incident. Rate-limit by installation/account and never use
    source IP as identity.
22. Use a five-second nominal interval, synchronous WebRequest timeout below two seconds,
    exponential transport backoff capped at 60 seconds, and jitter. A timer event missed while
    WebRequest runs is expected and cannot be interpreted as a second lease request. One agent is
    measured against current Worker, Durable Object, and D1 limits; usage alarms add a freeze reason
    before 50% of any daily free-tier quota. More agents require a new cost/capacity review.
23. Require fresh `BrokerBarEvidenceV1` before authorization. For the candidate symbol the EA sends
    closed M5 bars covering zone engagement through directional close, plus bounded overlapping M1
    bars when counterfactuals need them, all under the broker symbol-capability digest and stable
    reconciliation cursor. The execution edge independently reconstructs the first qualifying
    zone engagement, directional close, wick reference, buffer, and 4R geometry. Source and broker
    prices may differ within a versioned tolerance, but candle ordering, direction, zone contact,
    stop side, and risk distance must agree. Missing bars, gaps, mutable last bars, excess feed
    divergence, or inability to reproduce the trigger blocks the candidate. TradingView evidence
    alone can never lease a command.
24. Make candidate and command TTL explicit. The initial `DIR_CLOSE` market-entry policy uses a
    maximum command age of 30 seconds from the confirmed source bar close and also requires the
    matching broker bar to be closed/stable. If independent confirmation, reservation, and leasing
    do not finish in that window, expire the candidate; never chase on the next bar.
25. Require terminal build, EA/manifest digests, account fingerprint, broker and Windows clocks,
    connection/trading permissions, symbol capability digests, balance/equity/margin, complete
    order/position summary, and stable reconciliation watermark. Unknown or stale fields block.

### 5. Build a personal, multi-symbol MQL5 Expert Advisor

26. Add a new `mt5/TradeOpsAgent` source tree containing the uncompiled personal `.mq5` EA, pure
    MQL5 domain modules, contract fixtures, build scripts, version metadata, and operator
    documentation. Keep all source/history as ownership evidence. Do not use marketplace code,
    third-party signals/copiers, DLL imports, Python bridges, browser automation, or MetaApi.
27. Attach exactly one EA instance to one `EURUSD,M5` chart. Use `OnTimer` for sync and keep
    `OnTradeTransaction` O(1): it only copies bounded transaction facts into a preallocated queue
    and returns. Reconciliation, serialization, disk I/O, and WebRequest run outside that handler.
    An interprocess lock prevents a second instance from acquiring execution authority.
28. Pin the demo symbol map:

    | TradingView source | MetaQuotes demo |
    | --- | --- |
    | `EURUSD` | `EURUSD` |
    | `GBPJPY` | `GBPJPY` |
    | `USDJPY` | `USDJPY` |
    | `XAUUSD` | `XAUUSD` |
    | `NAS100` | `USTEC` |

    Symbol mappings are account-profile data, never string guesses. On onboarding, capture digits, point/tick size, tick value, contract size, volume minimum/maximum/step, stops level, freeze level, trade mode, session schedule, filling modes, and current spread. Any later capability change freezes that symbol until reapproved.
29. Before every order, the EA independently checks:
   - the signed, command-pinned immutable account profile exactly matches login hash, server,
     environment, margin mode, currency, balance class, and authority ceiling; the initial profile
     is specifically `MetaQuotes-Demo`, hedging, USD, and $50K and can never validate a paid account;
   - agent/manifest/command versions and safety epoch;
   - connected terminal, synchronized symbol, fresh bid/ask, trading session, and acceptable clock skew;
   - Algo Trading permission, account trade permission, symbol trade permission, margin, volume step, stops/freeze levels, and spread ceiling;
   - no duplicate attributed command/order/position and no order or position anywhere on the
     account that is absent from the coordinator's stable fold;
   - the edge-provided reservation and risk values match locally recomputed conservative values.
    Any disagreement rejects the command and emits a reason; the EA never “fixes” server intent silently.
30. Use only the independently reconstructed broker geometry. The unique engagement-candle epoch and
    direction must match the proposal; the broker wick plus immutable buffer produces the
    executable stop, and target is exactly four times normalized initial risk after spread/safety
    adjustments. Compare the source feed only for identity/divergence checks. Reject changed side,
    excessive movement, broker-bar mismatch, invalid stops, or any normalization that increases
    risk or weakens protection.
31. Size volume from the lower of balance/equity using a versioned `ModeledLossPolicyV1`. Use
    `OrderCalcProfit` for loss to stop, then add the approved symbol's explicit gap/slippage stress
    ticks, spread ceiling, commission, swap horizon, partial-fill/residual-order allowance, and
    rounding reserve. The per-symbol stress table records data source, lookback, quantile or fixed
    floor, effective date, and expiry. Floor volume to step and recompute modeled loss; never round
    up. This is a conservative model, not a guaranteed maximum across discontinuous markets.
    Reject unavailable/expired inputs, excessive minimum volume, or insufficient margin.
32. Add a `DEMO_CANARY` capability gate per account and symbol. Before normal strategy leasing, one
    separately owner-approved, supervised minimum-volume strategy canary on MetaQuotes demo must
    prove that a market request containing both SL and TP yields a filled position with those
    broker-side protections attached atomically. `OrderCheck` and documentation alone are
    insufficient. Failure permanently blocks that capability version until recaptured and
    reapproved. There is no such canary on a paid account without a new onboarding plan.
33. In V1 every market request must contain both broker-valid SL and TP in the initial request. If
    the approved capability cannot do that, reject before `OrderSend`; there is no normal
    post-fill protection window. Persist the exact received command, broker snapshot, calculated
    volume/geometry, and `SUBMIT_INTENT` write-ahead record to checksummed storage and flush it
    before calling `OrderSend`. Request success is not proof of order, fill, or protection.
34. Reconcile from current orders/positions and overlapping account history by magic, command tag,
    request ID, order/deal tickets, symbol, side, volume, and time window. On startup, reconnect,
    timeout, journal recovery, or possible queue loss, repeat overlapping history sweeps until two
    consecutive canonical snapshots have the same digest and cursor coverage. Accept no new lease
    until that stable fold accounts for all pre-submit intents and every account order, position,
    and recent deal, including manual or foreign-magic exposure. Any unattributed order/position
    creates `UNATTRIBUTED_EXPOSURE`, freezes entries, and reserves at least the greater of its
    computable stressed loss and all remaining local risk capacity; missing SL/price/capability
    makes the exposure unpriced and consumes the full local capacity until owner-reviewed
    reconciliation attributes or closes it.
35. A definite fill without exact verified SL/TP immediately creates `MISSING_DEFINITE`, freezes
    all new entries, durably journals an emergency-close intent, and attempts to flatten only the
    exact proven position. An ambiguous fill or close never triggers a blind retry; it remains
    `UNKNOWN` while stable reconciliation continues. The account stays frozen until protection or
    closure is proven.
36. Use append-only, checksummed journal segments for received commands, acknowledgements,
    pre-submit intents, outgoing events, and reconciliation snapshots. Fsync before broker actions.
    Never evict or compact an unacknowledged command, unresolved intent, or event; rotate only
    fully acknowledged closed segments. Do not persist account passwords or bearer tokens there.

### 6. Encode the conservative strategy and account risk policy

37. Execute only the new-version exact `DIR_CLOSE` plus `TWO_PLUS_CANDLES` cohort in V1. Keep BOC,
    HTF flip, discretionary setups, fallback liquidity, `ONE_CANDLE`, historical/backfill proposals,
    and new cohorts shadow-only. Diagnostics never trade. A v3 `PAPER_ELIGIBLE` label is not an
    execution qualification.
38. Use the new immutable strategy exit contract:
   - stop slightly beyond the deepest wick of the candle that entered the zone, with the reviewed broker safety/spread buffer;
   - one fixed 4R take-profit;
   - no breakeven, trailing stop, partial take-profit, loss-recovery sizing, martingale, grid, pyramiding, hedging, or discretionary override.
    For each promoted source/broker symbol pair, the contract stores the exact engagement-candle
    selection rule, direction-specific wick field, minimum buffer, feed-divergence tolerance, and
    citations. Undefined pair rules fail closed.
39. Use 0.5% nominal risk per idea. Increase to 1.0% only while realized balance is at least 2.0%
    above phase opening balance and all safety gates are healthy. Revert immediately below that
    threshold. In the 1% tier, permit only one full-risk new idea per trading day.
40. Enforce the stricter portfolio envelope before firm hard limits:
   - maximum two new executed trade ideas per reset day;
   - maximum 1.0% aggregate reserved/open `ModeledLossPolicyV1` exposure;
   - stop all new trades after 1.0% nominal realized plus floating daily loss;
   - correlated or same-direction ideas share the same 1.0% aggregate cap;
   - pending, leased, submission-unknown, unattributed, partially filled, and open exposures all
     consume modeled-loss capacity; an unpriced exposure consumes the full remaining capacity;
   - operator freezes block entries but never remove broker-side protection.
    A gap or broker failure can exceed the model. If actual loss, mark-to-market exposure, or
    realized slippage exceeds its modeled bound, add `MODELED_LOSS_BREACH`, stop all new leases,
    preserve/tighten protection or emergency-close only when required, and require incident review
    plus a newly approved stress-policy version before recovery.
41. Compute daily and total loss from immutable phase baselines and the higher of balance/equity at
    the rule pack's documented platform reset. Include floating and realized P&L, commission, swap,
    and unresolved modeled-loss reservations. Do not assume a fixed UTC offset; pin reset timezone and
    daylight-saving semantics from the account's current official rule pack. Missing rollover
    history freezes until reconciliation reconstructs it.
42. Create the FundingPips 50K 2 Step Standard pack only after the exact product is selectable and
    its then-current checkout/help/support evidence has been captured. The user's screenshots show
    materially different Standard/Pro/Flex rule choices, so prior 8%/5%/5%/10% values are not
    authority. Store targets, daily/maximum loss formula, reset time, minimum days, inactivity,
    news/weekend constraints, concentration, leverage, commissions, and effective date as
    `DRAFT_UNVERIFIED` until two-source review plus owner attestation. Such a pack cannot arm an
    evaluation. The local 1% envelope remains tighter and cannot be loosened by any firm pack.
43. Treat every prop-firm policy as unstable. Expired, disputed, unsupported-region, or changed
    evidence freezes paid activation. A profile change cannot mutate an active command/history.

### 7. Make sessions and strategy variants isolated experiments

44. Observe valid proposals from 08:00–22:00 `Asia/Jerusalem`, but authorize only the reviewed
    baseline 08:00–15:00 `Europe/London`. Store IANA zones and tzdb version; never fixed offsets.
45. Add a separate immutable counterfactual ledger keyed by
    `(candidate_id, variant_id, broker_feed_profile, cost_model_version)`. It does not reuse or
    mutate the existing unique `(setup_id, attempt_kind)` paper/shadow rows. Each variant stores
    required data resolution, spread/commission/slippage model, deterministic fill convention,
    open/ambiguous state, and settlement facts. The EA supplies bounded authenticated M1 broker bars
    and spread snapshots during shadow/demo operation; missing M1 coverage leaves trailing/BE
    variants `UNSETTLED_DATA_GAP`, never inferred from M5 candles.
46. Generate mutually exclusive counterfactual variants for:
   - baseline 08:00–15:00 London;
   - full 08:00–22:00 Jerusalem;
   - Asia, London, and New York buckets;
   - fixed 3R versus canonical 4R;
   - breakeven at 2R;
   - one-minute trailing only after 3R;
   - BOC and HTF-flip entries.
47. Change one factor per variant. Only the canonical new-version
    `DIR_CLOSE`/4R/no-management/baseline-session policy may eventually produce a command. The
    existing simulator continues its current single-outcome role; the new ledger evaluates variants
    without claiming broker execution.
48. Report expectancy in R, profit factor, drawdown, win rate, count, ambiguous/open/data-gap count,
    cost sensitivity, and simulated phase pass/breach. Never promote without sample size and an
    untouched-data result.
49. Unlock optimizer research only after eight weeks, 200 total eligible shadow signals, and 30 per
    candidate pair under one immutable strategy version. Walk-forward proposals cannot update the
    active manifest automatically.

### 8. Use a free, explicit news-calendar process in V1

50. Keep the TradingView `News° [toodegrees]` indicator as a visual cross-check only. It cannot authorize execution.
51. Add an owner-only weekly import workflow for Forex Factory high-impact events, the source FundingPips currently identifies for its news rules. The operator imports a reviewed CSV/JSON pack containing event ID, affected currencies, UTC start/end, impact, title, source URL, retrieval time, coverage interval, and content digest. Do not scrape Forex Factory automatically in V1.
52. Require a calendar pack that covers the current time through at least the next 24 hours and was operator-attested within the configured weekly window. Missing coverage, stale pack, malformed event, currency uncertainty, or disagreement with the visible TradingView calendar freezes new entries and raises an incident.
53. Block and expire new entries from 15 minutes before through 15 minutes after an affected
    high-impact event. Blackouts never block a required safety action: attaching/restoring/tightening
    protection, cancelling residual entry orders, or emergency flattening a definitely unprotected
    position remains allowed and is durably audited. Optional management, profit-taking changes,
    widening protection, and all new entries remain forbidden. This is deliberately stricter than
    the currently documented five-minute Master entry restriction without sacrificing safety.

### 9. Build owner controls, visibility, and evidence

54. Extend the operations console with a separate execution section that reads only authenticated `execution-edge` APIs and displays:
   - environment/account/phase and exact activation state;
   - agent heartbeat, build, clock skew, server, terminal connection, and Algo Trading status;
   - rule/news/session/strategy/symbol-capability versions;
   - daily baseline, current loss, trade-idea count, reserved/open risk, and tier;
   - candidate-to-command-to-order-to-deal-to-protection chronology;
   - every block/freeze/expiry/reconciliation reason;
   - Cloudflare request-budget headroom and Windows watchdog freshness.
55. After the owner-auth prerequisite passes, define exact grant-protected mutations for
    `ENROLL_AGENT`, `ROTATE_AGENT`, `IMPORT_NEWS_PACK`, `APPROVE_SYMBOL_CAPABILITY`,
    `APPROVE_RULE_PACK`, `ACKNOWLEDGE_INCIDENT`, `RECOVER_FREEZE_REASON`, `PROMOTE_DEMO_MODE`, and
    later `REQUEST_EVALUATION_ACTIVATION`. Each action names recovery prerequisites, resource
    version, safety epoch, and request digest; its grant is consumed inside the coordinator
    mutation. `FREEZE` is separately allowed as a fail-safe reduction of authority. There is no
    `FORCE_TRADE`, blanket `UNFREEZE`, or wildcard grant.
56. Define recovery as reason-specific. For example, stale news requires a newly validated pack;
    changed capability requires recapture and canary; reconciliation unknown requires two stable
    history sweeps; audit pending requires D1 acknowledgement; and protection failure requires
    proven protection/closure plus incident acknowledgement. Clearing one reason never clears
    another.
57. Create an ownership/evidence bundle containing `.mq5` source, Git history, compile logs, exact
    build hashes, architecture/rules, vectors, demo reports, and redacted screenshots. This supports
    a firm ownership review but does not presume acceptance.
58. Redact account login, email, tokens, credential URLs, TradingView credentials, and terminal
    paths. Add secret scanning and negative tests proving secrets never enter proposal/audit data.

### 10. Harden the dedicated Windows 11 execution host

59. Use the user's spare Windows 11 laptop on the user's home Ethernet connection. Do not use a VPN, VPS, remote trading host, public inbound port, or FundingPips credential outside that device. Keep Windows firewall and Defender enabled.
60. Configure AC sleep and hibernation off, lid-close action “do nothing” while plugged in, automatic Windows time synchronization, automatic power recovery where supported, and controlled update/restart windows outside trading sessions. The laptop battery supplies short outage protection; a UPS is optional later.
61. Install only release MT5, the personal EA, its ACL-restricted config, and repository-supplied watchdog scripts. Use Windows Task Scheduler to start MT5 after login/reboot and a local watchdog to detect process/heartbeat failure. The watchdog may restart a definitely stopped terminal but may never submit or modify orders.
62. Keep MT5 one-click trading disabled. Initially keep Algo Trading off. When demo activation is approved, allow only the exact execution Worker origin under MT5 WebRequest settings, leave DLL imports disabled, attach one EA instance, verify the profile `RD_PAPER`, and record the terminal/EA hashes.
63. The current signed account profile is demo-only: MetaQuotes-Demo, USD, hedging, and initial
    balance $50,000. Never infer that a later FundingPips account is equivalent. A new
    server/login/symbol set forces `EVALUATION_PENDING`, fresh capability capture, token rotation,
    rule review, and a separately signed immutable paid-account profile whose authority ceiling is
    initially `DRY_RUN`. Commands pin the exact profile digest; no conditional in the EA hard-codes
    demo identity as the universal paid-account guard.

### 11. Test from pure logic through real demo execution

64. Use TDD for every safety behavior. Add TypeScript contract/model tests for the new paper-only
    strategy/wire version, producer checkpoint/gap ledger, account-free candidate, service-binding
    RPC isolation, alarm-driven outbox leases/recovery, independent broker-bar reconstruction,
    coordinator audit outbox, owner identity/grant atomicity, reason-specific freezes, every fold
    transition, risk/news/session policy, counterfactual data gaps, and redaction. Retain all
    existing observation/paper boundary tests.
65. Add deterministic MQL5 tests/scripts for canonical vectors, mapping, bar serialization, geometry,
    `OrderCalcProfit`, volume flooring, fingerprinting, duplicate detection, write-ahead journal
    fsync/recovery, stable overlapping history folds, and event-queue handling.
66. Because `WebRequest` is unavailable in Strategy Tester, keep pure domain modules separate from
    the live transport. Run HTTPS/auth and broker integration only on MetaQuotes demo. Stress the
    `OnTradeTransaction` capture path beyond 1,024 rapid facts in a harness and prove its handler
    stays bounded/O(1); an overflow or sequence gap must freeze and force history reconciliation.
67. Prove these failure cases before any normal demo strategy order:
   - duplicate/out-of-order/conflicting TradingView webhook;
   - dispatcher crash before/after service-binding delivery, expired D1 claim, duplicate candidate
     delivery, and duplicate agent sync;
   - receiver inbox crash after commit but before RPC acknowledgement, exact response replay, and
     conflicting digest under the same delivery ID;
   - two simultaneous Worker requests for one account;
   - expired lease and response loss before/after broker submission;
   - MT5 rejection, requote, partial fill, invalid stops, changed symbol metadata, and insufficient margin;
   - Worker/Durable Object/D1 outage, quota exhaustion, stale news, time skew, Windows reboot, MT5 crash, internet loss, and agent-token rotation;
   - audit-outbox crash before D1 acknowledgement;
   - an order that exists after the EA believed submission timed out, reboot between journal flush
     and `OrderSend`, and reboot immediately after `OrderSend`;
   - a fill without protection and an ambiguous protection amendment;
   - wrong account/server, second EA instance, Algo Trading disabled, or operator profile switch.
   - TradingView proposal with forged hashes/geometry that broker bars do not reproduce;
   - owner revocation, expired/replayed/cross-action grant, and attempted blanket unfreeze;
   - M1 counterfactual gap, mutable broker bar, and feed divergence;
   - manual/foreign-magic order or position, unpriced exposure, modeled-loss breach, and emergency
     protection/flatten during a news blackout;
   - demo profile presented on a paid account and paid-profile digest mismatch.
68. Require invariants in tests and telemetry:
   - one candidate produces at most one broker trade idea;
   - one inbox delivery produces at most one committed candidate effect even if acknowledgement is lost;
   - no command without a committed risk reservation;
   - no new reservation when any safety input is unknown/stale;
   - aggregate reserved/open modeled-loss exposure never exceeds 1% under its pinned stress policy;
   - any unpriced exposure or actual/model breach freezes new leases and is never represented as a
     guaranteed bounded loss;
   - volume is never rounded upward;
   - no accepted fill remains silently unprotected;
   - no normal order is sent without previously demonstrated atomic initial SL/TP capability;
   - no lease while audit is pending, reconciliation is unstable, or any freeze reason remains;
   - TradingView facts alone can never authorize a command;
   - no automatic transition from demo to evaluation;
   - observation-edge still exposes no broker/account command surface.

### 12. Roll out through irreversible evidence gates

69. **Phase A — Freeze the executable proposal contract:** create and review the new paper-only
    strategy/wire version, per-symbol stop-provenance table, producer-integrity ledger, edge/Pine
    parity, vectors, and fresh evidence manifest. Old v3 results are excluded. No execution-edge
    deployment and Algo Trading stays off.
70. **Phase B — Build and offline safety proof:** implement the execution edge, both durable outbox
    protocols, coordinator folds, owner identity/action grants, EA, console, Windows scripts, and
    fixtures. All mutable owner and broker paths remain structurally unavailable until their gates
    pass.
71. **Phase C — Shadow transport and independent parity:** deploy on Cloudflare Free and run the
    agent in `DRY_RUN`. Collect live-contiguous new-version proposals and authenticated broker bars;
    compare every proposed trigger/geometry with the independent broker reconstruction. The
    coordinator cannot lease. Complete fault injection and owner-auth credentialed tests here.
72. **Phase D — Supervised single-symbol capability canary:** only after at least 20 fresh canonical
    GBPJPY proposals, zero unexplained reconstruction mismatch, stable reconciliation, green fault
    tests, and an owner grant, enter `DEMO_CANARY` for one minimum-volume new-version GBPJPY
    strategy candidate. Supervise it, prove atomic initial SL/TP and full reconciliation, then
    return to `DRY_RUN`. Any anomaly blocks the capability version.
73. **Phase E — Normal demo automation:** require eight continuous weeks and at least 100 eligible
    canonical signals under the exact new version, zero unresolved incidents, and owner approval
    before `DEMO_ARMED`. Start GBPJPY at 0.5%, one idea/day. After at least ten safely reconciled
    automated trades, promote `EURUSD`, `USDJPY`, `XAUUSD`, and `USTEC` one at a time, each through
    its own supervised canary. Keep two ideas/day and 1% aggregate/daily limits.
74. **Phase F — Paid-evaluation readiness:** require all of the following, with no waiver hidden in code:
   - at least eight continuous weeks of new-version observation/demo operation;
   - at least 100 eligible new-version canonical signals;
   - a complete sequential simulated Standard Phase 1 and Phase 2 pass under the targets and breach
     formulas in the then-current verified rule pack and cost model;
   - zero unresolved duplicate-order, protection, reconciliation, secret, stale-calendar, clock, or risk-limit incidents;
   - current FundingPips support confirmation that the user may purchase/use MT5 from Israel and that this personal EA/webhook architecture is acceptable;
   - refreshed FundingPips rules, platform symbols, news/weekend policy, commission/leverage, and server/account capabilities;
   - TradingView webhook/alert capacity for the promoted symbols;
   - measured Cloudflare free-tier usage below 50% of each daily limit, or an explicit decision to use Workers Paid;
   - a reviewed ownership bundle and final user approval to purchase/activate.
75. **Phase G — Evaluation canary:** a paid account never reuses demo token, rule pack, capability,
    profile, or canary evidence. Create and sign a paid-account profile from the observed account,
    start Algo Trading off, reconcile the empty account, run dry sync, and prove current
    support/policy. A new onboarding plan must define how atomic protection is demonstrated without
    an unauthorized capability-test trade; until that proof exists the ceiling remains `DRY_RUN`.
    Only then may a single-use grant enter `EVALUATION_ARMED`, one pair, at 0.5% risk. Any mismatch
    adds a freeze reason and revokes leasing.
76. Reaching a Master/funded account is outside this plan's authority. It requires a new review;
    evaluation success never arms it automatically.

## Key decisions & tradeoffs

1. **Personal local EA, not copier/VPS:** FundingPips currently prohibits VPN/VPS access and inbound third-party copying but describes a personal-EA ownership exception. A home Windows host has no monthly VPS cost and preserves a consistent region, at the cost of home power/internet reliability.
2. **Separate execution edge:** the existing service remains an observation/paper authority. A second Worker/DO/D1 boundary adds deployment complexity but prevents an accidental edit from converting raw webhook input into broker commands.
3. **TradingView proposes; broker bars confirm:** this adds latency and rejects some valid-looking
   setups, but a TradingView credential/hash cannot become trade authority. The exact trigger and
   geometry must be independently reproduced from authenticated MT5 broker bars.
4. **New evidence version:** v3's fixed 100/200-tick plan cannot be relabeled as wick/4R execution.
   A new immutable paper-only version and fresh corpus deliberately reset readiness.
5. **Outbound polling:** a five-second EA sync works within MT5 `WebRequest`, requires no inbound Windows port, and fits one-agent free-tier budgets. It adds up to roughly five seconds of latency, so commands expire rather than chase price.
6. **Durable Object per account:** account-local serialization, grants, freeze reasons, broker folds,
   and audit outbox are safer than optimistic D1 leasing, at the cost of more request accounting.
7. **Demo before spending:** MetaQuotes-Demo proves mechanics but not FundingPips costs/behavior.
   Paid onboarding always recaptures capabilities and policies.
8. **Only new-version `DIR_CLOSE` executes:** BOC and HTF flip remain counterfactual experiments.
9. **Conservative risk over fastest pass:** 0.5% base, conditional 1%, two ideas/day, and 1%
   aggregate/daily stops reduce breach risk but cannot rescue negative expectancy.
10. **Fixed 4R/no management:** wick/4R geometry becomes executable only after provenance and
    broker-bar parity; BE/trailing/3R live in the separate counterfactual ledger.
11. **Manual news import:** owner-attested calendar data is free but stale/uncertain coverage freezes.
12. **Free Cloudflare first:** measured headroom, not estimates alone, governs continued use.
13. **No automatic optimization/promotion:** proposals cannot change active policy without grants.

## Risks / open questions

1. FundingPips' public help currently advertises a Free Trial, while the user's Israeli signup flow reports it unavailable. This plan treats the UI restriction as authoritative, forbids bypassing it, and requires direct support confirmation before any purchase.
2. FundingPips policy and platform details can change without code changes. Every paid activation therefore has expiring policy evidence and a manual re-review gate.
3. The user's exact TradingView alert/webhook allowance is not yet recorded. This blocks five-pair activation, not the single-pair build or demo pipeline.
4. MetaQuotes-Demo execution costs and `USTEC` contract details differ from FundingPips. All paid-account symbol capabilities and cost models must be captured again; demo profitability is not treated as paid-account profitability.
5. Cloudflare Free operations fail rather than overage-bill when limits are exceeded. Usage telemetry, headroom, and broker-side protection reduce but do not remove this operational risk.
6. TradingView and Windows/MT5 remain external trust risks. Independent broker reconstruction stops
   TradingView-only forgery, but compromise of both proposal source and execution host is outside
   V1's protection. Mismatches fail closed.
7. A symmetric local bearer token is readable by a compromised Windows user account. Host
   dedication, Defender/firewall, ACLs, rotation, short TTLs, fingerprints, and no inbound ports
   reduce but do not eliminate this risk; hardware-backed identity is deferred.
8. Synchronous WebRequest, timer coalescing, and the 1,024-event trade-transaction queue can cause
   gaps. O(1) capture, write-ahead intent, overlap reconciliation, and freeze-on-gap are mandatory.
9. MQL5 cannot run `WebRequest` in Strategy Tester. Live-demo evidence is mandatory.
10. Profitability, firm acceptance, passage, rewards, and future availability are not guaranteed.

## Out of scope

1. Placing any real/demo order during planning or before the explicit rollout gates.
2. MT4, cTrader, DXtrade, Match-Trader, broker APIs, MetaApi, trade copiers, signal marketplaces, third-party EAs, or account management for other people.
3. VPN/VPS/cloud-hosted MT5 access for FundingPips.
4. Master/funded-account auto-activation, multi-account copying, cross-user trading, or “global every prop firm” activation. Future firms require compatible personal-EA rules and separate versioned profiles.
5. BOC/HTF-flip/discretionary/fallback/one-candle live execution, martingale, grid, hedging, pyramiding, loss recovery, AI trade decisions, BE/trailing/partial exits, or silent optimizer changes.
6. Automatic Forex Factory scraping or a paid news API in V1.
7. Guarantees of profit, challenge passage, reward eligibility, or protection from rule changes/account closure.
8. Replacing the existing historical root `PLAN.md` / `PLAN-REVIEW-LOG.md`; those remain the record for the earlier paper-only architecture.
