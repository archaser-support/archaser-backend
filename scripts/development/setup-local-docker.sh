#!/usr/bin/env bash
# Start local Postgres + Mongo (+ Redis) in Docker for Archaser development.
#
# Usage (from backend/):
#   bash ./scripts/development/setup-local-docker.sh deps      # default
#   bash ./scripts/development/setup-local-docker.sh down
#   bash ./scripts/development/setup-local-docker.sh status
#   bash ./scripts/development/setup-local-docker.sh urls
#
# Run Nest + Next on the host after deps are up:
#   npm run dev:all          # backend/
#   npm run dev              # frontend/
#
# Windows: prefer Git Bash / WSL, or use setup-local-docker.ps1

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="$ROOT/docker-compose.local-dev.yml"
PROJECT="archaser-local-dev"

PG_USER="${LOCAL_POSTGRES_USER:-archaser}"
PG_PASS="${LOCAL_POSTGRES_PASSWORD:-archaser}"
PG_DB="${LOCAL_POSTGRES_DB:-archaser}"
PG_PORT="${LOCAL_POSTGRES_PORT:-5432}"
MONGO_PORT="${LOCAL_MONGO_PORT:-27017}"
MONGO_DB="${LOCAL_MONGO_DB:-archaser_local}"
REDIS_PORT="${LOCAL_REDIS_PORT:-6379}"

color() {
    local code="$1"
    shift
    printf '\033[%sm%s\033[0m' "$code" "$*"
}

die() {
    echo "$(color 31 "ERROR:") $*" >&2
    exit 1
}

need_docker() {
    command -v docker >/dev/null 2>&1 || die "Docker is not installed or not on PATH"
    docker info >/dev/null 2>&1 || die "Docker daemon is not running"
    docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (docker compose)"
}

compose() {
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"
}

print_urls() {
    echo ""
    echo "$(color 34 "Host connection strings (put these in backend .env):")"
    echo "  DATABASE_URL=postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:${PG_PORT}/${PG_DB}?schema=public"
    echo "  MONGODB_URI=mongodb://127.0.0.1:${MONGO_PORT}/${MONGO_DB}"
    echo "  REDIS_URL=redis://127.0.0.1:${REDIS_PORT}"
    echo ""
    echo "$(color 34 "Containers:")"
    echo "  Postgres  localhost:${PG_PORT}"
    echo "  Mongo     localhost:${MONGO_PORT}"
    echo "  Redis     localhost:${REDIS_PORT}"
    echo ""
    echo "Example file: env.local-docker.example"
    echo "Apply schema yourself (when ready): npx prisma db push"
    echo ""
    echo "$(color 34 "Then run apps on the host:")"
    echo "  npm run dev:all          # backend/"
    echo "  npm run dev              # frontend/"
    echo ""
}

cmd_deps() {
    need_docker
    [[ -f "$COMPOSE_FILE" ]] || die "Missing $COMPOSE_FILE"
    echo "$(color 34 "Starting local Postgres + Mongo + Redis...")"
    compose up -d postgres mongo redis
    echo "$(color 34 "Waiting for healthchecks...")"
    compose up -d --wait postgres mongo redis
    echo "$(color 32 "Local data stores are up.")"
    print_urls
}

cmd_down() {
    need_docker
    echo "$(color 34 "Stopping local docker stack (volumes kept)...")"
    compose down
    echo "$(color 32 "Stopped.")"
    echo "To delete data volumes too: docker compose -p $PROJECT -f docker-compose.local-dev.yml down -v"
}

cmd_status() {
    need_docker
    compose ps
}

usage() {
    sed -n '2,15p' "$0"
}

ACTION="${1:-deps}"
case "$ACTION" in
    deps | up) cmd_deps ;;
    down | stop) cmd_down ;;
    status | ps) cmd_status ;;
    urls) print_urls ;;
    -h | --help | help) usage ;;
    *)
        usage
        die "Unknown command: $ACTION"
        ;;
esac
