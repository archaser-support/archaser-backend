---
name: portfolio-health-generate-recent
overview: Add a Generate recent action on Portfolio Health that rebuilds whole-account as-of snapshots for the pending CreditAsOfRewriteQueue window only, without replacing full-range Generate.
source: grill-me session
isProject: false
---

# Portfolio Health — generate recent (pending rewrite window)

## Problem Statement

After scheduled daily billing imports (and other invoice/payment imports), Portfolio Health history is stale until the nightly as-of rewrite drain runs. Analysts already have **Generate**, but it rebuilds every day in the page from/to range—often a full calendar year—even when only a short import-driven rewrite window is pending. Waiting for tonight or running a long Generate is too slow for a same-day refresh of the days the import already marked as needing rewrite.

## Solution

Add a second filter-row action, **Generate recent**, next to existing **Generate** on Credit Portfolio Health.

- **Generate** keeps today’s behavior: rebuild the selected page date range.
- **Generate recent** starts the same `CreditAsOfBackfillJob` runner, but the server sets `from_date` / `to_date` from the account’s **pending** `CreditAsOfRewriteQueue` row (not from the page picker).
- Writes remain **whole-account** as-of snapshots for `CustomerPolicyTrend` and `CreditDashboardDailySnapshot` (same writers as full Generate).
- The pending rewrite row is **left pending** so the nightly drain can still process it later.
- When there is no pending rewrite row, **Generate recent** is disabled with a short reason.
- Shared controls: Ignore reporting breach, Stop, Retry, and the import-style progress bar.

## User Stories

1. As a credit analyst, I want a **Generate recent** button next to Generate, so that I can refresh only the days waiting for nightly rewrite without rebuilding the whole year.
2. As a credit analyst, I want Generate to keep rebuilding my selected from/to range, so that I can still force a full history refresh when I need it.
3. As a credit analyst, I want Generate recent to use the pending rewrite queue window, so that the dates match what imports already enqueued for correction.
4. As a credit analyst, I want Generate recent enabled after a scheduled daily billing sync that enqueued a rewrite, so that I can update Portfolio Health the same day.
5. As a credit analyst, I want Generate recent enabled after a manual invoice or payment import that enqueued a rewrite, so that I am not limited to scheduled sync only.
6. As a credit analyst, I want Generate recent enabled when other rewrite events leave a pending queue row, so that “recent” means “waiting for nightly,” not “ERP schedule only.”
7. As a credit analyst, I want Generate recent disabled when there is no pending rewrite row, so that I do not start a no-op job.
8. As a credit analyst, I want a short disabled reason (tooltip or helper), so that I understand why Generate recent is unavailable.
9. As a credit analyst, I want Generate recent disabled when the rewrite row is `processing` or `done`, so that I do not race the nightly drain mid-walk.
10. As a credit analyst, I want the UI to show the pending from/to dates when Generate recent is enabled, so that I know which days will be rebuilt.
11. As a credit analyst, I want Generate recent to ignore the page date picker for the job window, so that a year-long chart range does not force a year-long generate.
12. As the system, I want the start API to resolve dates from the pending queue when mode is recent, so that stale UI dates cannot start the wrong window.
13. As the system, I want a clear error when mode is recent and no pending row exists, so that a late click after drain cannot invent a range.
14. As a credit analyst, I want Generate recent to rewrite the whole account for each day in the pending window, so that Portfolio Health and credit dashboard scopes stay consistent with full Generate.
15. As a credit analyst, I want Generate recent to write both Customer Policy Trend and Credit Dashboard Daily Snapshot rows, so that Health charts and dashboard trends stay aligned.
16. As a credit analyst, I want Generate recent to use true as-of open accounts receivable for each snapshot day, so that past days are not stamped with today’s live book.
17. As a credit analyst, I want the same Ignore reporting breach switch for Generate recent as for Generate, so that I have one control model.
18. As a credit analyst, I want Ignore reporting breach to default on for Generate recent, so that behavior matches full Generate.
19. As a credit analyst, I understand that leaving the queue pending means nightly drain may later rewrite the same days with reporting-late counted, so that Ignore on Generate recent may be temporary until tonight.
20. As a credit analyst, I want Stop and Retry to work the same for a recent run as for a full-range run, so that I do not learn two job UIs.
21. As a credit analyst, I want both Generate and Generate recent disabled while a generate job is running, so that I cannot start a second concurrent job on the account.
22. As a credit analyst, I want Generate recent to start even if a previous generate is paused or failed, so that I can abandon a long paused year-range and refresh the pending import window instead.
23. As a credit analyst, I want Retry after Stop to resume the recent job’s checkpoint, so that I do not lose progress mid-window.
24. As a credit analyst, I want a confirmation when the pending window exceeds about 90 days, so that I am warned when “recent” is still large because of an old invoice or payment date.
25. As a credit analyst, I want Generate recent to walk the full pending window even if it exceeds 366 days, so that it matches what nightly drain would eventually rewrite.
26. As a credit analyst, I want to click Generate recent again after success while the row is still pending, so that I can re-run without waiting for a new import.
27. As a credit analyst, I want the progress bar to show days done / days total for the recent job, so that I can see progress the same way as full Generate.
28. As a credit analyst, I want charts to refetch when the recent job completes, so that Portfolio Health updates without a manual reload.
29. As a credit analyst, I want to leave the page while Generate recent runs and see progress when I return, so that background generation still works.
30. As a credit analyst with credit dashboard view access, I want to start Generate recent on my account only, so that I cannot affect other accounts.
31. As a user without credit dashboard view, I want Generate recent APIs forbidden, so that access matches existing Generate gates.
32. As the nightly drain, I want the pending rewrite row left pending after Generate recent, so that I still process that work on the normal cadence.
33. As the nightly drain, I want to skip an account while Generate recent’s backfill job is running or paused, so that the existing backfill lock still protects concurrent writers.
34. As a credit analyst, I want English and Hebrew copy for the new button, disabled reason, helper dates, and large-range confirm, so that the UI is complete in both locales.
35. As a product owner, I want this feature documented relative to full Generate and the as-of rewrite PRD, so that “generate recent” is not confused with consuming or replacing the nightly drain.

## Implementation Decisions

- **Separate action, not a replacement** — Keep full-range Generate. Add **Generate recent** beside it on the Portfolio Health filter row.
- **Date source** — Eligible window is the account’s `CreditAsOfRewriteQueue` row with status **`pending` only**. Use that row’s `from_date` → `to_date`. Do not use `processing` or `done`. Do not use the page from/to for the job window.
- **Which events enable the button** — Any pending rewrite (scheduled billing sync, manual import, or other enqueue paths). No new “source = scheduled” flag.
- **Empty / ineligible queue** — Disable Generate recent with a short reason. Do not start a job.
- **Start contract** — Start accepts a recent mode (for example `mode: "recent"`). Server loads the pending queue and starts `CreditAsOfBackfillJob` with those dates. Client must not supply the authoritative from/to for recent mode. If no pending row: reject (400/409-style clear error).
- **Status contract** — Extend existing as-of backfill status (or the same poll payload the UI already uses) with pending rewrite `{ from, to } | null` so the UI can enable/disable and show dates without a second poller.
- **Write scope** — Whole account for every day in the pending window (all policies / business-unit scopes as full Generate). Do not scope CPT writes to queue `customer_ids` for this button.
- **Writers** — Same as-of writers as full Generate / nightly: Customer Policy Trend and Credit Dashboard Daily Snapshot. Overwrite existing days. True as-of open AR per `docs/agents/domain.md`.
- **Queue after success** — Do **not** mark the rewrite row `done`. Leave it pending for nightly drain. Analysts may re-run Generate recent while it remains pending.
- **Ignore reporting breach** — Same switch and defaults as full Generate. Nightly drain still counts reporting-late and may overwrite Ignore results later because the queue stays pending.
- **Job model** — One `CreditAsOfBackfillJob` per account. Running blocks both starts. Starting recent over paused/failed/complete replaces the job (fresh range, checkpoint reset) like Generate today. Shared Stop / Retry.
- **Large window UX** — Reuse the existing ~90-day confirmation pattern when pending day count exceeds the threshold; still allow start.
- **No 366-day cap on recent** — Walk the full pending window even if longer than the Portfolio Health picker max (366). Matches nightly drain semantics.
- **Auth** — Same gate as Generate (`view_credit_dashboard`); this account only.
- **i18n** — New user-facing strings in English and Hebrew in the same change.
- **Styling** — Reuse existing button / tooltip / progress patterns; no new styles without approval.
- **Related PRDs** — Builds on `portfolio-health-generate-snapshots` and `as-of-daily-snapshot-rewrite`; does not change drain cadence or enqueue rules.

### Grill decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Generate scope | Recent as a **separate** action; keep full-range Generate | Fast post-import path without removing year rebuild |
| D2 | Date source | Pending rewrite queue `from_date` → `to_date` | Same window imports enqueue for nightly |
| D3 | Empty queue | Disable + short reason | No no-op job; expose pending on status |
| D4 | Queue after success | Leave pending for nightly | Nightly may rewrite again; can undo Ignore |
| D5 | Ignore on recent | Same switch as full Generate | One control; Ignore may be temporary (D4) |
| D6 | Customer write scope | Whole account for queue days | Same write path; only dates shrink |
| D7 | UI | Second button **Generate recent** | Show pending from/to when enabled |
| D8 | Eligible queue | `pending` only | Avoid racing mid-drain `processing` |
| D9 | Start contract | Server resolves dates (`mode: "recent"`) | No stale client dates |
| D10 | Huge “recent” window | Same ~90-day confirm as full Generate | Honest when one old date stretches the queue |
| D11 | Which events | Any pending rewrite | No source flag required |
| D12 | Existing paused job | Start recent anyway; abandon paused range | One-job model |
| D13 | Pending > 366 days | Walk full pending window | Match nightly drain |
| D14 | After success | Allow re-run while still pending | No “already generated” tracking |

## Testing Decisions

- Prefer **external behavior** over implementation details: start mode, status payload, job dates, queue left pending, disable when no pending, conflict when already running, auth.
- **Ideal seam (one):** credit-insurance as-of backfill start/status HTTP contract (or the domain start helper behind it) — assert that recent mode reads pending queue dates, starts the existing backfill job, leaves queue pending, and rejects when no pending row. Avoid new seams if this path can cover the behavior.
- **Secondary thin coverage (only if needed):** UI wiring is acceptable as manual How to test; do not require a second automated seam unless HTTP leaves a gap.
- **Prior art:** `tests/backend/api/credit-asof-backfill-job.test.ts`, `tests/backend/api/credit-insurance.http.test.ts` (asof-backfill status/start gates), existing Generate large-range confirm UX on Portfolio Health.
- Good tests assert: pending dates become job `from`/`to`; no pending → error; `processing` does not enable recent; running job → conflict; Ignore flag stored on job as today; queue status still `pending` after successful recent run.
- Do not assert private SQL shape or React internals unless no higher seam exists.

## Out of Scope

- Replacing or removing full-range Generate
- Marking the rewrite queue `done` after Generate recent (consuming the drain)
- Filtering Generate recent to scheduled billing sync only
- Customer-scoped Generate writes (queue `customer_ids` for CPT-only narrowing)
- Starting recent from `processing` remaining days / racing active drain
- Hard cap refusing recent runs above N days
- New schema columns for “source” or “already generated for this queue row”
- Insurance policy trend snapshots
- New visual styles beyond existing Portfolio Health generate controls
- Changing nightly drain schedule, coalesce rules, or enqueue anchors

## Further Notes

- **Product wording:** “Recent” means the pending as-of rewrite window, not “last N calendar days” and not “scheduled ERP only.”
- **Ignore reporting breach + D4:** Document in UI tooltip that nightly drain may rewrite the same days later with reporting-late counted.
- **Performance:** A pending window can still be large when an import includes an old invoice/payment date; the ~90-day confirm is the safety net, not a hard limit.
- **Prerequisite trust:** Snapshot correctness still depends on true as-of open AR writers (`docs/agents/domain.md`).
## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/portfolio-health-generate-recent/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/portfolio-health-generate-recent/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Generate recent happy path | `issues/01-generate-recent-core.md` | — | 1–6, 10–18, 20–23, 25–33 |
| 2 | Guards, large-range confirm, copy | `issues/02-generate-recent-guards-copy.md` | 01 | 7–9, 19, 24, 34–35 |

**Status:** `ready-for-agent` on all slices.
