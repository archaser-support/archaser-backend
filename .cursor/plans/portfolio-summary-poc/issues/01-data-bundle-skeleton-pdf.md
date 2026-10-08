# 01 — Data bundle and skeleton Hebrew PDF

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 16, 18, 20, 22, 23
**PRD:** `.cursor/plans/portfolio-summary-poc.prd.md`

## What to build

The end-to-end tracer. A backend script takes an account and a from/to range (POC: 10149, Apr 1 – Sep 30, 2026). It calls the same portfolio-health domain service the dashboard uses, with the default scope (no policy filter, all business units, no-policy exposure excluded). It adds the policy terms and claims/remaining-excess data the Policy summary tab shows, and writes one JSON data bundle to the gitignored local workspace.

A render step turns the bundle into a skeleton Hebrew RTL PDF: a title, the range, a days-with-data note and a plain KPI table per area (policy terms, health, no coverage, utilization, costs). There is no narrative or charts yet. This proves the pipeline from data to PDF, including Hebrew RTL output.

## Acceptance criteria

- [x] Script runs with account, from and to arguments and fails clearly on invalid input
- [x] Bundle contains range, days available and days in range, health, no-coverage, utilization and costs sections, policy terms and claims/excess
- [x] Bundle and PDF are written only to the gitignored local workspace, and no customer data is committed
- [x] Skeleton PDF renders Hebrew right-to-left with correct currency and percent formatting
- [x] No new npm dependencies; if a headless browser download is needed, the user is asked first

## How to test

1. Run the script for account 10149, Apr 1 – Sep 30, 2026.
2. Open Portfolio Health in the app for the same account and range with default filters.
3. Compare the KPI table in the skeleton PDF with each dashboard tab. Expect every value to match, and Hebrew text, numbers and currency symbols to read correctly right-to-left.
