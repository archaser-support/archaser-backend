#!/usr/bin/env python3
"""One-shot: fix PromQL/LogQL, merge Nest health into Infrastructure, drop redundant boards."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "provisioning" / "dashboards"


def fix_expr(expr: str, env: str) -> str:
    if not isinstance(expr, str):
        return expr
    e = expr

    # Do not rewrite worker's archaser_worker_* default metrics.
    # Nest API (and similar) use nest_ prefix from collectDefaultMetrics.
    if "archaser_worker_" not in e:
        e = e.replace("nodejs_", "nest_nodejs_")
        e = e.replace("process_cpu_seconds_total", "nest_process_cpu_seconds_total")
        e = e.replace("process_resident_memory_bytes", "nest_process_resident_memory_bytes")
        e = e.replace("process_heap_bytes", "nest_process_heap_bytes")
        e = e.replace("nest_nest_", "nest_")

    # Cron counters are rarely incremented — use DB-backed 30d gauges.
    for inst in ("Staging", "Production"):
        e = e.replace(
            f'sum(increase(archaser_cron_job_executions_total{{status="SUCCESS", instance="{inst}"}}[24h]))',
            f'sum(archaser_cron_job_success_count_30d{{instance="{inst}"}})',
        )
        e = e.replace(
            f'sum(increase(archaser_cron_job_executions_total{{status="FAILED", instance="{inst}"}}[24h]))',
            f'sum(archaser_cron_job_failure_count_30d{{instance="{inst}"}})',
        )
        e = e.replace(
            f'sum(increase(archaser_cron_job_executions_total{{status="TIMEOUT", instance="{inst}"}}[24h]))',
            f'sum(archaser_cron_job_timeout_count_30d{{instance="{inst}"}})',
        )
        e = e.replace(
            f'sum by(job_name) (increase(archaser_cron_job_executions_total{{instance="{inst}"}}[24h]))',
            f'sum by(job_name) (archaser_cron_job_success_count_30d{{instance="{inst}"}} + archaser_cron_job_failure_count_30d{{instance="{inst}"}} + archaser_cron_job_timeout_count_30d{{instance="{inst}"}})',
        )
        e = e.replace(
            f'sum by(job_name) (increase(archaser_cron_job_executions_total{{instance="{inst}", status="SUCCESS"}}[24h]))',
            f'sum by(job_name) (archaser_cron_job_success_count_30d{{instance="{inst}"}})',
        )
        e = e.replace(
            f'sum by(job_name) (increase(archaser_cron_job_executions_total{{instance="{inst}", status="FAILED"}}[24h]))',
            f'sum by(job_name) (archaser_cron_job_failure_count_30d{{instance="{inst}"}})',
        )
        e = e.replace(
            f'sum(rate(archaser_cron_job_executions_total{{instance="{inst}", status="SUCCESS"}}[1h])) * 3600',
            f'sum(archaser_cron_job_success_count_30d{{instance="{inst}"}})',
        )
        e = e.replace(
            f'sum(rate(archaser_cron_job_executions_total{{instance="{inst}", status="FAILED"}}[1h])) * 3600',
            f'sum(archaser_cron_job_failure_count_30d{{instance="{inst}"}})',
        )

    if env == "staging":
        e = e.replace(
            '{service="archaser-core", host="staging"}',
            '{job="nest-docker", environment="staging"}',
        )
        e = e.replace(
            '{service="archaser-core", source="SES Webhook", host="staging"}',
            '{job="nest-docker", environment="staging"}',
        )
        e = e.replace(
            'sum(count_over_time({service="archaser-core", source="InforuStatusChecker", host="staging"} [$__interval]))',
            'sum(count_over_time({job="nest-docker", environment="staging"} |~ "(?i)inforu|sms" [$__interval]))',
        )
        e = e.replace(
            '{service="archaser-core", source="InforuStatusChecker", host="staging"}',
            '{job="nest-docker", environment="staging"} |~ "(?i)inforu|sms"',
        )
        e = e.replace(
            '{job=~"pm2|archaser-core", level=~"(?i)error|critical|fatal", host="staging"}',
            '{job="nest-docker", environment="staging"} |~ "(?i)error|critical|fatal|exception"',
        )
        e = e.replace(
            'sum(count_over_time({service="archaser-core", level=~"error|critical|fatal", host="staging"} [$__interval])) or sum(count_over_time({job="pm2", app_name=~".+", log_type="error", host="staging"} [$__interval]))',
            'sum(count_over_time({job="nest-docker", environment="staging"} |~ "(?i)error|exception|fatal" [$__interval]))',
        )
        # After generic replace, tighten SES / Open filters
        e = e.replace(
            '{job="nest-docker", environment="staging"} |~ "Delivery"',
            '{job="nest-docker", environment="staging"} |~ "(?i)ses|delivery|delivered"',
        )
        e = e.replace(
            '{job="nest-docker", environment="staging"} |~ "Open"',
            '{job="nest-docker", environment="staging"} |~ "(?i)open|opened|tracking"',
        )
        # Cron log panels
        e = e.replace(
            '{job="nest-docker", environment="staging"} |~ "cron_"',
            '{job="nest-docker", environment="staging"} |~ "(?i)cron|bullmq|repeatable"',
        )
    else:
        e = e.replace(
            '{service="archaser-core", host="production"}',
            '{job="pm2", environment="production"}',
        )
        e = e.replace(
            '{service="archaser-core", host="Production"}',
            '{job="pm2", environment="production"}',
        )
        e = e.replace('{job=~"pm2|archaser-core"', '{job="pm2"')
        e = e.replace(', host="production"', ', environment="production"')
        e = e.replace(', host="Production"', ', environment="production"')

    return e


def walk(obj, env: str) -> None:
    if isinstance(obj, dict):
        if "expr" in obj and isinstance(obj["expr"], str):
            obj["expr"] = fix_expr(obj["expr"], env)
        if "title" in obj and isinstance(obj["title"], str):
            t = obj["title"]
            for prefix in ("api / ", "worker / ", "peels / ", "Dashboards / "):
                if t.startswith(prefix):
                    obj["title"] = t[len(prefix) :]
                    break
        for v in obj.values():
            walk(v, env)
    elif isinstance(obj, list):
        for i in obj:
            walk(i, env)


def nest_services_panels(y_start: int) -> list:
    jobs = [
        ("archaser-api", "API"),
        ("archaser-worker", "Worker"),
        ("archaser-sms", "SMS"),
        ("archaser-connectors", "Connectors"),
        ("archaser-reports", "Reports"),
    ]
    panels: list = [
        {
            "gridPos": {"h": 1, "w": 24, "x": 0, "y": y_start},
            "id": 700,
            "title": "Nest services",
            "type": "row",
            "collapsed": False,
        }
    ]
    for i, (job, title) in enumerate(jobs):
        panels.append(
            {
                "datasource": {"type": "prometheus", "uid": "Prometheus"},
                "fieldConfig": {
                    "defaults": {
                        "mappings": [
                            {
                                "options": {
                                    "0": {"color": "red", "text": "DOWN"},
                                    "1": {"color": "green", "text": "UP"},
                                },
                                "type": "value",
                            }
                        ],
                        "thresholds": {
                            "mode": "absolute",
                            "steps": [
                                {"color": "red", "value": None},
                                {"color": "green", "value": 1},
                            ],
                        },
                    }
                },
                "gridPos": {
                    "h": 4,
                    "w": 4 if i < 4 else 8,
                    "x": i * 4 if i < 4 else 16,
                    "y": y_start + 1,
                },
                "id": 701 + i,
                "options": {
                    "colorMode": "background",
                    "graphMode": "none",
                    "justifyMode": "center",
                    "orientation": "auto",
                    "reduceOptions": {
                        "calcs": ["lastNotNull"],
                        "fields": "",
                        "values": False,
                    },
                    "textMode": "auto",
                },
                "targets": [
                    {
                        "expr": f'up{{job="{job}"}}',
                        "legendFormat": "up",
                        "refId": "A",
                    }
                ],
                "title": title,
                "type": "stat",
            }
        )
    panels.append(
        {
            "datasource": {"type": "prometheus", "uid": "Prometheus"},
            "fieldConfig": {"defaults": {"unit": "reqps"}},
            "gridPos": {"h": 8, "w": 12, "x": 0, "y": y_start + 5},
            "id": 710,
            "options": {
                "legend": {"displayMode": "list", "placement": "bottom"},
                "tooltip": {"mode": "single"},
            },
            "targets": [
                {
                    "expr": 'sum(rate(nest_http_requests_total{service="archaser-api"}[5m])) by (status_code)',
                    "legendFormat": "{{status_code}}",
                    "refId": "A",
                }
            ],
            "title": "API request rate",
            "type": "timeseries",
        }
    )
    panels.append(
        {
            "datasource": {"type": "prometheus", "uid": "Prometheus"},
            "fieldConfig": {"defaults": {"unit": "percentunit", "min": 0, "max": 1}},
            "gridPos": {"h": 8, "w": 12, "x": 12, "y": y_start + 5},
            "id": 711,
            "options": {
                "legend": {"displayMode": "list", "placement": "bottom"},
                "tooltip": {"mode": "single"},
            },
            "targets": [
                {
                    "expr": 'sum(rate(nest_http_requests_total{service="archaser-api",status_code=~"5.."}[5m])) / clamp_min(sum(rate(nest_http_requests_total{service="archaser-api"}[5m])), 1e-9)',
                    "legendFormat": "5xx rate",
                    "refId": "A",
                }
            ],
            "title": "API 5xx rate",
            "type": "timeseries",
        }
    )
    panels.append(
        {
            "datasource": {"type": "prometheus", "uid": "Prometheus"},
            "fieldConfig": {"defaults": {"unit": "percent"}},
            "gridPos": {"h": 8, "w": 12, "x": 0, "y": y_start + 13},
            "id": 712,
            "options": {
                "legend": {"displayMode": "list", "placement": "bottom"},
                "tooltip": {"mode": "single"},
            },
            "targets": [
                {
                    "expr": 'rate(archaser_worker_process_cpu_seconds_total{job="archaser-worker"}[1m]) * 100',
                    "legendFormat": "worker CPU",
                    "refId": "A",
                }
            ],
            "title": "Worker CPU",
            "type": "timeseries",
        }
    )
    panels.append(
        {
            "datasource": {"type": "prometheus", "uid": "Prometheus"},
            "fieldConfig": {"defaults": {"unit": "bytes"}},
            "gridPos": {"h": 8, "w": 12, "x": 12, "y": y_start + 13},
            "id": 713,
            "options": {
                "legend": {"displayMode": "list", "placement": "bottom"},
                "tooltip": {"mode": "single"},
            },
            "targets": [
                {
                    "expr": 'archaser_worker_nodejs_heap_size_used_bytes{job="archaser-worker"}',
                    "legendFormat": "heap used",
                    "refId": "A",
                },
                {
                    "expr": 'archaser_worker_nodejs_heap_size_total_bytes{job="archaser-worker"}',
                    "legendFormat": "heap total",
                    "refId": "B",
                },
            ],
            "title": "Worker heap",
            "type": "timeseries",
        }
    )
    return panels


def main() -> None:
    for env in ("staging", "production"):
        d = ROOT / env
        for path in sorted(d.glob("*.json")):
            data = json.loads(path.read_text())
            walk(data, env)

            if "prometheus" in path.name:
                panels = data.get("panels") or []
                if not any(p.get("id") == 700 for p in panels):
                    for p in panels:
                        gp = p.get("gridPos") or {}
                        if "y" in gp:
                            gp["y"] = gp["y"] + 22
                    data["panels"] = nest_services_panels(0) + panels

                for p in data["panels"]:
                    for t in p.get("targets") or []:
                        ex = t.get("expr", "")
                        if ("nest_nodejs_" in ex or "nest_process_" in ex) and "job=" not in ex:
                            if '{instance="' in ex:
                                t["expr"] = ex.replace(
                                    '{instance="',
                                    '{job="archaser-api", instance="',
                                )
                            if t.get("legendFormat") and "{{instance}}" in t["legendFormat"]:
                                t["legendFormat"] = t["legendFormat"].replace(
                                    "{{instance}}", "api"
                                )

                data["title"] = f"Infrastructure - {env.capitalize()}"
                data["tags"] = ["archaser", "infra", env]

            if "unified" in path.name:
                data["title"] = f"Home / Glance - {env.capitalize()}"
                data["tags"] = ["archaser", "home", env]

            if "cron" in path.name:
                data["title"] = f"Cron Jobs - {env.capitalize()}"
                for p in data.get("panels") or []:
                    if p.get("title") in ("Job Execution Status (24h)", "Executions (24h)"):
                        p["title"] = "Job status (30d from DB)"
                    if "Execution Rate" in str(p.get("title", "")):
                        p["title"] = "Success / Failure totals (30d)"

            if "communications" in path.name:
                data["title"] = f"Communications - {env.capitalize()}"
                for p in data.get("panels") or []:
                    title = p.get("title", "")
                    if "SES" in title or "Webhook" in title:
                        p["title"] = "Email/SES-related log volume"
                    if "Inforu" in title:
                        p["title"] = "SMS/Inforu-related log volume"

            path.write_text(json.dumps(data, indent=4) + "\n")
            print("updated", path.relative_to(ROOT))

        for name in (f"archaser-api-{env}.json", f"archaser-worker-{env}.json"):
            p = d / name
            if p.exists():
                p.unlink()
                print("removed", p.relative_to(ROOT))

    print("done")


if __name__ == "__main__":
    main()
