# 03 — Utilization idle named customers KPI

**Status:** done
**Priority:** normal
**Blocked by:** [01-policy-fee-field](01-policy-fee-field.md), [02-costs-assessment-card](02-costs-assessment-card.md)
**User stories:** 13, 14, 15, 16, 17, 19, 20
**PRD:** `.cursor/plans/annual-credit-assessment-fee.prd.md`

## What to build

On Portfolio Health **Utilization**, add a KPI card for **named** customers whose **open AR was $0 on every day they were named** in the selected range:

- Count of those idle named customers
- Ratio vs all named customers in the same “named anytime in range” set
- Annual Credit Assessment cost for those idle named customers: same fee × ceil-years rules as Costs (reuse year-multiplier helper)

No click-through report in this slice. DCL / non-named customers are excluded.

## Acceptance criteria

- [x] Card shows idle named count, ratio vs named-in-range denominator, and assessment cost
- [x] Idle = open AR $0 on every named day in range (snapshot/open-AR based, not invoice document dates)
- [x] Assessment cost uses current live fee × idle count × shared year multiplier (multi-policy Σ)
- [x] Null fee → $0 cost but count/ratio still show
- [x] No new click-through report
- [x] Matching English and Hebrew locale keys are added/updated together

## How to test

1. Pick a range with some named customers always at $0 open AR and some with open AR on at least one named day — count and ratio match expectations.
2. Confirm assessment cost = fee × idle count × year multiplier (and ×2 when range ceil-years is 2).
3. Blank fee on policy — cost shows $0; count/ratio still populate.
4. Hebrew locale: card labels present.
