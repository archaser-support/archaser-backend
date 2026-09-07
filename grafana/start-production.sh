#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Starting Production Grafana/Monitoring Stack..."
MONITORING_ENV=production \
GRAFANA_HOST_PORT=3201 \
PROMETHEUS_HOST_PORT=9091 \
LOKI_HOST_PORT=3101 \
GRAFANA_ROOT_URL=https://grafana.portal.archaser.com/ \
GRAFANA_DOMAIN=grafana.portal.archaser.com \
BACKEND_DOCKER_NETWORK=${BACKEND_DOCKER_NETWORK_PRODUCTION:-archaser-backend-production_default} \
docker compose --project-name archaser-monitoring-production \
  -f docker-compose.logging.yml up -d

echo "==> Production Grafana monitoring stack running on port 3201."
