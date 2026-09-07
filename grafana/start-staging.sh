#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NETWORK_NAME="${BACKEND_DOCKER_NETWORK_STAGING:-archaser-backend-staging_default}"
docker network create "$NETWORK_NAME" 2>/dev/null || true

echo "==> Starting Staging Grafana/Monitoring Stack..."
MONITORING_ENV=staging \
GRAFANA_HOST_PORT=3200 \
PROMETHEUS_HOST_PORT=9090 \
LOKI_HOST_PORT=3100 \
GRAFANA_ROOT_URL=https://grafana.staging.archaser.com/ \
GRAFANA_DOMAIN=grafana.staging.archaser.com \
BACKEND_DOCKER_NETWORK="$NETWORK_NAME" \
docker compose --project-name archaser-monitoring-staging \
  -f docker-compose.logging.yml up -d

echo "==> Checking status of archaser-grafana-staging..."
sleep 3
if docker ps --format '{{.Names}}' | grep -q "archaser-grafana-staging"; then
  echo "SUCCESS: Staging Grafana is RUNNING on port 3200."
else
  echo "WARNING: archaser-grafana-staging is not running. Recent logs:"
  docker logs archaser-grafana-staging --tail 30 || true
fi
