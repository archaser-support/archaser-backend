# 01 — Generate recent happy path

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 25, 26, 27, 28, 29, 30, 31, 32, 33
**PRD:** `.cursor/plans/portfolio-health-generate-recent.prd.md`

## What to build

Ship an end-to-end **Generate recent** path on Portfolio Health that rebuilds the pending as-of rewrite window without using the page date picker.

Deliver:

1. **Status** — Existing as-of backfill status (or the same poll payload) includes pending rewrite `{ from, to } | null` for a **`pending`** queue row only (`processing` / `done` / missing → null).
2. **Start** — Start accepts recent mode (e.g. `mode: "recent"`). Server reads the pending queue and starts the existing `CreditAsOfBackfillJob` with those dates. No client-authoritative from/to. Clear error if no pending row. Whole-account as-of writes for Customer Policy Trend and Credit Dashboard Daily Snapshot (same writers as Generate). Do **not** mark the rewrite row done.
3. **UI** — Second button **Generate recent** beside Generate. When pending is present, enable and show the pending from/to. Click starts recent mode with the shared Ignore reporting breach flag. While a job is running, disable both Generate and Generate recent. Reuse Stop, Retry, and progress bar. On complete, refetch Portfolio Health. Starting recent over paused/failed replaces the job like Generate today. Re-run while still pending is allowed.
4. **Copy** — English and Hebrew for the button label and basic tooltip/helper that shows the pending window.

Full-range Generate behavior stays unchanged.

## Acceptance criteria

- [x] Status exposes pending rewrite `{ from, to }` only when the account has a `pending` rewrite queue row; otherwise null.
- [x] `mode: "recent"` start resolves dates from that pending row and starts the existing backfill job; rejects when none.
- [x] Job writes whole-account CPT + dashboard snapshots for each day in the pending window; page from/to is not used for the job range.
- [x] After successful Generate recent, rewrite queue row remains `pending`.
- [x] Generate recent button appears next to Generate; enabled with pending dates when status has a window; shares Ignore / Stop / Retry / progress; both starts disabled while running.
- [x] Charts refetch when the recent job completes; leave/return still shows progress.
- [x] Auth matches Generate (`view_credit_dashboard`); this account only.
- [x] New button/helper strings present in English and Hebrew.

## How to test

1. On a credit-insurance account, complete an invoice or payment import (or billing sync) that enqueues a rewrite so `CreditAsOfRewriteQueue` has a **pending** row with a known from/to.
2. Open `/credit-portfolio-health` with a wide page range (e.g. full year). Confirm **Generate** still uses the page range, and **Generate recent** is enabled and shows the pending from/to (not the year).
3. Click **Generate recent**. Confirm progress advances for the pending day count only; Generate and Generate recent are disabled while running.
4. When complete, Portfolio Health charts update for those days. Confirm the rewrite queue row is still **pending**.
5. Click **Generate recent** again — it starts again on the same pending window.
6. Stop mid-run, then Retry — resumes from checkpoint. Optionally start Generate recent while a prior Generate is paused — recent replaces that job.
7. Confirm a user without credit dashboard view cannot start the job.
