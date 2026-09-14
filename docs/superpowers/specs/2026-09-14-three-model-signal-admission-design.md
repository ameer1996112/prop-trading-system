# Three-model authenticated signal admission

Date: 2026-09-14
Status: Proposed detailed design for owner review; not implementation or deployment approval.
Source baseline: merged main `43db33bb787c830b4effe0f64798e7968f71cc1c`.

## Outcome and boundary

Accept authenticated BOC, DIR_CLOSE and HTF_FLIP evidence, enforce durable
stream ordering and economic deduplication, and deliver immutable candidates to
a private evidence-only inbox. An admitted candidate is not a trade, an account
risk reservation, or permission to execute. Every new authority-bearing response
and stored delivery carries `authority: EVIDENCE_ONLY` and
`execution_allowed: false`. Existing agent responses remain `command: null`.

The owner approved proceeding with a separately versioned admission path and
quarantining the affected producer stream rather than every producer. This
document resolves the detailed semantics for review before an implementation
plan. No deployment, credential provisioning, alert activation, MT5 replacement,
order API, or broker action is part of this milestone.

## Approach and alternatives

Use the existing observation Worker as the ingress host, with new versioned
contracts, tables and a dedicated evidence-only receiver in execution-edge.
Keep the validated inner evidence format unchanged. Reuse established bounded
request and outbox patterns, but do not reuse their old protocol identities.

Extending ExecutionCandidateV2 was rejected: it is explicitly DIR_CLOSE,
PAPER_ONLY and replayable, unlike the three-model evidence boundary. A separate
new service would isolate deployments further but introduces another operational
surface without removing the need for new persistence and protocol contracts.

## Existing implementation facts

- `signal-evidence-v1.ts` validates bytes against independently supplied reviewed
  binding bytes and supports all three strict models. It has no production route.
- Its input is `TradeOpsSignalEvidenceInputV1`, containing observation and
  formations, with no credential or registration generation.
- Pine's evidence sequence starts at 1 and advances on local alert invocation,
  not on delivery acknowledgment. Its producer instance includes a start value.
- `observation-outbox-dispatcher.ts` provides a useful lease/retry pattern for an
  older candidate protocol; it is not already a three-model delivery path.
- The evidence capability test currently forbids any production consumer.
  Integration must replace that blanket rule with an exact reviewed ingress
  allowlist while retaining the pure module dependency and no-execution guards.

## Transport and producer registration

Introduce `TradeOpsSignalAdmissionRequestV1` on the dedicated proposed POST route
`/api/v1/signal-evidence`. Its exact top-level fields are schema_version,
credential, registration_id, generation, and evidence. Evidence is the unchanged
inner input object. Reject unknown/duplicate JSON keys, noncanonical numeric
tokens and malformed UTF-8 before any semantic normalization. Generation is a
positive safe integer. Registry identifiers are opaque, bounded ASCII strings.

The transport cap is 272 KiB; the unchanged inner validator's 256 KiB cap also
applies. These are application limits, not Cloudflare service limits. Enforce
streamed byte limits and fixed parsing budgets, not just Content-Length.

An operator-provisioned registration binds a credential digest to a stable
producer namespace, ticker/feed, detector/settings hashes, exact producer
instance, active generation, initial sequence 1, activation/expiry instants,
and explicit freshness policy. Require a distinct transport credential rather
than using an EA, paper-operator or Access credential. Store only its digest in
protected configuration; never persist or log the raw outer request.

The registry is authoritative; body fields cannot select arbitrary reviewed
bindings or create registrations. Unknown registration, bad credential and
disabled registration receive the same redacted authentication rejection.
Authenticate before returning detailed stream state. Missing registry or policy
fails closed. Credential possession authenticates the configured sender, not
the truth of its observed market path or TradingView itself.

No public registration/reset endpoint is added. Versioned local provisioning
fixtures and explicit operator tooling are separate from webhook access. A
future activation requires reviewed producer instance and policy values. A
chart reload never silently resets the server cursor. A replacement generation
requires explicit registration review and cannot erase old economic reservations.

Pine receives an opt-in transport wrapper, separate credential and registration
inputs; the existing evidence-only export and all legacy alert paths retain
their meanings. Regenerate RELEASE from LAB and verify protected parity. Raw
credentials must not reach log.info/log.error, snapshots, fixtures or screenshots.
No TradingView alert is created or changed during implementation.

## Durable admission state machine

The stream scope is registration_id plus generation. Only one generation may
be active for a registration. Persist ACTIVE, QUARANTINED and RETIRED states,
next expected sequence, registry revision and quarantine reason. Persist a
receipt identity by stream and producer sequence, with a canonical digest of
the credential-free inner request plus registration identity. Token rotation
must not change that digest. Preserve strict numeric validation before hashing.

After authentication, classification is ordered:

1. An existing receipt with the same digest returns its recorded outcome and
   current stream status. It does not renew expiry, enqueue again or clear a
   quarantine, even if the duplicate arrives after freshness has elapsed.
2. The same receipt identity with a different body is a conflict and quarantines
   the stream. The original receipt and selection remain immutable.
3. A quarantined/retired stream cannot admit anything new.
4. A new sequence must equal the durable expected sequence. A gap or an unknown
   older sequence quarantines the stream; no automatic buffering or gap healing.
5. Validate the inner evidence against the registered binding and freshness.
   An authenticated expected-sequence message that is invalid or stale records
   a rejection and quarantines the stream, rather than silently skipping it.
6. Commit the receipt, evidence, next cursor, attempt decision and outbox rows
   atomically. Only after commit return acceptance.

Unauthenticated, oversized and unparseable traffic cannot change stream state.
Infrastructure failure returns retryable failure without acceptance. A crash
after commit but before response is resolved by the exact-duplicate path.

Stream continuity means contiguous delivered evidence envelopes only. It does
not prove every market tick was observed. Preserve the validator's model-specific
proof and fidelity requirements; never relabel realtime evidence replayable.

Freshness uses injected server time, the selected event time and observation
time, not chart bar-open time as a substitute for event time. Both event and
observation age, permitted future skew and maximum queue age are explicit
registration policy values; none has a production fallback. Delivery expiry is
the earliest applicable deadline and never extends on retry. Boundary and
clock-regression tests are mandatory. Missing time fields block admission.

## One candidate per economic attempt

Use the existing restart-stable attempt key within its registered namespace,
not chart-local setup ID or generation, for a unique INITIAL reservation.
Allow only one active registration per namespace/ticker strategy scope so
duplicate producers cannot race to create competing reservations.

NO_CANDIDATE evidence advances a valid stream and is retained, but does not
reserve an attempt. The first eligible selected entry in an accepted contiguous
stream reserves the attempt immutably. Within one envelope, use the existing
validated chronology/co-trigger decision; never choose based on array order.
If multiple entries in a single envelope target one attempt ambiguously, reject
the whole admission rather than partially reserving it.

Later consistent evidence is audit-only and creates no new delivery. Earlier
contradictory chronology, changed immutable formation geometry, or conflicting
evidence identity quarantines its producing stream and marks the affected
attempt disputed. No replacement candidate is created. Exact duplicate
economic evidence across generations cannot bypass the reservation.

This offers first accepted eligible selection under complete known evidence,
not global earliest ordering across unseen alerts. Reservation here means
deduplication only; account exposure and risk remain future independent gates.

## Persistence and concurrency

Use additive versioned D1 tables in observation-edge for registrations/streams,
receipts, evidence facts, INITIAL reservations, outbox deliveries and quarantine
audit events. Unique constraints cover receipt identity, evidence identity,
attempt reservation and delivery identity. Digest conflicts cannot be hidden
behind INSERT OR IGNORE.

An admission transaction must assert the active registry revision, expected
cursor and absence/compatibility of the attempt reservation in SQL. Application
preflight reads are advisory, never the concurrency lock. Failed guards must
abort the entire transaction, not leave later statements free to insert. On
contention, re-read authoritative state and classify duplicate/conflict or retry;
do not report acceptance from a zero-row update.

D1 batch rollback is documented in the [D1 Database API reference](https://developers.cloudflare.com/d1/worker-api/d1-database/)
(checked 2026-09-14). It does not make an HTTP send atomic with the database.
The implementation plan must specify the concrete SQL guards and prove them
against the local D1 runtime, including concurrent requests and partial failure.

Retain reservation/digest tombstones across generation changes and cleanup.
This milestone provides no destructive retention job. Bounded reads, payload
caps and indexed lookups are required; long-term retention needs a separately
reviewed policy before operational scale-up.

## Delivery and receiver

The new outbox uses immutable candidate bytes and digest, stable delivery ID,
registration generation and expiry. Statuses are PENDING, CLAIMED, RETRY,
ACKNOWLEDGED, EXPIRED, FAILED_TERMINAL and QUARANTINED. Claims have bounded
leases and fencing tokens. Only the current token may finalize a claim.
Expired leases can be reclaimed without changing bytes or identity.

Before claiming and sending, check stream/quarantine status and expiry. A late
quarantine cancels pending/retry work. Already in-flight delivery may still land:
the receiver remains evidence-only and acceptance never implies current
eligibility or permission to trade. Future authorization must consult current
stream/attempt state; this milestone explicitly does not implement it.

Use a pinned private receiver binding, not a request-provided URL. Authenticate
service-to-service delivery independently of the producer credential. The new
execution-edge inbox validates the closed evidence-only delivery contract and
persists receipt ID/digest before acknowledging. Same ID/same digest is an
idempotent acknowledgment; same ID/different digest is a terminal conflict.
Receiver acknowledgment includes the exact ID and digest. A bare HTTP 200,
redirect, malformed body or mismatched acknowledgment is not success.

Retry only bounded transient failures with backoff and immutable expiry. On
retry exhaustion retain a terminal record for inspection; do not auto-replay.
Lost acknowledgments must not create another inbox candidate. Transport is
at-least-once with receiver deduplication, not exactly-once network delivery.
No receiver handler invokes account coordination, EA sync or an order route.

## Operator visibility, recovery and deployment boundary

Add a private bounded admission-status read contract for stream state, reason,
receipt outcome, attempt identity and delivery status. Never return credentials
or full producer request bodies. No public listing is added. This milestone
does not redesign the dashboard or claim broker balances, fills or realtime data.

Quarantine is sticky. Recovery requires operator investigation, retirement of
the old generation and explicit provisioning of a new one. No automatic
sequence reset, replay into an order path, or clearing of disputed attempts.
Unrelated namespaces continue. A systemic registry/storage outage prevents new
admission rather than pretending independent streams are healthy.

All admission and dispatch flags are false in every checked-in deployment
profile. Missing receiver bindings disable delivery. Existing DRY_RUN and
PAPER_ONLY interfaces, telemetry and runtime flags remain unchanged. Local
tests use isolated databases and fixture credentials. Deployment, remote
migrations, secret uploads, new alert inputs and native Pine acceptance are
subsequent explicit operational steps, not effects of accepting this document.

## Acceptance and implementation planning

Required automated evidence:

- All three models, long/short, co-triggers and NO_CANDIDATE.
- Bad credentials, wrong binding/generation/instance, disabled/missing registry,
  duplicate JSON keys, unsafe integers and oversized streamed input.
- Sequence 1 bootstrap, exact retries after expiry, same-sequence conflicts,
  gaps, reload/reset, stale/future timestamps and sticky quarantine.
- Two simultaneous admissions for one sequence and one economic attempt,
  generation cutover races and rollback at every persistence boundary.
- Lost response after commit, sender restart, lease expiry, stale finalizer,
  lost receiver acknowledgment, receiver conflict and queue expiry.
- Quarantine racing with claim/send, including evidence already delivered.
- No account, volume or executable command fields; no newly reachable broker
  capability; all existing paper, telemetry, Pine parity and security tests pass.
- Local D1 transaction tests in addition to pure/fake tests. Native Pine tests
  remain a separately recorded acceptance gate, never inferred from text tests.

Plan work in five reviewable parts: transport/registry contracts; durable
admission and SQL races; evidence-only receiver/outbox; opt-in Pine wrapper and
capability-guard integration; combined fault tests and operator handoff. Freeze
wire schemas, SQL guards, retry limits and test-only timing values in that plan
before coding. Operational numeric freshness values remain mandatory owner
configuration, not values selected by this design.

Completion of this milestone means proven admission and inbox delivery only.
Account policy, broker geometry, risk reservations, executable commands, EA
execution/reconciliation, broker dashboard integration and coordinated demo
acceptance are still required for the overall project.
