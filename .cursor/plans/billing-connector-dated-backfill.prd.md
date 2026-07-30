# Billing connector dated backfill — PRD

Status: ready-for-agent

## Problem Statement

When an Archaser admin runs the initial ERP (Enterprise Resource Planning)
billing-connector backfill for an account, the platform pulls full invoice and
payment history. That is often too large, too slow, or unnecessary when the
business only needs receivables from a cutover date forward.

If the admin could start from a date alone, open invoices created before that
date would be missing, so open AR (Accounts Receivable) and credit-insurance
capacity gap would be wrong. Related historical payments for those open invoices
would also be missing, so balances would not match the ERP.

Separately, accounts that do not import actual insurance reporting dates get
false **reporting breach** flags during backfill: import stamps breach using
“today” versus a computed target reporting date. Admins need a way to skip that
check for the backfill write without changing scheduled incremental sync or the
overnight overdue job.

Finally, any dated backfill must still respect the deferred-payment
chronological import model (payments before invoices, invoices oldest-first,
then chronological AR replay). A “fetch older open invoices first” pull must not
break that ingest order.

## Solution

Extend Billing integration (connector) backfill with three admin controls and
locked semantics:

1. **Optional backfill start date** — When set, invoice and payment pulls are
   limited to records **created** on or after that calendar day in the **account
   timezone**. Customers and contacts still pull full history. When blank,
   behavior stays full-history backfill.

2. **Include older open invoices** (switch, default **on** when a start date is
   set) — Also pull invoices created **before** the start date that still have
   an **unpaid balance** in the ERP, plus **related payments** linked to those
   invoices (any payment date). Combined with on/after-date invoices and
   payments, upserts keep a correct open-AR picture.

3. **Skip reporting breach during backfill** (switch, default **off**) — While
   on, connector **backfill** import does not set `reporting_breach` on written
   invoices. Scheduled/incremental connector sync and the overnight overdue /
   reporting-breach cron are unchanged.

4. **Lock after backfill starts** — Start date and both switches become
   read-only once backfill has started; changing them requires a backfill reset.

5. **Chronology preserved** — ERP may fetch older-open invoices (and their
   payments) before the dated window for efficiency, but **ingest** stays
   Customer → Payment → Invoice → Contact with invoice sort by invoice date then
   invoice number; chronological AR replay and maturity continue after Invoice
   as today.

## User Stories

1. As an `archaser_admin`, I want an optional backfill start date on Billing
   integration, so that I can limit the first ERP import to a cutover window.

2. As an `archaser_admin`, I want leaving the start date blank to keep
   full-history backfill, so that existing onboarding without a cutover date
   still works.

3. As an `archaser_admin`, I want the start date to mean “created on or after,”
   so that I am not filtering by ERP last-updated noise.

4. As an `archaser_admin`, I want invoices filtered by invoice date and payments
   by payment date against that start day, so that the cutover matches business
   documents.

5. As an `archaser_admin`, I want customers and contacts to always backfill
   fully even when a start date is set, so that dated invoices and payments can
   resolve to master data.

6. As an `archaser_admin`, I want the start date interpreted in the account
   timezone calendar day, so that “1 Jan 2024” matches the account’s local
   business day.

7. As an `archaser_admin`, I want a switch to also include older open invoices
   when a start date is set, so that pre-cutover unpaid receivables are not
   dropped.

8. As an `archaser_admin`, I want that switch on by default when I set a start
   date, so that I do not accidentally create an incomplete open-AR portfolio.

9. As an `archaser_admin`, I want to turn that switch off when I truly want only
   on/after-date invoices and payments, so that I can run a strict cutover.

10. As an `archaser_admin`, I want “open” to mean unpaid balance in the ERP
    regardless of status text, so that “Final” but unpaid invoices are still
    included.

11. As an `archaser_admin`, I want related payments for those older open
    invoices pulled by payment→invoice link (invoice number and customer), so
    that balances for those invoices match the ERP.

12. As an `archaser_admin`, I want on/after-date payments still pulled in
    addition to related-to-open payments, so that the dated window is complete
    and duplicates are handled by normal upserts.

13. As an `archaser_admin`, I want the open-invoice switch hidden or disabled
    when no start date is set, so that the UI does not imply a meaningless
    option.

14. As an `archaser_admin`, I want a switch to skip reporting-breach stamping
    during backfill, so that accounts without importable reporting dates do not
    get false late-reporting flags from the initial load.

15. As an `archaser_admin`, I want that switch off by default, so that normal
    accounts keep current breach behavior unless they opt in.

16. As an `archaser_admin`, I want skip-reporting-breach to apply only to
    connector **backfill** writes, so that scheduled incremental sync still
    stamps breach as today.

17. As an `archaser_admin`, I want the overnight overdue / reporting-breach job
    to keep running as today even when the backfill skip switch is on, so that
    day-two promotion is not silently disabled account-wide.

18. As an `archaser_admin`, I want the start date and both switches locked after
    backfill has started, so that I cannot mix two different cutover windows
    mid-run.

19. As an `archaser_admin`, I want a clear message that I must reset backfill to
    change locked options, so that I know how to recover from a wrong cutover
    choice.

20. As an `archaser_admin`, I want reset to unlock the start date and switches
    for editing again, so that I can correct configuration before restarting.

21. As an `archaser_admin`, I want Sync actions to show current mode, start
    date, switch states, and per-entity backfill progress, so that I can monitor
    a dated backfill.

22. As an `archaser_admin`, I want Start / resume backfill to honor the saved
    start date and switches, so that manual and scheduled backfill resumes share
    one configuration.

23. As an `archaser_admin`, I want preview sync to respect the start-date
    filters (and optionally surface whether older-open inclusion would apply),
    so that go/no-go reflects the cutover I am about to run.

24. As an `archaser_admin`, I want incremental “Run sync now” after backfill
    completes to ignore the historical start date and use normal watermarks, so
    that steady-state sync is not stuck in cutover filters.

25. As an accounts receivable clerk, I want dated backfill to still ingest
    payments before invoices with deferred linking, so that capacity gap and
    outstanding stay correct.

26. As an accounts receivable clerk, I want all invoices in a backfill batch
    (older-open and on/after) sorted by invoice date then invoice number per
    customer before persist, so that chronological stamping stays deterministic.

27. As an accounts receivable clerk, I want chronological AR replay and
    deferred-payment maturity to run after Invoice ingest on backfill as today,
    so that deferred payments link and apply on the right dates.

28. As a credit insurance operations user, I want older open invoices included
    in capacity-gap and terms-breach post-import recomputation, so that
    portfolio KPIs reflect true open AR after dated backfill.

29. As a credit insurance operations user, I want reporting_breach left
    unset/false during backfill when skip is on, so that historical invoices are
    not all marked late on import day.

30. As a credit insurance operations user, I want overnight reporting-breach
    promotion to still be able to set flags later when skip was used only on
    backfill, so that once reporting processes exist the daily job can catch up.

31. As a platform engineer, I want backfill pull phases to be resumable with
    cursors even when older-open and dated windows are separate ERP queries, so
    that PARTIAL runs do not lose progress.

32. As a platform engineer, I want configuration stored on the BillingConnector
    (not account-wide credit settings), so that only ERP backfill owns these
    options.

33. As a platform engineer, I want GET connector config to return start date,
    switch values, and whether options are locked, so that the UI does not guess
    lock state.

34. As a platform engineer, I want PUT connector config to reject changes to
    locked fields after backfill started, so that API clients cannot bypass the
    UI lock.

35. As a support engineer, I want sync history to show backfill runs that used a
    start date / older-open / skip-breach flags, so that I can diagnose odd AR
    after onboarding.

36. As a support engineer, I want clear errors when Priority cannot filter
    unpaid balance or payments-by-invoice as expected, so that we fall back or
    spike rather than silently incomplete opens.

37. As an `archaser_admin` without manage_billing_connector permission, I want
    the new controls read-only or hidden, so that unauthorized users cannot
    change cutover policy.

38. As a QA engineer, I want the Priority mock server to support dated filters,
    unpaid-open invoices, and payment-by-invoice links, so that local backfill
    tests do not need a live ERP.

39. As a developer, I want one orchestration path in the billing connector sync
    service to own dated pull + chronological ingest, so that file import and
    connector do not fork cutover logic incorrectly.

40. As a developer, I want unit tests at the sync orchestration seam to prove
    filter bounds, older-open inclusion, related payments, breach skip, and lock
    rules without spinning the full UI.

## Implementation Decisions

### Decision log (from grill)

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Start-date meaning | Created on/after; not ERP last-updated |
| D2 | Entities filtered | Invoices + payments; master data full |
| D3 | Older open invoices | Open before date + related payments |
| D4 | Open-invoice default | On when start date is set |
| D5/D6 | Reporting-breach switch | Connector; backfill write only |
| D7 | Overnight breach cron | Unchanged; may set flags later |
| D8 | Chronological import | Pull open-first; ingest date-sorted |
| D9 | Start date required | Optional; blank = full history |
| D10 | Change date mid-backfill | Locked after start; reset required |
| D11 | Breach-skip default | Off (opt-in) |
| D12 | Change skip mid-backfill | Locked after start; reset required |
| D13 | Date interpretation | Account timezone calendar day |
| D14 | Open definition | Unpaid balance in ERP |
| D15 | Related payments | By invoice number + customer |

### Schema and config

- Add connector-level fields for: optional backfill start date;
  include-older-open-invoices boolean; skip-reporting-breach-on-backfill
  boolean.
- Persist lock implicitly from existing backfill lifecycle
  (`backfill_started_at` / in-progress entity state): once backfill has started,
  treat the three options as immutable until entity/connector backfill reset
  unlocks them.
- Do not add account-wide credit-insurance flags for this feature.

### Pull and filter behavior

- When start date is null: current full backfill for all enabled entities.
- When start date is set:
  - Customer / Contact: unchanged full pull.
  - Invoice: union of (a) unpaid-balance invoices with create/invoice date
    before start day, if include-older-open is on; (b) invoices with
    create/invoice date on/after start day.
  - Payment: union of (a) payments linked to older-open invoice set when that
    switch is on; (b) payments with payment date on/after start day.
- Deduplicate overlapping payment/invoice rows via existing import upsert
  identity rules.
- Convert start date to inclusive lower bound using Account `time_zone` (default
  Asia/Jerusalem when unset).

### Chronological ingest (must not regress)

- Entity order remains Customer → Payment → Invoice → Contact.
- Invoice batches continue through existing chronological invoice sort (invoice
  date ascending, then invoice number) before create/upsert.
- After Invoice: chronological AR replay, deferred-payment maturity, post-import
  overdue metrics as today.
- “Fetch older open first” is an ERP pull/scheduling concern only; do not
  introduce a hard ingest phase that imports all older-open invoices before any
  dated invoices if that would break date order.

### Reporting breach skip

- When skip switch is on and sync mode/run is **backfill**, invoice insurance
  stamping for that write path must not set `reporting_breach` true (force false
  / skip breach evaluation).
- Incremental / scheduled connector sync ignores the switch.
- Overnight `computeCustomerOverdueMetrics` / reporting-breach promotion ignores
  the switch.

### API and UI

- Expose fields on connector GET/PUT; reject locked-field mutations with a clear
  error code after backfill started.
- Billing integration Sync actions: date picker, include-older-open switch
  (visible when date set), skip-reporting-breach switch, lock messaging, reset
  guidance.
- Save configuration before start/resume; resume uses stored locked values.

### Provider spike (blocking)

Before production Priority filters ship:

| Gate | If Yes | If No |
| --- | --- | --- |
| Unpaid bal. filterable | Server open-before pull | Client filter after pull |
| Payments by linked invoice | Chunked related pulls | Broader pull + filter |
| Mock covers both | Local/CI coverage | Extend mock first |

### Modules (conceptual)

- Billing connector config service / API (new fields, lock validation).
- Billing connector sync orchestration (dated + older-open pull plans, pass
  skip-breach into invoice import path).
- Priority provider client / contract (date bounds, unpaid filter,
  payment-by-invoice filter).
- Invoice insurance stamping path used by connector backfill (honor skip flag).
- Billing integration Sync actions UI.
- Priority mock server fixtures for dated/open/related-payment scenarios.
- Unit tests around sync orchestration and config lock rules.

## Testing Decisions

### What makes a good test

Assert observable outcomes: which ERP filter/window was requested, which
canonical rows are ingested, `reporting_breach` values after backfill, lock
rejection on config update, and that chronological ingest order / replay still
runs. Do not assert private helper call counts or React state internals.

### Primary seam (preferred)

**Billing connector sync orchestration** (the service that already runs
mode-aware backfill, entity order, import batches, replay, and maturity). Drive
it with a fake/mock Priority pull and stubbed import/replay dependencies where
needed. This is the highest existing seam that owns dated pull + chronological
guarantees in one place.

### Secondary seams

- **Connector config save/get** — start date, defaults, lock after
  `backfill_started_at`, unlock on reset.
- **Invoice insurance stamping / import path under backfill skip flag** — breach
  not set on backfill write; incremental path unchanged.
- **Pure date-bound helper** (account TZ start-of-day / end-of-day) if extracted
  — small unit tests.

### Prior art

- Billing connector sync and Priority contract unit tests.
- `sortInvoicesForImport` and deferred-payment / chronological AR replay tests.
- Billing connector sync-schedule PRD tests around config GET/PUT and backfill
  vs incremental mode.
- Priority mock server used for local connector development.

### Suggested scenarios

1. No start date → full invoice/payment history (regression).
2. Start date set, older-open off → only on/after invoices and payments;
   customers full.
3. Start date set, older-open on → unpaid pre-date invoices + related payments +
   on/after window.
4. Related payment older than start date still imported when linked to
   older-open invoice.
5. Skip breach on → backfill invoices have `reporting_breach` false; overnight
   path not muted in unit scope.
6. Skip breach off → existing breach stamping behavior on backfill.
7. After backfill started, PUT changing start date or switches fails until
   reset.
8. Ingest order Payment before Invoice; invoices date-sorted including mixed
   older-open and dated rows.
9. Incremental sync after INCREMENTAL mode ignores start-date window filters.

## Out of Scope

- Account-wide mute of reporting breach for file import or all crons.
- Changing overnight overdue / reporting-breach cron behavior.
- Hard-deleting or re-importing already written rows when switches change (reset
  unlocks config only; data cleanup is separate).
- SAP Business One dated backfill (Priority-first; other providers later).
- UI for changing start date without reset while PARTIAL.
- Automatic re-stamp of reporting breach for invoices imported under skip when
  the switch is later turned off.
- As-of daily snapshot / policy trend backfill (separate Billing tab card).
- Changing deferred-payment chronology rules themselves (consume existing
  behavior).
- Mass backfill of `target_reporting_date` / actual reporting dates from ERP
  beyond existing field mappings.

## Further Notes

- Aligns with deferred-payment chronological import and ERP billing connector
  plans; this PRD adds cutover-window controls on top of that pipeline.
- Existing `backfill_window_end` on sync state was planned for chunking history
  by end window; this feature’s **start date** is an admin cutover bound and
  should not be conflated without an explicit merge design.
- Product copy should distinguish “Skip reporting breach **during backfill**”
  from any daily job language so admins do not think overnight checks are
  disabled.
- Source: grill-me session (Jul 2026) decisions D1–D15.

## Issues (vertical slices)

Tracer-bullet breakdown published under
`.scratch/billing-connector-dated-backfill/issues/`. Implement in dependency
order; start a **fresh session per issue**.

| # | Title | Blocked by | Stories |
| --- | --- | --- | --- |
| 01 | Priority filter spike + mock | — | 10, 36, 38 |
| 02 | Backfill start date + lock | — | 1–6, 18–22, 24–27 |
| 03 | Older open + related payments | 01, 02 | 7–13, 25–28, 31 |
| 04 | Skip reporting breach | 02 | 14–17, 29–30 |
| 05 | Preview / incremental / history | 02 (+03) | 21, 23–24, 35, 37 |

Also 02: stories 32–34, 37, 39–40.

Paths under `.scratch/billing-connector-dated-backfill/issues/`:
`01-priority-open-payment-filter-spike.md`,
`02-backfill-start-date-and-lock.md`,
`03-older-open-invoices-related-payments.md`,
`04-skip-reporting-breach-on-backfill.md`,
`05-preview-incremental-sync-history.md`.
