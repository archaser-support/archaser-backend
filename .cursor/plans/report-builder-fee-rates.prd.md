---
name: report-builder-fee-rates
overview: Make Insurance Fee Rate (%) and Registration Fee (%) work end-to-end in the report builder on Customer and Customer Policies, with live active customer–policy values, filter/sort, and AVG-only grouping.
source: grill-me session (2026-10-08)
isProject: false
---

# Insurance and registration fee rates in report builder

## Problem Statement

Credit insurance users need **Insurance Fee Rate (%)** (`cost_percent`) and **Registration Fee (%)** (`registration_fee_percent`) as reliable report columns for lists, formulas, filters, and exports.

Both fields already appear in report metadata on **Customer** and **Customer Policies**, and formula hints already reference `Customer.cost_percent` / `Customer.registration_fee_percent`. In practice, Customer **Insurance Fee Rate** is not wired through the active customer–policy path the way Registration Fee is intended to be, so values can be blank. Filter/sort and group aggregates for these rates are incomplete or inconsistent with the product rules below.

## Solution

Keep the rates on **both** Customer and Customer Policies. Do not add money-amount fee columns or Annual Credit Assessment Fee in this work.

**Customer columns** resolve from the **live active customer–policy** row. If that rate is empty, **fall back to the linked insurance policy** rate (same rule for both fields).

**Placement (no new picker subsections):**

| Table | Order |
|-------|--------|
| Customer | After Cost Calculation Method: Insurance Fee Rate (%) → Registration Fee (%) → Policy Cost Snapshot Date |
| Customer Policies | After exclusion fields, before Capacity Gap (keep current) |

Support **filter and sort** on both rates on both tables. In grouped reports, allow **AVG only** (no SUM) on these percent fields.

## User Stories

1. As a credit insurance user, I want **Insurance Fee Rate (%)** on a Customer report to show the active customer–policy rate (or policy fallback), so that fee columns are not blank.
2. As a credit insurance user, I want **Registration Fee (%)** on a Customer report to show the active customer–policy rate (or policy fallback), so that formulas and exports match Settings.
3. As a credit insurance user, I want the same two rates on **Customer Policies** reports, so that I can audit rates per assignment row.
4. As a credit insurance user, I want both rates available when I join **Customer** from Invoice (or similar) reports, so that receivables can sit next to fee rates.
5. As a credit insurance user, I want to **filter and sort** by either rate on Customer and Customer Policies, so that I can find high or missing rates.
6. As a credit insurance user running a **grouped** report, I want **AVG** of a fee rate across a group, and I do not want **SUM** of percents offered for these fields.
7. As a credit insurance user, I want the two rates to stay **next to cost fields** on Customer (after Cost Calculation Method), so that I can find them with other cost settings.
8. As a developer, I want both rates resolved through the **same active customer–policy report helper** (select + extract + fallback), so that display, filter, and formulas stay aligned.

## Implementation Decisions

### Scope

- Rates only: `cost_percent`, `registration_fee_percent`.
- Tables: Customer + Customer Policies (no new InsurancePolicy report table).
- No computed money fees; no Annual Credit Assessment Fee; no trend-snapshot source for these rates.

### Customer resolution

Live active customer–policy → if null, InsurancePolicy field. Multi-policy selection follows the existing active customer–policy report helper (invoice/policy scope when present).

### Aggregates

AVG allowed; SUM blocked (or omitted) for these two percent fields when the report engine can express per-field aggregate rules. If the engine cannot restrict SUM without a larger change, document the gap and ship display/filter/sort first with a follow-up note in the slice.

### Relationship to policy-cost report builder PRD

`.cursor/plans/policy-cost-report-builder.prd.md` deferred live policy cost % as part of **trend daily-cost** virtual fields. This PRD covers **live rate columns** already listed in report metadata, not trend-backed daily cost amounts.

## Decision log (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | What to show | Rates only — Insurance Fee Rate (%) + Registration Fee (%) |
| D2 | Report tables | Keep on both Customer and Customer Policies |
| D3 | Customer placement | Stay in cost cluster after Cost Calculation Method |
| D4 | Customer value source | Live active customer–policy row |
| D5 | Empty customer–policy rate | Fall back to insurance policy rate |
| D6 | Customer Policies placement | Keep after exclusion, before Capacity Gap |
| D7 | Filter / sort | Yes on both tables for both rates |
| D8 | Group aggregates | AVG only (no SUM) |

## Out of Scope

- Money-amount insurance / registration fees in reports
- Annual Credit Assessment Fee in report builder
- InsurancePolicy as a primary report table
- Trend / snapshot-backed rates for these two fields
- Field-picker subsections / new UI grouping beyond reorder (reorder only if metadata order drifts)
- New automated tests unless explicitly requested later

## Further Notes

### Codebase scan (implementation touchpoints)

**Required**

- Customer policy-backed report field helper — treat `cost_percent` like Registration Fee (extract + select + InsurancePolicy fallback); ensure Registration Fee select merge actually loads CP/policy columns
- Report query builder — filter/sort on Customer via active CustomerPolicy path for both rates
- Group aggregate allowlist / UI — AVG only for these two fields when possible
- Report metadata field order — confirm Customer cost-cluster order and Customer Policies exclusion neighborhood

**Optional**

- Locale labels — already exist under `customers` for both keys; only touch if labels need clarity
- Formula engine auto-scale — already includes both field names; no change expected

**No change needed**

- Prisma schema — columns already on CustomerPolicy / InsurancePolicy
- Portfolio Health money cost charts — separate feature

### Follow-up: SUM not yet blocked on fee rate fields (engine gap)

Slice 02 shipped filter/sort; **SUM is still offered** for `cost_percent` / `registration_fee_percent`. The report engine has no per-field aggregation rule today:

- Report metadata fields (`reports/src/reports/report-metadata.ts`) carry no allowed/disallowed aggregation list.
- Backend grouping (`report-grouping.util.ts`, `applyGroupingAndAggregation`) accepts any of SUM/AVG/COUNT/MIN/MAX for any numeric field; no validation on save/execute.
- Frontend hard-codes the options: aggregation menu in `components/reports/DragDropFieldSelector.tsx`, palette auto-variants in `utils/reportTableUtils.ts` (`resolveNextPaletteFieldCandidate`), and formula aggregations (`FormulaUpsertModal`).

Proposed follow-up: add an optional metadata property (e.g. `disallowedAggregations: ["SUM"]`) on both fee-rate fields (Customer + Customer Policies), honor it in the three frontend spots, and reject it in backend execute/save validation. AVG/MIN/MAX/COUNT already work.

### Filter / sort mechanism (slice 02)

- **Customer reports:** Prisma `where` cannot express "active CustomerPolicy row, else InsurancePolicy rate" on the to-many join, so `splitFiltersByTable` skips these fields and `report-filter.util.ts` (`pickCustomerPolicyRateFilters` / `applyCustomerPolicyRateFiltersToRows`) filters fetched rows with the same `extractCustomerPolicyReportField` helper as display (full fetch → filter → paginate, like formula filters). Sort reuses the existing in-memory policy-backed sort.
- **Customer Policies reports:** direct Prisma columns. Fixed `operatorToPrisma` so the UI's `greater_or_equal` / `less_or_equal` map to `gte` / `lte` (they previously fell through to `equals` for every table).
- Not covered: rate filters on a **joined** Customer (e.g. Invoice report filtered by `Customer.cost_percent`) are still skipped, same as other policy-backed fields.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/report-builder-fee-rates/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/report-builder-fee-rates/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Wire live fee rates on Customer (+ Customer Policies display) | `issues/01-wire-customer-fee-rates.md` | — | 1–4, 7–8 |
| 2 | Filter, sort & AVG-only on fee rate fields | `issues/02-filter-sort-avg-fee-rates.md` | #1 | 5–6 |

**Status:** `ready-for-agent` on all slices.
