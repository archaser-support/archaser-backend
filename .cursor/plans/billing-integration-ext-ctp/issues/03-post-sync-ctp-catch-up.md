# 03 — Post-sync CTP catch-up

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 10, 11, 12, 13, 14, 15, 16, 17, 19
**PRD:** `.cursor/plans/billing-integration-ext-ctp.prd.md`

## What to build

After an accepted in-process billing sync finalizes as `SUCCESS` for `incremental` or `backfill` (not preview), run a CTP-only catch-up for that account: day-by-day from the day after the last successful Customer×Policy Trend snapshot through today, capped at 30 days, reusing the existing per-account CTP snapshot writer. Do not run Portfolio Health Generate. If CTP fails, leave billing sync status as SUCCESS; log the error; add a light non-blocking warning in Sync History or Integration UI only if a small reuse path exists. Prefer a single hook shared by scheduled and manual accepted syncs.

## Acceptance criteria

- [x] SUCCESS incremental sync triggers CTP catch-up for that account
- [x] SUCCESS backfill sync triggers the same catch-up
- [x] Preview / FAILED / PARTIAL do not trigger catch-up
- [x] Catch-up fills missing days after the last successful CTP day through today, max 30 days
- [x] No prior CTP history → generate today only (within the cap)
- [x] CTP failure does not change sync run status from SUCCESS
- [x] CTP failure is logged; light warning only if easy reuse
- [x] Does not invoke full Generate / dashboard snapshot backfill

## How to test

1. On a test account with a known last CTP snapshot a few days ago, run a successful incremental billing sync.
2. Confirm CTP rows exist for the missing days through today (≤30).
3. Confirm Sync History still shows SUCCESS for the billing run.
4. Force a CTP failure in a safe test setup (or stub) and confirm sync remains SUCCESS with a log/warning.
5. Run a preview sync and confirm CTP catch-up does not run.
6. Spot-check a successful backfill path the same way.
