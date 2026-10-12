# 03 — Overdue collection open skips future-covered invoices

**Status:** done  
**Priority:** normal  
**Blocked by:** [01-as-of-settle-and-maturity](01-as-of-settle-and-maturity.md)  
**User stories:** 5, 6, 7, 8, 12, 13  
**PRD:** `.cursor/plans/future-payment-settle-gate.prd.md`

## Goal

Update `Process Overdue Invoices` so invoices with linked future-dated payment(s) that would fully cover the invoice when matured are excluded from **opening** a collection period. Due→Overdue may still run. Other overdue invoices on the same customer without such cover can still open the period. Escalation jobs unchanged.

## Scope

- Open-period eligibility in the overdue cron/handler.
- Full-cover check (paid tolerance) against linked `payment_date > now` payments.
- Per-invoice exclusion only.

## Out of this slice

- `Process Automated Collection Periods` / `Move Collection To Next Category` changes.
- Settle/maturity mechanics (slices 01–02).

## How to test

1. Customer with one past-due invoice and a linked covering payment dated tomorrow: run Process Overdue — invoice may become Overdue, but no new collection period opens from that invoice alone.
2. Same customer also has a second past-due invoice with no future payment: run Process Overdue — collection period can open based on the second invoice.
3. Confirm Automated / Move Next Category behavior unchanged for an already-open period.
