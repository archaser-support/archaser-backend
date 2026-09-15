# 08 — Breach dilution vs resolution + clean streaks

**Status:** done
**Priority:** normal
**Blocked by:** [01-shared-ctp-series-utilities](01-shared-ctp-series-utilities.md)
**User stories:** 20, 21, 22, 28
**PRD:** `.cursor/plans/bucket1-ctp-kpis.prd.md`

## What to build

Ship KPI #11 (breach persistence vs dilution) and KPI #12 (breach clean-streak / episode tracking). Customer banner beside Health Index for rising-health cases with breach history: resolved vs diluted with raw breach $ and AR trends. PH Tab 1 filterable/exportable diluted-customer queue. Breach badge near Terms Breach: breach-free N days / in breach N days / no breach on record. Exportable episode history (start, end/ongoing, duration, peak $). Reuse shared streak helper; missing days excluded. Never classify never-breached customers as resolved/diluted. Purpose tooltips + EN+HE.

## Acceptance criteria

- [x] Diluted vs resolved classification uses breach amount trend + AR growth rules from the prompt defaults
- [x] Never-breached customers are N/A (not resolved)
- [x] Clean streak vs open breach badge correct; “no breach on record” when never breached in available history
- [x] Episode history exportable from PH
- [x] Diluted queue filterable/exportable on Tab 1
- [x] EN+HE purpose tooltips

## How to test

1. Customer with rising health but persistent non-zero breach and large AR growth → diluted banner; appears on PH diluted list/export.
2. Customer whose breach amount fell sharply while health rose → resolved framing.
3. Customer clean after a past episode → green breach-free N days; episode history shows closed episode.
4. Customer never breached → “no breach on record”, not a huge clean streak from window start.
5. Hebrew spot-check.
