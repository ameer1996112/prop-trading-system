# Task 1 report — strict transport and registration contracts

Status: DONE

## Implementation

- Added a strict duplicate-aware, fatal-UTF-8 admission decoder with 278528-byte
  outer and 262144-byte canonical evidence limits.
- Enforced the exact outer schema, bounded identifiers/credential, canonical
  safe integer spellings, positive generation/sequence, and copied input/evidence.
- Canonicalized evidence with sorted object keys and preserved array order, and
  derived credential-free SHA-256 identity from
  `{registration_id,generation,evidence}`.
- Added the closed registration decoder, full reviewed-binding validation,
  explicit freshness values, activation interval validation, and constant-time
  fixed-length credential digest comparison.
- Registry `scope_key` is the exact canonical encoded composite
  `{producer_namespace,strategy_id,ticker_id}`. Components are independently
  bounded. Namespace/ticker must match the reviewed binding. The additive
  internal `Transport.strategyId` is parsed from the strict observation and is
  authenticated against scope. `bindingBytes` is canonical internal bytes, not
  a JSON byte encoding.
- Added contract documentation and nine admission vectors referencing unchanged
  source evidence vectors. The two source fixtures with sequence zero are
  explicit transport rejection vectors; the protocol requires sequence >= 1.

## TDD evidence

- Initial RED: focused command failed both suites because the two production
  modules did not exist (`Cannot find module`), exit 1.
- First GREEN: 2 files, 18 tests passed.
- Vector GREEN: 2 files, 19 tests passed.
- Self-review regression RED: canonical trailing-zero binding tick size was
  accepted; 1 of 11 registration tests failed.
- Final GREEN: 2 files, 21 tests passed, exit 0.

## Verification

- Baseline supplied by controller: observation 821 passed; execution 690 passed.
- `npm --prefix apps/observation-edge test -- test/signal-admission-wire-v1.test.ts test/signal-admission-registration-v1.test.ts`: 21 passed.
- `npm --prefix apps/observation-edge run typecheck`: exit 0.
- `npm --prefix apps/observation-edge test`: 26 files, 842 tests passed.
- `git diff --check`: clean before report/commit review.

## Files

- `apps/observation-edge/src/signal-admission-wire-v1.ts`
- `apps/observation-edge/src/signal-admission-registration-v1.ts`
- `apps/observation-edge/test/signal-admission-wire-v1.test.ts`
- `apps/observation-edge/test/signal-admission-registration-v1.test.ts`
- `contracts/signal-admission-v1.md`
- `contracts/vectors/signal-admission-v1.json`
- `.superpowers/sdd/2026-09-14-three-model-signal-admission/task-1-report.md`

## Self-review and concerns

Reviewed exact keys, numeric token validation before conversion, digest shape and
comparison, expiry equality, disabled/generation/producer/strategy failures,
credential-neutral identity, input ownership, and task-only scope. No account,
order, deployment, credential provisioning, or old-checkout changes were made.
No implementation concern remains. Downstream decoders must honor the documented
source-vector references and explicit sequence-zero rejection cases.

## Review round 1/5 fixes

- Corrected tick-size canonicalization so trailing-zero rejection applies only
  to fractional spellings. Canonical integer tick sizes `10` and `100` are now
  accepted; `1.0` and `0.000010` remain rejected.
- Added literal canonical inner evidence boundary coverage: exactly 262144 bytes
  is accepted and 262145 bytes is rejected, with test construction accounting
  for the complete canonical serialization.
- RED: focused suite reported 2 failures out of 25, specifically integer tick
  sizes `10` and `100` returning null. The new inner-boundary test passed against
  the implementation and therefore documents existing correct boundary behavior.
- GREEN: focused suite passed 25/25 tests (2 files), exit 0.
- Typecheck: `npm --prefix apps/observation-edge run typecheck`, exit 0.
- Self-review: confirmed decimal validation still rejects fractional trailing
  zeros, integer strings remain positive canonical decimals, and both byte-limit
  assertions measure serialized evidence rather than padding alone. No concern.
