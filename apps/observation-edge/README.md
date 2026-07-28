# Observation Edge

Zero-cost-targeted Cloudflare Workers Free ingress for TradingView LAB
observations. It stores receipt metadata in D1 and serves the statically exported
operations console. It has no broker, account, order, or trade-execution route.

## Safety contract

- Ingress is disabled unless `TRADINGVIEW_OBSERVATION_INGRESS_ENABLED` is exactly
  `true` and the credential digest secret is a lowercase SHA-256 value.
- The ingress digest, paper-admin digest, reviewed detector digest, and reviewed
  settings digest are required Worker secrets. `wrangler.jsonc` declares their
  names under `secrets.required` and never supplies plaintext or empty values
  under `vars`.
- Request bodies are bounded before JSON parsing.
- JSON duplicate keys, invalid UTF-8, non-finite values, unsafe integers,
  unexpected fields, corrupt identifiers, invalid market geometry, and
  non-causal epochs are rejected.
- D1 stores only receipt metadata and a canonical payload SHA-256. It never
  stores raw credentials or raw payloads.
- A unique `idempotency_key` plus `INSERT OR IGNORE` provides atomic replay
  handling without paid D1 Sessions.

## Local verification

```sh
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

Apply the migration to a local D1 database with:

```sh
npm run db:migrate:local
```

## One-time deployment setup

Create a D1 database on the Cloudflare Free plan, replace the placeholder
`database_id` in `wrangler.jsonc`, then apply the migration:

```sh
npx wrangler d1 create prop-trading-observations
npm run db:migrate:remote
```

Hash newly generated ingress and paper-admin credentials locally. Configure
their digests and the two reviewed contract-v3 identity digests as Worker
secrets. Use an owner-only JSON file outside the repository and pass it only
through standard input:

```sh
npx wrangler secret bulk < /absolute/owner-only/path/worker-secrets.json
npx wrangler secret list
```

This remote mutation requires explicit operator approval and creates a Worker
deployment. The list must contain all four names declared in
`secrets.required`; it never reveals their values. Follow the effective
reviewed-hash verification sequence in
[`docs/runbooks/rd-three-entry-paper-rollout.md`](../../docs/runbooks/rd-three-entry-paper-rollout.md)
before enabling contract-v3 Pine emission.

After the secrets and database binding exist, set
`TRADINGVIEW_OBSERVATION_INGRESS_ENABLED` to `true`, export the operations
console into `../operations-console/out`, and run `npm run deploy`. The
`workers_dev` hostname is stable because preview URLs are disabled.
