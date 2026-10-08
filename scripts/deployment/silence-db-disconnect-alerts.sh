#!/usr/bin/env bash
# Create a short Grafana silence for production DB disconnect alerts
# (MongoDB Disconnected + PostgreSQL Disconnected) during deploys / restarts.
#
# Usage (on the host that can reach Grafana, usually the API EC2):
#   bash scripts/deployment/silence-db-disconnect-alerts.sh
#   SILENCE_MINUTES=20 bash scripts/deployment/silence-db-disconnect-alerts.sh
#
# From a laptop against public production Grafana (do not rely on localhost):
#   GRAFANA_URL=https://grafana.portal.archaser.com \
#   GRAFANA_ADMIN_PASSWORD='...' bash scripts/deployment/silence-db-disconnect-alerts.sh
# Or: py -3 scripts/deployment/silence_db_disconnect_alerts.py --create --list
#
# Credentials: GRAFANA_ADMIN_* / GRAFANA_URL / GRAFANA_ROOT_URL / GRAFANA_HOST_PORT
# from backend/.env.production, backend/.env, or the environment (same as
# cleanup-grafana-empty-folders.sh).
#
# Exit 0 on success; exit 1 on failure. Deploy wrappers should warn-and-continue.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

SILENCE_MINUTES="${SILENCE_MINUTES:-15}"
CREATED_BY="${SILENCE_CREATED_BY:-deploy-script}"
COMMENT="${SILENCE_COMMENT:-Production deploy — mute MongoDB/PostgreSQL Disconnected for ${SILENCE_MINUTES}m}"

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    case "$line" in
      GRAFANA_ADMIN_USER=*|GRAFANA_ADMIN_PASSWORD=*|GRAFANA_HOST_PORT=*|GRAFANA_URL=*|GRAFANA_ROOT_URL=*|MONITORING_ENV=*)
        # Do not override vars already set in the environment
        key="${line%%=*}"
        if [[ -z "${!key:-}" ]]; then
          export "${line?}"
        fi
        ;;
    esac
  done <"$f"
}

load_env_file "${BACKEND_ROOT}/.env.production"
load_env_file "${BACKEND_ROOT}/.env"

DEFAULT_PORT=3200
if [[ "${MONITORING_ENV:-}" == "production" ]]; then
  DEFAULT_PORT=3201
fi

# Shared EC2 checkout may leave staging GRAFANA_ROOT_URL in `.env`. Prefer an
# explicit URL, then localhost for this MONITORING_ENV, and only then ROOT_URL.
if [[ -z "${GRAFANA_URL:-}" ]]; then
  if [[ "${MONITORING_ENV:-}" == "production" ]]; then
    GRAFANA_URL="http://127.0.0.1:${GRAFANA_HOST_PORT:-3201}"
  elif [[ "${MONITORING_ENV:-}" == "staging" ]]; then
    GRAFANA_URL="http://127.0.0.1:${GRAFANA_HOST_PORT:-3200}"
  elif [[ -n "${GRAFANA_ROOT_URL:-}" ]]; then
    GRAFANA_URL="${GRAFANA_ROOT_URL%/}"
  else
    GRAFANA_URL="http://127.0.0.1:${GRAFANA_HOST_PORT:-$DEFAULT_PORT}"
  fi
fi
USER="${GRAFANA_ADMIN_USER:-admin}"
PASS="${GRAFANA_ADMIN_PASSWORD:-}"

if [[ -z "$PASS" ]]; then
  echo "Missing GRAFANA_ADMIN_PASSWORD."
  echo "Set it in ${BACKEND_ROOT}/.env.production / .env or run:"
  echo "  GRAFANA_ADMIN_PASSWORD='...' bash scripts/deployment/silence-db-disconnect-alerts.sh"
  exit 1
fi

if ! [[ "$SILENCE_MINUTES" =~ ^[1-9][0-9]*$ ]]; then
  echo "SILENCE_MINUTES must be a positive integer (got: $SILENCE_MINUTES)"
  exit 1
fi

export GRAFANA_URL USER PASS SILENCE_MINUTES CREATED_BY COMMENT

python3 <<'PY'
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

url = os.environ["GRAFANA_URL"].rstrip("/")
auth = base64.b64encode(
    f'{os.environ["USER"]}:{os.environ["PASS"]}'.encode()
).decode()
headers = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}
minutes = int(os.environ["SILENCE_MINUTES"])
starts = datetime.now(timezone.utc)
ends = starts + timedelta(minutes=minutes)

payload = {
    "matchers": [
        {
            "name": "alertname",
            "value": "MongoDB Disconnected|PostgreSQL Disconnected",
            "isRegex": True,
            "isEqual": True,
        },
        {
            "name": "grafana_folder",
            "value": "Production",
            "isRegex": False,
            "isEqual": True,
        },
    ],
    "startsAt": starts.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
    "endsAt": ends.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
    "createdBy": os.environ["CREATED_BY"],
    "comment": os.environ["COMMENT"],
}

path = "/api/alertmanager/grafana/api/v2/silences"
body = json.dumps(payload).encode()
req = urllib.request.Request(url + path, data=body, headers=headers, method="POST")

print(
    f"Creating {minutes}m silence on {url} for "
    "MongoDB/PostgreSQL Disconnected (Production) ..."
)

try:
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        data = json.loads(raw) if raw else {}
except urllib.error.HTTPError as exc:
    detail = exc.read().decode("utf-8", errors="replace")
    if exc.code == 401:
        print(
            "HTTP 401 Unauthorized — GRAFANA_ADMIN_USER/PASSWORD do not match Grafana.",
            file=sys.stderr,
        )
        print(
            "Check GRAFANA_ADMIN_* in .env.production / .env (same values used by compose).",
            file=sys.stderr,
        )
    else:
        print(f"HTTP {exc.code} {exc.reason}: {detail}", file=sys.stderr)
    sys.exit(1)
except Exception as exc:  # noqa: BLE001
    print(f"Silence request failed: {exc}", file=sys.stderr)
    sys.exit(1)

silence_id = data.get("silenceID") or data.get("id") or "(unknown)"
print(f"OK silence id={silence_id} until {payload['endsAt']}")
PY
