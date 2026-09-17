# 01 — Reporting breach start date + flag cleanup

**Status:** ready-for-agent  
**Priority:** high  
**Blocked by:** —  
**User stories:** 1–16, 28–31  
**PRD:** `.cursor/plans/reporting-breach-start-generate-modal.prd.md`

## Scope

- Add `BillingConnector.reporting_breach_start_date`; migrate copy from `backfill_start_date` when present.
- Point `resolveReportingBreachStartDate` at the new column (stop using `backfill_start_date`).
- Billing UI: required date after MEP; always editable; no prefill; EN+HE; remove “Skip reporting breach during backfill”.
- Remove connector `skip_reporting_breach_on_backfill` and Generate/job `skip_reporting_breach` from schema, API, sync, and as-of backfill runner.
- On date change: save immediately; background full recompute (set **and** clear); success message with link to Portfolio Health Generate.
- Null date: Generate fails closed; overnight sweep skips account with log/metric.
- Clear resolver cache when the date changes / recompute starts.

## How to test

1. Open Admin → Account → Billing integration. Confirm **Reporting breach start date** is after **MEP breach start date**, required on save, always editable, and the skip-on-backfill switch is gone (EN + HE).
2. Account with backfill start date: after migrate, reporting breach start date is seeded. Account without: save blocked until a date is entered; Generate fails closed with a clear error.
3. Change the date and save: form returns quickly; background recompute updates invoice `reporting_breach` (including clears for out-of-scope); success offers a link to Portfolio Health Generate (does not auto-start).
4. Connector backfill / overnight path: in-scope unreported Due/Overdue invoices can get reporting breach; pre-date invoices do not. No skip-on-backfill boolean remains in API/UI.
