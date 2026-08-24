---
name: portfolio-health-generate-snapshots
overview: Add a Generate button on Portfolio Health that rebuilds customer-policy and credit-dashboard daily snapshots for the selected date range, using the same true-history writer as the nightly run, with an import-style progress bar.
isProject: false
---

# Portfolio Health — generate snapshots for the selected range

## Problem

Portfolio Health and the credit dashboard charts read **daily snapshot rows**. Those rows are written by nightly jobs. Locally and after imports, the selected range is often empty. There is no per-account control on Portfolio Health to rebuild that history now.

Today’s snapshot writers still use **current** open invoices even when a past date is passed. A generate button that only loops those writers would copy today’s book onto every selected day.

## Solution

1. **Button** next to the from/to dates on Portfolio Health (`/credit-portfolio-health`). Anyone who can open the page can click it. It rebuilds **this account only**.
2. **Range** = the from/to currently selected on the page. Every day in that range is rewritten (overwrite), for **all policies and business units**, same scopes as the nightly dashboard job. Page filters do not limit what is written.
3. **Shared writer** for this button and the nightly run: one “as of that day” calculation (invoices dated on/before that day, minus payments on/before that day) that writes:
   - `CustomerPolicyTrend`
   - `CreditDashboardDailySnapshot`
4. **Same job as the admin history rebuild** (`CreditAsOfBackfillJob`: one row per account, `from_date` / `to_date`, checkpoint, pause). Click **starts that runner immediately** with the selected range. Nightly drain **skips** the account while the job is `running` or `paused`.
5. **UX**: background run; import-style progress bar under the filter row; charts refresh when finished. Leave the page — job keeps running; bar resumes on return. One job per account: **Generate** disabled while running. **Stop** = finish the current day, then halt; keep days already written. **Failure** = keep partial; **Retry** continues from the failed day.
6. **Ignore reporting breach** switch in the filter row (default **on**). Generate treats reporting-late as off in **both** snapshot tables; invoice records stay unchanged; nightly jobs still count reporting-late. Switch is locked while running / paused / failed; Retry keeps the stored job flag; a new Generate can change it.

## Decision log (grill)

| # | Topic | Decision | Plan impact |
|---|--------|----------|-------------|
| D1 | Who | Anyone who can open Portfolio Health; this account only | Gate with `view_credit_dashboard`; no admin-only hide |
| D2 | Tables | Customer-policy daily rows **and** dashboard daily snapshots | Same pair as nightly CPT + dashboard snapshot jobs |
| D3 | Dates | Every day in the selected from/to | Job `from_date` / `to_date` from the page picker |
| D4 | Past-day math | True history (as of that day) | Must land as-of open AR in the shared writer first |
| D5 | Shared logic | Button and nightly use the **same** writer | No second code path for history vs cron |
| D6 | When | Click runs the job **now** | Not “queue until tonight” |
| D7 | Wait | Background + import-style progress + refresh charts | Poll job status; do not hold one HTTP request for the whole range |
| D8 | Existing days | Overwrite every selected day | Upsert; do not skip filled days |
| D9 | Filters | Write whole account like nightly | Ignore policy / business unit / no-policy filters on write |
| D10 | Leave page | Server job; progress bar resumes | Persist `CreditAsOfBackfillJob`; poll on mount |
| D11 | Second click | One job; disable Generate | Reuse unique `account_id` job row |
| D12 | Admin rebuild | Same lock and same runner | Analyst start/stop/retry on the existing job model |
| D13 | Stop | Finish current day, halt, keep written days | Map to existing pause-at-checkpoint |
| D14 | Failure | Keep partial; Retry from failed day | `last_error` + resume from `checkpoint_date` |
| D15 | Placement | Button in the filter row, next to from/to | Progress bar under that row (import pattern) |
| D16 | Ignore meaning | Reporting-late off in snapshots only; invoices unchanged; other breach types still count | Overlay force-off; no invoice writes |
| D17 | Which runs | This Generate job only (Stop / Retry of the same run). Nightly still counts reporting-late | Pass `ignoreReportingBreach` from job flag, not nightly drain |
| D18 | Default | Switch starts **on** | Start API omitted/`true` → skip; UI `useState(true)` |
| D19 | Mid-job | Lock while running / paused / failed. Retry keeps original. New Generate can change | Hold ignore flag in process memory for this Generate; no DB column |
| D20 | Charts | Both snapshot tables (Health + credit dashboard) | Same overwrite pair as Generate today |
| D21 | Switch place | Filter row, next to Generate / Stop / Retry | MUI `Switch` + existing tooltip helper |
| D22 | Copy | “Ignore reporting breach” + tooltip below | English `defaultValue` until translation files allowed |

## Blocking gates

| Gate | If yes | If no |
|------|--------|-------|
| Shared snapshot writer uses true as-of open AR for a past `snapshotDate` | Button and nightly history are trustworthy | **Do not ship the button** — it would stamp today’s book onto past days |
| `CreditAsOfBackfillJob` runner accepts a bounded from/to (not only full history) | Health button can start it | Need a small runner change before the UI |
| Analyst (`view_credit_dashboard`) can start / stop / retry **their** account job | Matches D1 | Would regress to admin-only |

## Out of scope unless asked

- Insurance policy trend snapshots
- New colours / CSS — reuse existing import `LinearProgress`
- Translation file edits until explicitly allowed (EN + HE keys will be needed)
- Stamping live AR onto past days as a shortcut

## Implementation sketch (after approval)

1. **Writer** — Make `syncCustomerPolicyTrendSnapshotForAccount` and `takeCreditDashboardDailySnapshotsForAccount` compute open AR **as of `snapshotDate`**. Nightly today (`snapshotDate` = today) stays correct. Nightly rewrite drain and this button call the same functions.
2. **Job** — Start/pause/retry/status APIs on the existing `CreditAsOfBackfillJob` for the session account, allowed with `view_credit_dashboard`. Start sets `from_date`/`to_date` from the page, `status=running`, resets checkpoint for that range. Ignore reporting-late is taken from the Generate click and kept in memory for that run (Stop / Retry), not stored on the job row.
3. **UI** — Generate + Ignore reporting breach + Stop + Retry + determinate progress (`days_done` / `days_total`) next to the date range on `CreditPortfolioHealthScreen`. Poll while `running`/`paused`. On `idle` after success, refetch Portfolio Health.
4. **Tests** — Writer as-of vs live for a paid-after-day invoice; overlay ignore reporting-late keeps other flags; job lock (second start refused); pause keeps checkpoint; retry resumes with stored skip flag; HTTP forbidden without credit dashboard view.

## How to test

1. Open `/credit-portfolio-health` with credit dashboard access.
2. Set a from/to range that includes days with no snapshots (or days known to be wrong).
3. Click Generate. Confirm the import-style bar moves; Generate is disabled; leaving and returning still shows progress.
4. When done, Health charts and the credit dashboard trend show points for those days.
5. Click Generate again while running — it stays disabled.
6. Stop mid-run — later days are missing; earlier days remain. Retry continues from the next unfinished day.
7. Confirm a second browser/user on the same account also sees the running job, not a second start.
8. Generate with ignore **on** (default): reporting-late bucket is empty for those days; other breach types remain; invoice `reporting_breach` is unchanged. Nightly rewrite of today can still show reporting-late.
9. Stop, flip the switch — it stays locked. Retry keeps the original ignore setting. After complete, a new Generate can use a different setting.
