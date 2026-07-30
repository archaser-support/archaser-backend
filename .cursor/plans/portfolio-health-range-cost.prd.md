# Portfolio health range cost — PRD

Status: ready-for-agent

## Problem Statement

On Credit Portfolio Health → Costs & Effectiveness, **Policy cost** for a
selected date range is today the **sum of daily burn** stored on approved
`CustomerPolicyTrend` rows. For **Actual Sales** policies that daily burn is
based on **open AR usage × cost %**, not on sales issued in the range. For
**Limit** policies the daily figure is treated as a same-day rate and then
summed across days, which does not match an annualized
“limit × cost % / 365 × days” view.

Analysts therefore see a period total (for example ~1173) that does not
answer: “What did coverage cost for invoices we issued in this period, plus
top-up burn, with Limit cover priced as an annual rate over the days in
range?” The monthly cost chart currently plots **last available day’s daily
total per month**, which further diverges from true monthly range cost. The
daily cost sparkline reinforces the old daily-burn mental model and adds
little once period and monthly totals are redefined.

## Solution

Rebuild **period Policy cost** and **monthly policy cost bars** on the Costs
tab using method-aware range math for **approved** customers only, and
**remove the Cost trend sparkline**.

1. **Actual Sales** — For each qualifying invoice with `invoice_date` in the
   (month-scoped) range:
   `(Invoice.amount × cost % as of invoice_date) / 100`. Include credit notes
   as stored amounts. Exclude **Draft**, **Void**, and **Cancelled**. Require
   the customer to be **approved on that invoice_date**. When a policy filter
   is set, only invoices with `Invoice.policy_id` equal to that policy.

2. **Limit** — For each approved customer-day in range whose that-day method
   is Limit:
   `(approved limit that day × cost % that day) / 100 / 365`. Sum day slices
   (limit changes mid-range are handled naturally).

3. **Top-ups** — Keep amortization: for each active top-up day in range,
   `premium ÷ inclusive days in the top-up window`; sum those daily slices
   into period and into each calendar month.

4. **Method flips** — Apply Limit vs Actual Sales **by day / by invoice date**
   from that day’s cost configuration on history (not “current policy only”).

5. **Missing config** — If cost method or cost % is missing for that day,
   contribute **0** (no fallback).

6. **Monthly bars** — Same three components scoped to each calendar month
   (invoices by `invoice_date` month; Limit and top-up slices by day in that
   month).

7. **Effective cost** — Keep
   `period cost ÷ average daily compliant exposure` using the new period cost
   as numerator.

8. **Copy** — Update Costs help/title strings so Policy cost and monthly chart
   describe the new definitions (no sparkline).

Customer-level daily cost snapshots and other dashboards are unchanged in
this PRD.

## User Stories

1. As a credit analyst, I want period Policy cost to reflect **Actual Sales**
   as issued invoice amounts in the range × cost %, so that cost tracks sales
   written in the period rather than open AR burn.

2. As a credit analyst, I want period Policy cost for **Limit** customers to
   use `(approved limit × cost %) / 100 / 365` per day, so that limit-based
   cover is priced as an annual rate over days in range.

3. As a credit analyst, I want **top-up** cost included in the same period
   total via daily premium amortization, so that supplemental cover is not
   omitted.

4. As a credit analyst, I want monthly policy cost bars to use the **same
   formulas scoped to each calendar month**, so that month-over-month bars
   match the period definition.

5. As a credit analyst, I want the Cost trend **sparkline removed**, so that
   the Costs tab does not show a conflicting daily-burn series.

6. As a credit analyst, I want only **approved** customers (linked policy, no
   exclusion reason) to contribute, so that uncovered book does not inflate
   policy cost.

7. As a credit analyst, I want approval checked **on each Limit day and on
   each invoice’s issue date**, so that mid-range exclusion changes are
   respected.

8. As a credit analyst, I want Actual Sales to use the invoice’s **original
   issued `amount`** (account currency), so that later payments do not change
   historical period cost.

9. As a credit analyst, I want **credit notes** included as their stored
   amounts when not Draft/Void/Cancelled, so that netting follows how
   invoices are stored.

10. As a credit analyst, I want **Draft**, **Void**, and **Cancelled**
    invoices excluded, so that non-final documents do not drive cost.

11. As a credit analyst, I want cost % taken **as of the invoice issue day**
    (and as of each Limit day), so that later policy edits do not rewrite
    past period cost incorrectly.

12. As a credit analyst, I want Limit vs Actual Sales chosen **per day / per
    invoice date**, so that a method switch mid-range prices each slice
    correctly.

13. As a credit analyst, I want days or invoices with **missing cost method
    or cost %** to contribute zero, so that the product does not invent
    configuration.

14. As a credit analyst filtering by one insurance policy, I want Actual
    Sales to include only invoices stamped with that **`policy_id`**, so that
    policy-scoped cost matches other portfolio-health filters.

15. As a credit analyst, I want Limit and top-up slices under a policy filter
    to remain consistent with existing trend/policy scoping, so that filtered
    totals stay coherent.

16. As a credit analyst, I want **Effective cost** to keep using period cost
    ÷ average daily compliant exposure, so that “cost per unit of compliant
    cover” updates automatically with the new numerator.

17. As a credit analyst, I want Policy cost and monthly chart **labels/help**
    to describe issued-sales / annualized-limit / amortized top-ups, so that
    the UI matches the math.

18. As a credit analyst using business-unit filters, I want range cost to
    respect the same customer scope as the rest of portfolio health, so that
    BU views stay aligned.

19. As a credit analyst, I want an empty range or no qualifying
    invoices/days to show **zero** (or empty monthly series), so that sparse
    data does not error.

20. As a credit analyst, I want multi-currency top-up mismatch rules to stay
    as today (omit mismatched combined top-up when currencies disagree), so
    that we do not invent FX in v1.

21. As a QA engineer, I want unit tests at the portfolio costs aggregator for
    Limit day-slices, Actual Sales invoice sums, top-up amortization, month
    scoping, skips, method flips, approval-as-of-day, and policy filter, so
    that regressions are caught without UI drives.

22. As a developer, I want stored customer daily cost and
    non–portfolio-health surfaces left unchanged, so that this change stays
    scoped to portfolio range cost presentation.

23. As a credit analyst, I want period cost to be the sum of Actual Sales +
    Limit + top-up components over the selected from/to window, so that one
    number answers “what did coverage cost in this range?”

24. As a credit analyst viewing a partial month at range edges, I want only
    **days and invoices inside from/to** to count inside that month’s bar, so
    that range bounds are honored.

25. As a product owner, I want this behavior documented against the prior
    “sum of daily total_daily_cost” rule, so that agents and reviewers do not
    reintroduce sparkline-based period math.

## Implementation Decisions

- **Surface** — Credit Portfolio Health Costs & Effectiveness only: period
  Policy cost KPI, monthly policy cost chart, remove Cost trend sparkline and
  unused daily sparkline wiring from that section’s API payload when no longer
  needed by the UI.
- **Primary seam** — Extend the portfolio health **costs section builder /
  range-cost calculator** (same service layer that today builds `periodCost`,
  `daily`, `monthly`). Prefer pure functions that accept structured inputs
  (approved day rows with limit/method/cost %, qualifying invoices, top-up day
  contributions) and return `{ periodCost, monthly[] }` plus whatever
  footprint/effective-cost inputs already exist.
- **Do not** change `CustomerPolicyTrend` persisted daily cost columns or
  customer dashboard daily cost charts in this PRD.
- **Actual Sales input** — Query invoices in account + date range (+ optional
  BU customer set + optional `policy_id`), statuses excluding
  Draft/Void/Cancelled, use `amount`, join/filter approval and that-day cost
  method/percent from customer-policy trend (or equivalent historical) rows
  for `invoice_date`.
- **Limit input** — Iterate approved customer-days in range where that day’s
  `cost_calculation_method` is Limit; use that day’s approved limit and cost
  %; formula `(limit × costPercent) / 100 / 365`.
- **Top-ups** — Reuse existing amortization semantics
  (`premium / inclusive window days`) for each overlapping day in range; sum
  into period and month buckets.
- **Aggregation** —
  `periodCost = sum(actualSalesCost) + sum(limitDayCosts) + sum(topUpDayCosts)`
  over the selected range. Monthly points use the same three sums filtered to
  that `YYYY-MM`.
- **Effective cost** — Keep existing
  `computeEffectiveCost(periodCost, averageCompliantExposure)`; only the
  period numerator source changes.
- **API contract** — Costs section may drop or stop requiring a sparkline
  `daily` series for the UI; keep `periodCost`, `monthly`, `effectiveCost`,
  footprint fields, `accountCurrency`. Update types/tests accordingly.
- **i18n** — Update Costs copy keys for period cost help, monthly chart title,
  and remove sparkline-only strings if unused (with translation permission at
  implementation time).
- **No schema migration** required for v1 if history already carries method,
  cost %, limit, and invoices are queryable.

## Testing Decisions

- Good tests assert **external behavior** of the range-cost calculator and
  costs section builder: given fixtures for days, invoices, and top-ups,
  expect period and monthly totals (and effective cost wiring). Do not assert
  SQL text or React markup.
- **Chosen seam (ideal: one):** portfolio health costs range aggregator /
  `buildCostsSection` (and focused pure helpers it calls). Highest existing
  seam already covered by `creditPortfolioHealthService` cost unit tests
  (`computePeriodCost`, `aggregateDailyCostToMonthly`, `buildCostsSection`).
- Replace or rewrite tests that encode **sum of daily totalDailyCost** and
  **last-day-of-month** monthly aggregation so they match the new
  definitions.
- Prior art: `tests/unit/creditInsurance/creditPortfolioHealthService.test.ts`
  (costs describe block);
  `tests/unit/creditInsurance/customerPolicyDailyCost.test.ts` for
  amortization/`costPercent / 100` conventions to reuse, not to change
  customer daily snapshot behavior unless a shared helper is extracted
  carefully.
- Suggested cases: Limit day-by-day with mid-range limit change; Actual Sales
  issued amounts with credit note as stored; exclude Draft/Void/Cancelled;
  skip missing cost %; method flip mid-range; approval false on issue day →
  exclude invoice; policy filter on `Invoice.policy_id`; top-up overlap
  proration; month edge with from/to cutting a month; effective cost uses new
  period total.

## Out of Scope

- Changing how **customer dashboard** or stored **CustomerPolicyTrend** daily
  cost fields are computed or backfilled.
- FX conversion beyond using `Invoice.amount` (account currency) and existing
  top-up same-currency rules.
- Redefining Effective cost denominator (e.g. divide by issued sales).
- Recreating a sparkline from issued-sales or monthly series.
- New deductible % field or other Costs cards unrelated to period/monthly
  cost.
- Broad report-builder cost column changes.
- Backfilling historical invoices’ `policy_id` when null.

## Further Notes

- Decisions locked in grill-me (2026-07-29): D1–D16 (scope, Limit `/365`
  day-slices, Actual Sales issued totals, top-up amortization, cost % as-of
  issue day, approved-as-of-day, exclude Draft/Void/Cancelled, policy filter
  via `Invoice.policy_id`, keep Effective cost, remove sparkline, monthly =
  same formulas by month).
- Supersedes portfolio-health PRD wording that defined period cost as sum of
  approved daily `total_daily_cost` and monthly cost as last day’s daily
  total, **for the Costs tab period KPI and monthly chart only**.
- Related prior art: `.cursor/plans/credit-portfolio-health.prd.md`,
  `.cursor/plans/daily-policy-top-up-cost.prd.md`.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under
`.scratch/portfolio-health-range-cost/`. **Hard blockers** are recorded
in each slice's **Blocked by** header. Implement in dependency order;
start a **fresh session per issue**.

**Overview:** `.scratch/portfolio-health-range-cost/OVERVIEW.md`

| # | Title | File | Waiting on | Stories |
| --- | --- | --- | --- | --- |
| 1 | Range cost engine + API | `01-range-cost-engine-api.md` | — | see issue |
| 2 | Costs UI sparkline + copy | `02-costs-ui-sparkline-copy.md` | 01 | 5, 17 |

**Status:** `ready-for-agent` on all slices.
