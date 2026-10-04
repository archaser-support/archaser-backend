#!/usr/bin/env bash
# Quick checks: Nest metrics → Prometheus → Grafana
#   bash scripts/deployment/check-monitoring-stack.sh              # staging defaults
#   bash scripts/deployment/check-monitoring-stack.sh --env production

set -euo pipefail

ENV="staging"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENV="${2:-}"
      shift 2
      ;;
    --env=*)
      ENV="${1#*=}"
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--env staging|production]"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

ENV="$(echo "$ENV" | tr '[:upper:]' '[:lower:]')"
if [[ "$ENV" != "staging" && "$ENV" != "production" ]]; then
  echo "ERROR: --env must be staging or production (got $ENV)" >&2
  exit 1
fi

if [[ "$ENV" == "production" ]]; then
  NEST_PORT=4010
  WORKER_PORT=4003
  PROM_PORT=9091
  INSTANCE_LABEL="Production"
  PROM_CONTAINER="archaser-prometheus-production"
  GRAFANA_CONTAINER="archaser-grafana-production"
  BACKEND_NET_HINT="archaser-backend-production_default"
else
  NEST_PORT=3010
  WORKER_PORT=3003
  PROM_PORT=9090
  INSTANCE_LABEL="Staging"
  PROM_CONTAINER="archaser-prometheus-staging"
  # legacy name without suffix (older deploys)
  if ! docker ps --format '{{.Names}}' | grep -qx "$PROM_CONTAINER"; then
    PROM_CONTAINER="archaser-prometheus"
  fi
  GRAFANA_CONTAINER="archaser-grafana-staging"
  if ! docker ps --format '{{.Names}}' | grep -qx "$GRAFANA_CONTAINER"; then
    GRAFANA_CONTAINER="archaser-grafana"
  fi
  BACKEND_NET_HINT="archaser-backend-staging_default"
fi

echo "==> Env: $ENV (Nest :$NEST_PORT, Prometheus :$PROM_PORT, instance=$INSTANCE_LABEL)"

echo "==> Nest /metrics (host)"
if curl -sf --max-time 5 "http://127.0.0.1:${NEST_PORT}/metrics" | grep -E '^archaser_db_postgres_connected'; then
  echo "OK on :${NEST_PORT}"
elif [[ "$ENV" == "production" ]] && curl -sf --max-time 5 "http://127.0.0.1:3010/metrics" | grep -E '^archaser_db_postgres_connected'; then
  echo "WARN: metrics on :3010 (PM2/legacy), not :4010 — Prometheus production config scrapes api:4010"
else
  echo "FAIL: Nest not exposing archaser_db_postgres_connected on :${NEST_PORT}"
fi

echo "==> Prometheus → Nest (Docker DNS)"
if docker exec "$PROM_CONTAINER" wget -qO- --timeout=5 "http://api:${NEST_PORT}/metrics" 2>/dev/null | grep -q '^archaser_db_postgres_connected'; then
  echo "OK via api:${NEST_PORT}"
elif docker exec "$PROM_CONTAINER" wget -qO- --timeout=5 "http://host.docker.internal:${NEST_PORT}/metrics" 2>/dev/null | grep -q '^archaser_db_postgres_connected'; then
  echo "OK via host.docker.internal:${NEST_PORT} (fallback)"
else
  echo "FAIL: $PROM_CONTAINER cannot reach Nest on api:${NEST_PORT}"
  echo "Expected backend network: $BACKEND_NET_HINT"
  docker network ls | grep -E 'archaser|backend' || true
  docker inspect "$PROM_CONTAINER" --format '{{json .NetworkSettings.Networks}}' 2>/dev/null | head -c 500 || true
  echo
fi

echo "==> Prometheus targets"
if curl -sf --max-time 5 "http://127.0.0.1:${PROM_PORT}/api/v1/targets" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin);
targets=d.get("data",{}).get("activeTargets",[]);
[print("  %s instance=%s health=%s url=%s err=%s" % (t.get("labels",{}).get("job"), t.get("labels",{}).get("instance"), t.get("health"), t.get("scrapeUrl"), (t.get("lastError") or "")[:120])) for t in targets]'; then
  :
else
  echo "FAIL: cannot read Prometheus targets on :${PROM_PORT}"
fi

echo "==> Query archaser_cron_jobs_total{instance=\"${INSTANCE_LABEL}\"}"
curl -sf --get "http://127.0.0.1:${PROM_PORT}/api/v1/query" \
  --data-urlencode "query=archaser_cron_jobs_total{instance=\"${INSTANCE_LABEL}\"}" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); res=d.get("data",{}).get("result",[]); print("  series:", len(res));
[print(" ", r.get("metric"), "=>", r.get("value")) for r in res[:5]]'

echo "==> Query archaser_db_postgres_connected (any instance)"
curl -sf --get "http://127.0.0.1:${PROM_PORT}/api/v1/query" \
  --data-urlencode 'query=archaser_db_postgres_connected' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); res=d.get("data",{}).get("result",[]); print("  series:", len(res));
[print(" ", r.get("metric"), "=>", r.get("value")) for r in res[:5]]'

echo "==> Grafana → Prometheus"
if docker exec "$GRAFANA_CONTAINER" wget -qO- --timeout=5 'http://prometheus:9090/api/v1/query?query=up' 2>/dev/null | grep -q '"status":"success"'; then
  echo "OK"
else
  echo "FAIL: $GRAFANA_CONTAINER cannot reach http://prometheus:9090"
fi

echo "Done."
