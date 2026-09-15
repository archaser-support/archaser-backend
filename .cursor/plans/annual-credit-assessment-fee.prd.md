---
name: annual-credit-assessment-fee
overview: Store an Annual Credit Assessment Fee on the insurance policy and surface it on Portfolio Health Costs and Utilization.
source: grill-me session via /start-work
clickup_task_url: https://app.clickup.com/t/869f2ayqb
isProject: false
---

# Annual Credit Assessment Fee on policy + Portfolio Health

## Problem Statement

Insurers charge an **Annual Credit Assessment Fee** for every **named** customer on a policy. That fee is not stored on the policy today, so analysts cannot see the assessment cost burden on Credit Portfolio Health. Separately, named customers who carry **zero open accounts receivable (AR)** for every day they were named in the selected range still incur that annual fee — a cost of idle named cover that Utilization does not currently call out.

## Solution

1. Add an optional **Annual Credit Assessment Fee** money field on the insurance policy (account currency). Users set it on policy create/edit; Policy Summary shows it.
2. On Portfolio Health **Costs**, add a **standalone** card: total assessment cost = Σ over policies of (current fee × named customers who were named anytime in the range × year multiplier). Do **not** fold this into existing Policy cost / monthly charts / effective cost.
3. On Portfolio Health **Utilization**, add a KPI card: count of named customers with **open AR = 0 on every day they were named in the range**, ratio vs all named in that same set, and assessment cost for those idle named customers using the same fee × year-multiplier rules.
4. **Year multiplier** = `max(1, ceil(inclusiveDaysInRange / 365))` so any partial year still bills a full annual fee; multi-year ranges scale up by whole years.
5. Null fee → treat as **0** for money; Utilization still shows count and ratio. Always use the **current live** policy fee (no fee history in MVP).

## User Stories

1. As a credit analyst, I want to store the Annual Credit Assessment Fee on a policy, so that named-customer assessment cost is configured in one place.
2. As a credit analyst, I want the fee in account currency, so that Portfolio Health money cards match other Costs totals.
3. As a credit analyst, I want to leave the fee blank, so that policies without this charge show $0 assessment cost without blocking other KPIs.
4. As a credit operations user, I want to edit the fee on create/edit policy, so that I do not need database access.
5. As a credit analyst, I want Policy Summary to show the fee, so that I can review it with other policy cost settings.
6. As a credit analyst, I want English and Hebrew labels for the field and cards, so that both locales stay complete.
7. As a credit analyst, I want a Costs tab card for total Annual Credit Assessment cost, so that I see the fee burden for named cover in the selected range.
8. As a credit analyst, I want that Costs total to multiply fee by every customer who was named at any time in the range, so that mid-range leavers still count for the period.
9. As a credit analyst, I want ranges longer than one year to multiply by ceil whole years, so that multi-year windows do not understate annual fees.
10. As a credit analyst, I want any positive range shorter than one year to still use year multiplier 1, so that a partial year still costs the full annual fee.
11. As a credit analyst, I want the assessment Costs card to stay separate from Policy cost, so that insurance premium math and effective cost stay unchanged.
12. As a credit analyst, I want multi-policy portfolio views to sum per-policy (fee × named × years), so that mixed fees stay correct.
13. As a credit analyst, I want a Utilization KPI for named customers with zero open AR every named day in range, so that idle named cover is visible.
14. As a credit analyst, I want that KPI to show count and ratio out of all named in the range set, so that I can judge how large the idle share is.
15. As a credit analyst, I want the same Utilization card to show Annual Credit Assessment cost for those idle named customers, so that idle cover has a clear dollar impact.
16. As a credit analyst, I want Utilization assessment cost to use the same year multiplier as Costs, so that rules stay consistent.
17. As a credit analyst, I want “idle” to mean open AR was $0 on every day the customer was named in the range (from portfolio snapshots), so that balance-based inactivity matches Portfolio Health data.
18. As a credit analyst, I want fee edits to apply to any selected historical range immediately, so that MVP stays simple without fee history tables.
19. As a credit analyst, I want DCL (Discretionary Credit Limit) / self-underwritten customers excluded from these named-only metrics, so that only insurer-named cover is assessed.
20. As a product owner, I want no click-through customer report in MVP, so that we ship the cards first.
21. As a product owner, I want policy import/export of this field deferred, so that form + dashboard ship first.

## Implementation Decisions

- **Schema:** Add nullable money field on `InsurancePolicy` for Annual Credit Assessment Fee (account currency; same decimal style as other policy money amounts). No per-day fee history table in MVP.
- **API / policy CRUD:** Expose the field on policy read/create/update alongside existing cost fields (`cost_percent`, `registration_fee_percent`). Validate non-negative when set.
- **UI — policy form:** Add input on insurance policy create/edit next to other cost fields. EN + HE strings in the same change.
- **UI — Policy Summary:** Show the fee on Portfolio Health Policy Summary with other cost settings.
- **Year multiplier helper:** Shared pure function: inclusive day count of selected range → `max(1, ceil(days / 365))`.
- **Named set (Costs + Utilization denominator):** Customers who were named under the policy at any time during the selected range (from named / customer–policy trend history already used by Portfolio Health).
- **Costs card:** Standalone Portfolio Costs section field(s) for assessment total (and supporting counts if useful for tooltip). Do **not** change `periodCost`, monthly `totalCost`, daily cost series, or effective cost.
- **Utilization card:** New section fields: idle named count, named denominator count, ratio, assessment cost for idle named. Idle = open AR = 0 on every day the customer was named within the range.
- **Multi-policy:** When no policy filter, Σ per policy using each policy’s current fee and its own named/idle sets.
- **Null fee:** Money contributions are 0; Utilization count/ratio still compute.
- **i18n:** All new user-facing strings ship EN + HE together.
- **Primary repos:** Backend domain + API first; frontend policy form, Policy Summary, Costs, Utilization when those layers are touched (same branch name).
- **Testing seam (preferred):** Portfolio Health response for Costs / Utilization assessment fields, plus policy CRUD round-trip for the fee. Prefer extending existing portfolio health / policy entity seams over new ones.

## Testing Decisions

- Prefer testing **external behavior**: policy save/load of the fee; Costs card total for known named set + fee + range length; Utilization count/ratio/cost for known zero-AR named vs named with AR spikes.
- Good tests assert outcomes (counts, money, year multiplier), not internal SQL shape.
- Prior art: Portfolio Health range cost / registration fee work; policy form cost field validation; Policy Summary display of cost percents.
- Do **not** add automated tests unless the user explicitly asks in an implementation session.

## Out of Scope

- Policy import/export columns for the fee
- Fee change history / as-of fee snapshots
- Click-through credit-dashboard customer report for idle named
- Folding assessment fee into Policy cost, monthly bars, or effective cost
- Applying the fee to DCL / non-named customers
- Pro-rating the fee by fraction of a year (partial year still full annual)

## Further Notes

### Decision log (grill)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Costs card | Total = fee × named-customer count |
| D2 | Named set | Anyone named anytime in the selected range |
| D3 | Year multiplier | Ceil whole years; min ×1 |
| D4 | Activity basis | Open AR / exposure (not invoice document dates) |
| D5 | Zero-AR rule | Open AR = $0 every named day in range |
| D6 | Currency | Account currency |
| D7 | Null fee | Treat as $0; still show counts/ratio |
| D8 | Multi-policy | Σ per policy |
| D9 | MVP surfaces | Form + Policy Summary + Costs/Utilization cards |
| D10 | Policy cost rollup | Standalone card only |
| D11 | Report | No click-through in MVP |
| D12 | Fee edits | Always current live policy fee |

### ClickUp

- Task: https://app.clickup.com/t/869f2ayqb
- Branch (primary): `feat/annual-credit-assessment-fee-CU-869f2ayqb` (backend)

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/annual-credit-assessment-fee/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/annual-credit-assessment-fee/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Policy Annual Credit Assessment Fee field | `issues/01-policy-fee-field.md` | — | 1–6 |
| 2 | Costs tab Annual Credit Assessment card | `issues/02-costs-assessment-card.md` | 01 | 7–12, 18 |
| 3 | Utilization idle named customers KPI | `issues/03-utilization-idle-named-kpi.md` | 01, 02 | 13–17, 19–20 |

**Status:** `ready-for-agent` on all slices.
