#!/usr/bin/env bash
# Start every local Nest microservice together:
#   api :3002, worker :3003, sms :3004, connectors :3005, reports :3006
#
# Usage (from backend/):
#   npm run dev:all
#   bash ./scripts/startup/dev-microservices.sh
#   bash ./scripts/startup/dev-microservices.sh --skip-redis
#
# Ctrl+C stops all child processes.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SKIP_REDIS=0
for arg in "$@"; do
    case "$arg" in
        --skip-redis) SKIP_REDIS=1 ;;
        -h | --help)
            sed -n '2,12p' "$0"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 1
            ;;
    esac
done

export FORCE_NEST_DEV=1
export NODE_ENV=development
export NEST_PORT="${NEST_PORT:-3002}"
export WORKER_PORT="${WORKER_PORT:-3003}"
export SMS_PORT="${SMS_PORT:-3004}"
export CONNECTORS_PORT="${CONNECTORS_PORT:-3005}"
export REPORTS_PORT="${REPORTS_PORT:-3006}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export SMS_SERVICE_URL="${SMS_SERVICE_URL:-http://127.0.0.1:${SMS_PORT}}"
export CONNECTORS_SERVICE_URL="${CONNECTORS_SERVICE_URL:-http://127.0.0.1:${CONNECTORS_PORT}}"
export REPORTS_SERVICE_URL="${REPORTS_SERVICE_URL:-http://127.0.0.1:${REPORTS_PORT}}"

PIDS=()

color() {
    local code="$1"
    shift
    printf '\033[%sm%s\033[0m' "$code" "$*"
}

prefix_logs() {
    local name="$1"
    local code="$2"
    while IFS= read -r line || [[ -n "$line" ]]; do
        printf '%s %s\n' "$(color "$code" "[$name]")" "$line"
    done
}

kill_tree() {
    local pid="$1"
    if ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    local children
    children="$(pgrep -P "$pid" 2>/dev/null || true)"
    if [[ -n "$children" ]]; then
        while read -r child; do
            [[ -n "$child" ]] && kill_tree "$child"
        done <<<"$children"
    fi
    kill "$pid" 2>/dev/null || true
}

cleanup() {
    trap - EXIT INT TERM
    echo ""
    echo "$(color 33 "Stopping microservices...")"
    for pid in "${PIDS[@]:-}"; do
        kill_tree "$pid"
    done
    sleep 0.4
    for pid in "${PIDS[@]:-}"; do
        kill -9 "$pid" 2>/dev/null || true
    done
}

trap cleanup EXIT INT TERM

port_in_use() {
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

ensure_redis() {
    if [[ "$SKIP_REDIS" == "1" ]]; then
        echo "$(color 33 "Skipping Redis")"
        return 0
    fi
    if port_in_use 6379; then
        echo "$(color 32 "Redis already listening on 6379")"
        return 0
    fi
    if ! command -v docker >/dev/null 2>&1; then
        echo "$(color 33 "Docker not found; start Redis yourself on 6379")"
        return 0
    fi
    echo "Starting Redis via docker-compose.redis.yml..."
    docker compose -f "$ROOT/docker-compose.redis.yml" up -d
}

compile_nocheck() {
    local dir="$1"
    local tsconfig="$2"
    echo "$(color 34 "Compiling ${dir} (emit despite type errors)...")"
    (
        cd "$ROOT/$dir"
        npx tsc -p "$tsconfig" --noEmitOnError false || true
    )
}

start_cmd() {
    local name="$1"
    local code="$2"
    local dir="$3"
    shift 3
    (
        cd "$ROOT/$dir"
        exec "$@"
    ) > >(prefix_logs "$name" "$code") 2>&1 &
    PIDS+=("$!")
}

echo "=========================================="
echo " Archaser local microservices"
echo "=========================================="
echo "  api         http://127.0.0.1:${NEST_PORT}"
echo "  worker      http://127.0.0.1:${WORKER_PORT}"
echo "  sms         http://127.0.0.1:${SMS_PORT}"
echo "  connectors  http://127.0.0.1:${CONNECTORS_PORT}"
echo "  reports     http://127.0.0.1:${REPORTS_PORT}"
echo "=========================================="

ensure_redis

for spec in \
    "api:${NEST_PORT}" \
    "worker:${WORKER_PORT}" \
    "sms:${SMS_PORT}" \
    "connectors:${CONNECTORS_PORT}" \
    "reports:${REPORTS_PORT}"; do
    name="${spec%%:*}"
    port="${spec##*:}"
    if port_in_use "$port"; then
        echo "$(color 31 "Port ${port} already in use (${name}). Stop that process first.")" >&2
        exit 1
    fi
done

compile_nocheck api tsconfig.build.json
mkdir -p "$ROOT/api/dist/email/assets"
if [[ -d "$ROOT/api/src/email/assets" ]]; then
    cp -R "$ROOT/api/src/email/assets/." "$ROOT/api/dist/email/assets/"
fi

compile_nocheck reports tsconfig.json

start_cmd api 34 api \
    env FORCE_NEST_DEV=1 NODE_ENV=development \
    node --enable-source-maps dist/main.js

start_cmd worker 32 worker \
    npx ts-node -r tsconfig-paths/register src/main.ts

start_cmd sms 35 sms \
    npx ts-node src/main.ts

start_cmd connectors 36 connectors \
    npx ts-node src/main.ts

start_cmd reports 33 reports \
    node dist/main.js

echo ""
echo "All five services launching. Ctrl+C stops them."
echo "Health: /health on each port (api includes a Postgres probe)."
echo ""

fail=0
for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
        fail=1
    fi
done
if [[ "$fail" == "1" ]]; then
    echo "$(color 31 "A service exited immediately. Scroll up for the error.")" >&2
    exit 1
fi

wait
