#!/bin/sh
set -eu

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
temporary_root=$(mktemp -d "${TMPDIR:-/tmp}/phase0-container-smoke.XXXXXX")
secret_file="$temporary_root/postgres_password.txt"
project_name="phase0_verify_$$"
api_port=$((20000 + ($$ % 5000)))
console_port=$((30000 + ($$ % 5000)))
postgres_port=$((40000 + ($$ % 5000)))

umask 077
printf '%s\n' 'ephemeral-phase0-smoke-password' > "$secret_file"
export POSTGRES_PASSWORD_FILE="$secret_file"
export PHASE0_API_PORT="$api_port"
export PHASE0_CONSOLE_PORT="$console_port"
export PHASE0_POSTGRES_PORT="$postgres_port"

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
grep -q 'SERVER_API' "$temporary_root/console.html"
grep -q 'BLOCKED' "$temporary_root/console.html"
grep -q 'Refresh cadence: 30 seconds' "$temporary_root/console.html"

uv run python "$repository_root/scripts/database_smoke.py" \
  --port "$postgres_port" \
  --password-file "$secret_file" \
  --evidence "$repository_root/evidence/phase0/evidence-registry.json"

echo "container smoke: bounded image build/startup, migration/exact ledger proof, live=200, readiness=503/BLOCKED, runtime console=SERVER_API/BLOCKED with polling"
