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

## Vectors

`contracts/vectors/signal-admission-v1.json` maps all nine unchanged evidence
vectors by `source_case_id`. Consumers construct the outer request using the
literal registration identity in that file and the referenced unchanged input.
Cases whose legacy evidence observation has producer sequence zero are explicit
transport rejections because admission sequences start at one.
