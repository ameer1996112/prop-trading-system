# Signal admission V1 transport and registration

This contract is evidence-only. Admission does not authorize account access,
position sizing, commands, orders, or execution.

## Admission request

`TradeOpsSignalAdmissionRequestV1` is a closed JSON object with exactly
`schema_version`, `credential`, `registration_id`, `generation`, and `evidence`.
The credential is printable ASCII (1–1024 characters) and is never trimmed.
Registration identifiers are printable ASCII excluding backslash (1–160
characters). Generation and the evidence observation's `producer_sequence` are
canonical positive safe-integer tokens. All numeric tokens in evidence are
canonical integer tokens: fractions, exponents, negative zero, and unsafe
integers are rejected before conversion.

The outer limit is 278528 bytes; canonical evidence is limited to 262144 bytes.
JSON parsing is fatal UTF-8, duplicate-key aware, and bounded to depth 64 and
20000 nodes. Unknown outer fields are rejected. Evidence bytes are canonical
JSON with lexicographically sorted object keys and unchanged array order.

The receipt body digest is lowercase SHA-256 of canonical JSON
`{registration_id,generation,evidence}`. It excludes `credential`, so credential
rotation does not alter identity.

## Provisioned registration

`TradeOpsSignalAdmissionRegistrationV1` is a closed JSON object with exactly:
`schema_version`, `registration_id`, `generation`, `revision`, `scope_key`,
`producer_instance_id`, `credential_sha256`, `reviewed_binding`, `active_from`,
`active_until`, `enabled`, and `freshness`.

`reviewed_binding` is the existing closed `TradeOpsSignalEvidenceBindingV1`.
Internally it becomes canonical `bindingBytes`; bytes are not represented as a
JSON field. `scope_key` is an encoded composite scope, not a single identifier:
it is the exact canonical JSON string of
`{producer_namespace,strategy_id,ticker_id}`. Each component independently uses
the 1–160 character identifier rule. Namespace and ticker must equal the
reviewed binding, and request observation `strategy_id` must equal the scope.

Credential and binding digests are 64 lowercase hexadecimal characters.
Generation and revision are positive safe integers. Activation instants are
nonnegative safe integers with `active_until > active_from`. Freshness is a
closed object containing positive safe integers `max_event_age_seconds`,
`max_observation_age_seconds`, and `max_queue_age_seconds`; only
`future_skew_seconds` may be zero. Values use seconds and have no defaults.

Authentication requires an enabled exact registration/generation, exact
producer instance and strategy, `active_from <= now < active_until`, and a
fixed-length constant-time comparison of the SHA-256 credential digest. Missing,
disabled, expired, malformed, and wrong-credential registrations fail closed.

## Admission result and delivery

`TradeOpsSignalAdmissionResponseV1` has exactly `schema_version`, `authority`,
`execution_allowed`, `receipt_id`, `outcome`, `code`, `duplicate`, `stream_state`.
Safety is always `authority: "EVIDENCE_ONLY"`, `execution_allowed: false`.
Receipt outcome is `ACCEPTED`, `NO_CANDIDATE`, `AUDIT_ONLY`, or `REJECTED`;
code is nullable and stream state is `ACTIVE`, `QUARANTINED`, or `RETIRED`
(nullable before authentication). Receipt ID is nullable before durable admission.
The receipt ID is lowercase SHA-256 over canonical
`{schema_version:"TradeOpsSignalReceiptIdentityV1",registration_id,generation,sequence}`.
The store returns this body directly; storage faults throw `AdmissionUnavailableError`.

`TradeOpsSignalDeliveryV1` has exactly `schema_version`, `authority`,
`execution_allowed`, `delivery_id`, `delivery_body_sha256`, `receipt_id`,
`registration_id`, `generation`, `attempt_key`, `evidence_id`,
`evidence_body_sha256`, `admitted_at_epoch`, `expires_at_epoch`, `evidence`.
`evidence` is one unchanged validated `SignalEvidenceEntryV1`, including fidelity.
Delivery ID is lowercase SHA-256 over canonical
`{schema_version:"TradeOpsSignalDeliveryIdentityV1",attempt_key,evidence_id}`.
Delivery digest hashes the canonical complete delivery without its
`delivery_body_sha256` field. Object keys sort lexicographically; arrays retain
their order. Epochs are safe integer seconds; expiry is fixed at admission.

`TradeOpsSignalDeliveryAckV1` has exactly `schema_version`, `authority`,
`execution_allowed`, `delivery_id`, `delivery_body_sha256`, `status`.
Status is `STORED` (HTTP 201) or `DUPLICATE` (HTTP 200), with the same Safety
literals. Same ID/different digest is HTTP 409. An HTTP success without this
exact matching acknowledgment does not acknowledge a delivery.

## Transport vectors

`contracts/vectors/signal-admission-v1.json` maps all nine unchanged evidence
vectors by `source_case_id`. Consumers construct the outer request using the
literal registration identity in that file and the referenced unchanged input.
Cases whose legacy evidence observation has producer sequence zero are explicit
transport rejections because admission sequences start at one.

The same file also freezes nine full `deliveries` with literal body, stored and
duplicate acknowledgments, `source_case_id`, and nullable `normalization`.
DIR_CLOSE fixtures use an explicit positive producer sequence and corresponding
event ID; the original input vectors remain unchanged. A permanent observation
parity test reconstructs those inputs and compares the entire bridge output.
Digest and acknowledgment checks use an independent test serializer and SHA-256.
The NO_CANDIDATE case is a receiver rejection vector and is never dispatched.

## Private evidence receiver

The exact route is POST `/internal/signal-evidence-v1`. It is disabled unless
`SIGNAL_EVIDENCE_INBOX_ENABLED` is the string `true`; both checked-in execution
profiles explicitly set `false`. A dedicated Bearer token must hash to
`SIGNAL_DELIVERY_SECRET_SHA256`. It is independent of producer/agent credentials,
never trimmed, and never stored or returned. Missing or malformed configuration
and incorrect credentials return the same generic 401 response.

The receiver independently decodes every nested object using closed key sets,
checks safe integer seconds, bounded fatal UTF-8 JSON (278528 bytes, depth64,
20000 values), canonical integer tokens, duplicate keys and the 262144-byte
canonical evidence cap. The delivered entry must be SELECTED with non-null
candidate/evidence and the original model fidelity. It verifies duplicated IDs,
binding/source identity, selected-copy equality, the original attempt/formation
and evidence identities, receipt and delivery identities, the nested evidence
digest, delivery digest, and selected candidate/proof/selection hash derivations.
It does not run the market-rule evaluator or consult account policy.

Receiver persistence is immutable, unique by `delivery_id` and by
`(namespace, attempt_key)`, where namespace comes from the validated
`evidence.reviewed_binding.producer_namespace`. Raw attempt keys omit namespace;
the frozen hash algorithm is unchanged. SQL uniqueness arbitrates concurrent
requests. A zero-row insertion is re-read and digest-compared, never accepted
unconditionally. Storage errors return 503 and cannot be mistaken for duplicates.
Existing exact deliveries are acknowledged even after expiry. A new delivery
requires `admitted_at_epoch <= now < expires_at_epoch` and a nonempty interval.

All responses are `Cache-Control: no-store` and carry the Safety literals.
Success is the exact 201 STORED / 200 DUPLICATE acknowledgment above. Errors
contain only Safety and a fixed `error`: 404 NOT_FOUND, 405 METHOD_NOT_ALLOWED,
401 UNAUTHORIZED, 415 INVALID_DELIVERY (media type), 413 INVALID_DELIVERY (bytes),
422 INVALID_DELIVERY (schema, parsing or digest), 422 EXPIRED (time window),
409 CONFLICT (immutable identity), or 503 UNAVAILABLE (storage/server clock).
The dedicated handler has no account, agent, order or network capabilities.
