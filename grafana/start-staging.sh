#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Starting Staging Grafana/Monitoring Stack..."
MONITORING_ENV=staging \
GRAFANA_HOST_PORT=3200 \
PROMETHEUS_HOST_PORT=9090 \
LOKI_HOST_PORT=3100 \
GRAFANA_ROOT_URL=https://grafana.staging.archaser.com/ \
GRAFANA_DOMAIN=grafana.staging.archaser.com \
BACKEND_DOCKER_NETWORK=${BACKEND_DOCKER_NETWORK_STAGING:-archaser-backend-staging_default} \
docker compose --project-name archaser-monitoring-staging \
  -f docker-compose.logging.yml up -d

echo "==> Staging Grafana monitoring stack running on port 3200."
