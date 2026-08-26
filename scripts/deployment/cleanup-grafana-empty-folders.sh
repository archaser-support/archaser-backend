#!/usr/bin/env bash
# Delete empty Grafana folders left from older provisioning
# (api / peels / worker). Keeps Dashboards + Staging/Production (alerts).
set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://127.0.0.1:${GRAFANA_HOST_PORT:-3200}}"
USER="${GRAFANA_ADMIN_USER:-admin}"
PASS="${GRAFANA_ADMIN_PASSWORD:-admin}"
KEEP_CSV="${KEEP_CSV:-Dashboards,Staging,Production,General,Alerting}"

export GRAFANA_URL USER PASS KEEP_CSV

python3 <<'PY'
import base64
import json
import os
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
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
        return json.loads(body) if body else None


print(f"Listing folders on {url} ...")
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
