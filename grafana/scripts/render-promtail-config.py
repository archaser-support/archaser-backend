#!/usr/bin/env python3
"""Render promtail-config.generated.yaml from template + MONITORING_ENV.

Replaces every __MONITORING_ENV__ token with staging|production so docker and
PM2 log streams match Grafana dashboard selectors
(environment=\"staging\"|\"production\").
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "promtail-config.template.yaml"
OUT = ROOT / "promtail-config.generated.yaml"
ALLOWED = frozenset({"staging", "production"})


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--monitoring-env",
        required=True,
        help="staging or production (sets Promtail environment label)",
    )
    args = parser.parse_args()
    env = args.monitoring_env.strip().lower()
    if env not in ALLOWED:
        print(
            f"ERROR: --monitoring-env must be one of {sorted(ALLOWED)}, got {env!r}",
            file=sys.stderr,
        )
        return 1
    if not TEMPLATE.is_file():
        print(f"ERROR: template missing: {TEMPLATE}", file=sys.stderr)
        return 1

    rendered = TEMPLATE.read_text(encoding="utf-8").replace("__MONITORING_ENV__", env)
    if "__MONITORING_ENV__" in rendered:
        print("ERROR: template still contains __MONITORING_ENV__ after replace", file=sys.stderr)
        return 1

    if OUT.is_dir():
        # Docker bind-mount leftover when file was missing at first compose up
        OUT.rmdir()
    OUT.write_text(rendered, encoding="utf-8", newline="\n")
    print(f"Wrote {OUT} (environment={env})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
