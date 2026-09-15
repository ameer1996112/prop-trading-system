# Three-model Signal Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Authenticate and durably admit all three strict signal models, delivering deduplicated evidence to a private inbox without granting execution authority.

**Architecture:** New versioned admission contracts and D1 tables sit alongside the existing observation/paper interfaces. A transaction reserves each economic attempt and enqueues immutable evidence. A separately authenticated receiver deduplicates delivery; neither service invokes account coordination or MT5 commands.

**Tech Stack:** Existing TypeScript, Vitest, Workers, D1, Miniflare and Pine generator. Use the repository's locked runtime versions; add only the existing execution-edge Miniflare version to observation-edge development dependencies if direct runtime testing needs it.

**Spec:** `../specs/2026-09-14-three-model-signal-admission-design.md`, approved by the owner on 2026-09-14.

## Global Constraints

- Every new authority-bearing response and stored delivery carries `authority: EVIDENCE_ONLY` and `execution_allowed: false`.
- Existing agent responses remain `command: null`.
- No deployment, credential provisioning, alert activation, MT5 replacement, order API, or broker action is part of this milestone.
- All admission and dispatch flags are false in every checked-in deployment profile.
- Quarantine is sticky. Unrelated namespaces continue.
- Operational numeric freshness values remain mandatory owner configuration, not values selected by this design.
- Keep `TradeOpsSignalEvidenceInputV1`, ExecutionCandidateV2, PAPER_ONLY and telemetry contracts unchanged.
- Commit only task-owned files. Never alter the older dirty checkout or discard recovery worktrees.

## Execution setup and review gates

Start a new implementation branch from the approved design/plan commit using the
worktree skill. Do not implement on `main` or the previously merged PR branch.
Record baseline status and commit; run both Worker suites, typechecks, Pine
generator check and secret scan before modifying source. Existing failures stop
implementation for diagnosis, not test suppression.

This is one coupled admission subsystem, split into eight independently
reviewable deliverables below. After each task: inspect the diff, run its full
focused tests, perform specification and code-quality review, fix findings and
commit only that task's paths. Subagents are used only if the owner chooses that
execution option. No PR push or merge is implied by local implementation.

Each task follows RED → minimal implementation → GREEN. Do not replace the RED
step with a compilation-only check. Code fragments specify required interfaces
and core mechanics; the listed rejection matrices are also mandatory behavior.

## File ownership

| Area | Files and responsibility |
| --- | --- |
| Transport | observation `src/signal-admission-wire-v1.ts`: strict outer parsing, credential-free identity; `signal-admission-registration-v1.ts`: registry validation/authentication |
| Decision | observation `src/signal-admission-decision-v1.ts`: sequence/freshness/attempt classification; existing evidence validator remains pure |
| Persistence | observation `src/signal-admission-store-v1.ts`, migration `0031_signal_admission_v1.sql`: transaction guards and immutable facts |
| Receiver | execution `src/signal-evidence-inbox-v1.ts`, migration `0005_signal_evidence_inbox_v1.sql`: private durable deduplication |
| Delivery | observation `src/signal-admission-outbox-v1.ts`: leased, fenced, bounded delivery |
| Integration | observation `src/signal-admission-route-v1.ts`, both Worker entry points, Env definitions and configs; no unrelated entry-point refactor |
| Producer | LAB Pine transport wrapper and generated RELEASE; legacy behavior stays unchanged |
| Proof | colocated `test/signal-admission-*.test.ts`, execution inbox tests, contract vectors, Python Pine test and audit/runbook |

Migration numbers above are based on main at `43db33b`; if occupied at execution
time, allocate the next unused number and update all references before coding.

## Frozen cross-task contracts

Use seconds for all epoch and duration fields. Safe integer checks precede any
arithmetic; overflow rejects. Identifiers are 1–160 ASCII characters excluding
backslash; credential is 1–1024 printable ASCII characters. Never trim secrets.
Digest spelling is 64 lowercase hexadecimal characters. Fixture secrets are
clearly labeled local test values, not copies of deployment data.

The outer schema has exactly `schema_version`, `credential`, `registration_id`,
`generation`, `evidence`. Limits: 278528 outer bytes, 262144 inner bytes,
64 parser depth and 20000 parser nodes (reuse existing strict parser limits).
Require positive integer generation and sequence. Accept only JSON POST.

```ts
type Safety = { authority: "EVIDENCE_ONLY"; execution_allowed: false };
type StreamState = "ACTIVE" | "QUARANTINED" | "RETIRED";
type ReceiptOutcome = "ACCEPTED" | "NO_CANDIDATE" | "AUDIT_ONLY" | "REJECTED";
type AdmissionCode = "SEQUENCE_GAP" | "UNKNOWN_OLD_SEQUENCE" | "BODY_CONFLICT"
  | "INVALID_EVIDENCE" | "STALE" | "FUTURE" | "CLOCK_REGRESSION"
  | "ATTEMPT_CONFLICT" | "STREAM_BLOCKED";
interface Freshness {
  max_event_age_seconds: number;
  max_observation_age_seconds: number;
  future_skew_seconds: number;
  max_queue_age_seconds: number;
}
```

These types live in `signal-admission-wire-v1.ts` and are imported by the
observation modules. Cross-service wire schemas and literal vectors live in
`contracts/signal-admission-v1.md` and `contracts/vectors/signal-admission-v1.json`;
execution owns an independent closed decoder, not an import of observation's
route, store or evidence evaluator. Both decoders must match the same vectors.

Admission response fields: schema_version=`TradeOpsSignalAdmissionResponseV1`,
Safety, receipt_id (nullable on pre-admission failure), outcome, code (nullable),
duplicate, stream_state (nullable before authentication). HTTP: 202 new accepted,
NO_CANDIDATE or AUDIT_ONLY; 200 exact prior receipt; 409 stream/identity conflict;
422 invalid authenticated evidence; 401 generic auth failure; 413 byte limit;
400 unparseable outer input; 503 storage unavailable; 404 feature disabled.
All bodies remain redacted, no-store and evidence-only.

Delivery body exact fields: schema_version=`TradeOpsSignalDeliveryV1`, Safety,
delivery_id, delivery_body_sha256, receipt_id, registration_id, generation,
attempt_key, evidence_id, evidence_body_sha256, admitted_at_epoch,
expires_at_epoch, evidence. `evidence` is one unchanged validated
SignalEvidenceEntryV1, including its original fidelity. Hash the canonical body
without delivery_body_sha256. Derive delivery_id from canonical
`{schema_version:"TradeOpsSignalDeliveryIdentityV1",attempt_key,evidence_id}`.
No account, sizing or command fields are allowed at the authority-bearing level.

Acknowledgment exact fields: schema_version=`TradeOpsSignalDeliveryAckV1`, Safety,
delivery_id, delivery_body_sha256, status=`STORED` or `DUPLICATE`.
Use HTTP 201/200 respectively. Same ID/different digest returns 409. Successful
HTTP without an exact validated acknowledgment is never sufficient.

## Task 1: Strict transport and registration contracts

**Files:** Create wire/registration modules above, corresponding
`test/signal-admission-wire-v1.test.ts` and
`test/signal-admission-registration-v1.test.ts`, and the two contract files.

**Interfaces:**

```ts
interface Transport {
  registrationId: string; generation: number; credential: string;
  evidenceBytes: Uint8Array; sequence: number; producerInstanceId: string;
  bodySha256: string;
}
interface Registration {
  registrationId: string; generation: number; revision: number;
  scopeKey: string; producerInstanceId: string; credentialSha256: string;
  bindingBytes: Uint8Array; activeFrom: number; activeUntil: number;
  enabled: boolean; freshness: Freshness;
}
// All thrown parse failures are converted to redacted errors at the route.
parseAdmissionTransport(bytes: Uint8Array): Promise<Transport>;
readRegistration(bytes: Uint8Array): Registration | null;
authenticateRegistration(t: Transport, r: Registration | null, now: number): Promise<boolean>;
```

- [ ] Write literal tests for duplicate keys, UTF-8 errors, unknown fields,
  exponent/fractional/unsafe integer spellings, input caps and invalid registry
  digests. Populate admission vectors from the existing nine evidence vectors,
  without overwriting those original vectors.

```ts
it("does not accept a duplicate outer identity", async () => {
  const bytes = new TextEncoder().encode(
    '{"registration_id":"one","registration_id":"two"}');
  await expect(parseAdmissionTransport(bytes)).rejects.toThrow();
});
it("fails authentication without a registered producer", async () => {
  expect(await authenticateRegistration({} as Transport, null, 100)).toBe(false);
});
```

- [ ] Run `npm --prefix apps/observation-edge test -- test/signal-admission-wire-v1.test.ts test/signal-admission-registration-v1.test.ts`; confirm RED.
- [ ] Parse using `parseStrictJson`, inspect branded numbers before conversion,
  reject noncanonical integer spellings including negative zero, then serialize
  credential-free evidence using sorted object keys and preserved array order.
  Do not use JSON.parse followed by validation, which loses duplicate keys and
  number spelling. Hash canonical `{registration_id,generation,evidence}`.
  A change to credential alone must not change bodySha256. Copy input bytes and
  do not retain the original outer request beyond route scope.

```ts
const authenticated = r !== null && r.enabled && r.generation === t.generation
  && r.producerInstanceId === t.producerInstanceId
  && now >= r.activeFrom && now < r.activeUntil;
// Compare fixed-length digest bytes only after shape validation.
// Never put t.credential in a result, log, exception or persisted object.
```

- [ ] Validate every registry field and exact keys. Freshness limits must be
  explicit positive safe integers, except future skew may be zero. Hash the
  supplied credential using the existing WebCrypto pattern and compare digests
  without early exit. Unknown/disabled registry and wrong token share 401.
- [ ] Rerun focused tests plus typecheck. Add token rotation/body hash,
  expiry equality, inactive generation and wrong producer regressions.
- [ ] Review and commit only Task 1 files: `feat: define signal admission transport`.

## Task 2: Pure admission decision and fixture harness

**Files:** Create `src/signal-admission-decision-v1.ts`,
`test/signal-admission-decision-v1.test.ts`,
`test/support/signal-admission-fixture-v1.ts` in observation-edge.

**Interfaces:** `evaluateAdmission(t: Transport, r: Registration,
snapshot: AdmissionSnapshot, now: number): Promise<AdmissionDecision>`.
AdmissionSnapshot contains stream state/revision/nextSequence/lastAcceptedAt,
nullable existing receipt `{id,bodySha256,outcome,code}`, and attempt facts keyed
by attempt_key `{formationHash,evidenceId,evidenceHash,triggerEpoch,disputed}`.
AdmissionDecision is a closed union: DUPLICATE (prior receipt), BLOCKED (code),
QUARANTINE (code, disputed attempt keys), or COMMIT (validated entries,
per-entry NEW/AUDIT_ONLY/NO_CANDIDATE, nullable per-entry expiry). No I/O in this
module except hashing through the existing pure evidence validator.

- [ ] Build `fixture()` from `contracts/vectors/signal-evidence-v1.json` using
  `readFileSync(new URL(..., import.meta.url))`. Select by case_id, fail if absent,
  clone input, wrap it, then derive registration from the vector's binding and
  producer instance. Define test-only freshness as 30 event seconds, 30
  observation seconds, 2 future-skew seconds, 20 queue seconds. Fixture now is
  observation.observed_at_epoch. Normalize only the test transport's sequence to
  1 and its event_id to producer_instance_id + ':1' before calculating new
  admission identities; do not change original evidence vector files or expect
  their old digest goldens to match a mutated fixture. These values never enter
  production configs.

```ts
it("quarantines a missing message before considering candidate content", async () => {
  const f = await fixture();
  f.snapshot.nextSequence = f.transport.sequence + 1;
  const result = await evaluateAdmission(f.transport, f.registration, f.snapshot, f.now);
  expect(result).toMatchObject({ kind: "QUARANTINE", code: "UNKNOWN_OLD_SEQUENCE" });
});
```

- [ ] Run `npm --prefix apps/observation-edge test -- test/signal-admission-decision-v1.test.ts`; confirm RED.
- [ ] Implement classification in the spec's order. Exact recorded duplicates
  precede freshness and stream-state rejection after successful authentication.
  Never call the evaluator to replace a recorded outcome. The existing bridge
  validates model semantics; admission adds persistence-related classification.

```ts
const expiresAt = Math.min(
  observedAt + r.freshness.max_observation_age_seconds,
  triggerAt + r.freshness.max_event_age_seconds,
  now + r.freshness.max_queue_age_seconds,
  r.activeUntil,
);
// Reject when now >= expiresAt; never use a candle open as triggerAt.
```

- [ ] Read observation time from source_observation.observed_at_epoch and trigger
  time from selected.evidence.observed_trigger_epoch. Selected null records no
  delivery. Reject missing/unsafe values and future skew beyond policy; reject
  server now earlier than lastAcceptedAt. Consistent later evidence is audit
  only; changed formation, same identity/different body, earlier competing
  trigger or already disputed attempt blocks/quarantines. Same-time different
  selection is a conflict, not an arbitrary tie-break.
- [ ] Add all six model/direction cases, no-candidate followed by selection,
  co-trigger, gaps, stale/future equality, clock regression, sequence maximum,
  duplicate after expiry, repeated attempt across generations and ambiguous
  same-envelope attempt cases. Rerun focused tests and typecheck.
- [ ] Review and commit Task 2: `feat: classify durable signal admission`.

## Task 3: D1 transactions, generation fencing and race proof

**Files:** Create observation migration `0031_signal_admission_v1.sql`, store
module and `test/signal-admission-store-v1.test.ts`,
`test/support/signal-admission-d1-v1.ts`. Add exact Miniflare
`4.20260721.0` dev dependency to observation package/lock if needed, matching
execution-edge. Read `execution-edge/test/support/telemetry-d1-v2.ts` for the
existing runtime bridge pattern; do not depend on another package's node_modules.

**Interfaces:** `loadAdmissionSnapshot(db,t): Promise<AdmissionSnapshot>`;
`admitSignal(db,t,r,now): Promise<AdmissionResult>` where AdmissionResult is
the frozen HTTP response payload specified above; storage faults throw a typed
unavailable error. `installGeneration(db,previousRevision,nextRegistration,reason)`
is internal provisioning logic only, never a public handler.

Tables use the prefix `signal_admission_v1_`: registrations (unique active scope),
streams (registration,generation PK, revision, cursor,state,time), receipts
(stream,sequence PK, immutable digest/outcome), evidence (evidence_id PK,
immutable digest/body), attempts (attempt_key PK, immutable reservation plus
dispute flag), outbox (delivery_id PK), audit (immutable transitions), guards
(transaction token PK, ok CHECK(ok=1)). Use explicit columns and CHECK constraints
for Safety, statuses and positive integers. Evidence bodies are credential-free.

- [ ] Add a real runtime test that inserts a valid first receipt and forces a
  later statement to fail; assert zero receipts, reservations and outbox rows.

```ts
it("rolls back every admission write when a guard fails", async () => {
  const h = await createAdmissionDb();
  try {
    await expect(h.db.batch([
      h.db.prepare("INSERT INTO signal_admission_v1_guards VALUES (?, ?)").bind("test", 0),
    ])).rejects.toThrow();
    expect(await h.count("signal_admission_v1_guards")).toBe(0);
  } finally { await h.dispose(); }
});
```

- [ ] Run store tests RED. The helper exposes db, dispose(), count(table) with
  an explicit table allowlist, and provision(fixture registration). It applies
  all observation migrations in order inside local Miniflare; cf network lookup
  is disabled. Never invoke `--remote`.
- [ ] Implement transactional guard insertion before writes, for example:

```sql
INSERT INTO signal_admission_v1_guards(token, ok)
SELECT ?, CASE WHEN EXISTS (
  SELECT 1 FROM signal_admission_v1_streams s
  JOIN signal_admission_v1_registrations r USING (registration_id)
  WHERE s.registration_id=? AND s.generation=? AND s.revision=?
    AND s.next_sequence=? AND s.state='ACTIVE'
    AND r.revision=? AND r.active_generation=s.generation AND r.enabled=1
) THEN 1 ELSE 0 END;
```

Use a fresh transaction token. Add an equivalent guard for each preflight
attempt/evidence snapshot: absence must still be absence, or the expected
immutable digest and dispute state must still match. Then insert receipt,
evidence/new reservation/outbox, advance stream revision/cursor/time, and delete
that token from guards in the same batch. A failed CHECK rolls back everything;
a zero-row update is not success. Unique constraints are a second defense.

- [ ] Quarantine uses its own guarded batch: insert immutable rejection/conflict
  audit without overwriting the original receipt, mark stream and affected
  attempts, cancel pending/retry/claimed deliveries, increment revision. A
  conflicting receipt never replaces the original primary-key row. Retry
  classification on CAS contention at most three times, then return 503.
  Do not catch arbitrary SQL faults as duplicate success.
- [ ] Provisioning cutover checks previous revision, retires the old stream,
  creates sequence-1 stream and updates active generation atomically; retain all
  attempt/evidence tombstones. No active duplicate namespace/ticker/strategy
  scope. No reactivation of quarantined generations or disputed reservations.
- [ ] Test Promise.all admissions: identical receipt gives one COMMIT and one
  duplicate; changed body yields quarantine; two receipts/registrations cannot
  reserve one attempt twice. Force failures after each insertion, lost response
  after commit, stale registry revision and cutover races. Assert table counts
  and stored hashes, not merely HTTP results. Run full focused store/decision
  suites, package typecheck and migration regressions.
- [ ] Review SQL and commit Task 3: `feat: persist signal admission atomically`.

## Task 4: Private evidence-only inbox

**Files:** Create execution `src/signal-evidence-inbox-v1.ts`,
`test/signal-evidence-inbox-v1.test.ts`, migration
`0005_signal_evidence_inbox_v1.sql`; modify execution entry point only for its
explicit receiver route and Env fields.

**Interfaces:** `handleSignalEvidenceInbox(request: Request, env: InboxEnv,
now: number): Promise<Response>`; InboxEnv includes EXECUTION_DB,
SIGNAL_EVIDENCE_INBOX_ENABLED and SIGNAL_DELIVERY_SECRET_SHA256. Route is
`/internal/signal-evidence-v1`, POST only. No agent/account-coordinator calls.

- [ ] Add stored/duplicate/conflict tests with the exact shared delivery vectors.

```ts
it("does not acknowledge a mismatched delivery digest", async () => {
  const f = await inboxFixture();
  f.body.delivery_body_sha256 = "0".repeat(64);
  const response = await handleSignalEvidenceInbox(f.request(), f.env, f.now);
  expect(response.status).toBe(422);
  expect(await f.count()).toBe(0);
});
```

`inboxFixture()` creates an isolated execution D1 runtime, applies migrations,
loads a literal delivery vector, creates a request with a test-only bearer,
exposes count() and dispose(); tests register disposal even on failures.

- [ ] Run execution inbox tests RED. Implement strict closed decoding and body
  hash verification before write. Verify duplicated outer/inner IDs, Safety,
  authority-bearing key allowlists, registered model names, timestamps and
  selected evidence identity. Recompute canonical evidence body hash too;
  do not trust a matching outer digest alone. This is transport validation,
  not re-evaluation of source market evidence or account authorization.
- [ ] Authenticate using a dedicated service bearer digest. Raw token is never
  persisted or returned. Feature disabled gives 404. Existing same-ID/same-digest
  records may be acknowledged after expiry; new expired entries are refused.
  Insert immutable receiver record with unique delivery_id and unique attempt_key.
  A race is re-read and digest-compared; a conflicting attempt is never replaced.
- [ ] Prove exactly one row for concurrent duplicates, no order/account side
  effects, generic 401, closed schema rejection, missing secret, no-store
  responses and DB outage. Run full execution tests/typecheck.
- [ ] Review and commit Task 4: `feat: receive evidence-only signal deliveries`.

## Task 5: Fenced outbox dispatcher

**Files:** Create observation `src/signal-admission-outbox-v1.ts` and
`test/signal-admission-outbox-v1.test.ts`; store exposes claim/finalize methods.

**Interfaces:** `dispatchSignalAdmission(db, sender, clock): Promise<DispatchOutcome>`;
sender is `(body: string) => Promise<Response>`, supplied only by the route's
fixed private binding adapter. clock is `() => number`. DispatchOutcome is
DISABLED/EMPTY/ACKNOWLEDGED/RETRY/EXPIRED/FAILED_TERMINAL/QUARANTINED.

- [ ] Write lost-ack and stale-lease tests before implementation.

```ts
it("cannot finalize using an obsolete lease token", async () => {
  const h = await createAdmissionDb({ queuedAt: 100, expiresAt: 200 });
  try {
    const first = await h.claim(100);
    const second = await h.claim(131);
    expect(await h.finalize(first.token, "ACKNOWLEDGED", 132)).toBe(false);
    expect(await h.finalize(second.token, "ACKNOWLEDGED", 132)).toBe(true);
  } finally { await h.dispose(); }
});
```

The helper's optional queuedAt/expiresAt settings insert an admitted test queue
fixture before claiming; absent those settings, it creates an empty database.
Its claim/finalize wrappers call production store functions; do not mock SQL fencing.

- [ ] Run outbox tests RED. Implement 30-second lease, five total attempts,
  retry delays 2,4,8,16 seconds; 6-second send timeout; 16-KiB response limit;
  one delivery per dispatcher invocation. No configurable external URL.
  Network failures, 408, 429 and 5xx retry; other non-success statuses and
  malformed acknowledgments are terminal. Redirects are terminal. A 200/201
  must match the exact acknowledgment schema/ID/hash/Safety.
- [ ] Claim SQL requires ACTIVE current generation, undisputed attempt and
  unexpired delivery, and increments attempt_count with a fresh claim token.
  Recheck before send. Completion updates WHERE status=CLAIMED AND token=?
  and rechecks state and expiry. Quarantine/expiry takes precedence over a late
  success. No retry can extend expires_at_epoch or recreate a reservation.
- [ ] Test lost receiver response, sender crash, lease recovery, fifth failure,
  expiry before/after send, malformed/oversized ack, clock regression and
  quarantine after claim. If time moves backwards, stop sending and retain a
  diagnosable failure; never prolong a lease based on the regressed clock.
- [ ] Run store/outbox/inbox tests and typechecks. Review and commit Task 5:
  `feat: dispatch durable signal evidence with fenced retries`.

## Task 6: Gated routes and private status

**Files:** Create observation `src/signal-admission-route-v1.ts` and
`test/signal-admission-route-v1.test.ts`; modify observation `src/index.ts`,
`src/types.ts`, both execution configs and observation config;
modify `test/signal-evidence-capability-v1.test.ts`.

**Interfaces:** `handleSignalAdmission(request,env,clock): Promise<Response>`;
`handleSignalAdmissionStatus(request,env): Promise<Response>`. New flags:
SIGNAL_ADMISSION_ENABLED, SIGNAL_ADMISSION_DISPATCH_ENABLED,
SIGNAL_ADMISSION_STATUS_ENABLED, SIGNAL_EVIDENCE_INBOX_ENABLED, all false in
checked-in profiles. Private receiver binding SIGNAL_EVIDENCE_RECEIVER and
sender secret SIGNAL_DELIVERY_SECRET are optional; absence disables dispatch.
Status uses a separate SIGNAL_ADMISSION_OPERATOR_SECRET_SHA256.

- [ ] Add feature-off tests before wiring imports.

```ts
it("keeps signal admission unreachable by default", async () => {
  const response = await worker.fetch(new Request(
    "https://fixture.invalid/api/v1/signal-evidence", { method: "POST" }), inertEnv);
  expect(response.status).toBe(404);
});
```

Use existing Worker shell fixture Env and add only false new flags to inertEnv.
Run route and capability tests RED; explain the expected capability guard
failure before modifying its explicit production-consumer allowlist.

- [ ] Route streams up to the byte cap, cancels excess input, authenticates,
  calls the store and returns its durable result. Never log request/body or
  credentials. Implement redacted structured error codes with Safety.
  Dispatch remains separate from admission success: request failure after commit
  cannot undo it, and background dispatch failure cannot turn it into rejection.
- [ ] Add a scheduled handler guarded by dispatch flag and binding presence,
  calling the dispatcher once; add no deployed cron trigger in this milestone.
  Construct service calls only to fixed `/internal/signal-evidence-v1` through
  the binding, with the independent bearer and redirects refused.
- [ ] Status GET `/api/v1/signal-admission-status` requires operator auth and
  explicit registration_id/generation. Return at most 50 receipts and delivery
  summaries ordered deterministically by sequence, newest first. Allow no other
  query keys or bodies. Registration access is limited to the authenticated
  operator's configured scope, not merely possession of a guessed identifier.
  Store that scope in protected operator configuration and fail closed if absent.
- [ ] Permit only decision module to import the pure bridge, route→store→decision
  integration, and dedicated inbox imports on execution side. Keep the AST
  forbidden-builtin/external-package tests and add synthetic order/coordinator
  imports proving rejection. Do not delete old frozen source tests wholesale.
- [ ] Run both full Worker suites/typechecks and dry-run boundary verifier.
  Review and commit Task 6: `feat: expose gated signal admission and status`.

## Task 7: Opt-in Pine transport wrapper

**Files:** Modify LAB and regenerate RELEASE; create
`tests/unit/test_signal_admission_pine.py`; modify existing evidence capability
and source parity expectations only where the approved wrapper changes them.

- [ ] Add a test for default-off transport and explicit inner-envelope wrapping.

```python
def test_transport_is_separately_disabled():
    source = Path("scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine").read_text()
    assert 'signalAdmissionTransportEnabled = input.bool(false,' in source
    assert 'TradeOpsSignalAdmissionRequestV1' in source
```

- [ ] Run `uv run pytest tests/unit/test_signal_admission_pine.py -q`; confirm RED.
- [ ] Add separate transport enable, registration ID, positive generation and
  credential inputs. Transport requires existing evidence enablement; invalid
  enabled transport emits a redacted error and consumes no sequence. It must
  not fall back to an unauthenticated alert. With transport off, preserve the
  existing evidence envelope byte-for-byte.

```text
inner = signalEvidenceV1Envelope(observation, zone)
outer = {schema_version: TradeOpsSignalAdmissionRequestV1,
         credential: dedicated input, registration_id: dedicated input,
         generation: dedicated input, evidence: inner object}
```

Use existing jsonString for strings and an integer generation token. Validate
ASCII/input bounds before emission. Keep both inner and outer byte limits.
Increment the existing evidence sequence exactly once only after the chosen
alert invocation. No extra alert, credential logging or legacy sequence change.
- [ ] Test generation zero/unsafe values, escaping, invalid credential inputs,
  oversized outer/inner output, disabled defaults and unchanged legacy alert
  behavior. Run generator then `--check`, all Pine Python tests and observation
  Pine parity tests. Record native compilation as pending, not passing.
- [ ] Review protected regions and commit Task 7: `feat: wrap opt-in Pine signal admission`.

## Task 8: Combined proof, recovery guide and release gate

**Files:** Create observation `test/signal-admission-end-to-end.test.ts`,
`docs/runbooks/three-model-signal-admission.md`,
`docs/audits/2026-09-14-three-model-signal-admission.md`.

- [ ] Write an integration test wiring isolated observation and execution D1
  stores through an in-process sender. Count actual receiver rows after lost
  acknowledgment and retry; do not assert only sender call counts.

```ts
it("stores one candidate when the first acknowledgment is lost", async () => {
  const h = await createAdmissionIntegration();
  try {
    await h.admitFirst();
    await h.dispatch({ loseAcknowledgment: true });
    await h.advanceToRetry();
    await h.dispatch({ loseAcknowledgment: false });
    expect(await h.receiverCount()).toBe(1);
    expect(await h.deliveryStatus()).toBe("ACKNOWLEDGED");
  } finally { await h.dispose(); }
});
```

`createAdmissionIntegration` belongs in this test's support code and reuses
Task 3/4 runtime helpers. Its sender calls the production receiver handler and
optionally throws only after the receiver commits. Time is injected everywhere.

- [ ] Exercise all six model/direction vectors through route→database→outbox→
  receiver. Add duplicate, conflict/quarantine and unaffected-other-stream
  cases, exact replay after generation retirement/auth rejection, and late
  quarantine after receiver commit. Never claim stored evidence was revoked
  remotely or became executable.
- [ ] Run full verification from root:

```sh
npm --prefix apps/observation-edge test
npm --prefix apps/execution-edge test
npm --prefix apps/observation-edge run typecheck
npm --prefix apps/execution-edge run typecheck
uv run pytest
uv run ruff check .
uv run ruff format --check .
make secret-scan
node scripts/verify-mt5-dry-run-boundary.mjs
uv run python scripts/generate_rd_v3_release.py --check
git diff --check
```

- [ ] Write the runbook with registration prerequisites, hash-only secret
  storage, stream-specific recovery, immutable reservation retention, status
  interpretation and rollback by disabling the new flags. Explicitly separate
  local source verification from remote deployment, native Pine acceptance and
  demo execution. Never include working credentials or instructions that imply
  unattended account arming.
- [ ] Record actual test results, exact commit and pending native/external
  acceptance in the audit. Explain any scanner finding individually; do not
  expand the previously approved false-positive baseline automatically.
- [ ] Whole-change review checks every spec requirement, migration rollback,
  cross-service byte parity, no new broker capability and unchanged defaults.
  Commit Task 8: `test: prove three-model signal admission failure safety`.

## Plan self-review and handoff

Coverage: transport/auth/registration (1); ordering/freshness/attempts (2);
atomicity/cutover/tombstones (3); receiver/deduplication (4); retry/fencing (5);
visibility/capability/default gates (6); Pine compatibility (7); combined failure
proof and recovery (8). No task selects risk amounts or enables an order path.

Two interpretation clarifications: an exact old duplicate is only replayable
after current authentication succeeds, so retirement/credential revocation may
return 401 instead; operator status may still inspect its immutable receipt.
Missing/nonparseable identity cannot safely quarantine a claimed stream, while
authenticated semantic failure with a usable receipt identity does quarantine.
These preserve the spec's authenticate-first and no-unauthenticated-mutation rules.

The plan is ready for the owner's execution-method choice. It is not evidence
that implementation or tests have run, and does not authorize deployment.
