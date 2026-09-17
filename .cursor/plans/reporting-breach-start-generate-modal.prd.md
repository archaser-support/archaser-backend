---
name: reporting-breach-start-generate-modal
overview: Replace skip/ignore reporting-breach switches with a required Billing reporting breach start date, and move Portfolio Health Generate controls into an AppDialog while keeping progress on the page.
source: grill-me session (Portfolio Health Generate modal + reporting breach start date)
clickup_task_url: https://app.clickup.com/t/869f3cq5c
isProject: false
---

# Reporting breach start date + Portfolio Health Generate modal

## Problem Statement

Portfolio Health clutter puts Generate, Generate recent, Stop, Resume/Retry, and an “Ignore reporting breach” switch in the page toolbar next to normal filters. Analysts need those controls in a modal (like other AppDialog flows) while still watching progress on the page.

Separately, reporting-breach cutover is confusing: Billing has “Skip reporting breach during backfill,” Portfolio Health has a per-run ignore switch, and the domain already gates reporting breach using `backfill_start_date` under the hood. Teams need one explicit, required **Reporting breach start date** (next to MEP breach start date) that applies to live stamps, connector backfill, overnight jobs, and Portfolio Health Generate / recalculation—without per-run toggle knobs.

## Solution

1. Add a required **Reporting breach start date** on the Billing connector cutover UI (after **MEP breach start date**). Invoices issued on or after that calendar day participate in reporting-breach evaluation; earlier invoices never do. The field stays editable after backfill (unlike MEP). No soft prefill from backfill start date.
2. Remove both product switches: Portfolio Health “Ignore reporting breach” and Billing “Skip reporting breach during backfill.” Drop the related connector and Generate-job boolean flags from schema/API/runtime.
3. On Billing save when the date changes: persist immediately, kick a **background** full account reporting-breach recompute (promote and clear), then show success with a link/button to Portfolio Health Generate. Do not auto-start Generate.
4. Move Generate / Generate recent / Stop / Resume/Retry into an AppDialog opened from a status-aware toolbar button. Keep the progress bar (and ETA / last error) on the page. Inline the large-range confirm inside the modal. Auto-open when landing with an active job; after dismiss, stay closed until the user reopens or a new attention transition occurs.

Ship as **two vertical slices**: Billing date + flag cleanup first, then the Generate modal.

## User Stories

1. As an onboarding specialist, I want a Reporting breach start date on Billing after MEP breach start date, so that cutover dates for breaches sit together.
2. As an onboarding specialist, I want the field required on save, so that every configured connector has an explicit gate.
3. As an onboarding specialist, I want no soft prefill from backfill start date, so that I consciously choose the reporting gate.
4. As an onboarding specialist, I want existing connectors with a backfill start date to be seeded once on migrate, so that behavior does not suddenly expand to full history.
5. As an onboarding specialist, I want connectors without a backfill start date left unset until I enter a date, so that we never invent a silent fallback.
6. As an onboarding specialist, I want to edit the reporting breach start date after backfill has started, so that I can correct cutover without a backfill reset.
7. As an onboarding specialist, I want the “Skip reporting breach during backfill” switch removed, so that one date rule applies to backfill too.
8. As a credit analyst, I want invoices issued before the reporting breach start date never to show reporting breach, so that import history does not look like term violations.
9. As a credit analyst, I want invoices on or after the date to follow normal reporting-breach rules, so that live risk stays accurate.
10. As a credit analyst, I want connector backfill to stamp reporting breach using that same date gate, so that import and overnight jobs agree.
11. As a credit analyst, I want changing the date on Billing to kick a background full recompute, so that invoice flags catch up without blocking the form.
12. As a credit analyst, I want that recompute to clear breaches that fall out of scope, not only promote new ones, so that moving the date forward actually cleans the grid.
13. As a credit analyst, I want a success message with a link to Portfolio Health Generate after recompute, so that I know charts still need a snapshot rebuild.
14. As a credit analyst, I want Generate to fail closed when the date is missing, so that we never silently evaluate full history.
15. As a credit analyst, I want overnight reporting-breach sweeps to skip accounts with a missing date and log/metric that skip, so that ops can find gaps.
16. As a credit analyst, I want Portfolio Health Generate to stop sending a per-run skip flag, so that snapshots always respect the account date gate.
17. As a credit analyst, I want the Ignore reporting breach switch gone from Portfolio Health, so that the page is not offering a conflicting override.
18. As a credit analyst, I want Generate controls in a modal like other AppDialogs, so that the toolbar stays for filters only.
19. As a credit analyst, I want a single status-aware toolbar button to open that modal, so that I can re-enter Stop/Resume while a job runs.
20. As a credit analyst, I want the progress bar to stay on the page, so that I can watch progress while reading charts.
21. As a credit analyst, I want Stop / Resume / Retry only inside the modal, so that control ownership is clear.
22. As a credit analyst, I want the modal to stay open after Generate starts, so that Stop is one click away.
23. As a credit analyst, I want to close the modal freely while a job runs, so that I can use the rest of the page.
24. As a credit analyst, I want large-range confirmation inline in the modal, so that I am not stacking a second dialog.
25. As a credit analyst, I want the modal body to show the page date range and the pending rewrite window, so that Generate vs Generate recent is obvious.
26. As a credit analyst, I want the modal to auto-open when I land with a running, paused, or failed job, so that controls are immediately available.
27. As a credit analyst, I want dismiss to stick for that visit until I reopen or a new attention transition happens, so that polling does not re-pop the modal.
28. As a Hebrew-speaking user, I want new Billing and Portfolio Health copy in Hebrew and English together, so that locales stay in sync.
29. As a developer, I want `resolveReportingBreachStartDate` to read the new connector column, so that live and as-of paths share one gate.
30. As a developer, I want connector and job skip-reporting-breach booleans removed in the same work, so that dead flags cannot drift.
31. As a support engineer, I want the configured date on account Billing settings responses, so that I can explain breach counts without DB access.

## Implementation Decisions

### Delivery

- Two slices: (1) Billing reporting breach start date + remove switches/flags + background recompute + null handling; (2) Portfolio Health Generate modal (assumes per-run flag already gone).
- Primary planning and schema live in the backend repo; frontend Billing and Portfolio Health UI change when those slices are implemented (same branch name in frontend when first touched).

### Storage and migration

- Add nullable-at-DB `reporting_breach_start_date` (`@db.Date`) on BillingConnector beside `mep_breach_start_date`.
- Product rule: required on Billing cutover save (API 400 if missing/empty/invalid).
- One-time migrate: set `reporting_breach_start_date = backfill_start_date` where backfill start date is present; leave null otherwise (no invented fallback).
- Stop resolving reporting breach start from `backfill_start_date`; point the existing resolver at `reporting_breach_start_date`.
- Remove `skip_reporting_breach_on_backfill` from connector schema, API, Billing UI, and sync paths.
- Remove Generate / as-of backfill job `skip_reporting_breach` / `skipReportingBreach` from schema, API body, job view, and runner (`ignoreReportingBreach` per-run override goes away). Snapshots always evaluate reporting breach with the account date gate (and existing “today” calendar rules if any).

### Gate semantics

- Comparison field: invoice **issue date**, inclusive on/after the configured date (same calendar-day helper as MEP).
- Applies permanently: import/backfill, incremental sync, overnight reporting-breach sweep, term-breach resolvers, and Portfolio Health Generate / day replay paths that stamp or overlay reporting breach.
- Null date: Generate fails closed with a clear client error; overnight sweeps skip the account with a clear log/metric. Do not treat null as “no gate.”

### Billing UI

- Date input after MEP breach start date; EN+HE label/helper/required/error copy.
- No soft prefill from backfill start date.
- Always editable (not locked by `backfill_started_at`).
- Remove “Skip reporting breach during backfill” switch and related copy.
- On successful save when the date value changed: start background full recompute; toast that recompute started; later success toast/message with link/button to Portfolio Health Generate (no auto-start Generate).

### Background full recompute

- Must both **set** and **clear** `reporting_breach` according to current rules + date gate (today’s overnight promote-only sweep is insufficient when the date moves forward).
- Non-blocking: save returns after persisting the date; recompute runs asynchronously.
- Clear reporting-breach start-date resolver cache for the account when the date changes / at recompute start.

### Portfolio Health Generate modal

- Use shared `AppDialog` (drag/align/slide defaults like sibling modals).
- Toolbar: one status-aware open button (idle vs running/paused/failed wording).
- Modal actions: Generate, Generate recent, Stop, Resume/Retry as today; large-range confirm inline (no stacked DeleteDialog).
- Modal body: short help + selected page date range for Generate + pending rewrite window (or “none”) for Generate recent.
- Progress bar, ETA, and last error remain on the page (not duplicated as the primary progress UI inside the modal).
- After successful start, modal stays open; close is always allowed; job continues.
- Auto-open when status is running/paused/failed on land; after user dismiss, remember for the page visit and only auto-open again on a new attention transition (e.g. idle→running, running→failed).
- Remove ignore-switch state, props, locale keys, and request field wiring.

### i18n

- All new/changed user-facing strings ship EN+HE in the same change (accounts + dashboard namespaces as applicable). No English-only `defaultValue` gaps.

## Testing Decisions

Good tests assert **external behavior** (flags stamped/cleared, API validation, Generate rejection when date missing, modal open/control visibility)—not internal helper shape.

Preferred seams:

1. **Domain gate + recompute** — given invoices and a configured date, assert which rows end with `reporting_breach` true/false after full recompute (including clear-on-out-of-scope). Prior art: MEP breach start date gate tests; `shouldSetReportingBreach` / reporting breach scope.
2. **Billing connector upsert** — reject missing date; accept valid date; reject removed skip boolean if still sent (or ignore if transitional). Prior art: MEP breach start date API tests.
3. **Generate start** — rejects when account date missing; does not accept/persist per-run skip flag. Prior art: credit as-of backfill job tests.
4. **Manual How to test** — Billing UI placement/required; modal controls + on-page progress (no new automated UI tests unless explicitly requested).

Do not add or expand automated tests unless the user explicitly asks during implementation.

## Out of Scope

- Changing MEP breach start date semantics or its lock-after-backfill behavior.
- Auto-starting Portfolio Health Generate after Billing recompute.
- Showing a second progress bar inside the Generate modal as the primary progress UI.
- Hard-linking reporting breach start date to backfill start date.
- Recreating ClickUp subtasks for slices (slices live under `.cursor/plans/`).
- Dropping unrelated connector cutover fields.

## Further Notes

### Decision log (grill)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Stop / Resume / Retry | Modal only; progress on page |
| D2 | Open entry | Status-aware toolbar button |
| D3 | After Generate starts | Stay open |
| D4 | Large-range warning | Inline in same modal |
| D5 | Close while running | Free close; job continues |
| D6 | PH ignore switch | Removed |
| D7 | Land with active job | Auto-open |
| D8 | After dismiss | Stay closed until reopen / new attention transition |
| D10 | Gate | Invoice issue date on/after; dedicated column |
| D11 | Name | Reporting breach start date |
| D12–D13 | Skip-on-backfill switch | Removed; normal rules + date gate |
| D15–D16 | Required + migrate | Required on save; copy from backfill start when present; else manual |
| D17 | Lock | Always editable |
| D18–D19 | Old flags | Drop connector + job flags in same work |
| D20 | Prefill | None |
| D21–D23 | On date change | Save → background full recompute → success + link to Generate |
| D24 | Modal body | Help + page range + pending rewrite window |
| D25 | Delivery | Two slices |
| D26 | Null date | Generate fails closed; overnight skips with log/metric |

### Discovery gates

| Gate | If Yes | If No |
|------|--------|-------|
| Account-scale clear of `reporting_breach` is safe/performant in background | Proceed with async recompute as designed | Split clear into chunked durable job (follow-up) |
| No remaining UI/API clients require skip-reporting-breach booleans | Drop columns in slice 1 | Brief ignore-compat then drop |

### How to test (product)

1. Billing: field after MEP; required; skip-on-backfill switch gone; change date → quick save → background recompute → link to Generate.
2. Migrate: seeded from backfill start when present; unset accounts cannot Generate until date is set.
3. Portfolio Health: status-aware open button; controls in modal; progress on page; no ignore switch; large confirm inline; dismiss memory works.
