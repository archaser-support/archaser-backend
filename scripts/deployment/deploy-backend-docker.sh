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
                       (default: /home/ubuntu/api — staging and production share one checkout)
  --skip-install       Skip npm ci
  --skip-build         Skip backend workspace builds
  --skip-git-pull      Skip git fetch + reset to origin (use if you already synced)
  --no-grafana         Skip monitoring stack compose
  --skip-prisma        Skip prisma generate + sync-prisma-client
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

# EC2 builds can OOM during npm install even on ~4GB RAM when swap is 0.
# Ensure at least 2GB swap for deploy stability.
ensure_deploy_swap() {
    if [[ ! -r /proc/meminfo ]]; then
        return 0
    fi
    local mem_mb swap_mb
    mem_mb="$(host_mem_mb)"
    swap_mb="$(host_swap_mb)"
    log "Host memory: ${mem_mb}MB RAM, ${swap_mb}MB swap"
    if (( swap_mb >= 1024 )); then
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
        log "Creating 2G deploy swap at $swapfile"
        sudo fallocate -l 2G "$swapfile" || sudo dd if=/dev/zero of="$swapfile" bs=1M count=2048 status=none
        sudo chmod 600 "$swapfile"
        sudo mkswap "$swapfile" >/dev/null
    fi
    sudo swapon "$swapfile" 2>/dev/null || true
    log "Host memory after swap: $(host_mem_mb)MB RAM, $(host_swap_mb)MB swap"
}

DOCKER=(docker)

docker_daemon_reachable() {
    docker info >/dev/null 2>&1 || \
        { command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; }
}

# EC2 deploy often runs over SSH while docker.service was never started (or stopped after OOM).
ensure_docker_daemon() {
    if docker_daemon_reachable; then
        return 0
    fi
    if command -v systemctl >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1; then
        log "Docker daemon not reachable — starting docker.service"
        sudo -n systemctl enable docker >/dev/null 2>&1 || true
        if sudo -n systemctl start docker >/dev/null 2>&1; then
            sleep 3
        fi
    fi
    if ! docker_daemon_reachable; then
        echo "Error: Docker daemon is not running (or not reachable over /var/run/docker.sock)."
        echo "On the EC2 host run: sudo systemctl enable --now docker"
        exit 1
    fi
}

# ubuntu is often not in the docker group yet. Use passwordless sudo when the socket is denied.
resolve_docker_cli() {
    ensure_docker_daemon
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

backend_compose() {
    BACKEND_HOST_DIR="$BACKEND_DIR" docker_compose \
        --project-name "$BACKEND_PROJECT" \
        --env-file "$ENV_TARGET" \
        -f "$COMPOSE_BACKEND" \
        "$@"
}

# Older manual runs used the checkout directory name (e.g. project "api") as --project-name.
# Those containers keep ports 3010/4010 until removed; compose up on archaser-backend-* then no-ops or fails.
stop_legacy_backend_projects() {
    local legacy
    for legacy in api backend archaser-backend; do
        if [[ "$legacy" == "$BACKEND_PROJECT" ]]; then
            continue
        fi
        log "Removing legacy backend compose project (if any): $legacy"
        BACKEND_HOST_DIR="$BACKEND_DIR" docker_compose \
            --project-name "$legacy" \
            --env-file "$ENV_TARGET" \
            -f "$COMPOSE_BACKEND" \
            down --remove-orphans >/dev/null 2>&1 || true
    done
}

# Bare `docker network create <project>_default` (e.g. grafana/start-*.sh) leaves the
# network without com.docker.compose.* labels. Compose then refuses `up` with:
#   network … was found but has incorrect label com.docker.compose.network …
ensure_backend_compose_network() {
    local net="${BACKEND_PROJECT}_default"
    if ! "${DOCKER[@]}" network inspect "$net" >/dev/null 2>&1; then
        return 0
    fi
    local compose_net
    compose_net="$("${DOCKER[@]}" network inspect -f '{{index .Labels "com.docker.compose.network"}}' "$net" 2>/dev/null || true)"
    if [[ "$compose_net" == "default" ]]; then
        return 0
    fi
    log "Removing mislabelled network $net so compose can recreate it"
    local cid
    for cid in $("${DOCKER[@]}" network inspect -f '{{range $id, $_ := .Containers}}{{println $id}}{{end}}' "$net" 2>/dev/null || true); do
        [[ -n "$cid" ]] || continue
        "${DOCKER[@]}" network disconnect -f "$net" "$cid" >/dev/null 2>&1 || true
    done
    "${DOCKER[@]}" network rm "$net" >/dev/null 2>&1 || true
}

recreate_backend_stack() {
    stop_legacy_backend_projects
    log "Recreating backend stack (down → up; bind-mounted dist/ and env apply only in new containers)"
    backend_compose down --remove-orphans
    ensure_backend_compose_network
    if ! backend_compose up -d --force-recreate --remove-orphans --wait; then
        log "compose --wait unavailable or timed out — bringing stack up without wait"
        backend_compose up -d --force-recreate --remove-orphans
    fi
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
    local target_branch="$ENVIRONMENT"
    if [[ "$ENVIRONMENT" == "production" ]]; then
        target_branch="main"
    fi

    if git show-ref --verify --quiet "refs/remotes/origin/$target_branch"; then
        git checkout "$target_branch" 2>/dev/null || git checkout -b "$target_branch" "origin/$target_branch"
        git reset --hard "origin/$target_branch"
        log "Git checked out and reset to origin/$target_branch ($(git rev-parse --short HEAD))"
    else
        local current_branch
        current_branch="$(git rev-parse --abbrev-ref HEAD)"
        if git show-ref --verify --quiet "refs/remotes/origin/$current_branch"; then
            git reset --hard "origin/$current_branch"
            log "Git at origin/$current_branch ($(git rev-parse --short HEAD))"
        else
            echo "Warning: origin/$target_branch not found — continuing with current checkout"
        fi
    fi
}

ensure_build_tooling() {
    export PATH="$ROOT_DIR/node_modules/.bin:$PATH"
    if [[ -x "$ROOT_DIR/node_modules/typescript/bin/tsc" ]]; then
        return 0
    fi
    log "typescript CLI missing after npm ci — installing at workspace root"
    npm install --include=dev --no-save --no-audit --no-fund --ignore-scripts typescript@^5.9.2
    export PATH="$ROOT_DIR/node_modules/.bin:$PATH"
    if [[ ! -x "$ROOT_DIR/node_modules/typescript/bin/tsc" ]]; then
        echo "Error: tsc is still missing after typescript install."
        exit 1
    fi
}

# Never `npx prisma` — unpinned npx installs Prisma 7, which rejects `url = env("DATABASE_URL")`.
# Never `npm i prisma` during generate — Prisma 6.19 auto-install OOMs (SIGKILL) on 4GB EC2.
generate_prisma_client() {
    export PATH="$ROOT_DIR/node_modules/.bin:$PATH"
    local prisma_js="$ROOT_DIR/node_modules/prisma/build/index.js"
    if [[ ! -f "$prisma_js" ]]; then
        echo "Error: prisma CLI missing after npm ci: $prisma_js"
        echo "npm ci --include=dev must install the prisma devDependency."
        exit 1
    fi
    PRISMA_GENERATE_SKIP_AUTOINSTALL=1 \
    PRISMA_SKIP_POSTINSTALL_GENERATE=1 \
    NODE_OPTIONS="--max-old-space-size=384" \
        node "$prisma_js" generate --schema="$PRISMA_SCHEMA"
}

run_workspace_build() {
    local workspace="$1"
    export PATH="$ROOT_DIR/node_modules/.bin:$PATH"
    npm run build -w "$workspace"
}

npm_ci_low_memory() {
    local mem_mb heap_mb
    mem_mb="$(host_mem_mb)"
    heap_mb=640
    if (( mem_mb > 0 && mem_mb < 2048 )); then
        heap_mb=384
    elif (( mem_mb >= 4096 )); then
        heap_mb=1024
    fi
    log "npm ci (heap ${heap_mb}MB, maxsockets 1, prefer-offline, ignore-scripts)"
    # Ignore scripts so prisma/husky do not spawn extra Node during peak install.
    # Prisma generate still runs later in this script.
    if NODE_OPTIONS="--max-old-space-size=${heap_mb}" \
        npm ci --include=dev --no-audit --no-fund --prefer-offline --maxsockets 1 --ignore-scripts; then
        return 0
    fi

    log "npm ci failed (likely memory pressure) — retrying npm install with conservative settings"
    NODE_OPTIONS="--max-old-space-size=384" \
        npm install --include=dev --no-audit --no-fund --prefer-offline --maxsockets 1 --ignore-scripts
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
    if [[ -f "$(pwd)/docker-compose.backend.$ENVIRONMENT.yml" || -f "$(pwd)/backend/docker-compose.backend.$ENVIRONMENT.yml" ]]; then
        APP_DIR="$(pwd)"
    else
        # Staging and production share one EC2 git checkout; --env selects compose/env.
        APP_DIR="/home/ubuntu/api"
    fi
fi

# Split-repo checkout (EC2: /home/ubuntu/api) or nested backend/ under a parent root.
if [[ -f "$APP_DIR/docker-compose.backend.$ENVIRONMENT.yml" ]]; then
    ROOT_DIR="$APP_DIR"
    BACKEND_DIR="$APP_DIR"
    PRISMA_SCHEMA="prisma/schema.prisma"
    SYNC_SCRIPT="scripts/sync-prisma-client.js"
elif [[ -f "$APP_DIR/backend/docker-compose.backend.$ENVIRONMENT.yml" ]]; then
    ROOT_DIR="$APP_DIR"
    BACKEND_DIR="$APP_DIR/backend"
    PRISMA_SCHEMA="backend/prisma/schema.prisma"
    SYNC_SCRIPT="backend/scripts/sync-prisma-client.js"
else
    echo "Error: app dir not found or missing compose file: $APP_DIR"
    exit 1
fi

ENV_SOURCE="$BACKEND_DIR/.env.$ENVIRONMENT"
ENV_TARGET="$BACKEND_DIR/.env"
COMPOSE_BACKEND="$BACKEND_DIR/docker-compose.backend.$ENVIRONMENT.yml"
COMPOSE_MONITORING="$BACKEND_DIR/grafana/docker-compose.logging.yml"

if [[ "$ENVIRONMENT" == "staging" ]]; then
    BACKEND_PROJECT="archaser-backend-staging"
    MONITORING_PROJECT="archaser-monitoring-staging"
elif [[ "$ENVIRONMENT" == "production" ]]; then
    BACKEND_PROJECT="archaser-backend-production"
    MONITORING_PROJECT="archaser-monitoring-production"
else
    BACKEND_PROJECT="archaser-backend"
    MONITORING_PROJECT="archaser-monitoring"
fi

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

# npm ci uses --ignore-scripts, so generate before any workspace tsc that imports PrismaClient.
if [[ "$SKIP_PRISMA" != "true" ]]; then
    log "Generating Prisma client"
    mkdir -p node_modules/.prisma/client
    generate_prisma_client
    node "$SYNC_SCRIPT"
else
    log "Skipping prisma generate (--skip-prisma)"
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
    log "Building backend workspaces"
    ensure_build_tooling
    run_workspace_build @archaser/database
    run_workspace_build @archaser/auth
    run_workspace_build @archaser/sms-send
    run_workspace_build @archaser/credit-insurance-domain
    run_workspace_build @archaser/billing-connector
    run_workspace_build @archaser/cron-jobs
    # Nest api build last — on low-memory EC2 hosts it can disturb hoisted CLI bins (tsc).
    run_workspace_build @archaser/worker
    run_workspace_build @archaser/sms
    run_workspace_build @archaser/connectors
    run_workspace_build @archaser/reports
    run_workspace_build @archaser/api
    # Deploy contract: worker / connectors / cron load customer due/overdue
    # rollups from api/dist/customers (or CUSTOMERS_DOMAIN_ROOT). Building api
    # last ensures that artifact exists before the stack starts.
else
    log "Skipping backend builds (--skip-build)"
fi

# After this environment's env file is loaded and Prisma client generation.
# Failure exits before recreate_backend_stack, so the previous containers stay up.
log "Applying SQL migrations for $ENVIRONMENT"
node "$ROOT_DIR/scripts/deployment/apply-sql-migrations.js"

log "Starting backend stack (Nest + Redis + worker/sms/connectors/reports)"
recreate_backend_stack

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
        MONITORING_ENV_VARS=(
            MONITORING_ENV="$ENVIRONMENT"
            BACKEND_DOCKER_NETWORK="${BACKEND_PROJECT}_default"
        )
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
backend_compose ps

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
