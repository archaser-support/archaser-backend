---
name: at-risk-per-invoice-max
overview: At-risk = Σ max(live capacity_gap_i, terms_breach_i); Capacity Gap card = max(0, open AR − effective limit); invoice gaps are a live waterfall cache (oldest invoice date first), rewritten on AR-changing events—not sticky open stamps.
source: grill-me session + follow-up grill (live capacity gap) + /start-work CU-869exeaca
clickup_task_url: https://app.clickup.com/t/869exeaca
isProject: false
---

# At-risk exposure + live capacity gap allocation

## Problem Statement

Credit analysts need:

1. **At Risk Exposure** that does not double-count money that is both over-limit and in terms breach.
2. A **Capacity Gap** card that matches the industry over-limit idea (`open AR − effective limit`), not a sticky sum of old invoice stamps that can drift above true over-limit when earlier invoices are paid.

Sticky `limit_assessed` / invoice capacity gap (stamped at open, rarely rewritten) causes Excel Σ invoice gaps to disagree with the Capacity Gap card and keeps “gap” on invoices after the customer is back under the limit.

## Solution

### Capacity Gap (customer card)

- **Capacity Gap card** = `max(0, open AR − effective limit)`  
  - **Effective limit** = approved limit + top-up when top-up applies (D9).
- Not `min(Σ sticky invoice gaps, AR − limit)` and not a raw sticky invoice sum.

### Live invoice capacity gap (stored cache)

- Keep storing invoice `capacity_gap_amount` / `capacity_gap_amount_limit`, `limit_assessed_amount`, and `in_capacity_gap` for **At Risk**, reports/exports, and debug.
- **Do not** treat them as sticky forever. On each refresh, recompute a **live waterfall** over **current** open Due/Overdue invoices:
  1. Order by **oldest `invoice_date` first** (tie-break: invoice id ascending).
  2. Fill effective limit headroom.
  3. For each invoice: `limit_assessed` = in-limit slice; `capacity_gap` = `max(0, outstanding − assessed)`.
  4. `in_capacity_gap` = `capacity_gap_amount > 0`.
- Rewrite on **every AR-changing event** for that customer (payment link, invoice open/close/status, limit/top-up change) **and** existing post-ingest refresh (D6).
- When an earlier invoice closes and open AR falls under the limit, later invoices’ stored gaps must go to **0**.
- **UI:** Capacity Gap column on main unpaid/invoice screens — remove or stop featuring; keep on **reports/exports + debug** only (D10). Card stays customer-level only.

### At Risk Exposure

Define one shared formula everywhere at-risk is computed:

- For each open Due/Overdue invoice in scope: `atRisk_i = max(capacity_gap_i, terms_breach_i)`
- `terms_breach_i` = full line outstanding when any terms-breach flag is set, else `0`
- `capacity_gap_i` = that invoice’s **live** capacity gap (after waterfall refresh)
- Customer / portfolio at-risk = `Σ atRisk_i` (no post-sum `min(total AR, …)` cap; no portfolio policy residual)
- Equivalent view: `Capacity Gap + Terms Breach − overlap`, where overlap is `Σ min(gap_i, breach_i)` on invoices that have both — same numeric result when gaps are live and complete.
- Uncovered / excluded customers keep **full open AR** as at-risk
- Compliant exposure and health index continue to derive from total AR and at-risk
- **Terms Breach** cards stay on the existing full breach sum (unchanged)
- Snapshots / historical rewrite use as-of open invoices and the **same live waterfall as-of that day** when computing gaps for at-risk
- Update EN/HE tooltips for at-risk **and** capacity gap

### Worked examples (acceptance)

**Ex1 — breach on in-limit invoice, gap on later invoice**  
Limit 1000; inv1 500 breach; inv2 300; inv3 500.  
Terms breach 500; capacity gap 300; at-risk **800**.

**Ex2 — breach on the over-limit invoice**  
Limit 1000; inv1 500; inv2 300; inv3 500 breach.  
Terms breach 500; capacity gap 300; at-risk **500** (`max(300,500)` on inv3).

**Screenshot-style — gap-only last invoice**  
Limit 4000; AR 4227; gap 227 on last invoice (no breach); terms breach 880 on earlier invoices → at-risk **1107** (`880 + 227`).  
If an earlier open invoice is paid and AR drops under 4000 → capacity gap **0**; at-risk = remaining terms breach only.

## Decision log (grill)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Capacity Gap card | `max(0, open AR − limit)` customer-level |
| D2 | At Risk | `Σ max(gap_i, breach_i)` |
| D3 | When earlier invoices close | Recalc from live open AR |
| D5 | Invoice gap field | Store + update; not the card source of truth |
| D6 | When to rewrite | AR-changing events + post-ingest |
| D7 | Waterfall order | Oldest invoice date first |
| D8 | `limit_assessed` | Recompute with gap each refresh |
| D9 | Limit basis | Effective limit (approved + top-up) |
| D10 | Invoice gap UI | Reports/exports + debug only |
| D11 | `in_capacity_gap` | true when live gap amount > 0 |

## User Stories

1. As a credit analyst, I want at-risk on a customer dashboard to equal the sum of per-invoice `max(gap, breach)`, so that I can reconcile the card to invoice rows.
2. As a credit analyst, I want an invoice with only capacity gap to contribute its gap, so that over-limit exposure is still at risk when terms are fine.
3. As a credit analyst, I want an invoice with only terms breach to contribute its full outstanding, so that policy-term risk is fully counted.
4. As a credit analyst, I want an invoice with both gap and breach to contribute the larger of the two (not the sum), so that the same money is not double-counted.
5. As a credit analyst, I want uncovered or excluded customers to show full open AR as at-risk, so that uninsured exposure stays conservative.
6. As a credit analyst, I want the Terms Breach card to keep summing full breach outstanding, so that breach monitoring is separate from at-risk.
7. As a credit analyst, I want portfolio at-risk to be the sum of customer at-risk under the same rule, so that portfolio and customer views agree.
8. As a credit analyst, I want portfolio totals without an extra policy max-cover residual, so that portfolio math does not invent risk beyond invoice max contributions.
9. As a credit analyst, I want report `at_risk_exposure` enrichment to use the same formula, so that exports match the dashboard.
10. As a credit analyst, I want daily trend snapshots going forward to store the new at-risk, so that charts stay consistent with live KPIs.
11. As a credit analyst, I want historical snapshot days rewritten once with as-of open invoices, so that past health/at-risk/compliant charts are coherent with that day’s AR.
12. As a credit analyst, I want compliant exposure and health index rewritten with at-risk, so that each snapshot day is internally consistent.
13. As a credit analyst, I want dual-currency at-risk secondary lines (when shown) to follow the same per-invoice max rule in the secondary currency, so that primary and secondary tell the same story.
14. As a credit analyst, I want tooltips in English and Hebrew to describe at-risk and capacity gap, so that help text matches the product.
15. As a developer, I want a single shared computation seam for at-risk, so that customer, portfolio, report, and snapshot paths cannot drift.
16. As a developer, I want call sites that used `gap + netted breach` replaced or adapted to the new seam, so that old rollup math is not left half-alive.
17. As a QA engineer, I want Ex1 / Ex2 / gap-only-last-invoice cases to verify at-risk and capacity gap manually.
18. As a QA engineer, I want an uncovered customer to still show at-risk = total AR, so that exclusion rules are regression-checked.
19. As an operations engineer, I want a one-time rewrite job that can recompute all historical snapshot rows, so that we do not leave mixed-formula history.
20. As a product owner, I want ClickUp How to test steps that mirror the invoice reconciliation, so that acceptance is repeatable.
21. As a credit analyst, I want the Capacity Gap card to equal `max(0, open AR − effective limit)`, so that it matches over-limit exposure after payments.
22. As a credit analyst, I want invoice capacity gaps to update when earlier invoices are paid, so that an invoice is not stuck “in gap” after the customer is under limit again.
23. As a developer, I want one live waterfall that rewrites `limit_assessed`, invoice gap amounts, and `in_capacity_gap` on AR-changing events and post-ingest.
24. As a credit analyst, I want invoice capacity gap available in reports/exports for debug, but not as the Capacity Gap card.

## Implementation Decisions

- **Primary at-risk seam:** Shared helper sums per-invoice `max(gap, breach)` (plus uncovered → full AR). Prefer extending the existing credit-insurance domain helper.
- **Live waterfall seam:** New or extended domain helper that, given open invoices + effective limit, returns per-invoice assessed + gap; writers persist fields and set `in_capacity_gap`.
- **Capacity Gap card / CustomerPolicy.capacity_gap_amount:** Persist / display `max(0, open AR − effective limit)` (align secondary currency rules with existing dual-currency patterns). Stop using sticky `min(Σ invoice gaps, AR − limit)` KPI rollup once live gaps are authoritative; live `Σ gap_i` should equal the card when waterfall + AR are consistent.
- **Invoice membership:** Open Due/Overdue, non-negative amount; policy scope when filtered.
- **Breach input:** Any terms-breach flag → full line outstanding; else 0.
- **Triggers:** Payment link/recalc, invoice status transitions, limit/top-up changes, post-ingest AR chain (same customer scope as today’s gap pipeline).
- **Portfolio:** Sum customer at-risk only; no policy residual.
- **Terms Breach KPI:** Unchanged.
- **Snapshots:** Writers + one-time as-of historical rewrite; as-of days must apply live waterfall to that day’s open set (not today’s sticky stamps).
- **Frontend:** EN/HE tooltips for at-risk and capacity gap; remove/hide capacity gap from main unpaid invoice UI where it implies card semantics; no new styles.
- **Tests:** Only when explicitly requested.
- **Primary repo:** Backend for formula + waterfall + rewrite; frontend for tooltips / column visibility.

## Testing Decisions

- Assert Ex1 → at-risk 800; Ex2 → 500; gap-only last invoice → breach sum + gap; pay earlier invoice under limit → gap 0 and at-risk = remaining breach.
- Capacity Gap card equals `AR − effective limit` after payment that clears over-limit.
- Preferred seam: domain waterfall + at-risk helpers used by customer KPI response.

## Out of Scope

- Changing Terms Breach card/chart membership or amounts (flags unchanged)
- Changing uninsured amount semantics beyond uncovered → full AR already in place
- New automated test suites unless later requested
- New UI cards, charts, or styling
- Partial “90-day only” snapshot rewrite (full one-time rewrite)
- Keeping portfolio policy residual
- Keeping sticky-at-open `limit_assessed` as source of truth

## Further Notes

### Codebase scan

**Required**

- Shared at-risk helper and call sites (customer KPIs, portfolio, report enrichment, snapshots)
- Capacity gap pipeline: `syncInvoiceCapacityGapAmounts`, `computeLimitAssessedAmountForNewOpenInvoice`, `computePolicyCapacityGapKpi` / `syncCustomerPolicyGapAmounts`, post-ingest / payment recalc hooks
- `in_capacity_gap` flag writer
- As-of snapshot rewrite for gap + at-risk consistency
- Frontend tooltips + unpaid invoice capacity gap column visibility
- ClickUp durable summary / How to test

**Optional / out of scope unless requested**

- Automated unit tests for waterfall / at-risk
- Import golden-loop docs

**No change needed**

- Prisma schema for new columns (reuse existing gap / assessed / at-risk fields)
- Terms Breach outstanding APIs for the Terms Breach card alone

### Related plans

- `.cursor/plans/as-of-daily-snapshot-rewrite.prd.md` — as-of open set for historical days
- Prior sticky-gap docs superseded for Capacity Gap card and assessed stamps

## Issues (vertical slices)

Tracer-bullet breakdown under `.cursor/plans/at-risk-per-invoice-max/`.

**Overview:** `.cursor/plans/at-risk-per-invoice-max/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Shared formula + customer live KPIs | `issues/01-shared-formula-customer-kpis.md` | — | 1–6, 13, 15–18 |
| 2 | Portfolio + report live enrichment | `issues/02-portfolio-reports-live.md` | 01 | 7–9, 16 |
| 3 | Snapshot writers + full historical rewrite | `issues/03-snapshots-full-rewrite.md` | 01, 05 | 10–12, 19 |
| 4 | EN/HE at-risk + capacity gap tooltips / unpaid column | `issues/04-tooltip-copy.md` | — | 14, 24 |
| 5 | Live capacity-gap waterfall + card + event rewrite | `issues/05-live-capacity-gap-waterfall.md` | — | 17, 21–23 |

**Note:** Slice 01 may already be `done` against sticky gaps; after slice 05, re-verify Ex1/Ex2/card against live gaps. Slice 03 should wait on 05 so historical rewrite uses live as-of waterfall.
