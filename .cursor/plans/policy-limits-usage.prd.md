---
name: policy-limits-usage
overview: Rework the credit dashboard policy usage graph to show usage against customer approved limits for combined, Named, DCL/SDL, and top-up cover.
source: grill-me session
clickup_task_url: null
isProject: false
---

## Problem Statement

Credit-insurance users currently see the portfolio policy usage graph calculated against policy-level maximum cover fields. The first bar compares open receivables to the max policy total cover, and the DCL/SDL bar compares DCL open receivables to the policy max DCL/SDL cover. That makes the graph less useful for day-to-day credit control because users need to understand usage of the active customer limits they actually manage: Named limits, DCL/SDL limits, and top-up cover.

The existing graph also hides an important distinction. One customer can be over their approved limit while another customer's unused headroom offsets that overage at the portfolio level. Users want over-limit exposure to remain visible per customer, while still showing aggregated totals in one dashboard graph.

## Solution

Replace the portfolio policy usage graph's policy-maximum-cover basis with a customer-approved-limit basis. The graph becomes **Policy Limits Usage** and always shows three base-limit bars:

- **Total Limits Usage (Named + DCL/SDL)**: active Named and DCL/SDL customer policies together.
- **Named Limits Usage**: active Named customer policies only.
- **DCL/SDL Limits Usage**: active DCL/SDL customer policies only.

If active top-up capacity exists, keep a fourth **Top-Up** bar using the current top-up logic. The fourth bar should remain visually and behaviorally consistent with today's implementation.

For the first three bars, only active, non-excluded, non-outdated, non-expired customer policy rows with a positive approved limit count. Amounts must be normalized to the account display currency and respect the current credit dashboard filters. Usage is calculated per customer first, then summed, so individual breaches remain visible instead of being hidden by another customer's unused headroom.

The usage percentage for base-limit bars remains **open AR divided by base approved limit**, and may exceed 100%. The red segment represents only **uncovered exposure beyond base approved limit plus active top-up**, not top-up-covered excess. This means a customer can contribute to a base bar percentage above 100% while no red segment appears if active top-up fully covers the excess. The tooltip must explain that distinction.

## User Stories

1. As a credit analyst, I want the policy usage graph to show usage against active customer approved limits, so that the dashboard reflects the limits I manage operationally.

2. As a credit analyst, I want a combined Named + DCL/SDL bar, so that I can see total portfolio base-limit usage in one place.

3. As a credit analyst, I want a separate Named limits usage bar, so that I can understand whether Named customer cover is being consumed differently from DCL/SDL cover.

4. As a credit analyst, I want a separate DCL/SDL limits usage bar, so that I can monitor utilization of that cover category independently.

5. As a credit analyst, I want the graph title to say Policy Limits Usage, so that it no longer implies the chart is based on policy maximum-cover caps.

6. As a credit analyst, I want the combined bar to be a single aggregate bar, so that the first bar is easy to compare against the Named-only and DCL/SDL-only bars.

7. As a credit analyst, I want Named and DCL/SDL base bars to always appear even when one category is empty, so that the chart layout is stable across filters.

8. As a credit analyst, I want the top-up bar to appear only when active top-up capacity is greater than zero, so that inactive or irrelevant top-up policies do not create noise.

9. As a credit analyst, I want the top-up bar to behave as it does today, so that existing interpretation of top-up used, remaining, and over-effective cover remains unchanged.

10. As a credit analyst, I want only active customer policy rows to count, so that inactive policy assignments do not distort current usage.

11. As a credit analyst, I want excluded customers to be omitted from base-limit usage, so that excluded receivables do not appear as covered exposure.

12. As a credit analyst, I want outdated DCL rows to be omitted, so that outdated limits do not create false available capacity.

13. As a credit analyst, I want expired approved limits to be omitted, so that stale approvals are not treated as current cover.

14. As a credit analyst, I want customers without a positive approved limit to be excluded from base-limit capacity, so that zero or missing limits do not create misleading percentages.

15. As a credit analyst, I want open receivables and approved limits normalized to the account display currency, so that mixed-currency policies compare correctly.

16. As a credit analyst, I want dashboard policy filters and business-unit filters to apply to the graph, so that the chart matches the rest of the credit dashboard view.

17. As a credit analyst, I want per-customer over-limit exposure preserved before aggregation, so that one customer's breach is not hidden by another customer's remaining headroom.

18. As a credit analyst, I want the base-limit usage percentage to be actual open AR divided by approved limit, so that the percentage can honestly show usage above 100%.

19. As a credit analyst, I want red exposure on the first three bars to mean uncovered exposure beyond base limit plus active top-up, so that red does not duplicate top-up-covered excess.

20. As a credit analyst, I want top-up-covered excess to appear in the top-up bar, so that incremental cover consumption is isolated from base-limit exposure.

21. As a credit analyst, I want a tooltip explanation when base usage exceeds 100% without a red segment, so that I understand top-up is covering the above-base exposure.

22. As a Hebrew-speaking user, I want the new title, labels, and tooltip copy localized, so that the dashboard remains consistent in Hebrew.

23. As an English-speaking user, I want the new labels to be clear and specific, so that I can distinguish customer approved limits from policy maximum cover.

24. As a product owner, I want the top-10 customer usage chart unchanged, so that this change stays focused on the portfolio policy usage graph.

25. As a product owner, I want customer KPI cards, trend snapshots, policy reports, and policy-cap alerts unchanged, so that the feature does not expand into unrelated usage concepts.

26. As a developer, I want the graph data contract to expose explicit combined, Named, DCL/SDL, and top-up segments, so that the UI does not infer business rules from legacy policy maximum fields.

27. As a developer, I want portfolio segment computation covered with unit tests, so that future policy-limit changes do not silently reintroduce netting or policy-cap denominators.

28. As a QA engineer, I want simple examples where top-up covers above-base usage and where exposure exceeds effective cover, so that I can verify the red segment semantics manually.

## Implementation Decisions

### Confirmed Product Decisions

- The first base bar is **Total Limits Usage (Named + DCL/SDL)**.
- The second base bar is **Named Limits Usage**.
- The third base bar is **DCL/SDL Limits Usage**.
- The optional fourth bar remains **Top-Up** and stays aligned with today's top-up behavior.
- The chart title changes to **Policy Limits Usage**.
- Base-limit denominators are the sum of active customer approved limits, not policy-level maximum cover fields.
- Eligible base rows are active, non-excluded, non-outdated, non-expired rows with a valid positive approved limit.
- The combined bar is a single aggregate bar, not a visual split by limit type.
- Bars 1-3 always render, even when a category has zero eligible rows.
- The top-up bar appears only when active top-up capacity is greater than zero.
- Usage percentage for the first three bars is actual open AR divided by base approved limits and may exceed 100%.
- Red base-bar exposure means uncovered exposure beyond base approved limit plus active top-up.
- Top-up-covered above-base exposure appears in the top-up bar, not as red exposure in base bars.
- Scope is limited to the portfolio policy usage graph.
- English and Hebrew dashboard translations are part of the feature.

### Primary Seam

Use the existing credit dashboard summary path as the highest behavioral seam. It already owns the portfolio dashboard response and applies dashboard account, policy, and business-unit scoping. Add or refactor a portfolio policy-limit usage aggregation inside that boundary so the API response can provide the chart with precomputed base segments.

The preferred pure seam is a customer-row aggregation helper that accepts already-resolved row inputs: customer limit type, open AR in account currency, approved limit in account currency, active top-up amount in account currency, exclusion/outdated/expiration flags, and current date. It should return category totals for used-within-limit, remaining, uncovered exposure, and usage percentage inputs. This keeps database reads, currency conversion, and chart rendering thin.

### API and UI Contract

- The dashboard summary response should stop treating the chart's first two base bars as policy maximum-cover concepts.
- The chart should receive values that represent combined, Named, DCL/SDL, and optional top-up categories.
- The UI should render the same stacked series semantics: used, remaining, and over limit.
- For base bars, "over limit" should be interpreted as uncovered exposure after active top-up coverage.
- Existing top-up fields and behavior may remain compatible if they already express current top-up used, remaining, and over-effective exposure.
- The UI copy should avoid saying max total cover for this chart.
- The tooltip should distinguish "usage percentage" from "uncovered exposure" when top-up covers above-base AR.

### Calculation Rules

- Normalize open AR and approved limits to account display currency before aggregation.
- Calculate customer-level segments first:
  - Used within base limit is the portion of AR up to the base approved limit.
  - Remaining is unused base approved limit after current AR.
  - Top-up-covered excess is the portion of AR above base approved limit covered by active top-up.
  - Uncovered exposure is AR beyond base approved limit plus active top-up.
- Sum customer-level segments into each relevant category.
- The combined category is the sum of eligible Named and DCL/SDL category rows.
- Named category includes only active Named rows.
- DCL/SDL category includes only active DCL/SDL rows.
- Base usage percentage is total open AR for the eligible category divided by total base approved limit for that category.
- If a category has no eligible limit, show zero values rather than hiding the base bar.
- Do not use policy max total cover or policy max DCL/SDL cover as denominators for this chart.

### Codebase Scan

Required changes:

- Credit dashboard summary aggregation: replace policy-maximum-cover chart totals with customer approved-limit category totals.
- Portfolio policy usage chart component: rename props/categories from policy maximum cover concepts to policy-limit category concepts.
- Credit dashboard screen wiring: pass the revised summary fields to the chart.
- Dashboard translations in English and Hebrew: update title, labels, captions, and tooltip.
- Unit tests for category aggregation, per-customer breach preservation, top-up-covered excess, expired/outdated/excluded rows, and multi-currency alignment.

Optional / follow-up:

- Extract reusable named types for chart category totals if the response type becomes hard to read.
- Add manual QA fixtures for a mixed Named + DCL/SDL account if existing credit-insurance sample data does not cover the full graph.
- Consider a later report-builder field for policy-limit usage categories if users ask to export this graph logic.

No change needed:

- Database schema and migrations: the feature uses existing customer policy limits and top-up fields.
- Top-10 customer usage chart: already calculates against customer approved limits and is explicitly out of scope.
- Customer dashboard KPI cards: existing policy/top-up/effective usage cards are not part of this portfolio graph change.
- Customer policy trend snapshots: historical snapshot semantics stay unchanged.
- Insurance policy trend snapshots: policy-level max-cover usage remains a separate concept.
- Policy max cover alerts: alerts based on policy maximum cover remain valid and separate from this chart.
- Dashboard SQL report creation scripts: this graph is driven by the application dashboard summary, not the report seed scripts.

### Non-Goals in the Implementation

- Do not introduce a new limit type in the domain model.
- Do not rename stored DCL fields or policy settings as part of this feature.
- Do not change top-up resolution rules outside what is needed to read active top-up capacity for the graph.
- Do not alter policy maximum-cover alerting or trend calculations.
- Do not add new styles beyond using the chart's existing design system patterns.

## Testing Decisions

### What Makes a Good Test

Good tests should assert user-visible behavior and stable business rules, not private implementation details. Tests should validate the dashboard summary output and pure aggregation results: which rows count, how segments are summed, when percentages exceed 100%, and when red exposure appears.

Tests should avoid coupling to chart-library internals. UI tests, if added, should verify category labels and rendered data shape rather than ApexCharts implementation details.

### Modules to Test

- Portfolio policy-limit usage aggregation: category eligibility, per-customer segment summing, combined vs Named vs DCL/SDL totals.
- Currency normalization seam: approved limits and open AR must be in account currency before percentage calculation.
- Top-up interaction: base percentage can exceed 100% while red exposure remains zero when active top-up covers the excess.
- Dashboard summary response: revised policy usage block returns the categories expected by the chart.
- Chart rendering contract: base bars always appear; top-up bar appears only when active top-up capacity is positive.
- Translation keys: English and Hebrew labels exist for the title, base bar labels, top-up label, legend, and tooltip.

### Prior Art

- Existing customer usage bar tests cover policy, top-up, and over-effective segment math.
- Existing customer dashboard KPI tests cover approved-limit usage and top-up usage formulas.
- Existing multi-currency usage tests guard against mixing AR and limit currencies.
- Existing dashboard summary tests, if present near this area, should be extended before adding a lower-value UI-only test.

### Example Test Cases

- Named customer with AR 120, limit 100, no top-up contributes 100 used and 20 uncovered exposure to Named and combined bars.
- DCL/SDL customer with AR 120, limit 100, active top-up 50 contributes 100 used, 0 remaining, 0 uncovered exposure to DCL/SDL and combined bars; the base usage percentage is still 120%.
- Two customers, one over and one under limit, still show uncovered exposure for the over-limit customer rather than netting it away.
- Expired, excluded, outdated, missing-limit, and zero-limit rows are excluded from base-limit category totals.
- Empty Named or DCL/SDL category renders zero values while remaining visible.
- Top-up bar is omitted when no active top-up capacity exists and appears when active capacity is positive.

## Out of Scope

- Changing the top-10 customer usage chart.
- Changing customer dashboard KPI cards.
- Changing trend snapshot writes or historical policy usage semantics.
- Changing policy maximum-cover alerts.
- Changing report-builder fields or seeded dashboard report SQL.
- Adding a new `SDL` domain enum or database field.
- Changing how top-up policies are created, assigned, or resolved outside this graph.
- Introducing new dashboard styling beyond existing chart patterns.
- Publishing ClickUp tasks or vertical slices from this PRD.

## Further Notes

The confirmed terminology is **DCL/SDL**, even though the underlying customer limit enum currently distinguishes `Named` and `DCL`. In this feature, DCL/SDL is the customer-facing label for the non-Named customer limit category.

This PRD intentionally separates two concepts that will coexist in the product:

- **Policy maximum-cover usage** remains relevant for policy-level trend history and policy max-cover alerts.
- **Policy limits usage** is the redesigned dashboard graph focused on customer approved-limit utilization.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Change policy usage calculation and Graph](https://app.clickup.com/t/869e4xteb)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Policy-limit usage aggregation for dashboard summary | [869e517tx](https://app.clickup.com/t/869e517tx) | — | 1, 2, 10-19, 26-27 |
| 2 | Policy Limits Usage chart categories and localized copy | [869e517u1](https://app.clickup.com/t/869e517u1) | 1 | 3-9, 21-25 |
| 3 | Top-up-covered exposure semantics and regression QA | [869e517tn](https://app.clickup.com/t/869e517tn) | 2 | 8-9, 18-21, 27-28 |

**Assignee / status:** Nilotpal Bose on all slices; Selected for Development. Tags: `ready-for-agent`, `enhancement`, `credit-insurance`. ClickUp did not expose the configured `Feature` task type on this list, so slices were created with the list's default task type.
