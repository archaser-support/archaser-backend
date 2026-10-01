#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NETWORK_NAME="${BACKEND_DOCKER_NETWORK_PRODUCTION:-archaser-backend-production_default}"
MONGO_NETWORK_NAME="${MONGO_DOCKER_NETWORK:-archaser-mongo-shared}"
# Do not `docker network create` here — an unlabeled network breaks
# `docker compose --project-name archaser-backend-production up` (missing
# com.docker.compose.network=default). Nest deploy owns creating this network;
# monitoring joins it as external.
if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  echo "ERROR: backend network '$NETWORK_NAME' is missing."
  echo "Deploy the Nest production stack first (scripts/deployment/deploy-backend-docker.sh --env production),"
  echo "then re-run this script."
  exit 1
fi
if ! docker network inspect "$MONGO_NETWORK_NAME" >/dev/null 2>&1; then
  echo "ERROR: shared Mongo network '$MONGO_NETWORK_NAME' is missing."
  echo "Bring up staging mongo first (creates the shared network):"
  echo "  docker compose -p archaser-backend-staging -f docker-compose.backend.staging.yml up -d mongo"
  exit 1
fi

ENV_FILE="../.env"
if [[ -f "../.env.production" ]]; then
  ENV_FILE="../.env.production"
fi

MONGO_DS="$SCRIPT_DIR/provisioning/datasources/mongodb.generated.yaml"
# Docker creates a directory here if the file was missing at first `compose up`
# (bind-mount of a non-existent path). Grafana then crash-loops → nginx 502.
if [[ -d "$MONGO_DS" ]]; then
  echo "==> Removing bind-mount leftover directory at $MONGO_DS"
  rm -rf "$MONGO_DS"
fi

echo "==> Rendering MongoDB Grafana datasource from MONGODB_URI in $ENV_FILE..."
python3 "$SCRIPT_DIR/scripts/render-mongodb-datasource.py" --env-file "$ENV_FILE"
if [[ ! -f "$MONGO_DS" ]]; then
  echo "ERROR: mongodb.generated.yaml missing after render."
  exit 1
fi

PROMTAIL_CFG="$SCRIPT_DIR/promtail-config.generated.yaml"
if [[ -d "$PROMTAIL_CFG" ]]; then
  echo "==> Removing bind-mount leftover directory at $PROMTAIL_CFG"
  rm -rf "$PROMTAIL_CFG"
fi
echo "==> Rendering Promtail config for MONITORING_ENV=production..."
python3 "$SCRIPT_DIR/scripts/render-promtail-config.py" --monitoring-env production
if [[ ! -f "$PROMTAIL_CFG" ]]; then
  echo "ERROR: promtail-config.generated.yaml missing after render."
  exit 1
fi

echo "==> Starting Production Grafana/Monitoring Stack using $ENV_FILE..."
# Host .env* often still has GRAFANA_ROOT_URL=https://grafana.archaser.com (or
# grafana.production…). Strip those so shell exports below always win for
# GF_SERVER_* (alert/email links must be grafana.portal.archaser.com).
FILTERED_ENV="$(mktemp)"
trap 'rm -f "$FILTERED_ENV"' EXIT
grep -vE '^(GRAFANA_ROOT_URL|GRAFANA_DOMAIN)=' "$ENV_FILE" > "$FILTERED_ENV" || true

MONITORING_ENV=production \
GRAFANA_HOST_PORT=3201 \
PROMETHEUS_HOST_PORT=9091 \
LOKI_HOST_PORT=3101 \
GRAFANA_ROOT_URL=https://grafana.portal.archaser.com/ \
GRAFANA_DOMAIN=grafana.portal.archaser.com \
BACKEND_DOCKER_NETWORK="$NETWORK_NAME" \
MONGO_DOCKER_NETWORK="$MONGO_NETWORK_NAME" \
docker compose --project-name archaser-monitoring-production \
  --env-file "$FILTERED_ENV" \
  -f docker-compose.logging.yml up -d --force-recreate grafana

# Recreate prometheus + promtail so scrape ports / environment labels pick up
# generated configs; leave loki/db volumes intact.
MONITORING_ENV=production \
GRAFANA_HOST_PORT=3201 \
PROMETHEUS_HOST_PORT=9091 \
LOKI_HOST_PORT=3101 \
GRAFANA_ROOT_URL=https://grafana.portal.archaser.com/ \
GRAFANA_DOMAIN=grafana.portal.archaser.com \
BACKEND_DOCKER_NETWORK="$NETWORK_NAME" \
MONGO_DOCKER_NETWORK="$MONGO_NETWORK_NAME" \
docker compose --project-name archaser-monitoring-production \
  --env-file "$FILTERED_ENV" \
  -f docker-compose.logging.yml up -d --force-recreate prometheus promtail

MONITORING_ENV=production \
GRAFANA_HOST_PORT=3201 \
PROMETHEUS_HOST_PORT=9091 \
LOKI_HOST_PORT=3101 \
GRAFANA_ROOT_URL=https://grafana.portal.archaser.com/ \
GRAFANA_DOMAIN=grafana.portal.archaser.com \
BACKEND_DOCKER_NETWORK="$NETWORK_NAME" \
MONGO_DOCKER_NETWORK="$MONGO_NETWORK_NAME" \
docker compose --project-name archaser-monitoring-production \
  --env-file "$FILTERED_ENV" \
  -f docker-compose.logging.yml up -d

echo "==> Checking status of archaser-grafana-production..."
sleep 5
if docker ps --format '{{.Names}}' | grep -q "archaser-grafana-production"; then
  echo "SUCCESS: Production Grafana is RUNNING on port 3201."
  docker exec archaser-grafana-production printenv GF_SERVER_ROOT_URL || true
else
  echo "WARNING: archaser-grafana-production is not running. Recent logs:"
  docker logs archaser-grafana-production --tail 40 || true
fi
