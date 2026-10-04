# 01 — Shared as-of settle rule + maturity

**Status:** done  
**Priority:** high  
**Blocked by:** —  
**User stories:** 1, 2, 3, 9, 10, 11, 14  
**PRD:** `.cursor/plans/future-payment-settle-gate.prd.md`

## Goal

Introduce one “payments effective as of `asOf`” rule in the invoice paid/recalc path: linked payments with `payment_date > asOf` do not change outstanding, `total_paid`, or Paid. Extend billing sync / post-ingest maturity so that when `payment_date <= asOf`, those payments become effective and recalc/Paid run.

## Scope

- Shared filter in payment application / Paid recalc used by import link and maturity.
- Maturity orchestration on existing connector sync + post-ingest (no new daily cron).
- All accounts.

## Out of this slice

- 10149 virtual-close delay specifics (slice 02).
- Collection open skip (slice 03).

## How to test

1. Import or create a linked payment on an open invoice with `payment_date` tomorrow (and any needed account fixtures).
2. Confirm invoice outstanding / `total_paid` / status stay as if that payment were absent.
3. Run billing sync maturity / post-ingest with `asOf` on or after that payment date (or temporarily set payment_date to today and re-run maturity).
4. Confirm outstanding drops and Paid applies when coverage is enough (within paid tolerance).
