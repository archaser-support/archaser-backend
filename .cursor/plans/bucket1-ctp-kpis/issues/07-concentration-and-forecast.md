# 07 — Policy concentration + limit-breach forecast

**Status:** done
**Priority:** normal
**Blocked by:** [01-shared-ctp-series-utilities](01-shared-ctp-series-utilities.md)
**User stories:** 16, 17, 18, 19, 28
**PRD:** `.cursor/plans/bucket1-ctp-kpis.prd.md`

## What to build

Ship KPI #9 (policy concentration) and KPI #10 (limit-breach forecast). PH concentration card per policy: top-1 share headline, top-3 cumulative, ranked horizontal bars; exportable ranked list. Exclude single-customer policies from concentration *alerting* (still may show 100% context). Customer policy panel context line: share of policy open AR. Forecast: trailing-window trend of usage %; project crossing of default 150%/200% only when trending toward threshold and R² above floor; otherwise suppress or “trending away”. Extend Credit dashboard Limit Warnings with clearly labeled **projected** entries + exportable report rows. Purpose tooltips + EN+HE.

## Acceptance criteria

- [x] Concentration shares computed on latest (or selected) snapshot per policy
- [x] Single-customer policies excluded from concentration risk alerting
- [x] Forecast suppressed on low R² / short windows; no false-precision dates
- [x] Limit Warnings distinguish projected vs actual near-limit/score warnings
- [x] Exportable reports for concentration ranking and projected warnings
- [x] EN+HE purpose tooltips

## How to test

1. Multi-customer policy → PH concentration card shows ranked shares; export lists customers.
2. Single-customer policy → no concentration alert noise.
3. Customer climbing toward 200% util with decent fit → projected warning appears on Credit dashboard, labeled projected.
4. Noisy/flat series → forecast suppressed.
5. Hebrew spot-check.
