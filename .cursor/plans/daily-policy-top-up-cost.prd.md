---
name: daily-policy-top-up-cost
overview: Persist daily primary-policy and top-up insurance costs on CustomerPolicyTrend snapshots and expose them on the customer dashboard via KPI card and 90-day cost trend chart.
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869dwn45x
isProject: false
---

# Daily policy and top-up cost tracking

## Problem Statement

Credit insurance accounts configure **policy cost** on primary and top-up insurance policies (`cost_calculation_method`, `cost_percent`) and record **top-up premium** on individual customer top-up rows. Users need to understand how much insurance coverage costs them **each day** at the customer level — for the primary policy assignment and for any active top-ups — and how that cost changes over time.

Today the platform snapshots daily limits, usage, and top-up **cover** on `CustomerPolicyTrend`, but it does **not** compute or store monetary **cost**. There is no customer dashboard KPI or chart for insurance cost. Finance and credit teams cannot see daily burn, compare policy vs top-up cost, or review cost history without manual spreadsheet work from static policy settings and premium fields.

## Solution

Extend the existing **daily customer policy trend snapshot** pipeline to compute and persist cost fields on each `CustomerPolicyTrend` row (one row per customer per UTC calendar day):

1. **Primary policy daily cost** — Derived from the linked primary insurance policy’s cost configuration and the snapshot day’s limit or open-AR usage base, stored as an absolute point-in-time amount (not prorated by days-in-month).

2. **Top-up daily cost** — Derived from each active top-up’s total premium amortized evenly over its inclusive date window; aggregated across all active top-ups for that customer/day into a single amount on the same trend row.

3. **Total daily cost** — Stored every snapshot day as the combinable sum of available policy and top-up components (with explicit rules when currencies differ).

4. **Config snapshot** — Copy `cost_calculation_method` and `cost_percent` from the primary insurance policy onto the trend row so historical rows remain interpretable after policy edits.

5. **Customer dashboard** — Show today’s total daily cost as a KPI card and a 90-day line chart breaking out policy vs top-up cost from trend history.

6. **Forward-only history** — Cost columns populate from deploy forward; existing trend rows are not backfilled.

No separate top-up trend table is introduced; top-up cost is aggregated onto `CustomerPolicyTrend` only.

## User Stories

1. As a credit insurance user viewing a customer, I want to see **today’s total daily insurance cost**, so that I understand current coverage burn at a glance.

2. As a credit insurance user, I want today’s cost split into **primary policy** and **top-up** components, so that I can see what drives spend.

3. As a credit insurance user, I want a **90-day cost trend chart** on the customer dashboard, so that I can see how daily cost changed as limits, usage, or top-ups changed.

4. As a credit insurance user, I want daily primary policy cost to follow the policy’s **Cost Calculation Method** (Limit vs Actual Sales), so that cost aligns with how the insurer contract is configured.

5. As a credit insurance user with a **Limit**-based primary policy, I want daily policy cost based on that day’s **approved limit** and policy **Cost %**, so that cost tracks the limit basis.

6. As a credit insurance user with an **Actual Sales**-based primary policy, I want daily policy cost based on that day’s **open receivable usage** on the policy and policy **Cost %**, so that cost tracks exposure.

7. As a credit insurance user, I want **Cost %** treated as a **daily rate** (not an annual rate divided by 365), so that stored amounts match business expectations for per-day pricing.

8. As a credit insurance user with an active top-up that has a **premium**, I want daily top-up cost to reflect premium spread evenly across the top-up’s start–end dates, so that each day in the window carries a consistent daily charge.

9. As a credit insurance user with **multiple active top-ups**, I want their daily premium amounts **summed** into one top-up daily cost on the trend row, so that I see total top-up burn without drilling into each row.

10. As a credit insurance user with multiple active top-ups in the **same premium currency**, I want the aggregated top-up daily cost and currency stored, so that the dashboard shows one combined figure.

11. As a credit insurance user with multiple active top-ups in **different premium currencies**, I want top-up daily cost stored as **null** (not a misleading single-currency sum), so that I am not shown an incorrect aggregate.

12. As a credit insurance user whose primary policy has **no cost configuration**, I want policy daily cost stored as **null**, so that missing setup does not show zero as if cost were free.

13. As a credit insurance user with an active top-up **without premium**, I want that top-up to contribute **nothing** to top-up daily cost, so that incomplete data does not block other components.

14. As a credit insurance user, I want **total daily cost** stored every snapshot day when components can be combined, so that I have a daily history of overall insurance burn.

15. As a credit insurance user, I want total daily cost to equal policy plus top-up when both exist in the **same currency**, so that the total is arithmetically clear.

16. As a credit insurance user, I want total daily cost to reflect **policy cost alone** when top-up cost is null, so that partial data still produces a useful total.

17. As a credit insurance user, I want policy cost displayed in **limit currency** and top-up cost in **premium currency**, so that each component uses its natural currency without forced FX in v1.

18. As a credit insurance user reviewing trend history after a policy **Cost %** change, I want past rows to retain the **cost method and percent captured on that day**, so that historical daily costs remain auditable.

19. As a credit insurance user, I want cost computed only for customers with an **active customer policy** assignment (same scope as today’s trend cron), so that cost tracking matches existing limit/usage snapshots.

20. As a credit insurance user with a customer marked **excluded from policy** or **outdated DCL**, I want daily cost stored as **null** for that customer/day, so that cost is not shown for ineligible assignments.

21. As a collection manager, I want cost history to **accumulate from deploy forward** without retroactive backfill, so that I understand the series grows over time (consistent with other trend features).

22. As a developer, I want cost computation in **pure, unit-tested helpers** invoked from the existing trend snapshot job, so that formulas are testable without running the full cron.

23. As a developer consuming the customer policy trend API, I want cost fields included in the customer trend series response, so that the dashboard chart does not require a separate endpoint.

24. As a QA engineer, I want automated tests for Limit vs Actual Sales formulas, premium amortization, multi-top-up same-currency sum, mixed-currency null, and missing-config null, so that regressions are caught without manual cron runs.

25. As a product owner, I want **credit dashboard account-level cost KPIs** deferred, so that v1 ships customer-level value first.

26. As a product owner, I want **report builder / export** cost fields deferred, so that scope stays focused on dashboard visibility.

27. As a credit insurance user, I want the cost KPI and chart gated behind existing **credit insurance product** access on the customer dashboard, so that non-credit customers are unaffected.

28. As a credit insurance user viewing the chart when only policy cost exists, I want the chart to show the policy series and omit or zero the top-up series appropriately, so that the UI is not empty when no top-ups are active.

29. As a credit insurance user viewing the chart when cost is null for all days in range, I want a clear **empty state**, so that I understand cost is not configured rather than the feature being broken.

30. As a developer, I want snapshot upserts to **update cost columns on conflict** for the same customer/day, so that re-running today’s snapshot refreshes cost when limits, usage, premiums, or policy config change intraday.

## Implementation Decisions

### No separate top-up trend table

Do **not** create `CustomerTopUpTrend` or any per-top-up daily table. Top-up daily cost is computed at snapshot time from active `CustomerTopUp` rows and stored only as aggregated fields on `CustomerPolicyTrend`. Individual top-ups remain the source of truth for premium and dates.

### Schema extension — CustomerPolicyTrend

Add nullable columns to the existing daily customer policy trend model:

| Column | Purpose |
|--------|---------|
| `policy_daily_cost` | Primary policy daily cost amount |
| `policy_cost_currency` | Currency for policy cost (customer approved limit currency) |
| `top_up_daily_cost` | Sum of active top-ups’ daily premium rates |
| `top_up_cost_currency` | Shared premium currency when aggregation is valid |
| `total_daily_cost` | Combined daily cost when combinable |
| `cost_calculation_method` | Snapshot of primary policy method (`ActualSales` / `Limit`) |
| `cost_percent` | Snapshot of primary policy Cost % |

Migration follows existing SQL migration patterns; regenerate Prisma client after schema change.

### Primary policy daily cost formula

Computed only when the linked **primary** insurance policy has both `cost_calculation_method` and `cost_percent` set. **Cost % is a daily rate** — do not divide by 365.

```
if method is null or percent is null → policy_daily_cost = null

Limit:
  policy_daily_cost = approved_limit × cost_percent ÷ 100

ActualSales:
  policy_daily_cost = usage_amount × cost_percent ÷ 100

policy_cost_currency = approved_limit_currency (fallback account currency pattern used elsewhere for limit currency)
```

Use the **base approved limit** and **usage_amount** already computed for the snapshot row — not effective limit including top-up cover.

Eligibility: same active `CustomerPolicy` rows as today’s trend cron; store **null** cost when customer is excluded from policy or outdated DCL (aligned with gap/usage eligibility).

### Top-up daily cost formula

For each active top-up on snapshot day (inclusive UTC calendar window, not cancelled):

```
if premium is null → contribute 0 (skip row)

inclusive_days = end_date − start_date + 1 calendar days
daily_rate = premium ÷ inclusive_days
```

Aggregate across all contributing top-ups:

- If **all** contributing top-ups share the same `premium_currency` → `top_up_daily_cost = sum(daily_rate)`, `top_up_cost_currency = that currency`
- If **mixed premium currencies** among contributors → `top_up_daily_cost = null`, `top_up_cost_currency = null`
- If **no** contributors with premium → both null

Include top-ups across different TopUp insurance policies when active concurrently (same as cover resolver scope for the customer). Do not FX-convert premiums in v1.

### Total daily cost formula

Stored every snapshot day:

| Condition | `total_daily_cost` |
|-----------|-------------------|
| Policy and top-up costs both non-null, **same currency** | `policy_daily_cost + top_up_daily_cost` |
| Only policy cost non-null | `policy_daily_cost` |
| Only top-up cost non-null | `top_up_daily_cost` |
| Mixed currencies between policy and top-up | `policy_daily_cost` if only policy exists; otherwise null for combined total when both exist in different currencies |
| Both components null | null |

v1 does **not** convert policy and top-up into account base currency for total.

### Single implementation seam (preferred)

Introduce a small **pure cost computation module** (two exported functions or equivalent):

1. `computePolicyDailyCost(input)` — method, percent, approved limit, usage amount, currency, eligibility flags → `{ amount, currency } | null`

2. `computeTopUpDailyCostAggregate(activeTopUps, asOfDate)` — list of top-up premium/date/currency → `{ amount, currency } | null`

3. `computeTotalDailyCost(policyPart, topUpPart)` — combinator with currency rules above

The **existing customer policy trend snapshot job** is the only writer: after limit/usage/top-up cover fields are resolved for a customer/day, call the cost module and include results in the upsert. This reuses the same cron entry point as `top_up_total` and avoids a second daily job.

Readers (customer trend API, dashboard KPI service) **read stored columns** — they do not recompute cost formulas on read except for on-demand “refresh today” paths that already re-sync today’s snapshot.

### API contract

Extend the **customer policy trend** read response for a single customer to include, per series point:

- `policyDailyCost`, `policyCostCurrency`
- `topUpDailyCost`, `topUpCostCurrency`
- `totalDailyCost`
- `costCalculationMethod`, `costPercent` (optional audit fields for tooltips)

Default chart range: **90 days**, consistent with other customer dashboard trends.

Extend **customer dashboard KPI payload** (or equivalent customer credit KPI read path) with today’s `totalDailyCost` plus breakdown fields and currencies for the KPI card subtitle.

### Customer dashboard UI

- **KPI card:** today’s total daily cost with formatted currency; secondary line or tooltip for policy vs top-up breakdown when available.
- **Line chart:** 90-day series with at least two series (policy daily cost, top-up daily cost) and optional total overlay; reuse existing customer dashboard chart primitives and credit-product gating.
- **Empty/null UX:** when today’s total is null, show em dash or “not configured” pattern consistent with other credit KPIs — do not show 0.

Translations required for new labels (EN/HE) — follow project translation approval process.

### History and idempotency

- **Forward-only:** no backfill of historical `CustomerPolicyTrend` rows.
- Upsert on `(customer_id, snapshot_date)` updates cost columns on conflict, same as limit/usage fields.
- If primary policy cost config or top-up premium changes, only **subsequent** snapshot runs change stored values; past rows retain snapshotted config and computed amounts from that day.

### Relationship to existing top-up cover fields

`top_up_total` and `effective_approved_limit` continue to represent **cover capacity**; new cost fields are independent **monetary burn** metrics. Do not conflate premium amortization with cover amount resolution.

## Testing Decisions

### What makes a good test

Test **observable business rules** (formula inputs → stored/read amounts and null handling), not SQL upsert internals or Prisma call order. Prefer pure function unit tests for cost computation; add focused service-level tests only where snapshot wiring merges cost into an existing upsert payload.

### Modules to test

1. **Cost computation module** (primary) — Limit vs Actual Sales, null when config missing, null when excluded/outdated, currency passthrough, daily rate without ÷365.

2. **Top-up aggregation** — single top-up premium amortization; multiple same-currency sum; mixed-currency null; missing premium skipped; inactive/cancelled top-ups excluded; inclusive day count edge cases (single-day window).

3. **Total combinator** — same-currency sum; policy-only; top-up-only; mixed-currency partial total rules.

4. **Optional integration smoke** — snapshot runner exports remain callable; one test that mocked upsert receives cost fields when inputs are provided (only if pure tests do not cover wiring).

### Prior art

- Existing customer policy trend service unit tests (export/smoke pattern).
- Top-up domain tests (`CustomerTopUpService`, `resolveEffectiveApprovedLimit`, multi-top-up capacity tests) for active-top-up selection conventions.
- Customer dashboard KPI / view-model tests for card and chart payload shaping.

### Manual QA

- Customer with Limit method + Cost %: verify KPI and chart match hand-calculated `limit × percent / 100`.
- Customer with Actual Sales method: verify cost moves when open AR changes day over day.
- Customer with one top-up premium over 30 days: flat top-up daily line for active window.
- Customer with two USD top-ups: summed top-up daily cost.
- Customer with EUR + USD top-ups: top-up cost null, policy cost still shown if configured.

## Out of Scope

- **`CustomerTopUpTrend`** or any per-top-up daily persistence table.
- **Credit dashboard** account-level daily cost KPIs, snapshots, or trend charts.
- **Report builder / export** fields for daily cost.
- **Historical backfill** of cost on existing trend rows.
- **FX conversion** of policy cost and top-up premium into account base currency for totals.
- **FX aggregation** of mixed-currency top-ups into a single top-up daily cost.
- **Annual-rate (÷365)** interpretation of Cost % — explicitly rejected; Cost % is daily.
- **TopUp insurance policy cost %** as fallback when premium is missing — v1 uses premium amortization only for top-up cost.
- **Editable daily_cost field** on `CustomerTopUp` — v1 derives from premium and dates only.
- **Denormalized cost sync** on `Customer` or invoice entities.
- **Intraday cost alerts** or billing/invoicing integration.

## Further Notes

### Decision log (grill-me)

| Topic | Decision |
|-------|----------|
| Top-up storage | Aggregated on `CustomerPolicyTrend` only — no new trend table |
| Primary formula | Method-driven; Cost % is daily rate; Limit → approved limit; Actual Sales → usage_amount |
| Top-up formula | Premium ÷ inclusive days; sum when same premium currency |
| Total | Stored daily on same row with currency combinator rules |
| Currencies | Policy in limit currency; top-up in premium currency; no FX in v1 |
| Missing config | Null-skip per component |
| Config history | Snapshot method + percent on trend row |
| History | Forward-only from deploy |
| UI v1 | Customer dashboard KPI + 90-day chart |

### Testing seam confirmation

The intended **single seam** for automated testing is the **pure cost computation module** invoked from the existing daily customer policy trend snapshot. Dashboard and API layers should remain thin mappers over stored trend columns. If implementation prefers inlining formulas inside the snapshot service, extract them before merge so unit tests still target one module.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Daily policy and top-up cost tracking](https://app.clickup.com/t/869dwn45x)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Persist daily cost on CustomerPolicyTrend snapshots | [869dwn46r](https://app.clickup.com/t/869dwn46r) | — | 4–7, 8–13, 14–16, 18–22, 24, 30 |
| 2 | Expose daily cost in trend API and customer KPI payload | [869dwn47r](https://app.clickup.com/t/869dwn47r) | #1 | 1–2, 17, 23 |
| 3 | Customer dashboard daily cost KPI and 90-day chart | [869dwn47z](https://app.clickup.com/t/869dwn47z) | #2 | 1–3, 17, 27–29 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development

**Tags:** `ready-for-agent`, `enhancement`, `credit-insurance`
