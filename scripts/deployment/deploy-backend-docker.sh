#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage:
  bash backend/scripts/deployment/deploy-backend-docker.sh --env <staging|production> [options]

Options:
  --env <name>         Required. One of: staging, production
  --app-dir <path>     Deploy root on EC2 (default: /home/ubuntu/<env>)
  --skip-install       Skip npm ci
  --skip-build         Skip backend workspace builds
  --no-grafana         Skip monitoring stack compose
  --skip-prisma        Skip prisma generate + sync-prisma-client
  -h, --help           Show this help

Examples:
  bash backend/scripts/deployment/deploy-backend-docker.sh --env staging
  bash backend/scripts/deployment/deploy-backend-docker.sh --env production --no-grafana
EOF
}

require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" >/dev/null 2>&1; then
        echo "Error: '$cmd' is required but not installed."
        exit 1
    fi
}

log() {
    printf "\n==> %s\n" "$1"
}

ENVIRONMENT=""
APP_DIR=""
SKIP_INSTALL="false"
SKIP_BUILD="false"
NO_GRAFANA="false"
SKIP_PRISMA="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --env)
            ENVIRONMENT="${2:-}"
            shift 2
            ;;
        --app-dir)
            APP_DIR="${2:-}"
            shift 2
            ;;
        --skip-install)
            SKIP_INSTALL="true"
            shift
            ;;
        --skip-build)
            SKIP_BUILD="true"
            shift
            ;;
        --no-grafana)
            NO_GRAFANA="true"
            shift
            ;;
        --skip-prisma)
            SKIP_PRISMA="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1"
            usage
            exit 1
            ;;
    esac
done

if [[ -z "$ENVIRONMENT" ]]; then
    echo "Error: --env is required."
    usage
    exit 1
fi

if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    echo "Error: --env must be 'staging' or 'production'."
    exit 1
fi

if [[ -z "$APP_DIR" ]]; then
    APP_DIR="/home/ubuntu/$ENVIRONMENT"
fi

ROOT_DIR="$APP_DIR"
BACKEND_DIR="$ROOT_DIR/backend"
ENV_SOURCE="$BACKEND_DIR/.env.$ENVIRONMENT"
ENV_TARGET="$BACKEND_DIR/.env"
COMPOSE_BACKEND="$BACKEND_DIR/docker-compose.backend.$ENVIRONMENT.yml"
COMPOSE_MONITORING="$BACKEND_DIR/grafana/docker-compose.logging.yml"

PROJECT_SUFFIX=""
if [[ "$ENVIRONMENT" == "staging" ]]; then
    PROJECT_SUFFIX="-staging"
fi
BACKEND_PROJECT="archaser-backend$PROJECT_SUFFIX"
MONITORING_PROJECT="archaser-monitoring$PROJECT_SUFFIX"

require_cmd docker
require_cmd npm

if [[ ! -d "$ROOT_DIR" ]]; then
    echo "Error: app dir not found: $ROOT_DIR"
    exit 1
fi

if [[ ! -f "$COMPOSE_BACKEND" ]]; then
    echo "Error: backend compose not found: $COMPOSE_BACKEND"
    exit 1
fi

if [[ ! -f "$ENV_SOURCE" ]]; then
    echo "Error: expected env file missing: $ENV_SOURCE"
    exit 1
fi

cd "$ROOT_DIR"
log "Deploy root: $ROOT_DIR"

log "Preparing env files"
cp "$ENV_SOURCE" "$ENV_TARGET"
cp "$ENV_SOURCE" "$ROOT_DIR/.env"

if [[ "$SKIP_INSTALL" != "true" ]]; then
    log "Installing dependencies (npm ci)"
    npm ci --no-audit
else
    log "Skipping npm ci (--skip-install)"
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
    log "Building backend workspaces"
    npm run build -w @archaser/database
    npm run build -w @archaser/api
    npm run build -w @archaser/worker
    npm run build -w @archaser/sms
    npm run build -w @archaser/connectors
    npm run build -w @archaser/reports
else
    log "Skipping backend builds (--skip-build)"
fi

if [[ "$SKIP_PRISMA" != "true" ]]; then
    log "Generating Prisma client"
    npx prisma generate --schema=backend/prisma/schema.prisma
    node backend/scripts/sync-prisma-client.js
else
    log "Skipping prisma generate (--skip-prisma)"
fi

log "Starting backend stack (Nest + Redis + worker/sms/connectors/reports)"
docker compose \
    --project-name "$BACKEND_PROJECT" \
    --env-file "$ENV_TARGET" \
    -f "$COMPOSE_BACKEND" \
    up -d --remove-orphans

if [[ "$NO_GRAFANA" != "true" ]]; then
    if [[ -f "$COMPOSE_MONITORING" ]]; then
        log "Starting monitoring stack (Grafana + Loki + Prometheus + Promtail)"
        MONITORING_ENV="$ENVIRONMENT" docker compose \
            --project-name "$MONITORING_PROJECT" \
            --env-file "$ENV_TARGET" \
            -f "$COMPOSE_MONITORING" \
            up -d --remove-orphans
    else
        log "Monitoring compose not found; skipping"
    fi
else
    log "Skipping monitoring stack (--no-grafana)"
fi

log "Backend stack status"
docker compose \
    --project-name "$BACKEND_PROJECT" \
    --env-file "$ENV_TARGET" \
    -f "$COMPOSE_BACKEND" \
    ps

if [[ "$NO_GRAFANA" != "true" && -f "$COMPOSE_MONITORING" ]]; then
    log "Monitoring stack status"
    MONITORING_ENV="$ENVIRONMENT" docker compose \
        --project-name "$MONITORING_PROJECT" \
        --env-file "$ENV_TARGET" \
        -f "$COMPOSE_MONITORING" \
        ps
fi

log "Deployment complete"
