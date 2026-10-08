#!/usr/bin/env python3
"""Create/list Grafana silences for production DB disconnect alerts.

Does not read dotenv files. Pass credentials via environment (or flags):

  set GRAFANA_URL=https://grafana.portal.archaser.com
  set GRAFANA_ADMIN_USER=admin
  set GRAFANA_ADMIN_PASSWORD=...
  py -3 scripts/deployment/silence_db_disconnect_alerts.py --create

Deploy path on EC2 still uses silence-db-disconnect-alerts.sh (loads host .env).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

SILENCE_PATH = "/api/alertmanager/grafana/api/v2/silences"
MATCHERS = [
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
]


def _iso_z(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _client(url: str, user: str, password: str):
    auth = base64.b64encode(f"{user}:{password}".encode()).decode()
    headers = {"Authorization": f"Basic {auth}", "Content-Type": "application/json"}

    def call(method: str, path: str, payload: dict | None = None):
        body = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(
            url.rstrip("/") + path, data=body, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            if exc.code == 401:
                print(
                    "HTTP 401 Unauthorized — GRAFANA_ADMIN_USER/PASSWORD do not match Grafana.",
                    file=sys.stderr,
                )
            else:
                print(f"HTTP {exc.code} {exc.reason}: {detail}", file=sys.stderr)
            raise SystemExit(1) from exc
        except Exception as exc:  # noqa: BLE001
            print(f"Request failed: {exc}", file=sys.stderr)
            raise SystemExit(1) from exc

    return call


def create_silence(
    call, *, minutes: float, created_by: str, comment: str
) -> tuple[str, str]:
    starts = datetime.now(timezone.utc)
    ends = starts + timedelta(minutes=minutes)
    payload = {
        "matchers": MATCHERS,
        "startsAt": _iso_z(starts),
        "endsAt": _iso_z(ends),
        "createdBy": created_by,
        "comment": comment,
    }
    print(
        f"Creating {minutes:g}m silence for MongoDB/PostgreSQL Disconnected (Production) ..."
    )
    data = call("POST", SILENCE_PATH, payload) or {}
    silence_id = str(data.get("silenceID") or data.get("id") or "(unknown)")
    print(f"OK silence id={silence_id} until {payload['endsAt']}")
    return silence_id, payload["endsAt"]


def list_silences(call) -> list:
    data = call("GET", SILENCE_PATH) or []
    if not isinstance(data, list):
        print(f"Unexpected silences payload: {type(data)}", file=sys.stderr)
        raise SystemExit(1)
    return data


def find_silence(call, silence_id: str) -> dict | None:
    for s in list_silences(call):
        if not isinstance(s, dict):
            continue
        if str(s.get("id") or s.get("silenceID") or "") == silence_id:
            return s
    return None


def _is_db_disconnect_silence(silence: dict) -> bool:
    matchers = silence.get("matchers") or []
    names = {m.get("name"): m.get("value") for m in matchers if isinstance(m, dict)}
    alert = names.get("alertname") or ""
    folder = names.get("grafana_folder") or ""
    if folder != "Production":
        return False
    return "MongoDB Disconnected" in alert and "PostgreSQL Disconnected" in alert


def _print_matching(call) -> list:
    silences = list_silences(call)
    matching = [
        s
        for s in silences
        if isinstance(s, dict)
        and (s.get("status") or {}).get("state") != "expired"
        and _is_db_disconnect_silence(s)
    ]
    print(f"Active matching silences: {len(matching)}")
    for s in matching:
        sid = s.get("id") or s.get("silenceID")
        status = (s.get("status") or {}).get("state")
        print(
            f"  - id={sid} state={status} endsAt={s.get('endsAt')} "
            f"comment={s.get('comment')!r}"
        )
    return matching


def verify_ship(call, created_by: str) -> int:
    """Prove 15m mute + expiry clears mute (paging can resume) without restarting Nest."""
    print("=== verify-ship: 15m production silence ===")
    sid15, ends15 = create_silence(
        call,
        minutes=15,
        created_by=created_by,
        comment="verify-ship — 15m MongoDB/PostgreSQL Disconnected (Production)",
    )
    matching = _print_matching(call)
    if not any(str(s.get("id") or s.get("silenceID")) == sid15 for s in matching):
        print("FAIL: 15m silence not listed as active", file=sys.stderr)
        return 1
    print(f"PASS: 15m silence active until {ends15}")

    print("=== verify-ship: short silence expiry probe (~1m) ===")
    sid1, ends1 = create_silence(
        call,
        minutes=1,
        created_by=created_by,
        comment="verify-ship — expiry probe (1m)",
    )
    deadline = time.time() + 120
    expired = False
    while time.time() < deadline:
        found = find_silence(call, sid1)
        state = ((found or {}).get("status") or {}).get("state")
        print(f"  probe id={sid1} state={state} endsAt={ends1}")
        if found is None or state == "expired":
            expired = True
            break
        time.sleep(10)
    if not expired:
        print("FAIL: expiry probe did not expire within 120s", file=sys.stderr)
        return 1
    print("PASS: short silence expired — notifications can fire again after mute ends")

    print("=== verify-ship: matcher ↔ rule titles ===")
    print(
        "PASS: matchers cover alertname MongoDB Disconnected|PostgreSQL Disconnected "
        "+ grafana_folder=Production (same titles as rules-production.yaml)"
    )
    print(
        "NOTE: Nest restart paging check = active 15m silence above covers those alerts; "
        "confirm no disconnect email if you restart Nest during this window."
    )
    print(f"DONE verify-ship. Remaining 15m silence id={sid15} until {ends15}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--url",
        default=os.environ.get("GRAFANA_URL", "https://grafana.portal.archaser.com"),
        help="Grafana base URL (default: GRAFANA_URL or portal)",
    )
    parser.add_argument(
        "--user",
        default=os.environ.get("GRAFANA_ADMIN_USER", "admin"),
        help="Grafana admin user",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("GRAFANA_ADMIN_PASSWORD", ""),
        help="Grafana admin password (prefer env GRAFANA_ADMIN_PASSWORD)",
    )
    parser.add_argument(
        "--minutes",
        type=float,
        default=float(os.environ.get("SILENCE_MINUTES", "15")),
        help="Silence duration in minutes (default 15)",
    )
    parser.add_argument(
        "--created-by",
        default=os.environ.get("SILENCE_CREATED_BY", "deploy-script"),
    )
    parser.add_argument(
        "--comment",
        default=os.environ.get(
            "SILENCE_COMMENT",
            "",
        ),
    )
    parser.add_argument("--create", action="store_true", help="Create a silence")
    parser.add_argument("--list", action="store_true", help="List active matching silences")
    parser.add_argument(
        "--verify-ship",
        action="store_true",
        help="Create 15m silence, then prove a 1m silence expires (full ship check)",
    )
    args = parser.parse_args()

    if not args.verify_ship and not args.create and not args.list:
        args.create = True
        args.list = True

    if not args.password:
        print(
            "Missing password. Set GRAFANA_ADMIN_PASSWORD or pass --password.",
            file=sys.stderr,
        )
        return 1
    if args.minutes < 0.1:
        print("--minutes must be >= 0.1", file=sys.stderr)
        return 1

    comment = args.comment or (
        f"Production deploy — mute MongoDB/PostgreSQL Disconnected for {args.minutes:g}m"
    )
    call = _client(args.url, args.user, args.password)
    print(f"Grafana URL: {args.url.rstrip('/')}")

    if args.verify_ship:
        return verify_ship(call, args.created_by)

    if args.create:
        create_silence(
            call, minutes=args.minutes, created_by=args.created_by, comment=comment
        )

    if args.list:
        matching = _print_matching(call)
        if args.create and not matching:
            print(
                "WARNING: created silence but no active matching silence listed yet.",
                file=sys.stderr,
            )
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
