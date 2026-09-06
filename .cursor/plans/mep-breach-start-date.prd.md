---
name: mep-breach-start-date
overview: Add a MEP breach start date to the billing connector cutover options, configured in the Billing tab backfill settings, so invoices issued before that date neither cause a customer overdue block nor receive a customer overdue MEP flag — keeping historical imported AR from distorting credit-insurance breach data.
source: grill-me session (MEP breach start date for backfill)
clickup_task_url: null
isProject: false
---

# MEP breach start date for backfill

## Problem Statement

When an account is onboarded, the billing connector backfill pulls historical accounts receivable from the source ERP (Enterprise Resource Planning) system. The existing cutover option **include older open invoices** deliberately pulls unpaid invoices issued *before* the backfill start date, so open balances reconcile with the ERP.

Those pre-cutover invoices then participate fully in credit-insurance MEP (Maximum Extension of Payment) math:

- The oldest unpaid overdue invoice may be years old, so the customer is immediately past their MEP deadline and `overdue_block` is true.
- Every invoice imported afterwards is stamped `ctv_customer_overdue_mep`, because it was "issued while the customer was blocked".

The result is that a freshly onboarded account looks catastrophically breached on day one. The breach is an artifact of importing history the customer was never managing inside the product — not a real credit-insurance term violation. Analysts have no way to tell the system "start judging MEP from this date forward".

There is no date-based gate for MEP anywhere today. MEP configuration is day counts (`max_allowed_mep`) plus month-end cutoff day-of-month values on the policy. The only existing "suppress breach on import" mechanism is the boolean `skip_reporting_breach_on_backfill`, which covers reporting breach only and applies during backfill only.

## Solution

Add a single optional date — the **MEP breach start date** — configured per account in the **Backfill settings** section of the Billing tab on the account page.

When the date is set, for that account:

- An invoice **issued before** the date never counts as a cause of a customer overdue block.
- An invoice **issued before** the date is never stamped with the customer overdue MEP flag.

When the date is empty (the default, and the value for every existing account), behavior is exactly as today.

The rule is **permanent**, not backfill-scoped: incremental syncs, daily recalculation, and the historical as-of replay all apply the same filter, so the invoice grid, dashboards, and trend charts stay consistent with each other.

The field sits directly below **Backfill start date**, is pre-filled with the backfill start date as a suggestion, and is **locked once backfill has started** — exactly like its neighbouring cutover options. Changing it requires a backfill reset.

## User Stories

1. As an onboarding specialist, I want to set a MEP breach start date before the first backfill, so that historical AR does not create fake MEP breaches.
2. As an onboarding specialist, I want the field to sit inside the Backfill settings section next to the backfill start date, so that all cutover decisions are made in one place.
3. As an onboarding specialist, I want the field pre-filled with the backfill start date, so that the common case takes zero extra thought.
4. As an onboarding specialist, I want to override the pre-filled value with a different date, so that I can handle accounts where the MEP cutover differs from the import cutover.
5. As an onboarding specialist, I want to leave the field empty, so that accounts with clean full history keep evaluating MEP across all data.
6. As an onboarding specialist, I want the field locked after backfill starts, so that I cannot silently change the meaning of already-stamped data mid-import.
7. As an onboarding specialist, I want a clear message when I try to change a locked value, so that I know a backfill reset is required.
8. As an onboarding specialist, I want the value to reappear after a backfill reset in an editable state, so that I can correct a wrong date and re-run.
9. As a credit analyst, I want invoices issued before the MEP breach start date to be excluded from the customer overdue MEP flag, so that breach counts reflect real term violations.
10. As a credit analyst, I want pre-date open invoices to be ignored when computing the customer overdue block, so that a legacy unpaid invoice does not poison every new invoice for that customer.
11. As a credit analyst, I want the customer overdue block to reflect only post-date invoices, so that the block clears when the customer is actually current on in-scope AR.
12. As a credit analyst, I want the terms-breach-by-reason breakdown to show reduced customer overdue MEP counts after the gate applies, so that the reason mix is trustworthy.
13. As a credit analyst, I want dashboard KPI (Key Performance Indicator) breach totals to respect the gate, so that portfolio health is not inflated by imported history.
14. As a credit analyst, I want the historical trend chart to apply the same gate for every replayed day, so that trends and the invoice grid never disagree.
15. As a credit analyst, I want reporting breach behavior unchanged, so that the existing reporting toggle keeps its meaning.
16. As a credit analyst, I want invoice-after-policy-end and other created-in-terms-violation flags unchanged, so that this change has one narrow, explainable effect.
17. As an account manager, I want existing accounts to see zero behavior change until someone sets a date, so that the rollout is safe.
18. As a developer, I want a single shared filter used by both the live path and the as-of replay path, so that the two implementations cannot drift.
19. As a developer, I want the date compared against the invoice issue date only, so that there is one unambiguous comparison rule.
20. As a developer, I want the date validated as a calendar date on save, so that malformed input is rejected with a clear 400 error rather than silently ignored.
21. As a developer, I want the resolved value exposed on the connector run summary alongside the other cutover options, so that I can confirm what a given backfill actually used.
22. As a support engineer, I want to read the configured date from the account settings response, so that I can explain a customer's breach numbers without database access.
23. As a Hebrew-speaking user, I want the new label and helper text translated, so that the Billing tab stays fully localized.

## Implementation Decisions

### Storage

A new nullable calendar-date column, `mep_breach_start_date`, on the **BillingConnector** model, placed directly alongside `backfill_start_date`, `include_older_open_invoices`, and `skip_reporting_breach_on_backfill`. This keeps all four cutover fields in one block and lets the value reuse the existing lock guard, which is driven by `backfill_started_at` on the same row — no cross-model lookup in the save path.

Consequence to accept: the credit-insurance domain does not read `BillingConnector` today, so resolving the date on every recompute adds an account-scoped connector lookup with per-run caching. `BillingConnector.account_id` is unique, so there is exactly one connector per account and no resolution ambiguity. The one edge case is that deleting the connector drops the rule, reverting the account to ungated MEP evaluation.

Null means "no gate" and is the default for all existing rows. No data migration or backfill of the column.

### Semantics

- Comparison field is the invoice **issue date** (`invoice_date`), not due date and not the computed MEP deadline. Invoices with `invoice_date` strictly before the configured date are out of scope for MEP. Both sides are pure calendar dates, so the comparison is timezone-free.
- The gate applies on **both** sides of the MEP calculation:
  - **Cause side** — the customer overdue block computation ignores out-of-scope invoices when selecting the oldest unpaid overdue invoice and when deciding whether the customer is past their deadline.
  - **Flag side** — the created-terms-violation snapshot never sets the customer overdue MEP flag on an out-of-scope invoice.
- The gate is scoped to MEP only. Reporting breach, invoice-after-policy-end, capacity/limit flags, target MEP date, and target reporting date are all unchanged. The existing `skip_reporting_breach_on_backfill` toggle keeps its current meaning and is untouched.
- The gate is permanent and applies in every path that computes MEP: import, incremental sync, post-import overdue metrics refresh, scheduled recalculation, and the day-by-day as-of replay used for trend and dashboard snapshots.

### Domain module changes

The credit-insurance domain package gains an optional MEP breach start date on the inputs of its MEP calculations, threaded from a single account-scoped resolver:

- The customer overdue block computation and the as-of overdue block replay both accept the date and drop out-of-scope invoices from their candidate set before selecting the oldest overdue line.
- The created-terms-violation snapshot accepts the date and short-circuits the customer overdue MEP flag to false for out-of-scope invoices.
- A single shared predicate (invoice issue date is on or after the configured date, or no date configured) is used by every caller so the live and replay paths cannot drift.

Callers that already load account context pass the value through; callers that do not gain a lookup with per-run caching, since the value is stable for the duration of a sync or replay.

### API contract

- The account billing settings read response gains `mep_breach_start_date` as a `YYYY-MM-DD` string or null.
- The upsert payload accepts `mep_breach_start_date` with the same normalization used for `backfill_start_date`: trimmed, parsed as a calendar day, stored at UTC midnight, empty string treated as null, invalid input rejected with a 400.
- The value is subject to the existing backfill lock, resolved from `backfill_started_at` on the same connector row. When backfill has started and the incoming value differs from the stored one, the request is rejected with a 400 in the established style: the date is locked after backfill has started and requires a backfill reset.
- The connector run summary's frozen cutover options include the value, so a completed run records what it ran with.

### Frontend

- A date input inside the existing **Backfill settings** section of the Billing tab settings component, positioned immediately below **Backfill start date** and above the include-older-open-invoices and skip-reporting-breach toggles.
- Pre-filled from the backfill start date when the MEP field is empty and the user has not yet edited it; once the user types a value, that value wins and is never overwritten by later backfill-start-date edits.
- Saved through the same cutover-options persistence path as its neighbours.
- Disabled by the same lock flag that disables the rest of the section, so the whole block greys out together.
- Helper text explains that invoices issued before this date are excluded from MEP breach evaluation, and that the value is locked once backfill starts.

### Localization

New English and Hebrew strings for the label, helper text, and lock message. Translation files are only modified after explicit approval from the user.

## Testing Decisions

Only add tests when the user explicitly asks for them. When asked, these are the decisions.

A good test here asserts **external behavior** — the flags and block state produced for a given set of invoices and a given configured date — not the internal shape of the filter helper. Tests drive the domain entry points with fixture invoices and assert on the resulting customer overdue block and customer overdue MEP flags.

Modules to cover:

- Customer overdue block computation: a pre-date unpaid overdue invoice does not produce a block; a post-date one still does; an empty date reproduces today's behavior exactly.
- Created-terms-violation snapshot: an invoice issued before the date is never flagged, an invoice issued on the date is in scope (inclusive boundary), an invoice issued after is flagged when the customer is genuinely blocked.
- As-of replay: replaying a historical day yields the same MEP verdict as the live computation for the same data, so trend snapshots and the invoice grid agree.
- API validation: malformed date rejected with 400; edit attempt while backfill is started rejected with the lock error; edit allowed after reset.

Prior art: the existing credit-insurance domain tests under the API test directory that exercise overdue-metric and insurance-field computation with fixture invoices, and the invoice insurance refresh tests that assert stamped flags after a simulated import.

## Out of Scope

- Automatically re-stamping existing invoices when the date changes. The field is locked after backfill starts, so the only supported way to change it is a backfill reset followed by a re-run.
- Extending the gate to other breach reasons. Reporting breach keeps its existing boolean toggle; invoice-after-policy-end keeps using the policy start and end dates.
- Exposing the date as a per-run job parameter or on the as-of backfill admin card.
- Any change to target MEP date, target reporting date, month-end cutoff behavior, payment terms, or capacity gap math.
- A per-customer or per-policy override of the date.
- A one-time cleanup of historical flags for accounts that already completed backfill before this feature shipped.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under `.scratch/mep-breach-start-date/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.scratch/mep-breach-start-date/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Configure the MEP breach start date in Backfill settings | `issues/01-configure-mep-breach-start-date.md` | — | 1-8, 20-23 |
| 2 | Apply the MEP gate to live breach computation | `issues/02-apply-gate-to-live-mep.md` | 1 | 9-19 |
| 3 | Apply the MEP gate to the historical as-of replay | `issues/03-apply-gate-to-as-of-replay.md` | 2 | 14, 18 |

**Status:** `ready-for-agent` on all slices.

## Further Notes

- The interaction that motivates this feature is specifically **include older open invoices**. An account with that toggle off and a backfill start date set still imports pre-date invoices in some flows, so the MEP gate is not redundant with the backfill start date and must remain independently settable.
- Boundary rule is inclusive: an invoice issued exactly on the MEP breach start date is **in scope**.
- Timezone: the existing `backfill_start_date` is documented as an account-timezone calendar day, but no account timezone column exists in the schema (only `User.time_zone`), and values are normalized to UTC midnight. Rather than introduce a timezone, the comparison is defined as calendar-date to calendar-date: `Invoice.invoice_date` is a pure date column with no time component, so comparing it against the stored date is unambiguous and no timezone is needed. The misleading "account TZ" wording on `backfill_start_date` should be corrected to say UTC calendar day while implementing this, and the new column's comment must not repeat it. Adding a real account or connector timezone remains a separate, cross-cutting decision.
- Related placement question raised during review: `Account.last_sync_date` is written only by the connector's entity importer, which makes it look like a connector field. It is **not** — it is an intentional account-wide data-freshness marker rendered in the app header, and a prior plan fixed its semantics as "last successful scheduled incremental sync", with per-entity truth living in `ConnectorSyncState.last_successful_run_at`. It stays on `Account` and is out of scope here; the only action is keeping that intent documented so it is not mistaken for a duplicate.
- Storage was revisited after the lock decision and moved from `Account` to `BillingConnector`, so the value and its lock live on the same row. The trade-off is that deleting the connector removes the gate; if that becomes a real risk, promoting the column back to `Account` is the escape hatch.
- Follow-up worth considering later, out of scope here: surfacing the configured date on the customer or invoice detail view so an analyst can see why a given invoice is not flagged.
