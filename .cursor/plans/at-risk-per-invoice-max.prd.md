---
name: at-risk-per-invoice-max
overview: Recalculate credit-insurance at-risk exposure as the sum of per-invoice max(capacity gap, terms breach), across live KPIs, portfolio, reports, and a one-time as-of historical rewrite.
source: grill-me session + /start-work CU-869exeaca
clickup_task_url: https://app.clickup.com/t/869exeaca
isProject: false
---

# At-risk exposure — per-invoice max(gap, terms breach)

## Problem Statement

Credit analysts see **At Risk Exposure** that does not match a clear invoice-level rule. Today the system rolls up customer capacity gap plus terms-breach outstanding net of gap (`min(total AR, gap + breach)`), and the portfolio can add a policy-level residual. Analysts expect each open invoice to contribute `max(capacity gap, terms breach)`, with the customer (and portfolio) total equal to the sum of those invoice contributions.

## Solution

Define one shared formula everywhere at-risk is computed:

- For each open Due/Overdue invoice in scope: `atRisk_i = max(capacity_gap_i, terms_breach_i)`
- `terms_breach_i` = full line outstanding when any terms-breach flag is set, else `0`
- `capacity_gap_i` = that invoice’s capacity gap in the KPI currency (account base for primary; matching secondary rules where dual currency exists)
- Customer / portfolio at-risk = `Σ atRisk_i` (no post-sum `min(total AR, …)` cap; no portfolio policy residual)
- Uncovered / excluded customers keep **full open AR** as at-risk
- Compliant exposure and health index continue to derive from total AR and the new at-risk
- **Terms Breach** cards stay on the existing full breach sum (unchanged)
- One-time **full historical rewrite** of stored at-risk, compliant, and health using **as-of open invoices for each snapshot day**
- Update EN/HE tooltips to describe the new rule

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
14. As a credit analyst, I want tooltips in English and Hebrew to describe the new formula, so that help text matches the product.
15. As a developer, I want a single shared computation seam for at-risk, so that customer, portfolio, report, and snapshot paths cannot drift.
16. As a developer, I want call sites that used `gap + netted breach` replaced or adapted to the new seam, so that old rollup math is not left half-alive.
17. As a QA engineer, I want a customer with mixed gap-only, breach-only, and both invoices to verify the sum manually, so that acceptance is objective.
18. As a QA engineer, I want an uncovered customer to still show at-risk = total AR, so that exclusion rules are regression-checked.
19. As an operations engineer, I want a one-time rewrite job that can recompute all historical snapshot rows, so that we do not leave mixed-formula history.
20. As a product owner, I want ClickUp How to test steps that mirror the invoice reconciliation, so that acceptance is repeatable.

## Implementation Decisions

- **Primary formula seam:** Replace (or reimplement behind) the shared customer at-risk helper so all live and snapshot writers call one function that sums per-invoice `max(gap, breach)` (plus uncovered → full AR). Prefer extending the existing credit-insurance domain helper rather than adding a second parallel API.
- **Invoice membership:** Open Due/Overdue invoices with non-negative amount, same breach flags as today’s terms-breach membership; policy scope when a policy filter is active.
- **Gap input:** Use invoice-level capacity gap amounts already stored for KPI currency (account base for primary path).
- **Breach input per invoice:** If any terms-breach flag is true, use full line outstanding (same outstanding basis as terms-breach sums today); else `0`.
- **No AR min-cap** after the sum; health index may continue to clamp at-risk to AR only when computing the percentage if needed for numerical safety, without changing the stored/displayed at-risk amount unless clamp is already display-only — prefer displaying the summed at-risk as computed.
- **Uncovered:** Keep current uncovered detection (no linked policy or any exclusion reason) → at-risk = full open AR; capacity gap suppressed as today.
- **Portfolio:** Sum customer (or equivalent invoice-scoped) at-risk only; remove policy residual that adds max-cover excess beyond customer gaps.
- **Terms Breach KPI:** Do not change card/query semantics.
- **Snapshots:** Update writers for customer policy trend and credit dashboard daily snapshots; run a **one-time full rewrite** of historical `at_risk_exposure` / compliant / health using as-of open invoices for each day (reuse existing as-of open-AR / rewrite pipeline concepts from the as-of daily snapshot rewrite work).
- **Frontend:** Update EN/HE dashboard tooltip strings for at-risk; no new styles.
- **Tests:** Do not add or expand automated tests unless explicitly requested later.
- **Primary repo:** Backend for formula + rewrite; frontend for tooltips only (same branch name when touched).

## Testing Decisions

- Good tests (manual or future automated) assert **external amounts**: given invoices with known gap and breach flags, at-risk equals the expected sum; uncovered equals total AR; portfolio equals sum of customers; snapshot day D uses as-of membership.
- Preferred seam: shared domain helper used by customer KPI response (highest practical seam without UI driving).
- Prior art: existing credit-insurance domain unit/integration patterns around invoice insurance fields and customer KPI snapshot builders.
- Manual How to test (customer 21262 or similar): compute per open invoice `max(gap, breach outstanding-or-0)`, sum, compare to At Risk card.

## Out of Scope

- Changing Terms Breach card/chart membership or amounts
- Changing capacity gap calculation / sticky gap pipeline itself
- Changing uninsured amount (separate field) semantics beyond uncovered → full AR already in place
- New automated test suites unless later requested
- New UI cards, charts, or styling
- Partial “90-day only” rewrite (superseded by full one-time rewrite)
- Keeping portfolio policy residual

## Further Notes

### Codebase scan

**Required**

- Shared at-risk helper and call sites in credit-insurance domain (customer KPIs, portfolio summary, report enrichment, KPI/trend snapshot payloads, trend service)
- Portfolio residual path in credit insurance dashboard summary
- As-of / snapshot rewrite entry points for customer policy trend and credit dashboard daily snapshots
- Frontend EN/HE tooltip keys for at-risk metric copy
- ClickUp durable summary / How to test alignment

**Optional / out of scope unless requested**

- Automated unit tests around the new helper
- Portfolio health monthly chart beyond consuming rewritten snapshot values
- Import golden-loop agent docs that mention old not-insured formula

**No change needed**

- Prisma schema for new columns (reuse existing at-risk / compliant / health fields)
- Terms Breach outstanding APIs used solely for the Terms Breach card
- Capacity gap sync pipeline writers (inputs remain invoice gaps)

### Related plans

- `.cursor/plans/as-of-daily-snapshot-rewrite.prd.md` — as-of open set for historical days
- Prior KPI docs that described `gap + netted breach` are superseded by this PRD for at-risk

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/at-risk-per-invoice-max/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/at-risk-per-invoice-max/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Shared formula + customer live KPIs | `issues/01-shared-formula-customer-kpis.md` | — | 1–6, 13, 15–18 |
| 2 | Portfolio + report live enrichment | `issues/02-portfolio-reports-live.md` | 01 | 7–9, 16 |
| 3 | Snapshot writers + full historical rewrite | `issues/03-snapshots-full-rewrite.md` | 01 | 10–12, 19 |
| 4 | EN/HE at-risk tooltips | `issues/04-tooltip-copy.md` | — | 14 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
