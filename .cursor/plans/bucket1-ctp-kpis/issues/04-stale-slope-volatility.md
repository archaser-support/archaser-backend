# 04 — Stale snapshots + health slope + AR volatility

**Status:** done
**Priority:** normal
**Blocked by:** [01-shared-ctp-series-utilities](01-shared-ctp-series-utilities.md)
**User stories:** 9, 10, 11, 12, 13, 28
**PRD:** `.cursor/plans/bucket1-ctp-kpis.prd.md`

## What to build

Ship KPI #7 (stale/carried-forward snapshots), #5 (health index trend slope), and #6 (day-over-day AR volatility). Surface PH footnote for carried-forward days; mute/mark stale days on AR trend charts. Customer Health Index gets momentum badge (improving/flat/deteriorating) with slope on hover plus peak/current framing; PH Tab 1 shows portfolio-level momentum. Volatility card with σ daily swing, bipolar sparkline, and flaggable extreme single-day moves. Slope/volatility **exclude stale days by default**. Suppress slope classification when too few available days. Purpose tooltips + EN+HE. Exportable drill-downs where the prompts require lists of extreme moves / stale detail if needed for audit.

## Acceptance criteria

- [x] Stale identical non-zero AR runs are detected; footnote shows count; charts mark carried-forward days
- [x] Health slope badge/classification uses shared helper; insufficient days suppress classification
- [x] Volatility skips DoD pairs across data gaps and skips/caps AR[t-1]=0 safely
- [x] Stale days excluded from slope and volatility denominators by default
- [x] Peak/current health framing works for non-monotonic series
- [x] EN+HE purpose tooltips on new UI

## How to test

1. Customer with weekend-identical AR → chart marks carried-forward; footnote count increases on PH.
2. Customer with non-monotonic health → badge/hover shows slope; peak date/value and current value both visible.
3. Customer with a large single-day AR drop → extreme move is flaggable separately from σ.
4. Confirm turning points across a missing snapshot day do not invent a false spike.
5. Hebrew spot-check.
