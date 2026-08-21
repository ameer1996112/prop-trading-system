# RD entry execution proposal v1

Status: `FROZEN_PAPER_ONLY_INERT`

`rd-entry-execution-proposal-v1` is an account-free proposal contract. It does not authorize a
terminal action. Existing contract-v3 observations, fixed 100-tick stops, fixed 200-tick targets,
paper intents, and results can never be promoted into this version.

The only eligible proposal shape is an exact confirmed five-minute `DIR_CLOSE` for the existing
`TWO_PLUS_CANDLES` cohort under `LIVE_CONTIGUOUS` producer delivery. Evidence may correctly be
`REPLAYABLE`; delivery may not be historical or backfilled. The proposal pins the engagement
candle, directional-close candle, source tick capability, reviewed detector/settings/provenance
digests, zone, direction-specific wick, buffer, integer-tick risk, and exact 4R target.

Validation requires a trusted edge configuration value named the reviewed identity binding. The
binding is a closed, immutable, account-free value that pins exactly `ticker_id`, `source_symbol`,
`source_feed`, `detector_code_sha256`, `settings_sha256`, `provenance_sha256`,
`source_tick_capability_sha256`, `source_tick_size`, and `buffer_policy_version`. Every field must
exactly equal the proposal. A missing, malformed, partially specified, or mismatched binding fails
closed. Shape-valid hashes alone are never treated as reviewed.

The public candidate-derivation function accepts untrusted `unknown` input plus that trusted
binding and performs full runtime validation itself before hashing. A TypeScript assertion or a
previous validation call cannot bypass the check.

When either public validation input is a raw `Uint8Array`, it is decoded with the strict JSON
parser before exact-key validation. Duplicate keys, unsafe integers, and fractional or exponent
tokens in integer fields therefore fail closed. Already-parsed strict values and ordinary object
inputs remain supported for bounded ingress paths that parse centrally.

## Geometry

- Long: engagement `LOW` is the wick reference; `stop = low - buffer`,
  `risk = entry - stop`, and `target = entry + 4 × risk`.
- Short: engagement `HIGH` is the wick reference; `stop = high + buffer`,
  `risk = stop - entry`, and `target = entry - 4 × risk`.
- The source bar must be closed, stable, exactly five minutes, directionally close beyond the
  zone, and provide the proposed entry close. All prices are safe integer ticks.
- Tick size is a canonical positive ASCII decimal of at most 32 total characters and at most 12
  fractional digits. Signs, exponent notation, leading-zero integer forms, and trailing fractional
  zeroes are rejected.

The source rule references remain the reviewed directional-close and zone-engagement excerpts in
the frozen strategy contract: `LCydpj3CaHo` at 18:40 for directional close and `E5EBc1MtiXQ` at
17:50 for pre-entry zone handling. These citations do not approve any numeric buffer.

## Inert buffer policy

Policy version `rd-entry-wick-buffer-v1` currently contains review fixtures only:

| Source symbol | Directional wick | Minimum buffer ticks | Divergence tolerance ticks |
| --- | --- | ---: | ---: |
| EURUSD | low / high | 2 | 3 |
| GBPJPY | low / high | 3 | 5 |
| USDJPY | low / high | 2 | 5 |
| XAUUSD | low / high | 5 | 10 |
| NAS100 | low / high | 10 | 20 |

These numbers are conspicuously inert fixtures, not production-approved trading parameters. They
must be replaced or expressly owner-approved with per-symbol evidence before any authority ceiling
can rise. An undefined symbol or mismatched value fails closed.

## Identity and conflicts

The logical candidate preimage contains exactly strategy version, candidate wire version, ticker
ID, setup ID and revision, selection ID, and source-bar close epoch. Canonical UTF-8 JSON is hashed
with SHA-256. Geometry is excluded from that identity. The canonical candidate-body SHA-256 is
stored separately, so changed geometry under the same logical signal is a conflict and never a new
signal.

The shared vector document contains literal acceptance, rejection, and same-identity conflict
cases. Its reviewed identities and numeric policies are test fixtures only; their repeated-letter
digests are intentionally unmistakable non-production values and convey no execution approval.
Because the reviewed vector bytes are immutable, the focused runtime test adds a supplemental
rejection matrix. The frozen vectors and that matrix jointly cover every closed authority
constant, both disallowed entry-model alternatives, shadow-only selection, stale timing, invalid
wick evidence, reviewed-identity mismatches, unsafe arithmetic, historical delivery, and unknown
keys without changing any frozen digest.

## Contract artifacts

- `contracts/schema/rd-entry-execution-proposal-v1.schema.json` strictly describes the proposal.
- `contracts/schema/execution-candidate-v1.schema.json` separately and strictly describes the
  account-free `ExecutionCandidateV1` wire value, including its digest-free logical ID and separate
  canonical body digest.
- `contracts/vectors/rd-entry-execution-proposal-v1.json` is the cross-runtime fixture source for
  positive, negative, binding-mismatch, tick-size, and content-conflict cases.

Both schemas reject unknown fields and pin inert `PAPER_ONLY` constants. JSON Schema is structural;
the TypeScript runtime checks against the reviewed binding and re-derives candle timing/OHLC,
directional geometry, recency, deepest wick, buffer, safe arithmetic, exact 4R, and both digests.
Those runtime and cross-field checks are normative.

## Gates

Proposal emission and candidate dispatch are separate controls and both default disabled. Pine
parity, owner review, a fresh live-contiguous evidence corpus, routing-manifest approval, Windows
compilation, authenticated broker-bar reconstruction, and every later rollout gate remain
uncompleted. Nothing in this contract deploys a Worker, changes a TradingView alert, arms an
account, opens MT5, enables Algo Trading, or sends an order.
