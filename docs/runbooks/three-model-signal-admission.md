# Three-model signal admission: evidence-only recovery

This runbook covers local verification and the prerequisites for a separately
approved rollout. Admission, receipt storage and receiver acknowledgment carry
`authority: EVIDENCE_ONLY` and `execution_allowed: false`. A stored candidate is
historical evidence, not an executable order. Existing agent responses continue
to return `command: null`. No account arming, broker action, MT5 replacement,
credential provisioning, alert activation or deployment is authorized here.

## Registration and rollout prerequisites

Review the exact producer namespace, strategy, ticker, feed, symbol, tick size,
producer instance and nonzero detector/settings digests. Register one active
generation with a positive revision, bounded activation interval and owner-chosen
event age, observation age, future skew and queue age policies. No operational
numeric freshness value is supplied by this runbook or inherited from tests.
Keep the registration scope canonical and consistent with its reviewed binding.

Registration records contain only a SHA-256 credential digest; never persist or
log the admission credential in receipts, evidence, delivery bodies or audit rows.
The private receiver stores the service credential digest in protected
`SIGNAL_DELIVERY_SECRET_SHA256` configuration. The sender necessarily obtains its
bearer value from protected `SIGNAL_DELIVERY_SECRET` configuration. Neither is a
checked-in value. Credentials are not trimmed. Use synthetic local values only
for isolated tests.

The operator status endpoint separately requires a protected operator digest and
`SIGNAL_ADMISSION_OPERATOR_SCOPE_JSON`. Its only allowed shape is
`{"registration_ids":["approved-registration-id"]}`: at most 8192 UTF-8 bytes,
at most 50 unique valid registration identifiers, and no extra fields. Missing,
malformed or unauthorized scope denies access. A caller's requested registration
does not grant scope. Status is private, redacted and evidence-only.
The closed status response is documented in `contracts/signal-admission-v1.md`.
Inspect `stream.state` and `stream.reason` even when a receipt is ACCEPTED or a
delivery is ACKNOWLEDGED. `attempt_associations` includes disputed attempt keys
and NO_CANDIDATE evidence. Each list is capped at 50 in deterministic newest-first
order; it is a bounded operational view, not exhaustive history or an atomic
snapshot. Unknown generations return 404; existing empty generations return 200.
Later receipt conflicts on a quarantined current generation preserve the original
receipt while recording audit evidence and disputing associated reservations.
Registration IDs reject all spaces; credential spaces remain significant.

For a future separately authorized rollout, review and reconcile the complete
existing migration history, including observation migrations
`0031_signal_admission_v1.sql`, `0032_signal_admission_receipt_evidence_v1.sql`,
`0033_signal_admission_dispatch_v1.sql`, and execution migration
`0005_signal_evidence_inbox_v1.sql`. Verify the exact filenames against the
checkout. Local tests apply checked-in migrations only to disposable isolated
D1 stores. Passing them is not evidence that remote schemas were migrated.

All checked-in deployment profiles keep `SIGNAL_ADMISSION_ENABLED`,
`SIGNAL_ADMISSION_DISPATCH_ENABLED`, `SIGNAL_ADMISSION_STATUS_ENABLED`, and
`SIGNAL_EVIDENCE_INBOX_ENABLED` false. A future rollout requires separate review
of protected configuration, service binding, native producer acceptance and
environment ownership. Enabling any of these flags does not authorize trading.

## Interpreting durable state

| Observation | Meaning and response |
| --- | --- |
| `ACCEPTED` | Evidence passed admission and eligible evidence was reserved. It is not an order. |
| `NO_CANDIDATE` / `AUDIT_ONLY` | Receipt and evidence are retained without creating a new executable capability. |
| Exact duplicate, HTTP 200 | Current authentication succeeded and an immutable prior receipt was returned; no new reservation. |
| HTTP 401 | Authentication failed, including an exact replay of a retired generation. Do not infer whether a receipt exists. |
| `QUARANTINED` stream | Sticky stream block. Diagnose its durable reason and receipts; unrelated namespaces remain independent. |
| `PENDING` / `CLAIMED` / `RETRY` delivery | Queue state, fenced lease or bounded retry; no execution permission. |
| `ACKNOWLEDGED` delivery | Receiver returned an exact matching `STORED` or `DUPLICATE` acknowledgment. |
| `EXPIRED` / `FAILED_TERMINAL` / `QUARANTINED` delivery | No further successful delivery may be inferred. Inspect failure reason and immutable evidence. |
| Receiver `STORED` / `DUPLICATE` | Exactly one durable historical inbox row for that delivery identity. Still evidence-only. |

## Stream-specific recovery

1. Identify the exact registration, generation and namespace through authorized
   status access. Preserve receipt IDs, immutable body digests, audit reasons and
   reservation history. Do not copy credentials into an incident report.
2. Distinguish authentication/configuration failure, sequence gap or body conflict,
   semantic invalidity, clock regression, freshness expiry and transport failure.
   A missing message or changed body must not be concealed by renumbering a replay.
3. Leave quarantine sticky. Never reset a stream to active, rewind its sequence,
   rewrite a receipt, replace evidence or delete an attempt reservation. Recovery
   uses an explicitly reviewed next generation, a new producer lifecycle where
   required, and compare-and-swap of the expected registration revision. Record
   the reason. Generation cutover retires the old stream atomically; old receipt
   and attempt tombstones survive. Reusing the same economic attempt in that
   namespace does not create a fresh opportunity merely by changing generation.
4. Diagnose only the affected namespace. Identical economic keys in different
   validated namespaces are independent. Do not impose a global stream reset.
5. Let the bounded dispatcher retry immutable bytes after transport failure. An
   acknowledgment lost after receiver commit can return `DUPLICATE` on retry;
   verify receiver row count and matching digests, not merely sender attempts.
   Never extend expiry or recreate a terminal delivery to force another send.

Quarantine can happen after the receiver commits. The final sender check may
refuse acknowledgment while the receiver still retains its earlier immutable
row. That row was not remotely revoked or made executable. Preserve it as
historical evidence; do not claim delivery compensation deleted it. Evidence
admission has no command, account, sizing, order API or broker capability.

## Rollback and retention

Disable the new admission and dispatch flags and, as appropriate, the new status
and inbox flags. Stop the associated producer emission through the separately
controlled producer configuration. Account for in-flight sends: disabling a
route cannot undo a receiver commit already completed. Preserve evidence for
reconciliation.

Rollback is feature disablement, not a destructive down migration. Retain all
observation admission migrations, the execution inbox migration, immutable
receipts/evidence, receipt links, reservations, audit records and inbox rows.
Do not drop tables or remove immutability triggers to make rollback convenient.
Any future data lifecycle change requires its own reviewed retention plan.

## Acceptance gates

Local source checks include both complete Worker suites and typechecks, Python
tests, Ruff checks, secret scan, MT5 dry-run boundary verification, Pine generator
consistency and whitespace checks. Record actual results in the linked
[implementation audit](../audits/2026-09-14-three-model-signal-admission.md).
The combined integration suite uses real isolated D1 databases, the production
admission route, production outbox dispatcher and production receiver handler.
Its freshness allowance preserves original vector event chronology and is
test-only. It is not an owner policy recommendation.

The Python Pine checks inspect source and execute extracted predicates; they do
not compile or execute Pine's real encoder. Native TradingView acceptance remains
required before any separately authorized external use:

- [ ] Compile LAB and generated RELEASE with the native Pine compiler.
- [ ] Verify unchanged legacy emission when transport is disabled.
- [ ] Exercise all three models in both directions through the real encoder.
- [ ] Exercise quotes, backslashes and other supported escaping through the real
  encoder, checking the decoded outer credential and unchanged inner evidence.
- [ ] Exercise payload size boundaries, including the retained 35000-character
  producer cap, UTF-8 byte accounting, and server inner/outer limits; verify the
  rejection behavior immediately below, at and above each applicable boundary.
- [ ] Verify enabled transport rejects Unicode serialization so ASCII character
  length remains a sound byte count, including Unicode from producer metadata.
- [ ] Verify invalid credential/identifier/generation, Unicode and oversized
  payload rejection do not invoke an alert, consume sequence, or fall back to
  legacy emission. Distinguish local alert invocation from network acknowledgment.
- [ ] Complete separate remote configuration/schema and service-binding review.
- [ ] Complete separately authorized external/native acceptance evidence. Demo
  execution, if ever requested, is a separate milestone with its own authority.

Local source verification leaves every unchecked native/external gate pending.
