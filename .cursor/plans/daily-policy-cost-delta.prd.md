---
name: daily-policy-cost-delta
overview: Store day-over-day insurance cost changes (not absolute daily levels) on CustomerPolicyTrend, with capped cron gap-fill, delta-first KPI/chart API, and renamed report fields.
source: grill-me session + to-prd synthesis
clickup_task_url: https://app.clickup.com/t/869dwn9v4
isProject: false
---

# Daily policy cost delta storage

## Problem Statement

Credit insurance accounts already persist **daily insurance cost** on `CustomerPolicyTrend` via the daily customer policy trend snapshot job. Each row stores **absolute daily burn levels** — primary policy cost, top-up cost, and a combinable total — computed from policy configuration, approved limit or open-AR usage, and amortized top-up premium.

Finance and credit users need to see **how much cost changed from one day to the next**, not only the static level for a given day. A level series repeats the same figure when underlying inputs are stable; it does not highlight **movement** when limits, usage, premiums, or cost configuration shift. The customer dashboard KPI and 90-day chart (from the daily-cost feature) were designed around levels; report builder fields expose latest-row levels as well.

When the snapshot cron misses one or more UTC calendar days, comparing “today” to “yesterday” requires **filling gaps** or falling back to the last available snapshot — otherwise deltas are undefined or misleading.

This PRD changes persistence and read contracts from **levels** to **day-over-day deltas**, with explicit gap-fill rules and renamed API/report fields.

**Prerequisite:** Daily cost columns exist on `CustomerPolicyTrend` and level formulas are implemented (daily-cost PRD). Level computation remains in memory at snapshot time; only what is **stored** and **read** changes.

## Solution

1. **Delta-only persistence** — On each snapshot day, compute today's cost **levels** using existing formulas, compare to the prior day's levels (or fallback predecessor), and store **deltas** in the existing cost amount columns (`policy_daily_cost`, `top_up_daily_cost`, `total_daily_cost`). Database column names may remain; semantics become change amounts.

2. **Null predecessor → delta zero** — When there is no prior level (first trend row for the customer, prior row missing, or prior component was null), store **0** for that component's delta, not the full level and not null.

3. **Total delta** — `total_daily_cost` delta equals the **sum of policy and top-up deltas** when both are non-null and share the same currency — not the delta of a combined total level.

4. **Currency rules** — Compute a component delta only when **currency matches the prior day** for that component; otherwise store null. Negative deltas are allowed when the level decreases.

5. **Audit snapshots unchanged** — Continue storing `cost_calculation_method`, `cost_percent`, and currency columns on each row for historical interpretability.

6. **Cron gap-fill** — Before writing today, detect missing UTC calendar days at the **account** level (latest `snapshot_date` across all customers). Auto-fill up to **7** consecutive missing days by re-running the account snapshot sync for each date in order. If the gap exceeds 7 days, fill only the **most recent 7** days before today, then write today. If a customer still has no predecessor row, compute delta vs that customer's **most recent earlier** `snapshot_date`.

7. **Forward-only history** — Rows written before this change are not backfilled; delta semantics apply from deploy forward only.

8. **Customer dashboard** — KPI shows **today's total cost change** (delta), not absolute level. 90-day chart plots **stored delta series** (flat at zero when level unchanged). Optional subtitle when delta baseline is not calendar-yesterday.

9. **API** — Rename read-model fields to `*Change` suffix (camelCase). Expose `priorSnapshotDate` and optional `gapFillDaysApplied` on `latest` / KPI responses.

10. **Report builder** — Rename virtual Customer fields to `*_change` (snake_case) with delta semantics; update filters, sorts, and metadata labels.

## User Stories

1. As a credit insurance user viewing a customer, I want the KPI to show **today's change in total daily insurance cost**, so that I immediately see whether burn increased or decreased vs the prior snapshot.

2. As a credit insurance user, I want the KPI breakdown to show **policy and top-up change components**, so that I can see which part drove the movement.

3. As a credit insurance user, I want a **90-day chart of daily cost changes**, so that I see spikes when limits, usage, premiums, or cost % move and a flat zero line when cost is stable.

4. As a credit insurance user, I want the **first day** cost becomes configured to show **zero change**, so that activation does not look like a sudden cost spike.

5. As a credit insurance user returning after cost was null, I want the day cost **first appears** to show **zero change**, so that null-to-configured transitions are not misread as a one-day jump.

6. As a credit insurance user with a **Limit**-based policy and an unchanged approved limit, I want stored policy cost **change to be zero** day over day, so that stable limits do not imply false movement.

7. As a credit insurance user with an **Actual Sales**-based policy, I want policy cost **change to reflect usage movement**, so that open-AR shifts show up in the delta series.

8. As a credit insurance user whose **approved limit increases**, I want policy cost change to reflect the level difference vs the prior day, so that limit amendments are visible.

9. As a credit insurance user whose **cost percent** changes on the primary insurance policy, I want the next day's policy cost change to capture the effect vs the prior day's level, so that configuration edits surface in the trend.

10. As a credit insurance user with an active top-up premium spread over a date window, I want top-up cost change to be **zero on most days** within the window, so that flat amortized rates do not fake daily volatility.

11. As a credit insurance user who **adds a new top-up**, I want top-up cost change on that day to reflect the new daily rate vs the prior day, so that new coverage is visible.

12. As a credit insurance user who **ends or cancels a top-up**, I want top-up cost change to show a **negative or null** movement as appropriate, so that removed coverage is visible.

13. As a credit insurance user with **multiple active top-ups in the same premium currency**, I want top-up cost change based on the **aggregated level** difference, so that combined top-up movement is one figure.

14. As a credit insurance user with **mixed premium currencies** among active top-ups, I want top-up cost change stored as **null** when aggregation is invalid, so that I am not shown a misleading combined change.

15. As a credit insurance user with **policy and top-up in the same currency**, I want total cost change to equal **policy change plus top-up change**, so that the total is arithmetically clear.

16. As a credit insurance user with **policy and top-up in different currencies**, I want total cost change to follow component rules (null when both exist and cannot be summed), so that totals match storage rules from the daily-cost feature.

17. As a credit insurance user whose **policy cost currency changes** vs the prior day, I want policy cost change **null**, so that cross-currency diffs are not shown.

18. As a credit insurance user **excluded from policy** or with **outdated DCL**, I want cost changes **null** for that customer/day, so that ineligible assignments do not show burn movement.

19. As a credit insurance user reviewing history, I want each row to retain **snapshotted cost method and percent**, so that I can audit how levels were derived even though amounts stored are deltas.

20. As a credit insurance user when the cron **missed a few days**, I want missing calendar days **auto-filled** (up to a week) before today's delta is written, so that yesterday's comparison is meaningful.

21. As a credit insurance user when the cron was down **longer than a week**, I want today's delta computed against the **best available prior row** after partial gap-fill, so that I still see a change figure rather than silence.

22. As a credit insurance user when delta is **not vs calendar yesterday**, I want the KPI to indicate **which prior snapshot date** was used, so that I understand multi-day gaps.

23. As a credit insurance user, I want **negative** cost change when daily burn decreases, so that reductions are visible.

24. As a credit insurance user building a **Customer report**, I want fields named for **cost change** (not level), so that exports match dashboard semantics.

25. As a credit insurance user, I want to **filter and sort** customers by total daily cost change in report builder, so that I can find accounts with the largest movement.

26. As a credit insurance user without credit insurance on the account, I want cost change fields **hidden** in reports, so that non-credit customers are unaffected.

27. As a credit insurance user, I want **null change** rendered as an empty cell in reports, so that missing data is not shown as zero.

28. As a developer consuming the customer policy trend API, I want **renamed change fields** on each series point, so that clients do not misinterpret deltas as levels.

29. As a developer, I want delta rules in **pure unit-tested helpers**, so that formulas are verified without running the full cron.

30. As a QA engineer, I want tests for gap-fill date resolution, null-predecessor zero, currency mismatch null, negative deltas, and total-as-sum-of-components, so that regressions are caught early.

31. As an operator, I want cron logs when **gap exceeds seven days**, so that I know manual backfill may be needed for older history.

32. As a credit insurance user re-running **today's snapshot** intraday, I want today's stored change updated when inputs shift, so that the KPI stays current (delta still vs prior calendar day or fallback predecessor, not vs earlier today).

33. As a product owner, I want **absolute daily cost levels** removed from database storage, so that there is a single source of truth for movement.

34. As a product owner, I want **no backfill** of historical rows to delta semantics, so that scope stays bounded.

35. As a credit insurance user viewing the chart when all changes are null in range, I want a clear **empty state**, so that I understand cost is not configured rather than the feature being broken.

## Implementation Decisions

### Relationship to daily-cost (levels) PRD

Level formulas are **unchanged**: Cost % is a daily rate; Limit uses approved limit; Actual Sales uses usage amount; top-up uses premium ÷ inclusive calendar days with same-currency aggregation. The snapshot job still computes levels in memory, then derives deltas before upsert. The daily-cost PRD's level-based user stories for KPI/chart/reports are **superseded** by this PRD for those surfaces.

### Delta persistence semantics

For each customer and UTC `snapshot_date`:

1. Compute **today's levels** with existing cost snapshot logic.
2. Load **predecessor** row: prior calendar day's row after gap-fill, or if missing, the customer's most recent earlier `snapshot_date`.
3. For each component (policy, top-up):
   - If today's level is null → delta null.
   - If predecessor level is null or no predecessor → delta **0**.
   - If predecessor currency ≠ today's currency → delta null.
   - Else → delta = today level − predecessor level (negative allowed).
4. **Total delta**: if policy delta and top-up delta are both non-null and same currency → total delta = policy delta + top-up delta; else apply same partial rules as level combinator (policy-only when top-up null, etc.) but using **deltas**, not level combinator on totals.

Store results in existing amount columns. Keep currency, method, and percent columns as today.

### Gap-fill orchestration

At the start of each account's sync during the daily cron:

- `lastDate` = maximum `snapshot_date` among all `CustomerPolicyTrend` rows for the account.
- `gap` = number of UTC calendar days from `lastDate + 1` through **yesterday** inclusive.
- If `gap` = 0: proceed to today.
- If `1 ≤ gap ≤ 7`: for each missing date in order, run account snapshot sync for that `snapshotDate` (writes deltas for those days using each day's predecessor).
- If `gap > 7`: run sync only for the **seven** dates from `yesterday − 6` through `yesterday`, then today. Log a warning with account id and gap size.
- Per customer, if today still lacks a predecessor after partial fill, use **most recent earlier row** for that customer when computing today's delta.

Constant: `MAX_GAP_FILL_DAYS = 7`.

Manual backfill for gaps older than seven days is operational (separate script invocation per date), not automatic in cron.

### API contract (prototype type shape)

Flat fields on each trend `series` point and on `latest`:

```
policyDailyCostChange: number | null
topUpDailyCostChange: number | null
totalDailyCostChange: number | null
policyCostCurrency: string | null
topUpCostCurrency: string | null
costCalculationMethod: 'Limit' | 'ActualSales' | null
costPercent: number | null
```

On `latest` and customer daily-cost KPI payload only:

```
priorSnapshotDate: string | null   // ISO date of row used as delta baseline
gapFillDaysApplied?: number         // 0–7, count of auto-filled days this cron run for the account
```

Series points do **not** include `priorSnapshotDate` per point (keeps chart payload small). KPI subtitle uses `priorSnapshotDate` when it differs from calendar yesterday.

Remove or stop exposing level field names (`policyDailyCost`, etc.) from the public API response.

### Report builder

Rename virtual Customer fields to delta semantics, e.g. `policy_daily_cost_change`, `top_up_daily_cost_change`, `total_daily_cost_change`, retaining currency/method/percent/snapshot-date audit fields with updated labels. Filters and sorts on amount fields apply to **change** values. Grouped SUM/AVG aggregates sum **changes** (same mixed-currency caveats as levels PRD).

### Customer dashboard UI

- **KPI card:** primary value = `totalDailyCostChange`; breakdown = policy and top-up change when available.
- **Subtitle:** when `priorSnapshotDate` is not calendar yesterday, show change since that date (translations required per project process).
- **Chart:** plot `policyDailyCostChange`, `topUpDailyCostChange`, optional `totalDailyCostChange`; zero line when unchanged.

### Modules to build or modify

- **Cost computation module** — add delta derivation from today levels + predecessor row; keep existing level functions for internal use.
- **Gap-fill date resolver** — pure function: given `lastDate`, `todayUtc`, `maxDays` → ordered list of dates to sync.
- **Customer policy trend snapshot service** — gap-fill loop, predecessor lookup, persist deltas, expose renamed fields on read paths.
- **Customer policy trend API handler** — no route change; response shape update.
- **Report metadata and query execution** — renamed fields, join logic unchanged (latest trend row).
- **Customer dashboard** cost KPI and chart consumers — bind to change fields.

### History and idempotency

Forward-only: pre-deploy rows may hold levels or null; do not convert. Upsert on `(customer_id, snapshot_date)` overwrites change columns on conflict when today's snapshot re-runs.

### Testing seam (recommended)

**Primary seam (single):** pure **delta snapshot** function — inputs: today's computed level snapshot + predecessor level snapshot (or absent); outputs: delta snapshot matching all currency, null, zero-predecessor, and total-sum rules. Invoked from the snapshot writer after level computation. This extends the existing cost computation module seam from the daily-cost PRD rather than introducing a second writer.

**Secondary seam:** pure **gap-fill date list** function — inputs: account `lastDate`, `todayUtc`, cap 7; outputs: ordered UTC dates to sync. No database in unit tests.

Cron wiring and API mappers stay thin; optional one integration smoke that upsert payload contains deltas when predecessor is mocked — only if pure tests do not cover wiring.

## Testing Decisions

### What makes a good test

Test **observable business rules**: given today and predecessor levels/currencies/eligibility, assert stored/read **change** amounts and null handling. Test gap-fill date lists from account last-date scenarios. Do not assert SQL order, Prisma call counts, or internal cron loop structure.

### Modules to test

1. **Delta snapshot (primary)** — null predecessor → 0; null today → null; currency mismatch → null; negative change; total = sum of components when combinable; excluded/outdated → null; method/percent passthrough unchanged on audit fields.

2. **Gap-fill date resolver** — gap 0, 3, 7, 10 (partial seven-day window); UTC calendar boundaries.

3. **API/KPI mapping** — DB delta columns map to `*Change` JSON keys; `priorSnapshotDate` populated on fallback paths (mapper unit tests).

4. **Report field rename** — metadata includes `*_change` fields; filter on `total_daily_cost_change` resolves to trend join (extend existing report builder cost field tests).

### Prior art

- Existing `customerPolicyDailyCost` unit tests (level formulas).
- `customerPolicyTrendCostMapping` tests (row → API point).
- Report builder trend cost field tests (`ReportExecutionService`, `ReportQueryBuilder`, `reportCustomerTrendCostFields`).

### Manual QA

- Stable Limit customer: several days of zero change, then raise limit → positive policy change.
- Actual Sales: open AR moves → non-zero policy change.
- Cron missed 3 days → after run, KPI shows change vs filled yesterday; `gapFillDaysApplied` = 3.
- Cron missed 10 days → partial fill 7; KPI `priorSnapshotDate` may be >1 day back.
- Report export: column headers say "change"; values match dashboard delta.

## Out of Scope

- Storing **absolute daily levels** alongside deltas in the database.
- **Backfill** of historical rows to delta semantics.
- **Account-level** credit dashboard cost change KPIs or snapshots.
- **FX conversion** for deltas across currencies.
- **Per-customer** gap detection (account-level max date only).
- **Automatic gap-fill beyond seven days** in cron (manual script per date instead).
- **Per-series-point** `priorSnapshotDate` on chart API.
- **Driver decomposition** (change attributed only to Δusage vs Δlimit separately).
- **Cumulative accrued cost** (running sum of daily burn).
- Changing level formulas (Cost % daily rate, top-up amortization, combinator rules for levels).

## Further Notes

### Decision log (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Storage | Delta-only in cost amount columns (replace level semantics) |
| D2 | First cost day | Delta = 0 |
| D3 | KPI | Shows today's delta |
| D4 | Chart | Plots delta series |
| D5 | Reports | Rename to `*_change` fields |
| D6 | History | Forward-only, no backfill |
| D7 | Currency | Delta only when currency matches prior day; negatives allowed |
| D8 | Prior row | Gap-fill first; else most recent earlier row |
| D9 | Total delta | Sum of component deltas when combinable |
| D10 | Audit fields | Keep method, percent, currencies |
| D11 | Gap-fill mechanism | Re-run account snapshot per missing date |
| D12 | Null→value | Delta = 0 |
| D13 | API names | `*DailyCostChange` camelCase |
| D14 | API shape | Flat fields |
| D15 | Gap cap | 7 UTC days |
| D16 | Gap > cap | Fill most recent 7, then fallback |
| D17 | Gap anchor | Account `MAX(snapshot_date)` |
| D18 | API metadata | `priorSnapshotDate`, optional `gapFillDaysApplied` on latest/KPI only |

### Supersedes

Storage and read semantics for cost amount columns and dashboard/API/report **level** field names from **daily-policy-top-up-cost** and **policy-cost-report-builder** PRDs. Level **formulas** and audit column behavior remain.

### Discovery gate (pre-merge)

Spike on one large account: seven-day gap-fill chain p95 runtime within cron budget. If not, lower cap or escalate to ops-only backfill (informational).

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Policy cost fields in report builder](https://app.clickup.com/t/869dwn9v4)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Persist daily cost deltas with capped gap-fill on CustomerPolicyTrend | [869dxfj4b](https://app.clickup.com/t/869dxfj4b) | — | 4–7, 9, 18–21, 29–34 |
| 2 | Expose cost change fields in trend API and KPI payload | [869dxfj6v](https://app.clickup.com/t/869dxfj6v) | #1 | 22, 28, 32 |
| 3 | Customer dashboard daily cost change KPI and chart | [869dxfj6r](https://app.clickup.com/t/869dxfj6r) | #2 | 1–3, 35 |
| 4 | Report builder cost change fields (rename from levels) | [869dxfj7e](https://app.clickup.com/t/869dxfj7e) | #1 | 24–27; *coordinate with existing level-based report subtasks 869dwn9vm/w0/wa* |

**Assignee / status:** Nilotpal Bose on all slices; Selected for Development

**Tags:** `ready-for-agent`, `enhancement`, `credit-insurance`
