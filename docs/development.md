# Development and verification

## Supported toolchain

- Python 3.12, pinned by `.python-version`, with dependencies resolved in `uv.lock`.
- Node 22, pinned by `.nvmrc`, with dependencies resolved in
  `apps/operations-console/package-lock.json`.
- Docker Compose for local PostgreSQL, API, and operations-console containers.

`make bootstrap` installs exactly the locked dependency graphs. `make format` applies Python
formatting. `make verify-phase0` is the complete proof and does not require a provider credential,
provider account, provider call, or legacy-repository checkout. Its container category builds both
production images and starts an isolated local Compose project with an ephemeral local PostgreSQL
password file; the trap removes its containers and volume.

The general secret scan excludes only generated caches and its own narrow baseline. Audited false positives are
matched by path, detector type, and hashed candidate in `.secrets.baseline`; there are no broad
whole-line vocabulary exclusions. A regression test plants credentials on lines containing both
`sha256` and the managed-secret provider name and proves they remain detectable. Both lockfiles
also pass a dedicated authenticated-registry URL scanner for userinfo and credential query keys.

## Local services

Create `config/local/postgres_password.txt` locally with mode `0600`; that directory is ignored.
Set `POSTGRES_PASSWORD_FILE` to that absolute path and run `docker compose up --build`. The
one-shot `migrate` service runs `alembic upgrade head` before the API starts. The API deliberately
reports readiness with HTTP 503 and `BLOCKED`; liveness
only proves the process is serving. The console labels absent API configuration `UNCONFIGURED`
and an unreachable API `API_UNAVAILABLE`; malformed API state is `API_INVALID`. The production
home route is forced dynamic so `PHASE0_API_BASE_URL` is read by the server at request time.
The open console asks that dynamic server route for a fresh snapshot every 30 seconds, cleans up
its timer on unmount, and keeps the last fail-closed snapshot visible while refreshing.

The real container smoke has explicit pull/build/startup/cleanup time bounds. It migrates a fresh
PostgreSQL volume, exercises the typed evidence append repository as `phase0_runtime`, compares
the database-generated exact-byte SHA-256/JSON projection, and proves forged direct insertion and
UPDATE/DELETE/TRUNCATE attempts fail.

The only Phase 0 endpoints are:

- `GET /health/live`
- `GET /health/readiness`
- `GET /api/v1/phase0/gates`

There is no external-ingress endpoint and no broker or account-management endpoint.

## Generated contracts

The JSON schemas, golden vectors, evidence registry, and gate report are committed outputs.
Their builders have `--check` modes and are run by the proof. Deliberate contract changes require
regeneration and review; a generated diff is part of the change.

JSON Schema alone does not implement cross-record, digest, real-calendar, ordering, or derived
eligibility rules. See `contracts/README.md`; safety consumers must use the typed validator and
canonical digest checks.

## Remaining supply-chain limitation

Locks, secret scanning, deterministic tests, and actual image builds are proven. This slice does
not claim the full PLAN platform/supply-chain gate: no offline vulnerability database or pinned
container-image digest set was approved for this build, so a deterministic CVE verdict and base
image provenance attestation remain external work. Image tags are pinned but not digest-pinned.

The optional local legacy comparison is:

```sh
uv run python tools/evidence_inventory.py check-source \
  --inventory evidence/inventory.json \
  --source-root /Users/ameeramer/dev/projects/galilsoftware/sources/trading
```

It reads only the explicit allowlist. It never stages, stashes, cleans, or writes the source repo.
