# 05 — Live capacity-gap waterfall + card + event rewrite

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 17, 21, 22, 23
**PRD:** `.cursor/plans/at-risk-per-invoice-max.prd.md`

## What to build

Replace sticky-at-open capacity gap stamps with a **live waterfall** over current open Due/Overdue invoices:

1. Order by oldest `invoice_date`, then invoice id ascending.
2. Fill **effective limit** (approved + top-up when applicable).
3. Persist per invoice: `limit_assessed_amount`, `capacity_gap_amount` / `capacity_gap_amount_limit`, `in_capacity_gap` (`gap > 0`).
4. **Capacity Gap card** / `CustomerPolicy.capacity_gap_amount` = `max(0, open AR − effective limit)` (not sticky `min(Σ gaps, …)`).
5. Run this rewrite on AR-changing events for the customer (payment link/recalc, invoice open/close/status, limit/top-up change) and existing post-ingest refresh.
6. At Risk continues to use `Σ max(gap_i, breach_i)` on the refreshed invoice gaps (seam from slice 01).

## Acceptance criteria

- [x] After refresh, Σ live invoice gaps equals Capacity Gap card (`AR − effective limit`) for a normal insured customer (single-currency case)
- [x] Ex1: at-risk **800**; Ex2: at-risk **500** (same customer gap + breach totals, different overlap) — verified via pure waterfall math
- [x] Paying an earlier open invoice so AR falls under the limit clears gap on remaining invoices and sets card gap to 0
- [x] `limit_assessed` is rewritten with the waterfall (not left sticky from open day)
- [x] Triggers cover payment/post-ingest paths used in production for this account flow (+ policy save / top-up create-cancel)

## How to test

1. Build a customer like Ex1 / Ex2 (or use spreadsheet scenario: limit 4000, AR 4227, gap-only last invoice, earlier term breaches).
2. Confirm Capacity Gap card = AR − effective limit; last invoice holds the gap; at-risk = breach sum + gap when gap invoice is not breached.
3. Mark an earlier open invoice Paid (or apply payment) so AR ≤ limit; re-run post-ingest/recalc for that customer.
4. Confirm invoice gaps are 0, card gap is 0, at-risk equals remaining terms breach only.
5. Confirm an invoice with both gap and breach contributes `max(gap, breach)` only once to at-risk.
