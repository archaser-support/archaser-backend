#!/usr/bin/env python3
"""Seed local Loki with sample RDS postgres logs for dashboard smoke tests.

Production/staging ingest is CloudWatch → lambda-promtail → Loki on EC2.
Local compose has an empty Loki and no Promtail, so Postgres Logs panels
show "No data" until something pushes {job=rds-postgres, environment=staging}.

Usage (from repo, with local Loki up):
  python3 grafana/scripts/seed-local-loki-postgres-logs.py

Env:
  LOKI_URL=http://127.0.0.1:3100
  ENVIRONMENT=staging
  HOURS=2          # keep ≤ ~2h; Loki ingesters reject far-behind samples on active streams
  LINES_PER_HOUR=40
"""

from __future__ import annotations

import json
import os
import random
import time
import urllib.error
import urllib.request
from collections import defaultdict

LOKI_URL = os.environ.get("LOKI_URL", "http://127.0.0.1:3100").rstrip("/")
ENVIRONMENT = os.environ.get("ENVIRONMENT", "staging")
HOURS = int(os.environ.get("HOURS", "2"))
LINES_PER_HOUR = int(os.environ.get("LINES_PER_HOUR", "40"))

TEMPLATES = [
    ("INFO", "connection authorized: user=app database=archaser SSL enabled", None),
    ("INFO", "disconnection: session time: 0:00:12.345 user=app database=archaser", None),
    ("LOG", "duration: 42.100 ms  statement: SELECT 1", 42),
    ("LOG", "duration: 1250.500 ms  statement: SELECT * FROM \"Invoice\" WHERE status = $1", 1250),
    ("LOG", "duration: 2100.000 ms  statement: UPDATE \"Customer\" SET updated_at = NOW()", 2100),
    ("WARNING", "could not receive data from client: Connection reset by peer", None),
    ("ERROR", "duplicate key value violates unique constraint \"Customer_email_key\"", None),
    ("ERROR", "relation \"MissingTable\" does not exist", None),
    ("FATAL", "password authentication failed for user \"bad_user\"", None),
    ("PANIC", "could not write to log file: No space left on device", None),
]

WEIGHTS = [30, 20, 15, 8, 5, 8, 8, 5, 1, 1]


def push(stream: dict) -> None:
    body = json.dumps({"streams": [stream]}).encode()
    req = urllib.request.Request(
        f"{LOKI_URL}/loki/api/v1/push",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status not in (200, 204):
                raise RuntimeError(f"push failed: HTTP {resp.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"push failed: HTTP {exc.code}: {detail}") from exc


def main() -> None:
    random.seed(42)
    now = int(time.time())
    start = now - HOURS * 3600
    by_severity: dict[str, list[tuple[int, str]]] = defaultdict(list)

    for hour_offset in range(HOURS):
        hour_start = start + hour_offset * 3600
        for i in range(LINES_PER_HOUR):
            severity, message, duration = random.choices(
                TEMPLATES, weights=WEIGHTS, k=1
            )[0]
            ts = hour_start + int((i + 1) * (3600 / (LINES_PER_HOUR + 1)))
            ts += random.randint(0, 3)
            if ts >= now:
                ts = now - 1 - (LINES_PER_HOUR - i)
            payload: dict = {"error_severity": severity, "message": message}
            if duration is not None:
                payload["duration"] = duration
            by_severity[severity].append((ts, json.dumps(payload)))

    total = 0
    for severity, entries in sorted(by_severity.items()):
        entries.sort(key=lambda x: x[0])
        values: list[list[str]] = []
        last_ns = -1
        for ts, line in entries:
            ns = ts * 1_000_000_000
            if ns <= last_ns:
                ns = last_ns + 1
            last_ns = ns
            values.append([str(ns), line])
            total += 1
        push(
            {
                "stream": {
                    "job": "rds-postgres",
                    "environment": ENVIRONMENT,
                    "error_severity": severity,
                },
                "values": values,
            }
        )
        print(f"  {severity}: {len(values)} lines")

    print(
        f"Seeded {total} lines → {LOKI_URL} "
        f"(job=rds-postgres, environment={ENVIRONMENT}, hours={HOURS})"
    )


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as exc:
        raise SystemExit(f"Cannot reach Loki at {LOKI_URL}: {exc}") from exc
    except RuntimeError as exc:
        raise SystemExit(str(exc)) from exc
