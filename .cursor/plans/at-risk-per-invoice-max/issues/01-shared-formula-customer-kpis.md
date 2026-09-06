# 01 — Shared formula + customer live KPIs

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 13, 15, 16, 17, 18
**PRD:** `.cursor/plans/at-risk-per-invoice-max.prd.md`

## What to build

Introduce (or replace) the shared credit-insurance at-risk seam so customer live KPIs use:

- per open Due/Overdue invoice: `atRisk_i = max(capacity_gap_i, terms_breach_i)`
- `terms_breach_i` = full outstanding if any terms-breach flag, else 0
- customer at-risk = `Σ atRisk_i`
- uncovered / excluded → full open AR
- Terms Breach card inputs unchanged
- secondary-currency at-risk (when present) follows the same per-invoice max rule
- compliant / health derive from the new at-risk

## Acceptance criteria

- [ ] Customer dashboard At Risk equals the manual sum of per-invoice max(gap, breach) for insured customers
- [ ] Uncovered / excluded customers still show at-risk = total open AR
- [ ] Terms Breach outstanding card behavior unchanged
- [ ] Health index / compliant exposure use the new at-risk
- [ ] Dual-currency secondary at-risk (when shown) uses the same rule

## How to test

1. Open a customer with mixed invoices (gap-only, breach-only, both) — e.g. 21262 if still valid.
2. For each open Due/Overdue invoice, compute `max(capacity gap, outstanding if breached else 0)` and sum.
3. Compare to the Dashboard **At Risk Exposure** card (account currency).
4. Open an uncovered/excluded customer and confirm at-risk equals Total AR.
5. Confirm the Terms Breach card still shows the full breach sum (not the max formula).
