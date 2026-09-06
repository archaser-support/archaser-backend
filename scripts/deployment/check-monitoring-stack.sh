#!/usr/bin/env bash
# Quick checks: Nest metrics → Prometheus → Grafana
#   bash scripts/deployment/check-monitoring-stack.sh

set -euo pipefail

echo "==> Nest /metrics (host)"
if curl -sf --max-time 5 http://127.0.0.1:3010/metrics | grep -E '^archaser_db_postgres_connected'; then
  echo "OK"
else
  echo "FAIL: Nest not exposing archaser_db_postgres_connected on :3010"
  exit 1
fi

echo "==> Prometheus → Nest (Docker DNS)"
if docker exec archaser-prometheus wget -qO- --timeout=5 http://api:3010/metrics 2>/dev/null | grep -q '^archaser_db_postgres_connected'; then
  echo "OK via api:3010"
elif docker exec archaser-prometheus wget -qO- --timeout=5 http://host.docker.internal:3010/metrics 2>/dev/null | grep -q '^archaser_db_postgres_connected'; then
  echo "OK via host.docker.internal:3010 (fallback)"
else
  echo "FAIL: prometheus cannot reach Nest"
  echo "Expected backend network: archaser-backend-staging_default"
  docker network ls | grep -E 'archaser|backend' || true
fi

echo "==> Prometheus targets"
curl -sf --max-time 5 http://127.0.0.1:9090/api/v1/targets \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); 
targets=d.get("data",{}).get("activeTargets",[]);
[print("  %s instance=%s health=%s err=%s" % (t.get("labels",{}).get("job"), t.get("labels",{}).get("instance"), t.get("health"), (t.get("lastError") or "")[:100])) for t in targets]'

echo "==> Query archaser_db_postgres_connected"
curl -sf --get http://127.0.0.1:9090/api/v1/query \
  --data-urlencode 'query=archaser_db_postgres_connected' \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); res=d.get("data",{}).get("result",[]); print("  series:", len(res));
[print(" ", r.get("metric"), "=>", r.get("value")) for r in res[:5]]'

echo "==> Grafana → Prometheus"
if docker exec archaser-grafana wget -qO- --timeout=5 'http://prometheus:9090/api/v1/query?query=up' 2>/dev/null | grep -q '"status":"success"'; then
  echo "OK"
else
  echo "FAIL: grafana cannot reach http://prometheus:9090"
fi

echo "Done."
