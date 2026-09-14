# 01 — Shared CTP streak, trend, and stale utilities

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 25, 26
**PRD:** `.cursor/plans/bucket1-ctp-kpis.prd.md`

## What to build

Add shared, pure domain utilities for CTP daily series used by later KPI slices: (1) streak/run detection that ignores missing snapshot days (do not treat gaps as clean), (2) trailing-window linear slope/trend with suppress-when-too-few-days, (3) stale/carried-forward detection for consecutive identical non-zero AR values. Prefer generalizing existing Portfolio Health streak helpers into one reusable place in the credit-insurance domain rather than copying logic per KPI. Export helpers so customer KPIs, portfolio health, and forecast code call the same primitives. No end-user UI in this slice beyond whatever is required to keep the package building.

## Acceptance criteria

- [ ] One shared streak/run API covers over-limit days, breach days, and similar boolean-day series with available-day semantics
- [ ] Trailing-window slope helper returns slope, optional R², and suppress flag when days are insufficient
- [ ] Stale-run helper marks carried-forward days and can produce an exclude set for slope/volatility consumers
- [ ] Missing calendar days between snapshots break streaks and are excluded from denominators (same spirit as Portfolio Health days available)
- [ ] No duplicate streak implementations left behind in the new call paths this slice touches

## How to test

1. Call the new helpers with a short hand-built series that includes a one-day gap, a clean day, and a weekend of identical AR.
2. Confirm the gap does not count as a clean day / does not continue a streak.
3. Confirm identical non-zero AR across consecutive snapshot days is flagged stale after the first day.
4. Confirm slope is suppressed when fewer than the configured minimum available days are present.
5. Run package/typecheck for the domain package (or backend `tsc`) to ensure exports compile.
