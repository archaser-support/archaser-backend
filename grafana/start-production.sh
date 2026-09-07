#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

NETWORK_NAME="${BACKEND_DOCKER_NETWORK_PRODUCTION:-archaser-backend-production_default}"
docker network create "$NETWORK_NAME" 2>/dev/null || true

echo "==> Starting Production Grafana/Monitoring Stack..."
MONITORING_ENV=production \
GRAFANA_HOST_PORT=3201 \
PROMETHEUS_HOST_PORT=9091 \
LOKI_HOST_PORT=3101 \
GRAFANA_ROOT_URL=https://grafana.portal.archaser.com/ \
GRAFANA_DOMAIN=grafana.portal.archaser.com \
BACKEND_DOCKER_NETWORK="$NETWORK_NAME" \
docker compose --project-name archaser-monitoring-production \
  -f docker-compose.logging.yml up -d

echo "==> Checking status of archaser-grafana-production..."
sleep 3
if docker ps --format '{{.Names}}' | grep -q "archaser-grafana-production"; then
  echo "SUCCESS: Production Grafana is RUNNING on port 3201."
else
  echo "WARNING: archaser-grafana-production is not running. Recent logs:"
  docker logs archaser-grafana-production --tail 30 || true
fi
