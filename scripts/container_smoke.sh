#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary_root_parent=${CONTAINER_SMOKE_TMPDIR:-$repository_root}
temporary_root=$(mktemp -d "$temporary_root_parent/phase0-container-smoke.XXXXXX")
# Docker Desktop/Colima receives host bind mounts, so resolve macOS's /var
# symlink before exporting this path through Compose.
temporary_root=$(CDPATH= cd -- "$temporary_root" && pwd -P)
secret_file="$temporary_root/postgres_password.txt"
project_name="phase0_verify_$$"
api_port=$((20000 + ($$ % 5000)))
console_port=$((30000 + ($$ % 5000)))
postgres_port=$((40000 + ($$ % 5000)))
observation_value='authfixture'

umask 077
printf '%s\n' 'ephemeral-phase0-smoke-password' > "$secret_file"
chmod 0444 "$secret_file"
export POSTGRES_PASSWORD_FILE="$secret_file"
export PHASE0_API_PORT="$api_port"
export PHASE0_CONSOLE_PORT="$console_port"
export PHASE0_POSTGRES_PORT="$postgres_port"
export PTS_TRADINGVIEW_OBSERVATION_INGRESS_ENABLED=true
export PTS_TRADINGVIEW_OBSERVATION_CREDENTIAL_SHA256=cb517fd9c8db7760f0a5971b6f9ea5ec3c673d3aeede59ee327c493795cbf290

compose_bounded() {
  bound_seconds=$1
  shift
  uv run python "$repository_root/scripts/run_bounded.py" --seconds "$bound_seconds" -- \
    docker compose --project-name "$project_name" --file "$repository_root/compose.yaml" "$@"
}

cleanup() {
  compose_bounded 60 down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$temporary_root"
}
trap cleanup EXIT HUP INT TERM

compose_bounded 60 config --quiet
for image in node:22.22.0-alpine python:3.12.8-slim-bookworm \
  ghcr.io/astral-sh/uv:0.11.21 postgres:17.6-alpine; do
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    uv run python "$repository_root/scripts/run_bounded.py" --seconds 120 -- docker pull "$image"
  fi
done
compose_bounded 600 build --quiet api migrate operations-console
if ! compose_bounded 180 up --detach postgres migrate api operations-console; then
  compose_bounded 60 logs --no-color || true
  exit 1
fi

attempt=0
while [ "$attempt" -lt 45 ]; do
  if curl --fail --silent --show-error --max-time 2 \
    "http://127.0.0.1:$api_port/health/live" > "$temporary_root/live.json" 2>/dev/null && \
    curl --fail --silent --show-error --max-time 3 \
    "http://127.0.0.1:$console_port/" > "$temporary_root/console.html" 2>/dev/null; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if [ "$attempt" -ge 45 ]; then
  compose_bounded 60 ps || true
  compose_bounded 60 logs --no-color || true
  echo "container smoke timed out" >&2
  exit 1
fi

readiness_status=$(curl --silent --show-error --max-time 3 \
  --output "$temporary_root/readiness.json" --write-out '%{http_code}' \
  "http://127.0.0.1:$api_port/health/readiness")
test "$readiness_status" = "503"
grep -q '"ready":false' "$temporary_root/readiness.json"
grep -q '"status":"BLOCKED"' "$temporary_root/readiness.json"
grep -q 'PAPER LAB' "$temporary_root/console.html"
grep -q 'NO EXECUTION' "$temporary_root/console.html"

observation_envelope=$(printf '%s' \
  '{"credential":"'"$observation_value"'","payload":{"schema_version":"1.0","strategy_id":"rd_liquidity_sd_5m_v1","strategy_version":"1.0.0-phase1","producer_instance_id":"container-smoke","sequence":0,"idempotency_key":"container-smoke:0","symbol":"XAUUSD","ticker_id":"OANDA:XAUUSD","feed":"OANDA","timeframe":"5","timezone":"Etc/UTC","bar_open_epoch":1710000000,"bar_close_epoch":1710000300,"detector_code_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","settings_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","kind":"snapshot","last_confirmed_bar_close_epoch":1710000300,"active_setups":[]}}')

insert_status=$(curl --silent --show-error --max-time 5 \
  --output "$temporary_root/receipt-inserted.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data "$observation_envelope" \
  "http://127.0.0.1:$api_port/api/v1/tradingview/observations")
test "$insert_status" = "202"
grep -q '"status":"RECEIVED"' "$temporary_root/receipt-inserted.json"
if grep -q "$observation_value" "$temporary_root/receipt-inserted.json"; then
  echo "observation credential leaked into receipt response" >&2
  exit 1
fi

duplicate_status=$(curl --silent --show-error --max-time 5 \
  --output "$temporary_root/receipt-duplicate.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data "$observation_envelope" \
  "http://127.0.0.1:$api_port/api/v1/tradingview/observations")
test "$duplicate_status" = "200"
grep -q '"status":"DUPLICATE"' "$temporary_root/receipt-duplicate.json"

receipt_list_status=$(curl --silent --show-error --max-time 5 \
  --output "$temporary_root/receipt-list.json" --write-out '%{http_code}' \
  "http://127.0.0.1:$api_port/api/v1/observation-receipts?limit=50")
test "$receipt_list_status" = "200"
grep -q '"mode":"OBSERVATION_ONLY"' "$temporary_root/receipt-list.json"
grep -q '"ingress_enabled":true' "$temporary_root/receipt-list.json"
grep -q '"count":1' "$temporary_root/receipt-list.json"
grep -q '"status":"RECEIVED"' "$temporary_root/receipt-list.json"

conflicting_envelope=$(printf '%s' "$observation_envelope" | sed \
  's/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc/')
conflict_status=$(curl --silent --show-error --max-time 5 \
  --output "$temporary_root/receipt-conflict.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data "$conflicting_envelope" \
  "http://127.0.0.1:$api_port/api/v1/tradingview/observations")
test "$conflict_status" = "409"
grep -q '"code":"IDEMPOTENCY_CONFLICT"' "$temporary_root/receipt-conflict.json"

invalid_credential_envelope=$(printf '%s' "$observation_envelope" | sed \
  "s/$observation_value/invalid-smoke-value/")
invalid_credential_status=$(curl --silent --show-error --max-time 5 \
  --output "$temporary_root/receipt-invalid-credential.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data "$invalid_credential_envelope" \
  "http://127.0.0.1:$api_port/api/v1/tradingview/observations")
test "$invalid_credential_status" = "401"
grep -q '"code":"INVALID_CREDENTIAL"' "$temporary_root/receipt-invalid-credential.json"

console_live_status=$(curl --silent --show-error --max-time 5 \
  --output "$temporary_root/console-live.json" --write-out '%{http_code}' \
  "http://127.0.0.1:$console_port/health/live")
test "$console_live_status" = "200"
grep -q '"status":"ALIVE"' "$temporary_root/console-live.json"

console_receipt_list_status=$(curl --silent --show-error --max-time 5 \
  --output "$temporary_root/console-receipt-list.json" --write-out '%{http_code}' \
  "http://127.0.0.1:$console_port/api/v1/observation-receipts?limit=50")
test "$console_receipt_list_status" = "200"
grep -q '"count":1' "$temporary_root/console-receipt-list.json"
grep -q '"symbol":"XAUUSD"' "$temporary_root/console-receipt-list.json"

legacy_webhook_status=$(curl --silent --show-error --max-time 3 \
  --output "$temporary_root/legacy-webhook.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data '{}' \
  "http://127.0.0.1:$api_port/webhook")
test "$legacy_webhook_status" = "404"

uv run python "$repository_root/scripts/database_smoke.py" \
  --port "$postgres_port" \
  --password-file "$secret_file" \
  --evidence "$repository_root/evidence/phase0/evidence-registry.json"

echo "container smoke: migration/role proof, live=200, readiness=503/BLOCKED, observation 202/200/409/401/listed, static console and same-origin proxy verified, no legacy webhook"
