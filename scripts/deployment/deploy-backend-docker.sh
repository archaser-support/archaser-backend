#!/usr/bin/env bash

# Ubuntu /bin/sh is dash. `set -o pipefail` is bash-only, so re-exec if
# this file was started with `sh scripts/deployment/deploy-backend-docker.sh`.
if [ -z "${BASH_VERSION:-}" ]; then
    exec /usr/bin/env bash "$0" "$@"
fi

set -euo pipefail

usage() {
    cat <<'EOF'
Usage:
  bash scripts/deployment/deploy-backend-docker.sh --env <staging|production> [options]

Options:
  --env <name>         Required. One of: staging, production
  --app-dir <path>     Backend checkout on EC2
                       (default: /home/ubuntu/api for staging, /home/ubuntu/production for production)
  --skip-install       Skip npm ci
  --skip-build         Skip backend workspace builds
  --skip-git-pull      Skip git fetch + reset to origin (use if you already synced)
  --no-grafana         Skip monitoring stack compose
  --skip-prisma        Skip npm run setup (prisma generate + sync-prisma-client)
  -h, --help           Show this help

Examples:
  bash scripts/deployment/deploy-backend-docker.sh --env staging
  bash scripts/deployment/deploy-backend-docker.sh --env production --no-grafana
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

host_mem_mb() {
    awk '/MemTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || echo 0
}

host_swap_mb() {
    awk '/SwapTotal:/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || echo 0
}

# t3.small/t3.micro OOM-kills a full workspace `npm ci`. Add 2G swap when RAM is low.
ensure_deploy_swap() {
    if [[ ! -r /proc/meminfo ]]; then
        return 0
    fi
    local mem_mb swap_mb
    mem_mb="$(host_mem_mb)"
    swap_mb="$(host_swap_mb)"
    log "Host memory: ${mem_mb}MB RAM, ${swap_mb}MB swap"
    if (( mem_mb >= 3072 || swap_mb >= 1024 )); then
        return 0
    fi
    local swapfile="/swapfile.archaser-deploy"
    if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true 2>/dev/null; then
        echo "Warning: ${mem_mb}MB RAM and ${swap_mb}MB swap — npm ci may be OOM-killed."
        echo "Add swap, then re-run:"
        echo "  sudo fallocate -l 2G $swapfile && sudo chmod 600 $swapfile && sudo mkswap $swapfile && sudo swapon $swapfile"
        return 0
    fi
    if [[ ! -f "$swapfile" ]]; then
        log "Low RAM — creating 2G swap at $swapfile"
        sudo fallocate -l 2G "$swapfile" || sudo dd if=/dev/zero of="$swapfile" bs=1M count=2048 status=none
        sudo chmod 600 "$swapfile"
        sudo mkswap "$swapfile" >/dev/null
    fi
    sudo swapon "$swapfile" 2>/dev/null || true
    log "Host memory after swap: $(host_mem_mb)MB RAM, $(host_swap_mb)MB swap"
}

DOCKER=(docker)

# ubuntu is often not in the docker group yet. Use passwordless sudo when the socket is denied.
resolve_docker_cli() {
    if docker info >/dev/null 2>&1; then
        DOCKER=(docker)
        return 0
    fi
    if command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; then
        log "Docker socket not writable by this user — using sudo docker"
        DOCKER=(sudo -n docker)
        return 0
    fi
    echo "Error: cannot talk to the Docker daemon (permission denied on /var/run/docker.sock)."
    echo "Add this user to the docker group and start a new SSH session:"
    echo "  sudo usermod -aG docker \"\$USER\""
    echo "Then log out and back in, or run: newgrp docker"
    exit 1
}

docker_compose() {
    "${DOCKER[@]}" compose "$@"
}

monitoring_stack_exists() {
    "${DOCKER[@]}" ps -a --format '{{.Names}}' 2>/dev/null | grep -qx 'archaser-loki'
}

# EC2 checkout must match remote before build. Without this, `npm run build` compiles stale sources.
sync_git_checkout() {
    if [[ "$SKIP_GIT_PULL" == "true" ]]; then
        log "Skipping git sync (--skip-git-pull)"
        return 0
    fi
    if [[ ! -d "$ROOT_DIR/.git" ]]; then
        log "Not a git checkout — skipping git sync"
        return 0
    fi

    log "Syncing git checkout"
    cd "$ROOT_DIR"

    if [[ -f "$ENV_SOURCE" ]]; then
        set -a
        # shellcheck disable=SC1090
        source "$ENV_SOURCE"
        set +a
    fi

    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
        local remote_url path
        remote_url="$(git remote get-url origin 2>/dev/null || true)"
        if [[ "$remote_url" == https://github.com/* && "$remote_url" != *"${GITHUB_TOKEN}"* ]]; then
            path="${remote_url#https://}"
            path="${path#*@}"
            git remote set-url origin "https://${GITHUB_TOKEN}@${path}"
        fi
    fi

    git fetch origin
    local branch
    branch="$(git rev-parse --abbrev-ref HEAD)"
    if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
        git reset --hard "origin/$branch"
        log "Git at origin/$branch ($(git rev-parse --short HEAD))"
    else
        echo "Warning: origin/$branch not found — continuing with current checkout"
    fi
}

npm_ci_low_memory() {
    local mem_mb heap_mb
    mem_mb="$(host_mem_mb)"
    heap_mb=768
    if (( mem_mb > 0 && mem_mb < 2048 )); then
        heap_mb=512
    elif (( mem_mb >= 4096 )); then
        heap_mb=2048
    fi
    log "npm ci (heap ${heap_mb}MB, maxsockets 1, ignore-scripts)"
    # Ignore scripts so prisma/husky do not spawn extra Node during peak install.
    # Prisma generate still runs later in this script.
    NODE_OPTIONS="--max-old-space-size=${heap_mb}" \
        npm ci --no-audit --no-fund --maxsockets 1 --ignore-scripts
}

ENVIRONMENT=""
APP_DIR=""
SKIP_INSTALL="false"
SKIP_BUILD="false"
SKIP_GIT_PULL="false"
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
        --skip-git-pull)
            SKIP_GIT_PULL="true"
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
    if [[ "$ENVIRONMENT" == "staging" ]]; then
        APP_DIR="/home/ubuntu/api"
    else
        APP_DIR="/home/ubuntu/production"
    fi
fi

# Split-repo checkout (staging EC2: /home/ubuntu/api) or nested backend/ under a parent root.
if [[ -f "$APP_DIR/docker-compose.backend.$ENVIRONMENT.yml" ]]; then
    ROOT_DIR="$APP_DIR"
    BACKEND_DIR="$APP_DIR"
elif [[ -f "$APP_DIR/backend/docker-compose.backend.$ENVIRONMENT.yml" ]]; then
    ROOT_DIR="$APP_DIR"
    BACKEND_DIR="$APP_DIR/backend"
else
    echo "Error: app dir not found or missing compose file: $APP_DIR"
    exit 1
fi

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
resolve_docker_cli

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
ensure_deploy_swap
sync_git_checkout

log "Preparing env files"
cp "$ENV_SOURCE" "$ENV_TARGET"
cp "$ENV_SOURCE" "$ROOT_DIR/.env"

if [[ "$SKIP_INSTALL" != "true" ]]; then
    log "Installing dependencies (npm ci)"
    npm_ci_low_memory
else
    log "Skipping npm ci (--skip-install)"
fi

# npm ci uses --ignore-scripts (also set in .npmrc). Run setup before workspace tsc.
if [[ "$SKIP_PRISMA" != "true" ]]; then
    log "Running backend setup (prisma generate + sync-prisma-client)"
    (cd "$BACKEND_DIR" && npm run setup)
else
    log "Skipping backend setup (--skip-prisma)"
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
    log "Building backend workspaces"
    npm run build -w @archaser/database
    npm run build -w @archaser/auth
    npm run build -w @archaser/sms-send
    npm run build -w @archaser/credit-insurance-domain
    # billing-connector before cron-jobs (cron-jobs imports @archaser/billing-connector)
    npm run build -w @archaser/billing-connector
    npm run build -w @archaser/cron-jobs
    npm run build -w @archaser/api
    npm run build -w @archaser/worker
    npm run build -w @archaser/sms
    npm run build -w @archaser/connectors
    npm run build -w @archaser/reports
else
    log "Skipping backend builds (--skip-build)"
fi

log "Starting backend stack (Nest + Redis + worker/sms/connectors/reports)"
# --force-recreate: bind-mounted dist/ and env_file values apply only after container recreate.
# Without it, `up -d` leaves old Node processes running when compose config is unchanged.
BACKEND_HOST_DIR="$BACKEND_DIR" docker_compose \
    --project-name "$BACKEND_PROJECT" \
    --env-file "$ENV_TARGET" \
    -f "$COMPOSE_BACKEND" \
    up -d --remove-orphans --force-recreate

if [[ "$NO_GRAFANA" != "true" ]]; then
    if [[ ! -f "$COMPOSE_MONITORING" ]]; then
        log "Monitoring compose not found; skipping"
    else
        # Always `up -d` so compose/config changes (Loki schema, datasources, root URL) apply.
        # Name conflicts happen when an earlier `docker compose` used a different --project-name.
        log "Starting/updating monitoring stack (Grafana + Loki + Prometheus + Promtail)"
        for c in archaser-loki archaser-grafana archaser-grafana-db archaser-prometheus archaser-promtail; do
            "${DOCKER[@]}" rm -f "$c" >/dev/null 2>&1 || true
        done
        MONITORING_ENV_VARS=(MONITORING_ENV="$ENVIRONMENT")
        if [[ "$ENVIRONMENT" == "staging" ]]; then
            MONITORING_ENV_VARS+=(
                GRAFANA_ROOT_URL="${GRAFANA_ROOT_URL:-https://grafana.staging.archaser.com/}"
                GRAFANA_DOMAIN="${GRAFANA_DOMAIN:-grafana.staging.archaser.com}"
            )
        elif [[ "$ENVIRONMENT" == "production" ]]; then
            MONITORING_ENV_VARS+=(
                GRAFANA_ROOT_URL="${GRAFANA_ROOT_URL:-https://grafana.portal.archaser.com/}"
                GRAFANA_DOMAIN="${GRAFANA_DOMAIN:-grafana.portal.archaser.com}"
            )
        fi
        if ! env "${MONITORING_ENV_VARS[@]}" docker_compose \
            --project-name "$MONITORING_PROJECT" \
            --env-file "$ENV_TARGET" \
            -f "$COMPOSE_MONITORING" \
            up -d --remove-orphans; then
            echo "Warning: monitoring stack failed to start; Nest stack is already up."
            if monitoring_stack_exists; then
                log "Partial monitoring containers still present — check: docker logs archaser-loki"
            fi
        fi
    fi
else
    log "Skipping monitoring stack (--no-grafana)"
fi

log "Backend stack status"
BACKEND_HOST_DIR="$BACKEND_DIR" docker_compose \
    --project-name "$BACKEND_PROJECT" \
    --env-file "$ENV_TARGET" \
    -f "$COMPOSE_BACKEND" \
    ps

if [[ "$NO_GRAFANA" != "true" ]]; then
    log "Monitoring stack status"
    "${DOCKER[@]}" ps --filter "name=archaser-loki" --filter "name=archaser-grafana" --filter "name=archaser-prometheus" --filter "name=archaser-promtail"
fi

log "Deployment complete"
if [[ "$ENVIRONMENT" == "staging" ]]; then
    log "Staging reverse proxy: bash scripts/deployment/setup-staging-nginx.sh [--with-monitoring]"
    log "Grafana URL: https://grafana.staging.archaser.com (containers on 127.0.0.1:3200)"
    log "Do not run deploy-staging.sh (Next UI) on this box"
fi
