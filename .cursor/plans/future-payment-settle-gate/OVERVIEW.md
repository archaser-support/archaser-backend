# Future payment settle gate

**PRD:** `.cursor/plans/future-payment-settle-gate.prd.md`  
**ClickUp:** [Hold invoice Paid until payment date; skip collection open when future payment covers](https://app.clickup.com/t/869fafv1w)  
**Branch:** `feat/future-payment-settle-gate-CU-869fafv1w`

## Outcome

Future-dated linked payments do not settle invoices until `payment_date`; recon virtual close waits the same way; overdue collection opening skips invoices fully covered by such payments.

## Vertical slices

| # | Slice | Status |
|---|--------|--------|
| 01 | Shared as-of settle rule + maturity applies future payments | done |
| 02 | Delay 10149 recon virtual close until cash payment date | done |
| 03 | Process Overdue skips collection open when future payment covers | done |

Slices live under `issues/`.
