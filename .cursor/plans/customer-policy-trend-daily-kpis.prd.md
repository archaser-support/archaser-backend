---
name: customer-policy-trend-daily-kpis
overview: Extend CustomerPolicyTrend daily snapshots with full policy-setting fields and customer financial KPIs (health index, exposure, capacity gap, usage %s, terms breach breakdown), one row per customer policy assignment per day.
source: grill-me session + ClickUp task 869e1bjgt
clickup_task_url: https://app.clickup.com/t/869e1bjgt
isProject: false
---

# Customer Policy Trend — Daily KPI Snapshots

## Problem Statement

Credit analysts need **daily historical snapshots** of customer policy settings and financial results so they can compare trends over time — limits, terms, exposure, health index, capacity gap, and terms breach breakdown — without relying on live tables that only reflect today's state.

A ClickUp specification lists roughly thirty fields per customer per day, spanning policy configuration (limits, terms, cutoffs, exclusion) and financial KPIs (receivables, health index, at-risk/compliant exposure, capacity gap, usage percentages, terms breach). Some of these are **already stored** on `CustomerPolicyTrend` (limits, terms basics, open AR as `usage_amount`, top-up totals, exclusion flags). Many are **missing** (month-end cutoff days, financial KPIs, separate usage % columns, terms breach breakdown).

Additionally, the trend table's unique key is **`(customer_id, snapshot_date)`**, so when a customer has multiple active policy assignments on the same day, the nightly cron **overwrites** prior rows — only the last processed policy survives. That makes per-policy historical comparison unreliable.

## Solution

1. **Correct row grain** — One snapshot row per **`(customer_id, customer_policy_id, snapshot_date)`**, replacing the current customer-per-day unique key. Each row represents one active `CustomerPolicy` assignment on that calendar day (UTC).

2. **Extend policy-setting snapshots** — Copy the four month-end cutoff/substitute day fields from `CustomerPolicy` into each trend row. Treat ClickUp **“Payment terms cutoff/substitute day”** as **Reporting** cutoff/substitute (no separate payment-term cutoff fields exist in the product). Existing columns continue to cover limits, terms, top-up total, effective limit, and exclusion.

3. **Snapshot financial KPIs at cron time** — For each row, compute and store dashboard-aligned metrics in **account base currency** (`financial_currency`): total receivables (`usage_amount`), health index %, at-risk exposure, compliant exposure, capacity gap, and three usage % columns (`policy_usage_pct`, `top_up_usage_pct`, `effective_usage_pct`). Stop writing legacy `usage_pct`; migrate readers to `effective_usage_pct`.

4. **Terms breach breakdown** — Store a JSONB map `terms_breach_by_reason` on each row: for each known breach reason key, `{ count, amount }` scoped to invoices on that row's `insurance_policy_id` (Due/Overdue breach invoices only). Include an `other` bucket when invoice flags do not map cleanly.

5. **Forward-only rollout** — New columns populate from deploy date onward via the existing **Customer Policy Trend Daily Snapshot** cron (with gap-fill). No mandatory historical backfill in v1.

6. **Cron-only writes** — Snapshot population stays in the nightly job; no new read-time sync requirement for v1 beyond existing on-demand sync on the top-customers usage endpoint.

## User Stories

1. As a credit analyst, I want a daily snapshot of each customer's **approved limit, limit type, and currency**, so that I can see how limits changed over time.

2. As a credit analyst, I want daily snapshots of **top-up total and effective approved limit**, so that I can track how temporary cover affected effective limits historically.

3. As a credit analyst, I want daily snapshots of **max payment term, max allowed MEP, and reporting days**, so that I can audit term changes on a customer policy.

4. As a credit analyst, I want daily snapshots of **MEP and Reporting month-end cutoff and substitute days**, so that I can see when month-end roll rules changed.

5. As a credit analyst, I want **excluded-from-policy status and exclusion reason** snapshotted daily, so that exclusion history is preserved even if the reason is later cleared.

6. As a credit analyst, I want **total open receivables** (per policy assignment) snapshotted daily in account currency, so that receivables trend matches dashboard totals.

7. As a credit analyst, I want **health index** (0–100%) snapshotted daily per policy row, so that I can chart portfolio health for a customer over time.

8. As a credit analyst, I want **at-risk exposure** and **compliant exposure** amounts snapshotted daily, so that I can decompose total AR into risky vs compliant portions historically.

9. As a credit analyst, I want **capacity gap** snapshotted daily per policy row, so that limit-overrun history is available without recomputing from invoices.

10. As a credit analyst, I want **policy usage %, top-up usage %, and effective usage %** stored separately on each daily row, so that limit utilization trends distinguish base limit vs top-up pool vs combined effective limit.

11. As a credit analyst, I want **terms breach outstanding broken down by breach reason** (count and amount per reason) on each daily row, so that I can see whether breaches shifted from payment-term vs MEP vs reporting over time.

12. As a credit analyst with **multiple active policy assignments** on one customer, I want **one trend row per policy assignment per day**, so that policy-scoped history is not overwritten.

13. As a credit analyst reviewing a customer with **no linked insurance policy** (`insurance_policy_id` null), I still want a daily trend row keyed by `customer_policy_id`, so that DCL / pending-review paths retain history.

14. As a credit analyst, I want snapshot dates to use **UTC calendar days** consistent with other credit-insurance daily snapshots, so that trend boundaries align across dashboards.

15. As a credit analyst, I accept that **historical rows before deploy** will have NULL in new columns, so that forward-only rollout avoids expensive backfill.

16. As a credit analyst using the **credit dashboard top-customers usage chart**, I want charts to read **effective usage %** from the new column, so that utilization display stays correct after `usage_pct` deprecation.

17. As a credit analyst using the **customer dashboard policy trend chart**, I want the trend series to use stored KPI columns when available, so that historical charts reflect snapshot-time calculations.

18. As a credit analyst, I want **insurance policy number** available when viewing trends via join on `insurance_policy_id`, so that I can identify which policy a row belongs to without denormalizing policy number onto the trend row.

19. As an operations engineer, I want the existing **Customer Policy Trend Daily Snapshot** cron to remain the write entry point, so that scheduling and observability stay unchanged.

20. As an operations engineer, I want **gap-fill** behavior preserved for missed cron days (within existing cap), so that short outages do not leave permanent single-day holes in new columns when gap-fill runs.

21. As a developer, I want KPI snapshot math to **reuse customer dashboard formulas** scoped per `insurance_policy_id`, so that live KPIs and historical snapshots do not drift.

22. As a developer, I want a **single service seam** for snapshot row construction and upsert, so that tests and future report wiring have one owner module.

23. As a QA engineer, I want **unit tests on pure snapshot mapping helpers** (KPI fields, JSONB breach shape, usage % triple), so that regressions are caught without full DB integration setup in v1.

24. As a product owner, I accept **no report-builder virtual fields** in v1, so that storage and cron ship before customer report exposure.

25. As a product owner, I accept **no changes to InsurancePolicyTrend** in this task, so that policy-header trend scope stays separate from per-customer assignment trends.

26. As a Hebrew-speaking user, I want any **new UI labels** for additional trend series to follow existing i18n patterns when surfaced, so that localization stays consistent (no new copy required if only backend columns ship in v1).

## Implementation Decisions

### Primary seam (testing & architecture)

**Customer policy trend snapshot service** — extend the existing module that owns:

- **Write:** `syncCustomerPolicyTrendSnapshotForAccount` / `takeCustomerPolicyTrendSnapshots` — iterates active `CustomerPolicy` rows per credit-insurance account, computes KPI bundle per row, upserts into `CustomerPolicyTrend`.
- **Pure helpers (new or extracted):** map one policy assignment + live inputs → snapshot payload (financial KPIs, usage % triple, `terms_breach_by_reason` JSON). Test these without DB.
- **Read (migrate only):** existing trend readers (`getCustomerPolicyUsageTrend`, `getCustomerPolicyTrendForCustomer`, `getCustomerPolicyPortfolioTrend`, risk exposure trend) switch from `usage_pct` to `effective_usage_pct` where applicable.

Cron job wrapper continues to delegate to `takeCustomerPolicyTrendSnapshots` with no new job name.

**Proposed testing seam:** pure `buildCustomerPolicyTrendSnapshotPayload(...)` (or equivalent) at the highest point that accepts already-fetched policy row, AR, gap, breach aggregates, and account currency — returns the full upsert column set. Cron/SQL upsert remains thin orchestration. Confirm this seam before `/to-issues` if a different boundary is preferred.

### Grill-confirmed decisions

| Topic | Decision |
|-------|----------|
| Row grain | One row per `(customer_id, customer_policy_id, snapshot_date)` |
| Unique key | Replace `(customer_id, snapshot_date)` with `(customer_id, customer_policy_id, snapshot_date)` |
| Financial KPIs | Store all at cron time using dashboard formulas, account currency |
| Usage % | Add `policy_usage_pct`, `top_up_usage_pct`, `effective_usage_pct`; **stop writing `usage_pct`** |
| Month-end cutoffs | Snapshot 4 ints from `CustomerPolicy` |
| Payment terms cutoff | Maps to **Reporting** cutoff/substitute (not a new field) |
| Top up vs Top up Value | `top_up_total` only — no separate `top_up_value` aggregate |
| Health index | `health_index_pct` FLOAT 0–100 |
| Compliant exposure | Store `compliant_exposure_amount` explicitly |
| Terms breach | JSONB per reason with `{ count, amount }`; scoped to row's `insurance_policy_id` |
| Policy number | Join at read — no denormalization |
| Currency | `financial_currency` = account base currency |
| Backfill | Forward-only |
| InsurancePolicyTrend | Out of scope |
| Report builder | Out of scope v1 |

### Schema changes (`CustomerPolicyTrend`)

**New columns:**

| Column | Type | Notes |
|--------|------|-------|
| `mep_cutoff_day_of_month` | INT NULL | From `CustomerPolicy` |
| `mep_substitute_day_of_month` | INT NULL | From `CustomerPolicy` |
| `reporting_cutoff_day_of_month` | INT NULL | From `CustomerPolicy`; covers “payment terms cutoff” |
| `reporting_substitute_day_of_month` | INT NULL | From `CustomerPolicy` |
| `financial_currency` | VARCHAR(16) NULL | Account currency at snapshot time |
| `health_index_pct` | FLOAT NULL | 0–100 |
| `at_risk_exposure_amount` | FLOAT NULL | Account currency |
| `compliant_exposure_amount` | FLOAT NULL | Account currency |
| `capacity_gap_amount` | FLOAT NULL | Per-policy stored gap |
| `policy_usage_pct` | FLOAT NULL | Capped like dashboard |
| `top_up_usage_pct` | FLOAT NULL | Null when no top-up |
| `effective_usage_pct` | FLOAT NULL | Primary usage metric going forward |
| `terms_breach_by_reason` | JSONB NOT NULL DEFAULT `{}` | See contract below |

**Index / constraint migration:**

- Drop unique index on `(customer_id, snapshot_date)`.
- Add unique index on `(customer_id, customer_policy_id, snapshot_date)`.
- Existing rows: assume `customer_policy_id` was populated by cron; rows with NULL `customer_policy_id` need migration policy (delete or backfill from latest assignment) — implementer should audit counts before migration.

**Deprecated column:**

- `usage_pct` — retain column for backward compatibility but **stop writing** on new snapshots; readers migrate to `effective_usage_pct`.

### `terms_breach_by_reason` JSON contract

Keys align with `TermsBreachCountByReason` plus `other`:

```typescript
type TermsBreachReasonSnapshot = {
  count: number;
  amount: number; // outstanding in financial_currency
};

type TermsBreachByReasonSnapshot = {
  reportingBreach?: TermsBreachReasonSnapshot;
  paymentTerm?: TermsBreachReasonSnapshot;
  customerOverdueMep?: TermsBreachReasonSnapshot;
  customerExcludedFromPolicy?: TermsBreachReasonSnapshot;
  outdatedDcl?: TermsBreachReasonSnapshot;
  invoiceAfterPolicyEnd?: TermsBreachReasonSnapshot;
  other?: TermsBreachReasonSnapshot;
};
```

- **Scope:** Invoices where `status IN (Due, Overdue)`, breach flags set, and `policy_id` matches the trend row's `insurance_policy_id` (null-policy rows: only invoices with null `policy_id` or explicit rule for unassigned — default to matching `insurance_policy_id` including null).
- **Amount:** Sum invoice outstanding (same basis as `getCustomerTermsBreachOutstandingSum`) attributed per flag; an invoice with multiple flags contributes to each applicable reason bucket.
- **Count:** Invoice count per flag (same semantics as `getCustomerTermsBreachCountByReason`).
- **Implementation note:** Dashboard aggregation today computes counts per flag and total amount in one pass but does not expose per-reason amounts — snapshot cron needs a **new per-customer per-policy aggregation** (extend pattern from `aggregateTermsBreachForSummary`).

### Snapshot write path

- **Schedule:** Existing cron `Customer Policy Trend Daily Snapshot` (`0 3 * * *` UTC).
- **Account filter:** `has_credit_insurance = true`.
- **Row source:** Active `CustomerPolicy` where customer `collection_status IN (Active, Inactive)`.
- **Per row computation (reuse existing helpers where possible):**
  - Open AR on policy → `usage_amount` (already implemented).
  - Top-up totals / effective limit (already implemented).
  - Capacity gap → `storedCapacityGapAmount` on the policy row.
  - Terms breach → new per-policy by-reason aggregation.
  - At-risk → `computeCustomerRiskExposure` with policy AR, capacity gap, terms breach total.
  - Health index → `computeCustomerHealthIndex(totalAr, atRisk)`.
  - Compliant → `max(0, totalAr - atRisk)` (store explicitly).
  - Usage % triple → `computeTopUpUsageMetrics` / `computeCustomerUsageBarSegments` pattern.
  - Cutoff ints → copy from `CustomerPolicy`.
  - `financial_currency` → `Account.currency`.
- **Upsert:** `ON CONFLICT (customer_id, customer_policy_id, snapshot_date) DO UPDATE` including all new columns.
- **Gap-fill:** Unchanged — `resolveGapFillDates` + capped catch-up days.

### Read path migrations (`usage_pct` deprecation)

Consumers to update to `effective_usage_pct` (or compute from new columns):

- Top-customers usage trend response / credit dashboard charts.
- Customer policy trend series mapping (`mapCustomerPolicyTrendRowToPoint`).
- Portfolio trend near-limit filters (`usage_pct >= 80 AND < 100`).
- Any report or test fixtures asserting `usage_pct` writes.

**No new public API fields required in v1** if existing response shapes map `usagePct` from `effective_usage_pct` for backward-compatible API contracts.

### Codebase scan

**Required changes:**

| Area | Reason |
|------|--------|
| Prisma `CustomerPolicyTrend` model + SQL migration | New columns, unique key change |
| Customer policy trend snapshot service | Copy cutoffs, compute KPIs, JSONB breach, new upsert key |
| Customer policy trend cron wrapper | No logic change expected; verify step messages still accurate |
| Credit dashboard top-customers / usage charts | Read `effective_usage_pct` |
| Customer dashboard trend query mapping | Map new fields when exposing series |
| Unit tests: trend service, usage bar, cost mapping | Update for new columns and `usage_pct` deprecation |

**Optional / follow-up:**

| Area | Reason |
|------|--------|
| Report builder virtual fields (`reportCustomerTrendCostFields` pattern) | Explicitly out of scope v1 |
| `ReportExecutionService` / `ReportQueryBuilder` | Only if new report fields added later |
| Backfill script (mirror insurance policy trend backfill) | Out of scope unless requested |
| Customer dashboard KPI cards reading from trend | Live KPIs remain live; trend is for history |

**No change needed:**

| Area | Reason |
|------|--------|
| `InsurancePolicyTrend` snapshot cron | Out of scope |
| Translation files | No new UI strings if v1 is backend-only |
| Import/export policy columns | Trend is write-only from cron |
| `CustomerCheckpoint` | Separate restore-point feature |

## Testing Decisions

### What makes a good test

- Test **observable snapshot payload shape** and **KPI math** on pure helpers — given fixed AR, gap, breach breakdown, limits, and top-up inputs, assert output columns and JSONB content.
- Test **unique-key behavior** conceptually: two policy assignments same customer same day → two distinct payloads (integration test optional in v1).
- Do **not** assert raw SQL string contents or private cron loop order.
- Match **prior art:** `customerPolicyTrendService.test.ts` export smoke + `customerPolicyTrendCostMapping.test.ts` / `customerPolicyTrendUsageBar.test.ts` pure helper tests; `insurancePolicyTrendService.test.ts` rollup tests.

### Modules under test

| Module / seam | What to test |
|---------------|--------------|
| Pure snapshot payload builder | Health index, compliant/at-risk, usage % triple, JSONB breach map, currency field |
| Terms breach by-reason aggregator (new) | Count + amount per flag; multi-flag invoice; policy scope filter |
| `mapCustomerPolicyTrendRowToPoint` | Uses `effective_usage_pct` for `usagePct` API field |
| `computeCustomerUsageBarSegments` (existing) | Still source of truth for usage % inputs to snapshot |
| Snapshot service (v1) | Export smoke — write/read functions exist after signature changes |

### Prior art

- `tests/unit/creditInsurance/customerPolicyTrendUsageBar.test.ts` — usage % segment math.
- `tests/unit/creditInsurance/customerDashboardKpis.test.ts` — health index and KPI formulas.
- `tests/unit/creditInsurance/creditDashboardSnapshotService.test.ts` — daily snapshot JSON fields pattern at account level.
- `tests/unit/creditInsurance/customerPolicyTrendCostMapping.test.ts` — trend row → API point mapping.

### Explicitly not required in v1

- Full integration test with database seed + cron run.
- Report builder field extraction tests.
- Historical backfill script tests.

## Out of Scope

- **InsurancePolicyTrend** month-end cutoff columns or other policy-header trend extensions.
- **Report builder** virtual customer fields for new trend columns.
- **Mandatory historical backfill** for new columns on existing snapshot dates.
- **`policy_number` denormalization** on trend rows.
- **Separate `top_up_value` aggregate** (distinct from `top_up_total`).
- **Payment terms cutoff/substitute** as new schema fields (mapped to Reporting cutoffs).
- **New UI charts** for all KPI series (backend storage first; UI can follow).
- **Per-business-unit trend snapshots** (see `credit-dashboard-bu-trend-history.prd.md`).
- **CustomerCheckpoint** / restore-point integration.

## Further Notes

### Already on `CustomerPolicyTrend` (no new column)

Insurance policy reference (`insurance_policy_id`), limit type, approved limit + currency, top-up total, effective approved limit, max payment term, max allowed MEP, reporting days, exclusion flags, total receivables (`usage_amount`), daily cost delta fields, credit score fields, DCL flags.

### ClickUp task typo clarifications

- **Health Index** listed as “amount + currency” → store as **percentage 0–100**.
- **Terms Breach count** listed as “amount + currency” → store **count** in JSONB; amounts per reason also in JSONB per grill decision.
- **Policy Usage / Top Up Usage / Effective Usage** → three separate FLOAT columns.

### Dependency / ordering

- Month-end cutoff fields on `CustomerPolicy` should be deployed (`20260705_policy_month_end_cutoff_fields.sql`) before snapshot copies them; if migration not yet applied in an environment, snapshot copies NULLs.

### Risk: per-reason breach amounts

No existing helper returns **amount per breach reason** at customer-policy scope — only counts (`getCustomerTermsBreachCountByReason`) and total outstanding (`getCustomerTermsBreachOutstandingSum`). Implementation should add one aggregation used by both snapshot cron and (future) UI if needed.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Required data to save histirically daily](https://app.clickup.com/t/869e1bjgt)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | CustomerPolicyTrend schema & per-policy daily row grain | [869e1hh6u](https://app.clickup.com/t/869e1hh6u) | — | 4, 12, 13, 14, 15, 19, 20 |
| 2 | Snapshot financial KPIs & usage % at cron | [869e1hh7y](https://app.clickup.com/t/869e1hh7y) | 1 | 6–10, 15, 21–23 |
| 3 | Terms breach breakdown JSONB on daily trend rows | [869e1hhan](https://app.clickup.com/t/869e1hhan) | 1 | 11, 21–23 |
| 4 | Trend readers & charts — effective usage % migration | [869e1hhe3](https://app.clickup.com/t/869e1hhe3) | 2 | 16, 17 |

_Slices 2 and 3 can run in parallel after slice 1._

**Assignee / status:** Nilotpal Bose on all slices; Selected for Development per `.cursorrules`
