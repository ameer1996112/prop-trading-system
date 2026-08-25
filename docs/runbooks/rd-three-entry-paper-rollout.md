# Runbook: RD three-entry paper rollout

This runbook promotes contract v3 to the existing Cloudflare observation stack. It is paper-only:
do not add broker credentials, broker routes, live accounts, live orders, or automatic promotion.
Version 2 rows and version 3 audit rows remain immutable.

No remote command in this runbook is part of local verification. Applying D1 migrations, changing
Worker configuration, deploying, or changing a TradingView alert requires explicit operator
approval immediately before that action.

## Release inputs

Record the reviewed commit and local build artifacts before approval:

- edge source: `apps/observation-edge`;
- edge dry-run artifact: `apps/observation-edge/dist`;
- console source: `apps/operations-console`;
- console static artifact: `apps/operations-console/out`;
- TradingView producer: `scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine`;
- D1 migrations: `0024_observation_entries_v3.sql`,
  `0025_observation_entry_v3_decision_order.sql`,
  `0026_observation_entry_v3_attempt_order.sql`,
  `0027_observation_entry_v3_paper_fallback_shadow.sql`,
  `0028_observation_entry_v3_liquidity_cohorts.sql`,
  `0029_observation_entry_v3_one_candle_reason.sql`, and
  `0030_observation_remote_schema_compatibility.sql`.

The required runtime binding names are listed below without values. The five names marked
**secret binding** are also listed under `secrets.required` in `wrangler.jsonc`, but that field is
schema/type/local-warning metadata only: it does not inspect remote bindings or block deployment.
The five secret names must never appear under plaintext `vars`:

- `TRADINGVIEW_OBSERVATION_INGRESS_ENABLED`
- `TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256` (**secret binding**)
- `TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES`
- `PAPER_LEDGER_ENABLED`
- `PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256` (**secret binding**)
- `RD_ENTRY_PAPER_ACCOUNT_IDS`
- `RD_ENTRY_PAPER_RISK_BPS`
- `RD_ENTRY_V3_DETECTOR_CODE_HASH` (**secret binding**)
- `RD_ENTRY_V3_SETTINGS_HASH` (**secret binding**, legacy single-profile fallback)
- `RD_ENTRY_V3_SETTINGS_HASHES_JSON` (**secret binding**, preferred exact-ticker map)
- `RD_EXECUTION_PROPOSAL_V1_REVIEWED_IDENTITIES_JSON`
- `RD_EXECUTION_CANDIDATE_EMISSION_ENABLED` (must remain `false`)
- `RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED` (must remain `false`)
- `RD_EXECUTION_RECEIVER_MANIFEST_SHA256` (must remain `INERT_NOT_CONFIGURED`)
- `NEXT_PUBLIC_API_BASE_URL` (only when the console is built for a different API origin)

Never record a raw ingress or paper-admin credential in Git, shell history, command output, D1, a
deployment variable, a screenshot, or this runbook.

## 1. Verify the release locally

From the repository root:

```sh
make verify-observation
git status --short
git diff --check
```

The proof must end with:

```text
OBSERVATION VERIFICATION PASSED — ingress records metadata and no execution surface exists
```

Build the two production artifacts again and retain their output paths:

```sh
(cd apps/operations-console && npm run build)
(cd apps/observation-edge && npm run build)
```

Do not continue if the working tree differs from the reviewed commit.

Candidate emission and dispatch are independent controls and both remain disabled. The receiver
manifest is inert. This release exposes receipt-only observation ingress: it does not accept
execution-proposal payloads, add a public dispatcher or receiver route, or add any account or
broker execution surface.

## 2. Reconcile D1 migrations through 0030

After explicit deployment approval, inspect pending migrations. The remote D1 database has a
historical proposal-table lineage that this receipt-only release must preserve. Do not recreate,
rename, drop, alter, or manually mark those tables. The only permitted new migration is the
no-schema-change compatibility ledger marker
`0030_observation_remote_schema_compatibility.sql`:

```sh
(cd apps/observation-edge && npm run db:migrate:remote)
```

The migration output must show that `0024_observation_entries_v3.sql`,
`0025_observation_entry_v3_decision_order.sql`,
`0026_observation_entry_v3_attempt_order.sql`,
`0027_observation_entry_v3_paper_fallback_shadow.sql`,
`0028_observation_entry_v3_liquidity_cohorts.sql`,
`0029_observation_entry_v3_one_candle_reason.sql`, and
`0030_observation_remote_schema_compatibility.sql` are already applied or were applied
successfully. Stop if any proposal-table-creating migration is reported as pending; reconcile the
Worker source first rather than mutating the remote proposal schema. Do not delete, rename, roll
back, or manually edit the migration ledger for any of these migrations.

## 3. Review and bind detector/settings identities

Compute the detector digest from the exact saved Pine bytes in the reviewed commit:

```sh
shasum -a 256 scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine
```

Separately capture every TradingView input, feed, symbol, timeframe, timezone, and session setting
in a reviewer-owned canonical JSON profile outside the repository. Do not rely on Pine defaults.
Canonicalize the reviewed profile and compute its SHA-256:

```sh
jq -S -c . /absolute/path/to/reviewed-settings.json | shasum -a 256
```

Two reviewers must compare the digests to the exact source and profile. Keep the paper kill switch
engaged and contract-v3 Pine emission disabled throughout binding verification.

The one-candle detector is opt-in and fail-closed. Review these two profiles independently:

```text
STRICT:
  Enable one-candle liquidity = false
  liquidity cohort = TWO_PLUS_CANDLES

EXPERIMENT:
  Enable one-candle liquidity = true
  liquidity cohort = ONE_CANDLE or TWO_PLUS_CANDLES
  one-candle economic action = SHADOW_ONLY
```

The experiment flag does not authorize paper or live trading. For `ONE_CANDLE`, canonical edge
arbitration records `policy_action = SHADOW_ONLY` when a candidate can be observed and
`policy_action = NONE` when the setup is invalidated or candidate-less. The persisted and API
effective `action` is always `SHADOW_ONLY` with
`effective_action_reason = ONE_CANDLE_EXPERIMENT_NOT_PROMOTED`. Policy action is audit evidence;
effective action is the economic authorization boundary. No one-candle result can create a paper
intent, actionable Pine marker/alert, broker order, or live execution.

For each exact ticker ID, preserve distinct owner-reviewed canonical settings JSON and SHA-256
digests for `STRICT` and `EXPERIMENT`; never reuse one profile's settings hash for the other.
Include a profile identifier in the reviewer-owned record even though only the digest is sent.
Runtime supports only one `ticker_id` to reviewed-settings-hash binding, so only one profile may be
active for a ticker at a time. Do not run simultaneous `STRICT` and `EXPERIMENT` alerts for the
same ticker. Separate tickers may use different active profiles. For a multi-pair rollout, retain
both reviewed profile digests for every approved ticker outside runtime, then bind only the one
currently active digest for each ticker. Create an owner-only JSON file outside the repository
with the reviewed secret bindings. Do not put any value on a command line or in shell history. The
preferred multi-pair file has this exact shape, with each placeholder replaced locally by the
single active profile hash for that ticker:

```json
{
  "RD_ENTRY_V3_DETECTOR_CODE_HASH": "<reviewed detector digest>",
  "RD_ENTRY_V3_SETTINGS_HASHES_JSON": "{\"VANTAGE:GBPJPY\":\"<GBPJPY settings digest>\",\"VANTAGE:GBPUSD\":\"<GBPUSD settings digest>\",\"VANTAGE:USDJPY\":\"<USDJPY settings digest>\"}"
}
```

The secret value is a strict JSON object encoded as a string because Wrangler bulk secret input is
itself JSON. Every key must be the exact TradingView `ticker_id`, every value must be a non-zero
lowercase SHA-256, and the map may contain at most 64 entries. When this map is present it takes
precedence over `RD_ENTRY_V3_SETTINGS_HASH`; malformed maps, missing tickers, and mismatched hashes
fail closed to shadow-only. Keep `RD_ENTRY_V3_SETTINGS_HASH` only as the legacy single-profile
fallback until rollback policy permits removing it.

Immediately before the next command, obtain explicit approval for a remote Worker secret change.
From `apps/observation-edge`, bulk-bind the reviewed values through standard input:

```sh
umask 077
npx wrangler secret bulk < /absolute/owner-only/path/rd-entry-v3-secrets.json
```

`wrangler secret bulk` mutates the remote Worker and creates a deployment. Do not run it during
local verification. Remove the owner-only file according to operator policy after the binding is
confirmed. The reviewed hashes are absent from `vars`, so a later `wrangler deploy` cannot replace
them with empty plaintext values. The `secrets.required` list provides local metadata and warnings
only; it is not a deployment gate.

Before proceeding to the application deployment, list the remote binding names:

```sh
npx wrangler secret list
```

Confirm that all five names are present with type `secret_text`:

```text
TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256
PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256
RD_ENTRY_V3_DETECTOR_CODE_HASH
RD_ENTRY_V3_SETTINGS_HASH
RD_ENTRY_V3_SETTINGS_HASHES_JSON
```

Stop before deployment continuation if any name is absent. Secret listing does not reveal or prove
values. The post-deployment signed DIR_CLOSE gate in step 7 is the effective-value proof.
Unreviewed or mismatched identities are intentionally retained as blocked audit only.

## 4. Deploy the edge and console

The console is built into `apps/operations-console/out` and served by the edge Static Assets
binding, so its release and the Worker release are one deployment:

```sh
(cd apps/operations-console && npm run build)
(cd apps/observation-edge && npm run deploy)
```

Observe a terminal successful deployment before calling the release deployed. Verify the stable
origin:

```text
GET /health/live
GET /api/v1/rd-entry-decisions?limit=20
```

The decision route is protected by the paper-admin bearer credential. No `/webhook`, broker,
provider, order, fill, or live-account route may exist.

## 5. Create or verify the PAPER_ONLY account

Use the protected paper-account API to verify that each ID named by
`RD_ENTRY_PAPER_ACCOUNT_IDS` exists and is immutable. If an account is absent, create it through
`POST /api/v1/paper-accounts` using the separate paper-admin credential and the reviewed account
contract. Never use a broker or prop-firm account ID. Confirm the configured risk is within the
contract range before disengaging the paper kill switch or enabling v3 Pine emission.

## 6. Install the TradingView producer

1. Open a supported Forex chart at the five-minute timeframe.
2. Add `SND_RD_5M_V3_THREE_ENTRY_LAB.pine` to Pine Editor.
3. Save, compile, and add it to the chart.
4. Enter the dedicated contract-v3 ingress credential only in
   **Contract-v3 ingress credential**. Use the approved printable token format
   (`A-Z`, `a-z`, `0-9`, `.`, `_`, `~`, `+`, `/`, `=`, `:`, or `-`); Pine fails closed on any
   other credential character.
5. Enter the reviewed detector/settings digests from step 3.
6. Keep diagnostics and legacy setup export disabled.
7. Keep **Emit contract-v3 entry events** disabled until the signed DIR_CLOSE and replay gate in
   step 7 passes.
8. Select the ticker's one active reviewed profile exactly. For `STRICT`, leave
   **Enable one-candle liquidity** off. For `EXPERIMENT`, turn it on. Confirm that the ticker's
   runtime settings-hash binding is the digest for that selected profile.
9. Create one alert for the ticker's active profile with condition **Any alert() function call**,
   the stable v3 observation webhook, and no separately composed message body. Never keep strict
   and experiment alerts active simultaneously for the same ticker.

Every `alert()` call automatically serializes the exact outer
`{"credential":...,"payload":...}` Worker envelope. Do not paste a message template into the
TradingView alert dialog. The 35,000-character producer limit applies to that complete envelope,
including the safely serialized credential, and an oversized envelope is not sent.

TradingView stores a snapshot of the script and all inputs in the alert. To switch one ticker from
`STRICT` to `EXPERIMENT` or back: disable and delete its old alert; update that ticker's runtime
reviewed-hash binding to the new profile hash; recreate the alert with matching saved source and
inputs; then verify its stored receipt. Toggling **Enable one-candle liquidity**, changing its
reviewed settings hash, or making any other source or input change does not update an existing
alert. Pine compile, add-to-chart, input-snapshot review, alert recreation, and live-tick behavior
are manual release checks and must be recorded as pending until an operator actually completes
them.

## 7. Signed smoke sequence

Use synthetic LAB payloads only. Send them to the v3
`POST /api/v1/tradingview/observations` endpoint with the dedicated observation credential in the
outer envelope. Never paste the credential into logs or saved payload files. Use a unique setup,
producer sequence, and event ID per non-replay smoke.

After the account/risk review, disengage the paper kill switch for this signed synthetic gate only;
keep Pine emission disabled. Run this sequence and capture only status codes, bounded response
fields, and resulting row IDs:

1. Send one exact `DIR_CLOSE` entry-decision payload whose producer detector/settings hashes are
   the two reviewed digests. Expect `202`.
2. Query the authenticated `GET /api/v1/rd-entry-decisions?limit=20` and
   `GET /api/v1/paper-simulations/summary?limit=50` routes. Require one selected
   `PAPER_ELIGIBLE` `DIR_CLOSE` decision and exactly one paper intent for that setup. This is the
   effective-value proof: a reviewed-hash mismatch must not satisfy it.
3. Replay the identical bytes. Expect `200/DUPLICATE`; query both routes again and require the same
   decision and exactly one intent, with no additional intent.
4. Send a strict `HTF_TIMED` BOC payload. Expect canonical model `BOC` and at most one paper intent
   for that setup.
5. Send an exact flip payload. Expect canonical model `HTF_FLIP`. Also prove a contact followed by
   a continuously observed, strictly later tick recross in the same five-minute child is exact. A
   same-atomic-tick contact/recross or any sequence gap must remain blocked/non-exact.
6. Send an atomic BOC/flip payload. Expect `CO_TRIGGER_SAME_EVENT`, both candidate identities, one
   entry price, and one paper intent.
7. Send a `DISCRETIONARY_5M` BOC payload. Expect `SHADOW_ONLY`,
   `BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED`, and no paper intent.
8. Query `GET /api/v1/rd-entry-decisions?limit=20`. Each setup must display rows for `BOC`,
   `DIR_CLOSE`, and `HTF_FLIP`, including waiting or blocked placeholders.
9. Query the paper summary. Confirm no setup attempt has more than one initial position.

Stop immediately on a different result. Disable v3 Pine emission and keep the paper kill switch
engaged until the mismatch is reviewed; do not “fix” smoke data in D1. Enable Pine emission only
after the DIR_CLOSE/replay effective-value gate and the remaining smoke sequence pass.

## 8. One-candle experiment evidence

The cohort metrics route is authenticated with the paper-admin bearer credential:

```text
GET /api/v1/rd-entry-cohort-metrics
Authorization: Bearer <paper-admin credential>
```

Never place the credential in a URL, saved command, screenshot, or report. The response groups
outcomes by liquidity cohort, flag value, entry model, symbol, and feed. For each group:

```text
resolved = wins + losses
win rate = wins / (wins + losses)
trades = resolved + ambiguous + open
```

Open and ambiguous outcomes are excluded from the win-rate denominator. Always review and report
the `resolved` count with the rate; `win_rate_bps` is `null` when `resolved` is zero. Do not compare
rates without their resolved sample sizes.

After deployment, update the saved Pine source and activate the `EXPERIMENT` profile only for
explicitly approved markets. For each ticker being switched, disable/delete its old alert, replace
that ticker's active reviewed-hash binding with the experiment profile hash, and recreate one alert
from the matching saved source and input snapshot. Before claiming the experiment is collecting
outcomes:

1. Confirm TradingView shows a successful 2xx webhook delivery for the recreated experiment alert.
2. Confirm the corresponding receipt is stored by the observation service.
3. Inspect the accepted setup evidence and require the immutable fields:

   ```json
   {
     "schema_version": "3.1",
     "strategy_version": "3.1.0-contract3",
     "rule_contract_version": "3.1.0",
     "liquidity_cohort": "ONE_CANDLE",
     "one_candle_enabled": true
   }
   ```

4. Query authenticated `GET /api/v1/rd-entry-cohort-metrics` and require the first
   `liquidity_cohort: "ONE_CANDLE"` row for that approved symbol.
5. Confirm `ONE_CANDLE` was never effectively `PAPER_ELIGIBLE`. Candidate-bearing decisions have
   canonical `policy_action = SHADOW_ONLY`; invalidated or candidate-less decisions have canonical
   `policy_action = NONE`. Every persisted/API row must have effective `action = SHADOW_ONLY` and
   `effective_action_reason = ONE_CANDLE_EXPERIMENT_NOT_PROMOTED`. Confirm no paper intent,
   actionable Pine marker/alert, broker order, or live execution surface exists.

A delivered TradingView alert alone is insufficient. Until both stored 2xx receipt proof and the
first `ONE_CANDLE` metrics row exist, report the experiment as **not yet collecting outcomes**.

## 9. Acceptance

The rollout is accepted only when all of the following are recorded:

- local `make verify-observation` passed at the deployed commit;
- D1 is migrated through 0030;
- candidate emission and dispatch remain disabled, the receiver manifest remains inert, and no
  account or broker execution exists;
- detector and settings digests match across source, edge, and Pine;
- the paper account and risk configuration are reviewed;
- Pine compiled, was added to the five-minute chart, and produced an actual realtime event;
- all signed smoke outcomes match the sequence above;
- the console shows all three models and one selected paper position at most;
- strict and experiment profiles have distinct reviewed hashes and input snapshots, with only one
  profile active per ticker;
- a stored 2xx experiment receipt and first `ONE_CANDLE` cohort-metrics row are recorded before
  collection is claimed;
- `ONE_CANDLE` is never effectively `PAPER_ELIGIBLE`; canonical `policy_action` is `SHADOW_ONLY`
  for candidate-bearing observations and `NONE` for invalidated or candidate-less observations,
  while persisted/API effective `action` is always `SHADOW_ONLY` with
  `effective_action_reason = ONE_CANDLE_EXPERIMENT_NOT_PROMOTED`, and no paper intent or actionable
  Pine marker/alert exists; and
- broker/live execution remains disabled.

## Rollback

1. Disable the TradingView v3 alert.
2. Leave version 3 rows immutable.
3. Redeploy the previous edge/console release if necessary.
4. Do not delete migration 0024, migration 0025, migration 0026, migration 0027, migration 0028,
   migration 0029, migration 0030, or historical paper intents or shadow outcomes.

Keep the reviewed hashes and failed smoke evidence for diagnosis. Rollback does not authorize
editing or deleting audit facts.
