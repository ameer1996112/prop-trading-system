# Three-model TradeOps demo completion

Date: 2026-09-14
Status: Draft for owner review; not execution or deployment authorization.

## Outcome

Deliver one integrated release: TradingView release-producer signals for BOC,
DIR_CLOSE and HTF_FLIP pass through Cloudflare validation and account risk
authorization, execute on a pinned MT5 demo account, and appear as actual broker
activity in the existing TradeOps dashboard. Complete local implementation and
automated verification before asking the owner to install and validate the final
package on Windows. Native and external acceptance cannot be replaced by local
tests or claimed complete before it happens.

The owner explicitly rejected a DIR_CLOSE-only release. All three strict models
are required for release acceptance. Real-money/prop account execution is outside
this release. No profitability claim is made.

## Existing sources and preservation

Backend/EA worktree: `mt5-stale-payload-recovery`, branch
`codex/mt5-stale-payload-recovery`. Frontend/docs worktree:
`tradeops-dashboard-migration`, branch `codex/tradeops-dashboard-migration`.
Both contain existing work that must be preserved. Do not use the older checkout
as an interchangeable implementation base, merge unrelated changes, or reset it.

Relevant existing specifications are the July 28 three-entry arbitration design,
August 21 V3 signal-authority design, September 3 telemetry delivery roadmap, and
September 11 durable queue adapter design. Their paper-only and command-free
protocols stay unchanged. This release introduces separately versioned demo
authority rather than silently changing their meaning.

The LAB Pine is the authoring source; regenerate SND_RD_5M_V3_RELEASE.pine using
the existing generator and prove protected semantic parity. The release producer
is the operational artifact, not an independent detector implementation.

## Approach

Recommended: extend the current Cloudflare architecture with a separately
versioned three-model evidence/command boundary and integrate the existing
durable telemetry work. Keep the familiar frontend and its authentication
boundary. This preserves the investment and makes actual order authority
independently testable.

Rejected alternative: reinterpret existing PAPER_ONLY observations or DRY_RUN
commands as permission to trade. This changes frozen meanings and makes old
messages dangerous. Rejected alternative: replace the whole stack or restore
MetaAPI/Railway; this discards existing work and contradicts the requested
Cloudflare migration.

## Signal semantics

- BOC: strict HTF-timed break of the immutable qualifying reference candle, with
  continuous ordered crossing evidence and the existing common setup gates.
- DIR_CLOSE: confirmed qualifying five-minute directional close.
- HTF_FLIP: ordered HTF opening, protective-side contact/wick, then recross of
  that same HTF open. Do not rename BOC to flip.

Preserve TWO_PLUS_CANDLES strict eligibility. Discretionary non-HTF BOC,
one-candle experiments, and OHLC-only reconstructions of intrabar order remain
non-executable with explicit reasons. Supporting all models does not mean
inventing missing discretionary rules or executing every observation.

New evidence contracts must admit genuinely observed continuous realtime BOC
and flip evidence for demo evaluation without relabeling it replayable. Persist
the authenticated evidence before deciding. Producer reloads, stream gaps,
conflicting identities and impossible chronology prevent authorization. Broker
bars cannot prove the original TradingView intrabar path; broker verification
checks executable geometry and current conditions, not fabricated source proof.

The edge selects the earliest eligible proven event within a complete accepted
candidate bundle/contiguous stream. Co-triggers produce one economic action.
Once reserved for execution, selection is immutable; later events are audited,
not a second order or a replacement. No promise of global earliest ordering
across unseen alerts: gaps block authorization, and late contradictions are
quarantined. Initial release has no automatic re-entry or pyramiding per attempt.

## Execution boundary

Pine sends account-free evidence, not volume, account authority or executable
orders. Authenticated ingress validates reviewed producer identity, exact schema,
freshness, sequence, geometry and model-specific evidence. It creates a durable
candidate and outbox atomically. Retried delivery cannot create another candidate.

The account coordinator binds a candidate to a reviewed demo account policy and
serializes risk reservations. A separate demo command version carries immutable
candidate, policy, account, installation, symbol and expiry pins. Existing v1
DRY_RUN and v2 telemetry contracts remain inert and command-free respectively.

Proposed order behavior is a market entry after authorization, subject to fresh
broker quote, spread, deviation, market/session, margin, stop-distance and volume
checks. Signal prices are not promised fill prices. A missed or expired signal
is rejected, never converted into a pending order or chased later. Stops and
targets are required in the submitted request; do not retry rejection as a naked
entry. Broker capability incompatibility blocks the symbol.

Geometry and sizing require an explicitly selected, versioned per-model policy.
Do not copy DIR_CLOSE's inert wick-buffer/4R fixtures onto BOC/flip or promote the
paper fixed-distance plan by inference. Configure and test conversion between
source ticks and broker prices, symbol aliases, rounding, minimum/maximum volume,
and account-currency risk. Missing policy values block enablement, not silently
fall back to a risk percentage or lot size.

## Terminal durability and recovery

One EA lifecycle owns scheduling and network operations. Command execution and
telemetry use separate durable identities; telemetry acknowledgments are never
order acknowledgments. Preserve exact pending telemetry replay and existing
capture cutover semantics.

Before attempting a broker request, persist a command-specific execution intent
and consume its send authorization durably. Duplicate commands return durable
state. After restart or an ambiguous send result, reconcile against broker
orders/deals using recorded identifiers and bounded matching. Do not blindly
resubmit. If the result cannot be proven, freeze the affected execution scope and
surface an operator reconciliation requirement. Exactly-once broker execution is
not promised; prioritize preventing duplicate exposure over retrying uncertainty.

Track receipt, validation, reservation, command delivery, send intent, broker
acceptance/rejection, partial fills, positions and closure as distinct states.
Partial fills retain actual volume and risk; no automatic top-up. Acknowledged
commands are not displayed as filled trades. Position reconciliation must cover
manual trades and account mode without claiming ownership of unrelated orders.

## Required enablement configuration

Trading starts disabled. Both service and terminal must agree on a pinned demo
account/installation and reviewed policy generation. Required configuration:

- account identity and supported account mode;
- allowed broker symbols and source-feed mappings;
- risk per trade, aggregate exposure, maximum open trades and daily-loss limit;
- each model's stop/target policy and broker conversion rules;
- maximum signal age, spread, deviation and supported trading sessions;
- any required news/prop-rule policy and its freshness requirements.

These are owner-approved operational values, not fixture defaults. Real accounts,
missing configuration, stale reconciliation or policy mismatch cannot arm.
Kill switch revokes new commands/reservations and blocks new entries; it does
not silently liquidate positions. Existing broker protection remains in place.
Any future forced-close feature needs its own explicit behavior and authority.

## Dashboard

Keep the restored TradeOps navigation and layout. Add actual broker balance,
equity, positions, orders, deals and connection/capture freshness through private
account-scoped reads. Reuse the session and refresh owner, purge account data on
logout/auth failure, and never expose EA or ingress secrets to the browser.

Show signal model and competing/co-triggered models, selection and rejection
reasons, command state, actual broker fill price/volume and realized results.
Paper simulation and broker outcomes remain separate sources. Missing values are
not zero. Show timestamp and stale/offline status; do not advertise tick-realtime
updates when using periodic polling. Initial target is visible updates within one
configured capture/upload plus dashboard refresh cycle, measured in acceptance.

## Delivery workstreams and acceptance

1. Freeze three-model demo evidence, arbitration, geometry policy interfaces and
   command lifecycle contracts with positive/negative fixtures.
2. Complete durable backend candidate delivery, reservations, demo commands,
   receipts and fail-closed recovery; keep existing protocols compatible.
3. Integrate EA telemetry transport and command execution with deterministic
   broker/network/storage fakes and restart/fault tests.
4. Add private broker-data reads and existing-dashboard integration, including
   auth, stale data, partial fills and ambiguous-execution states.
5. Produce a versioned source/package manifest, local verification report,
   installation/configuration guide, deployment checklist and rollback procedure.
6. Coordinated external acceptance: reviewed Cloudflare deployment/configuration,
   Windows compilation, demo-only checks, TradingView producer/alert setup, and
   evidence of each model traversing the complete path into broker results and UI.

Automated coverage must include all models long/short, co-triggers, delayed/gapped
streams, duplicate/conflicting alerts, stale commands, invalid policies, live
account rejection, concurrent risk reservations, broker rejection/partial fill,
crash before/after send, ambiguous results, telemetry replay, lost acknowledgments,
auth expiry and dashboard source separation. Integration tests use simulated
orders only. Actual demo orders occur only in the final explicitly enabled test.

Completion means every required model has verified end-to-end evidence, not only
that files compile or offline tests pass. If no natural signal is available,
clearly labeled demo acceptance fixtures can validate transport/execution, but
do not substitute for validating the actual Pine trigger of each model.

## Review and remaining decisions

Owner review is required for this draft's proposed market-entry behavior,
one-economic-action-per-attempt rule and strict model eligibility. Numeric account
policies are mandatory final configuration, never guessed during implementation.
Concrete subsystem contracts and failure-state transitions require implementation
plans before coding. No deployment, alert mutation, terminal replacement, secret
discovery, account arming or broker action has been performed by writing this
document. No commits are included in this drafting step.
