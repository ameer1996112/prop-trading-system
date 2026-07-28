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
- D1 migrations: `0024_observation_entries_v3.sql` and
  `0025_observation_entry_v3_decision_order.sql`.

The required runtime environment-variable names are listed below without values. Treat digest
variables as configuration secrets even though they store hashes:

- `TRADINGVIEW_OBSERVATION_INGRESS_ENABLED`
- `TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256`
- `TRADINGVIEW_OBSERVATION_MAX_BODY_BYTES`
- `PAPER_LEDGER_ENABLED`
- `PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256`
- `RD_ENTRY_PAPER_ACCOUNT_IDS`
- `RD_ENTRY_PAPER_RISK_BPS`
- `RD_ENTRY_V3_DETECTOR_CODE_HASH`
- `RD_ENTRY_V3_SETTINGS_HASH`
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

## 2. Apply D1 migrations through 0025

After explicit deployment approval, apply every pending migration through
`0025_observation_entry_v3_decision_order.sql`:

```sh
(cd apps/observation-edge && npm run db:migrate:remote)
```

The migration output must show that both `0024_observation_entries_v3.sql` and
`0025_observation_entry_v3_decision_order.sql` are already applied or were applied successfully.
Do not delete, rename, or roll back either migration.

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

Two reviewers must compare the digests to the exact source and profile. Configure the reviewed
digests under `RD_ENTRY_V3_DETECTOR_CODE_HASH` and `RD_ENTRY_V3_SETTINGS_HASH`, and paste the same
digests into Pine's **Reviewed detector SHA-256** and **Reviewed settings SHA-256** inputs.
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
   **Contract-v3 ingress credential**.
5. Enter the reviewed detector/settings digests from step 3.
6. Keep diagnostics and legacy setup export disabled.
7. Enable **Emit contract-v3 entry events** only after the edge, D1, and paper account checks pass.
8. Create one alert with condition **Any alert() function call**, the stable v3 observation webhook,
   and no separately composed message body.

TradingView stores a snapshot of the script and inputs in the alert. Recreate the alert after any
source or setting change. Pine compile, add-to-chart, and live-tick behavior are manual release
checks and must be recorded as pending until an operator actually completes them.

## 7. Signed smoke sequence

Use synthetic LAB payloads only. Send them to the v3
`POST /api/v1/tradingview/observations` endpoint with the dedicated observation credential in the
outer envelope. Never paste the credential into logs or saved payload files. Use a unique setup,
producer sequence, and event ID per non-replay smoke.

Run this sequence and capture only status codes, bounded response fields, and resulting row IDs:

1. Send one exact `DIR_CLOSE` entry-decision payload. Expect `202`, one
   `PAPER_ELIGIBLE` decision, and one paper intent.
2. Replay the identical bytes. Expect `200/DUPLICATE` and no additional paper intent.
3. Send a strict `HTF_TIMED` BOC payload. Expect canonical model `BOC` and at most one paper intent
   for that setup.
4. Send an exact flip payload. Expect canonical model `HTF_FLIP`.
5. Send an atomic BOC/flip payload. Expect `CO_TRIGGER_SAME_EVENT`, both candidate identities, one
   entry price, and one paper intent.
6. Send a `DISCRETIONARY_5M` BOC payload. Expect `SHADOW_ONLY`,
   `BOC_DISCRETIONARY_CONTEXT_UNQUANTIFIED`, and no paper intent.
7. Query `GET /api/v1/rd-entry-decisions?limit=20`. Each setup must display rows for `BOC`,
   `DIR_CLOSE`, and `HTF_FLIP`, including waiting or blocked placeholders.
8. Query the paper summary. Confirm no setup attempt has more than one initial position.

Stop immediately on a different result. Disable v3 Pine emission and keep the paper kill switch
engaged until the mismatch is reviewed; do not “fix” smoke data in D1.

## 8. Acceptance

The rollout is accepted only when all of the following are recorded:

- local `make verify-observation` passed at the deployed commit;
- D1 is migrated through 0025;
- detector and settings digests match across source, edge, and Pine;
- the paper account and risk configuration are reviewed;
- Pine compiled, was added to the five-minute chart, and produced an actual realtime event;
- all six smoke outcomes match the sequence above;
- the console shows all three models and one selected paper position at most; and
- broker/live execution remains disabled.

## Rollback

1. Disable the TradingView v3 alert.
2. Leave version 3 rows immutable.
3. Redeploy the previous edge/console release if necessary.
4. Do not delete migration 0024, migration 0025, or historical paper intents.

Keep the reviewed hashes and failed smoke evidence for diagnosis. Rollback does not authorize
editing or deleting audit facts.
