#!/usr/bin/env bash

# Pull a MongoDB database from Atlas and restore it into the EC2 Docker Mongo
# used by the Nest staging (or production) compose stack.
#
# Ubuntu /bin/sh is dash — re-exec under bash if needed.
if [ -z "${BASH_VERSION:-}" ]; then
    exec /usr/bin/env bash "$0" "$@"
fi

set -euo pipefail

usage() {
    cat <<'EOF'
Usage:
  bash scripts/deployment/sync-atlas-mongo-to-ec2.sh --env <staging|production> [options]

Pulls one database from Atlas (mongodump) and restores it into the compose
Mongo service on this EC2 host (mongorestore --drop).

Required:
  --env staging|production
  Atlas URI via ATLAS_MONGODB_URI env, or --atlas-uri <uri>
    (SRV connection string including user/password — do not commit it)

Options:
  --app-dir <path>     Backend checkout (default: /home/ubuntu/api)
  --source-db <name>   Atlas database name
                       (default: staging → archaser_staging, production → archaser)
  --target-db <name>   Local Docker database name (default: same as --source-db)
  --yes                Skip interactive confirmation
  -h, --help           Show this help

Examples (run on the API EC2):
  export ATLAS_MONGODB_URI='mongodb+srv://user:pass@cluster.../'
  bash scripts/deployment/sync-atlas-mongo-to-ec2.sh --env staging --yes

  # Prod Atlas DB into staging Docker DB name:
  bash scripts/deployment/sync-atlas-mongo-to-ec2.sh --env staging \
    --source-db archaser --target-db archaser_staging --yes

Notes:
  - Needs Docker. Uses the mongo:7 image for dump (no host mongodump install).
  - Staging compose Mongo URI path must stay /archaser_staging.
  - Production compose (if used) must stay /archaser.
  - --drop replaces collections in the target DB only.
EOF
}

log() {
    echo "==> $*"
}

ENVIRONMENT=""
APP_DIR=""
ATLAS_URI="${ATLAS_MONGODB_URI:-}"
SOURCE_DB=""
TARGET_DB=""
ASSUME_YES="false"
MONGO_IMAGE="${MONGO_SYNC_IMAGE:-mongo:7}"

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
        --atlas-uri)
            ATLAS_URI="${2:-}"
            shift 2
            ;;
        --source-db)
            SOURCE_DB="${2:-}"
            shift 2
            ;;
        --target-db)
            TARGET_DB="${2:-}"
            shift 2
            ;;
        --yes)
            ASSUME_YES="true"
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

if [[ -z "$ATLAS_URI" ]]; then
    echo "Error: set ATLAS_MONGODB_URI or pass --atlas-uri."
    exit 1
fi

if [[ -z "$APP_DIR" ]]; then
    APP_DIR="/home/ubuntu/api"
fi

if [[ -f "$APP_DIR/docker-compose.backend.$ENVIRONMENT.yml" ]]; then
    ROOT_DIR="$APP_DIR"
    COMPOSE_FILE="$APP_DIR/docker-compose.backend.$ENVIRONMENT.yml"
elif [[ -f "$APP_DIR/backend/docker-compose.backend.$ENVIRONMENT.yml" ]]; then
    ROOT_DIR="$APP_DIR/backend"
    COMPOSE_FILE="$APP_DIR/backend/docker-compose.backend.$ENVIRONMENT.yml"
else
    echo "Error: compose file not found under $APP_DIR"
    exit 1
fi

if [[ "$ENVIRONMENT" == "staging" ]]; then
    PROJECT="archaser-backend-staging"
    DEFAULT_DB="archaser_staging"
else
    PROJECT="archaser-backend-production"
    DEFAULT_DB="archaser"
fi

SOURCE_DB="${SOURCE_DB:-$DEFAULT_DB}"
TARGET_DB="${TARGET_DB:-$SOURCE_DB}"

if [[ "$ENVIRONMENT" == "staging" && "$TARGET_DB" != "archaser_staging" ]]; then
    echo "Warning: staging Nest compose expects database path /archaser_staging (got: $TARGET_DB)."
fi
if [[ "$ENVIRONMENT" == "production" && "$TARGET_DB" != "archaser" ]]; then
    echo "Warning: production Nest compose expects database path /archaser (got: $TARGET_DB)."
fi

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Error: required command not found: $1"
        exit 1
    fi
}

require_cmd docker

log "Ensuring compose Mongo is up ($PROJECT)"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d mongo

MONGO_CID="$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q mongo)"
if [[ -z "$MONGO_CID" ]]; then
    echo "Error: could not resolve mongo container for project $PROJECT"
    exit 1
fi

log "Waiting for local Mongo health"
for _ in $(seq 1 30); do
    if docker exec "$MONGO_CID" mongosh --quiet --eval 'db.adminCommand({ ping: 1 }).ok' 2>/dev/null | grep -q 1; then
        break
    fi
    sleep 2
done

DUMP_HOST_DIR="$(mktemp -d /tmp/archaser-mongo-sync.XXXXXX)"
# mongo image runs as non-root; host mktemp dirs are 700 → permission denied in /backup
chmod 777 "$DUMP_HOST_DIR"
cleanup() {
    # Dump files are owned by the mongo image user; remove via the same image.
    if [[ -d "$DUMP_HOST_DIR" ]]; then
        docker run --rm \
            -v "$DUMP_HOST_DIR:/backup" \
            "$MONGO_IMAGE" \
            bash -c 'rm -rf /backup/*' >/dev/null 2>&1 || true
        rm -rf "$DUMP_HOST_DIR" 2>/dev/null || true
    fi
}
trap cleanup EXIT

log "Dumping Atlas db=$SOURCE_DB → $DUMP_HOST_DIR"
# Ephemeral mongo:7 runs mongodump so the host does not need Database Tools.
# Match host uid/gid so leftover files are deletable without sudo.
docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$DUMP_HOST_DIR:/backup" \
    "$MONGO_IMAGE" \
    mongodump \
        --uri="$ATLAS_URI" \
        --db="$SOURCE_DB" \
        --out=/backup

DUMP_DB_DIR="$DUMP_HOST_DIR/$SOURCE_DB"
if [[ ! -d "$DUMP_DB_DIR" ]]; then
    echo "Error: dump folder missing after mongodump: $DUMP_DB_DIR"
    echo "Check ATLAS_MONGODB_URI and that database '$SOURCE_DB' exists on Atlas."
    exit 1
fi

BSON_COUNT="$(find "$DUMP_DB_DIR" -name '*.bson' | wc -l | tr -d ' ')"
log "Dump contains $BSON_COUNT .bson files"

if [[ "$ASSUME_YES" != "true" ]]; then
    echo
    echo "About to REPLACE local Docker DB '$TARGET_DB' (project=$PROJECT) with Atlas '$SOURCE_DB'."
    read -r -p "Continue? [y/N] " answer
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

RESTORE_IN_CONTAINER="/tmp/archaser-mongo-restore-$SOURCE_DB"
log "Copying dump into mongo container"
docker exec "$MONGO_CID" rm -rf "$RESTORE_IN_CONTAINER"
docker cp "$DUMP_DB_DIR" "$MONGO_CID:$RESTORE_IN_CONTAINER"

log "Restoring into local db=$TARGET_DB (--drop)"
if [[ "$SOURCE_DB" == "$TARGET_DB" ]]; then
    docker exec "$MONGO_CID" mongorestore \
        --db="$TARGET_DB" \
        --drop \
        "$RESTORE_IN_CONTAINER"
else
    docker exec "$MONGO_CID" mongorestore \
        --nsFrom="${SOURCE_DB}.*" \
        --nsTo="${TARGET_DB}.*" \
        --drop \
        "$RESTORE_IN_CONTAINER"
fi

docker exec "$MONGO_CID" rm -rf "$RESTORE_IN_CONTAINER"

COLLECTION_COUNT="$(
    docker exec "$MONGO_CID" mongosh --quiet --eval \
        "db.getSiblingDB('$TARGET_DB').getCollectionNames().length"
)"
log "Done. Local db=$TARGET_DB collections=$COLLECTION_COUNT"
log "Apps already point at mongodb://mongo:27017/$TARGET_DB via compose — no restart required for URI."
log "Optional: refresh Grafana Mongo datasource (cd grafana && ./start-staging.sh)."
