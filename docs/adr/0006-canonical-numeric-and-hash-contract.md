# ADR 0006: canonical numeric and hash contract

Status: `ACCEPTED / LOCALLY VERIFIED`

## Decision

Domain and hashed persistence use integer price ticks, integer lot steps, integer money minor units
with explicit currency scale, and fixed-scale plain decimal strings for ratios and tick sizes.
Binary floating point and `Decimal` objects do not cross the serialization boundary.

Canonical JSON is UTF-8 with ASCII-profile keys sorted lexicographically, no insignificant
whitespace, and integer/decimal-string values. It rejects float/exponent numbers, NaN/infinity,
duplicate input keys, unsafe integers, invalid UTF-8 scalars, and fixed decimals with exponent,
leading-zero, or scale ambiguity. SHA-256 is computed over those exact bytes.

The ASCII key profile avoids Python Unicode-code-point versus JavaScript UTF-16 key-ordering
differences. Integers are limited to the common safe range. `contracts/vectors` is the shared
Python/TypeScript oracle and is verified by both test suites.
