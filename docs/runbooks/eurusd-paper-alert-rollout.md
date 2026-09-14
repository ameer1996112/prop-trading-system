# Runbook: EURUSD paper-alert ingress

## Safety boundary

This rollout accepts one EURUSD five-minute TradingView observation only. It is
not a trade, an order, or a request to MT5. Do not change MT5, broker,
WebRequest, or Algo Trading settings. Keep
`RD_EXECUTION_CANDIDATE_EMISSION_ENABLED=false`,
`RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED=false`, and
`RD_EXECUTION_RECEIVER_MANIFEST_SHA256=INERT_NOT_CONFIGURED`.

The MT5 DRY_RUN health Worker and dashboard are independent. This procedure
must never send an observation or command to them.

## Scope

- One TradingView chart: EURUSD, five minutes.
- One reviewed Pine alert using **Any alert() function call**.
- One Cloudflare observation Worker:
  `https://prop-trading-observation-edge.ameer-1996112.workers.dev`.
- Receipt-only observation storage and visibility.

No additional pair is allowed until this runbook has a successful full-session
evidence report.

## 1. Local release preflight

Use a clean worktree on the reviewed branch:

```sh
cd apps/observation-edge
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run lint
npm run typecheck
npm run build
npx wrangler secret list
```

All local checks must pass. The remote protected-binding listing must contain these names
and must never print their values:

```text
TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256
PAPER_LEDGER_ADMIN_CREDENTIAL_SHA256
RD_ENTRY_V3_DETECTOR_CODE_HASH
RD_ENTRY_V3_SETTINGS_HASH
RD_ENTRY_V3_SETTINGS_HASHES_JSON
```

Verify the fixed non-execution configuration before any remote mutation:

```sh
node -e 'const fs=require("node:fs");const c=fs.readFileSync("wrangler.jsonc","utf8");for(const x of ["\"TRADINGVIEW_OBSERVATION_INGRESS_ENABLED\": \"true\"","\"RD_EXECUTION_CANDIDATE_EMISSION_ENABLED\": \"false\"","\"RD_EXECUTION_CANDIDATE_DISPATCH_ENABLED\": \"false\"","\"RD_EXECUTION_RECEIVER_MANIFEST_SHA256\": \"INERT_NOT_CONFIGURED\""])if(!c.includes(x))throw new Error(`missing ${x}`);console.log("paper-only configuration verified")'
```

Expected output:

```text
paper-only configuration verified
```

Stop if a required protected-binding name is missing or any safety value differs.

## 2. Dedicated TradingView credential

Create a new high-entropy credential and keep its raw value only in the
reviewed TradingView script input. Do not put it in Git, D1, Cloudflare
variables, screenshots, logs, or a command line.

Compute its lower-case SHA-256 digest locally without echoing the raw value:

```sh
read -rs -p 'TradingView credential: ' tv_credential; printf '\n'; printf %s "$tv_credential" | shasum -a 256; unset tv_credential
```

With explicit remote-mutation approval, set the digest as the protected value
using Wrangler's interactive prompt:

```sh
cd apps/observation-edge
npx wrangler secret put TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256
```

Paste the digest, never the raw credential, when prompted.

## 3. Deploy the observation Worker

With separate deployment approval, inspect migrations first:

```sh
cd apps/observation-edge
npx wrangler d1 migrations list DB --remote
```

Apply only migrations reported as pending:

```sh
npm run db:migrate:remote
```

Build the existing operations console and deploy the existing observation
Worker:

```sh
cd ../operations-console
npm ci --ignore-scripts --no-audit --no-fund
npm run build
cd ../observation-edge
npm run deploy
```

Verify the result is observation-only:

```sh
curl -sS https://prop-trading-observation-edge.ameer-1996112.workers.dev/health/live
```

The JSON must include all of these values:

```json
{
  "status": "ALIVE",
  "mode": "OBSERVATION_ONLY",
  "execution": "DISABLED"
}
```

Stop if any value differs.

## 4. Create one EURUSD TradingView alert

Before creation, record the exact chart ticker ID, feed, timezone, all inputs,
and five-minute timeframe. Hash the reviewed Pine bytes:

```sh
shasum -a 256 scripts/pinescript/SND_RD_5M_V3_THREE_ENTRY_LAB.pine
```

In TradingView:

1. Open the reviewed EURUSD five-minute chart.
2. Add the reviewed Pine script with the dedicated raw credential in its input.
3. Create one alert with **Condition: Any alert() function call**.
4. Set the webhook URL to:

   ```text
   https://prop-trading-observation-edge.ameer-1996112.workers.dev/api/v1/tradingview/observations
   ```

5. Leave TradingView's message body managed by the reviewed Pine `alert()`
   function. Do not paste a replacement JSON body.
6. Capture only a redacted screenshot showing the ticker, timeframe, alert
   condition, and redacted destination structure.

Do not create another alert or alert for another pair.

## 5. Verify receipt-only behavior

After a genuine TradingView event, review the receipt endpoint or operations
console:

```sh
curl -sS 'https://prop-trading-observation-edge.ameer-1996112.workers.dev/api/v1/observation-receipts?limit=20'
```

Required evidence:

- a EURUSD `202/RECEIVED` receipt;
- an idempotent `200/DUPLICATE` result from the platform retry of the same
  event, or existing local replay-fixture proof if no production retry occurs;
- current receipt freshness; and
- the health endpoint still reports `execution: "DISABLED"`.

Never handcraft or replay a production payload manually. A `401`, `409`, or
missing current receipt is a stop condition. It does not justify retrying to
MT5, enabling candidates, or adding another pair.

## 6. Full-session decision

Observe one active market session. Mark the redacted evidence report
`VERIFIED` only if receipt freshness remains current, outcomes are explainable,
and the Worker remains observation-only. Otherwise mark it `NOT_PROVEN` with a
redacted failure class and leave the single-pair configuration unchanged.
