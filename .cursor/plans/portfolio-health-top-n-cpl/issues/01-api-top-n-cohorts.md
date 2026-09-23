# 01 — API: top-N Credit Protection cohorts on portfolio-health

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 10, 11, 12, 13, 14, 18, 19, 20
**PRD:** `.cursor/plans/portfolio-health-top-n-cpl.prd.md`

## What to build

Extend the Portfolio Health API so the Health section returns precomputed **top-N Credit Protection** cohort metrics for **N = 5, 10, and 20** in a single response.

Rank customers by mean daily total receivables over the selected range (same filters as existing portfolio-health CPT queries). Rank once for top 20, then roll up cohorts for 5, 10, and 20.

For each cohort: aggregate mean receivables / compliant / at-risk; Credit Protection Level = compliant ÷ receivable (same helper rules as existing health index); share % vs portfolio means for the same metrics. If fewer than N customers exist, use all available and report actual count.

Default N in the payload is 10; options are 5 / 10 / 20. No chart series in this slice.

## Acceptance criteria

- [x] `GET` portfolio-health Health section includes cohort metrics for 5, 10, and 20
- [x] Ranking uses mean daily total receivables and respects page filters (date, policy, BU scope, include-no-policy rules)
- [x] CPL and share % match the PRD aggregation rules; fewer-than-N uses available customers
- [x] Payload supports local UI switching without a second request for N

## How to test

1. Call portfolio-health for an account/range with many customers; inspect Health section JSON for three cohorts (5/10/20) with CPL and share fields.
2. Confirm cohort 10 receivables ≥ cohort 5 and cohort 20 ≥ cohort 10 when enough customers exist.
3. Use a filter that leaves fewer than 5 customers; confirm cohorts still return metrics with `nActual` ≤ requested and no empty failure.
4. Spot-check CPL for a known tiny fixture: cohort compliant/receivable matches the health-index formula.
