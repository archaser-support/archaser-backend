#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NETWORK_NAME="${BACKEND_DOCKER_NETWORK_PRODUCTION:-archaser-backend-production_default}"
docker network create "$NETWORK_NAME" 2>/dev/null || true

ENV_FILE="../.env"
if [[ -f "../.env.production" ]]; then
  ENV_FILE="../.env.production"
fi

echo "==> Rendering MongoDB Grafana datasource from MONGODB_URI in $ENV_FILE..."
python3 "$SCRIPT_DIR/scripts/render-mongodb-datasource.py" --env-file "$ENV_FILE"
if [[ ! -f "$SCRIPT_DIR/provisioning/datasources/mongodb.generated.yaml" ]]; then
  echo "ERROR: mongodb.generated.yaml missing after render."
  exit 1
fi

echo "==> Starting Production Grafana/Monitoring Stack using $ENV_FILE..."
MONITORING_ENV=production \
GRAFANA_HOST_PORT=3201 \
PROMETHEUS_HOST_PORT=9091 \
LOKI_HOST_PORT=3101 \
GRAFANA_ROOT_URL=https://grafana.portal.archaser.com/ \
GRAFANA_DOMAIN=grafana.portal.archaser.com \
BACKEND_DOCKER_NETWORK="$NETWORK_NAME" \
docker compose --project-name archaser-monitoring-production \
  --env-file "$ENV_FILE" \
  -f docker-compose.logging.yml up -d

echo "==> Checking status of archaser-grafana-production..."
sleep 3
if docker ps --format '{{.Names}}' | grep -q "archaser-grafana-production"; then
  echo "SUCCESS: Production Grafana is RUNNING on port 3201."
else
  echo "WARNING: archaser-grafana-production is not running. Recent logs:"
  docker logs archaser-grafana-production --tail 30 || true
fi
