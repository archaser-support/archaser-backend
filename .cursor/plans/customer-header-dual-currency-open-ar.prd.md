---
name: customer-header-dual-currency-open-ar
overview: Align customer header Total Due and Total AR dual-currency amounts by sourcing both from FX-converted open receivable totals and live invoice-currency sums on customer GET.
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869dwm8np
isProject: false
---

# Customer header dual-currency open AR alignment

## Problem Statement

On the customer detail header, credit-insurance customers with multi-currency open receivables see **Total Due Amount** and **Total AR** cards rendered as `secondary (account)` — for example `£ 2,000 (₪ 9,500)` vs `£ 2,000 (₪ 13,500)`.

Users expect both cards to show **consistent** open-receivable totals when the underlying invoices tell the same story. In the reported case, all three open invoices are **Due** (not Overdue), so the ILS and GBP figures should match across both cards — expected **£ 3,000 (₪ 13,500)** for each.

Today the two cards use **different aggregation paths**:

- **Total Due** reads denormalized `total_due_amount` (Due invoices only, `outstanding_debt` sum without FX conversion) and a client-side secondary helper that sums due currency buckets and conditionally skips overdue buckets unless due ≈ AR.
- **Total AR** reads a primary total that may come from unconverted open-AR SQL (mixing `outstanding_debt` with raw `customer_outstanding_debt`) and a secondary total from denormalized invoice buckets on GET — while the KPI service already prefers a live invoice-currency query.

The result is not a single broken exchange rate but **inconsistent sources**: stale or partial denormalized fields, unconverted foreign-currency lines, and divergent read paths between GET customer and dashboard KPIs. Users lose trust in credit-insurance header metrics and cannot reconcile header figures with invoice reality.

## Solution

Unify header dual-currency display on **one open-receivable computation** at customer GET time:

1. **Primary (account currency)** — Sum open Due and Overdue invoice lines in account currency using the same FX-aware rule already used for credit-insurance KPIs: prefer `outstanding_debt`; when zero and invoice currency differs from account currency, convert `customer_outstanding_debt` (or `amount`) via latest stored rate with live ECB fallback.

2. **Secondary (invoice currency)** — Sum open Due and Overdue lines in the resolved secondary invoice currency via live invoice query (same rule as dashboard KPI service), with denormalized bucket fallback only when the live sum is zero.

3. **Scope** — Customer-level, all policies: include every open Due/Overdue invoice for the customer regardless of policy filter on the header.

4. **Total Due card** — When a secondary amount exists (> 0), render the **same** primary and secondary pair as Total AR on the amount line. Keep the existing due-invoice count as secondary metadata below the amount (count remains Due-only; amount reflects full open AR in both currencies).

5. **Dual-currency gate** — Show the parenthetical secondary line whenever secondary open AR > 0, not only for credit-insurance product flag or when due ≈ AR.

6. **Display-first** — Do not change denormalized customer sync (`total_due_amount`, currency buckets) in this PRD; fix the read/display path. Denormalized sync alignment remains optional follow-up.

After the fix, both header cards show identical dual-currency open-receivable totals when all open invoices are Due and share the same currency mix.

## User Stories

1. As a credit insurance user viewing a customer header, I want Total Due and Total AR to show the same GBP and ILS open-receivable amounts when all open invoices are Due, so that I can trust the header without mental reconciliation.

2. As a credit insurance user, I want the GBP parenthetical on header cards to reflect the sum of open invoice amounts in invoice currency, so that the secondary figure matches what I see on individual invoices.

3. As a credit insurance user, I want the ILS account-currency total to use consistent FX conversion for foreign-currency invoices, so that implied conversion rates are the same on every header card.

4. As a credit insurance user with three Due GBP invoices totaling £ 3,000, I want both Total Due and Total AR to display £ 3,000 (₪ 13,500), so that the header matches invoice reality.

5. As a collection manager, I want Total Due Amount on the header to show open receivable totals in both currencies when secondary currency data exists, so that the card is useful for multi-currency accounts even outside strict credit-insurance KPI flows.

6. As a credit insurance user, I want header totals to include all open Due and Overdue invoices at customer level, so that policy-scoped dashboard filters do not silently shrink header open AR.

7. As a credit insurance user, I want the due-invoice count under Total Due to remain a Due-only count, so that I still see how many invoices are in Due status while the amount reflects correct open AR.

8. As a credit insurance user viewing a customer with only account-currency invoices, I want header cards to show a single-currency amount with no empty parenthetical, so that the UI stays clean when no secondary currency applies.

9. As a credit insurance user viewing a customer where live invoice query returns zero secondary but denormalized buckets are stale, I want a sensible bucket fallback, so that the UI does not regress when invoice data is temporarily unavailable.

10. As a developer maintaining credit-insurance dashboards, I want customer GET header enrichment to use the same open-AR helpers as dashboard KPIs, so that header and dashboard tab do not diverge again.

11. As a developer, I want one server-side seam that produces `{ primaryOpenAr, secondaryOpenAr, secondaryCurrency }` for header display, so that the UI does not reimplement aggregation rules.

12. As a QA engineer, I want an automated test with mixed-currency Due invoices proving both header cards receive identical enriched amounts from GET customer, so that regressions are caught without manual DOM inspection.

13. As a QA engineer, I want a regression test for FX conversion when `outstanding_debt` is zero and `customer_outstanding_debt` is in a foreign currency, so that ILS totals are not raw unconverted foreign amounts.

14. As a product owner, I want this fix scoped to display/read paths first, so that we ship correct header UX without a risky denormalized aggregation rewrite.

15. As a collection agent, I want header dual-currency formatting to remain `secondary (account)` with RTL support unchanged, so that Hebrew layout conventions are preserved.

16. As a credit insurance user comparing Total Due to Total Overdue on the same header, I want Total Due amount to represent open receivables (Due + Overdue in value terms) while Total Overdue card continues to show overdue-specific metrics, so that each card keeps its semantic label but amounts are arithmetically consistent with open AR.

17. As a developer integrating portal or other consumers of customer GET, I want enriched `total_ar` and `total_ar_secondary` fields to reflect live open-AR rules, so that any consumer of those fields gets corrected values without separate fixes.

18. As a user who previously saw £ 2,000 (₪ 9,500) on Total Due due to partial denormalized data, I want the corrected display after deploy without re-importing invoices, so that the fix is effective on next page load.

19. As a developer, I want to remove the client-side `resolveSecondaryDueAmount` overdue gate (`|total_due − total_ar| < 0.01`), so that secondary amounts are not silently truncated when primary sources disagree.

20. As a credit insurance user with overdue and due invoices in the same secondary currency, I want the secondary parenthetical to sum both statuses, so that the GBP total matches all open invoice lines in that currency.

21. As an archaser admin reviewing capacity gap and terms-breach cards on the same header, I want those cards to continue using their existing dual-currency ratio/fallback rules, so that this PRD does not unintentionally change unrelated KPI cards.

22. As a developer writing unit tests, I want prior art from existing open-receivable and header-amount tests to extend, so that new tests follow established credit-insurance test patterns.

## Implementation Decisions

### Single test seam (preferred)

Expose corrected open-receivable totals through **customer GET enrichment** — one server-side computation consumed by both Total Due and Total AR header cards. The UI should not compute currency totals locally except for formatting (RTL, symbols). This is the highest seam: one read path, two display labels.

### Open AR primary (account currency)

- Compute customer-level open AR by summing every open Due and Overdue invoice line in account currency.
- Per-line rule (aligned with credit-insurance KPI helpers): use `outstanding_debt` when non-zero; otherwise, when invoice currency differs from account currency, convert customer-currency outstanding via latest `CurrencyRate` with Frankfurter fallback; never add raw foreign `customer_outstanding_debt` into an ILS total without conversion.
- Replace the current GET customer logic that takes `max(denormalized due + overdue, unconverted open-AR SQL)` for `total_ar` with this FX-aware total.
- Customer-level scope: no policy filter on header enrichment.

### Open AR secondary (invoice currency)

- Resolve secondary currency using existing helper that picks the first non-account currency with positive amount from due/overdue buckets.
- Sum open Due and Overdue invoice lines in that currency via live invoice query (customer_outstanding_debt preferred, amount fallback — same as dashboard KPI service).
- Fall back to denormalized bucket sum only when live query returns zero/null.
- Populate GET response field used for Total AR secondary; Total Due reads the same value.

### Total Due card behavior

- Amount line: use enriched primary and secondary open AR (same pair as Total AR).
- Secondary line below: keep `no_of_due_invoices` count unchanged (Due-only count).
- Remove client-side secondary aggregation and the conditional overdue inclusion gate.

### Dual-currency display gate

- Render dual-currency format when `secondaryOpenAr > 0` and secondary currency is resolved.
- Do not require credit-insurance product flag or due ≈ AR equality for the parenthetical.

### API contract

- `total_ar` on GET customer: FX-aware customer-level open AR primary.
- `total_ar_secondary`: live invoice-currency open AR sum with bucket fallback.
- `credit_insurance_secondary_currency`: unchanged resolution; may remain null when no secondary currency applies.
- Do not add new public fields unless necessary; prefer correcting semantics of existing enriched fields consumed by the header.

### Modules touched (conceptual)

- Customer GET handler enrichment for credit-insurance / multi-currency customers.
- Open receivable service helpers (FX-aware account-currency map; invoice-currency sum — reuse/extend existing credit-insurance open receivable module rather than new parallel logic).
- Customer header UI: Total Due and Total AR amount wiring; remove local secondary resolver.
- Optional shared client formatter remains unchanged (`secondary (account)` line format).

### Out of scope for implementation module changes

- Denormalized `total_due_amount` / currency bucket cron rewrite.
- Policy-scoped header totals.
- Capacity gap, terms breach, or other header KPI cards (unless they already consume the same enriched `total_ar` pair and benefit automatically from corrected primary).
- Translation file changes.
- New styling.

### Architectural alignment

- Follows existing credit-insurance pattern: live invoice truth for open AR where denormalized customer fields may lag (same principle as capacity-gap dual-currency and dashboard KPI plans).
- Display-first per grill-me D1; aggregation sync deferred.

## Testing Decisions

### What makes a good test

- Assert **observable behavior**: enriched GET customer amounts and formatted header display inputs — not internal call order or private helper names.
- Use **fixture invoice rows** with known `outstanding_debt`, `customer_outstanding_debt`, `customer_currency`, and status — mirror the reported bug (three Due GBP invoices → £ 3,000 primary secondary, ₪ 13,500 FX-converted primary).
- Prefer **one integration-style unit test** at the customer GET enrichment seam over multiple UI tests duplicating aggregation rules.

### Modules to test

1. **Customer GET enrichment** — primary and secondary open AR for mixed-currency Due invoices; verifies Total Due and Total AR consumers would receive identical pairs.
2. **Open receivable helpers** — extend existing tests for FX conversion when `outstanding_debt = 0` and invoice currency is foreign (prior art: open receivable account currency tests).
3. **Header view-model / wiring** (light) — optional test that Total Due amount props equal Total AR amount props when enriched fields match (only if not fully covered by GET test).

### Prior art

- `customerCreditInsuranceHeaderAmounts` / invoice bucket ratio tests.
- `openReceivableAccountCurrency` tests (`computeInvoiceLineOpenArInAccountCurrency`).
- `customerDashboardCardViewModel` tests for dual-currency display contracts.
- Capacity-gap dual-currency plan: live invoice vs denormalized fallback pattern.

### Key scenarios

| Scenario | Expected |
|----------|----------|
| Three Due GBP invoices, £ 1,000 each, FX → ₪ 13,500 total | Both cards: £ 3,000 (₪ 13,500) |
| All Due, single currency (account only) | Single-currency display, no parenthetical |
| Due + Overdue in same secondary currency | Secondary sums both; primary FX-aware sum |
| Live secondary query = 0, buckets stale non-zero | Bucket fallback used |
| `outstanding_debt = 0`, GBP `customer_outstanding_debt` | Primary uses converted ILS, not raw GBP |

## Out of Scope

- Rewriting `CustomerService.calculateDueAmountsForCustomers` or overdue aggregation cron to fix denormalized `total_due_amount` and currency buckets at write time.
- Policy-scoped header open AR when user selects a policy on the customer dashboard tab.
- Changing Total Due card label to "Open AR" or merging Total Due and Total AR into one card.
- Portal customer detail pages unless they independently reimplement the same bug (separate PRD if needed).
- Modifying translation strings or visual styling of header cards.
- Backfill scripts to re-sync historical customer denormalized fields.

## Further Notes

### Reported bug snapshot (grill-me)

- Observed: Total Due `£ 2,000 (₪ 9,500)`; Total AR `£ 2,000 (₪ 13,500)`.
- Expected: both `£ 3,000 (₪ 13,500)`.
- Confirmed: all three underlying invoices are **Due** — discrepancy is calculation/source inconsistency, not Due vs Overdue scope.

### Decision log (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Fix scope | Display layer first |
| D2 | Expected values | £ 3,000 + ₪ 13,500 on both cards |
| D3 | Secondary source | Live invoice-currency query |
| D4 | Primary source | FX-converted open AR |
| D5 | Total Due wiring | Same open-AR pair as Total AR |
| D6 | Dual-currency gate | When secondary > 0 |
| D7 | Scope | Customer-level, all policies |

### Follow-up (optional)

- PRD or task to align denormalized customer fields with live open-AR helpers at sync time so list views, exports, and reports that still read `total_due_amount` converge without live queries.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Customer header dual-currency open AR alignment](https://app.clickup.com/t/869dwm8np)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Open AR enrichment on customer GET (FX primary + live secondary) | [869dwm8p6](https://app.clickup.com/t/869dwm8p6) | — | 2, 3, 9, 10, 11, 13, 17, 18, 20 |
| 2 | Customer header — align Total Due and Total AR dual-currency display | [869dwm8pd](https://app.clickup.com/t/869dwm8pd) | 1 | 1, 4, 5, 6, 7, 8, 15, 16, 19, 21 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development

**Tags:** `ready-for-agent`, `enhancement`, `credit-insurance`
