#!/usr/bin/env bash
# Delete empty Grafana folders left from older provisioning
# (api / peels / worker). Keeps Dashboards + Staging/Production (alerts).
#
# Credentials: set GRAFANA_ADMIN_* or place them in backend/.env.staging / .env
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

load_env_file() {
  local f="$1"
  [[ -f "$f" ]] || return 0
  # Export only Grafana-related keys (avoid sourcing secrets we don't need)
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    case "$line" in
      GRAFANA_ADMIN_USER=*|GRAFANA_ADMIN_PASSWORD=*|GRAFANA_HOST_PORT=*|GRAFANA_URL=*)
        export "${line?}"
        ;;
    esac
  done <"$f"
}

load_env_file "${BACKEND_ROOT}/.env.staging"
load_env_file "${BACKEND_ROOT}/.env"

GRAFANA_URL="${GRAFANA_URL:-http://127.0.0.1:${GRAFANA_HOST_PORT:-3200}}"
USER="${GRAFANA_ADMIN_USER:-admin}"
PASS="${GRAFANA_ADMIN_PASSWORD:-}"
KEEP_CSV="${KEEP_CSV:-Dashboards,Staging,Production,General,Alerting}"

if [[ -z "$PASS" ]]; then
  echo "Missing GRAFANA_ADMIN_PASSWORD."
  echo "Set it in ${BACKEND_ROOT}/.env.staging or run:"
  echo "  GRAFANA_ADMIN_PASSWORD='your-password' bash scripts/deployment/cleanup-grafana-empty-folders.sh"
  exit 1
fi

export GRAFANA_URL USER PASS KEEP_CSV

python3 <<'PY'
import base64
import json
import os
import sys
import urllib.error
import urllib.request

url = os.environ["GRAFANA_URL"].rstrip("/")
auth = base64.b64encode(
    f'{os.environ["USER"]}:{os.environ["PASS"]}'.encode()
).decode()
headers = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}
keep = {t.strip() for t in os.environ["KEEP_CSV"].split(",") if t.strip()}


def call(path: str, method: str = "GET"):
    req = urllib.request.Request(url + path, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            print(
                "HTTP 401 Unauthorized — GRAFANA_ADMIN_USER/PASSWORD do not match Grafana.",
                file=sys.stderr,
            )
            print(
                "Check GRAFANA_ADMIN_* in .env.staging / .env (same values used by compose).",
                file=sys.stderr,
            )
            sys.exit(1)
        raise


print(f"Listing folders on {url} as {os.environ['USER']} ...")
folders = call("/api/folders") or []
for folder in folders:
    title = folder.get("title") or ""
    uid = folder.get("uid")
    if title in keep:
        print(f"keep   {title} ({uid})")
        continue
    search = call(f"/api/search?type=dash-db&folderUIDs={uid}&limit=5") or []
    if search:
        print(f"skip   {title} ({uid}) — has dashboard(s)")
        continue
    print(f"delete {title} ({uid})")
    try:
        call(f"/api/folders/{uid}", method="DELETE")
        print("  ok")
    except urllib.error.HTTPError as exc:
        print(f"  failed: HTTP {exc.code} {exc.reason}")
    except Exception as exc:  # noqa: BLE001
        print(f"  failed: {exc}")
PY
