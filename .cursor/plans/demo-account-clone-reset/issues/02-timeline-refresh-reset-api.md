# 02 — Shared timeline refresh + reset API/job

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** [01-demo-flag-settings-shell](01-demo-flag-settings-shell.md)
**User stories:** 14, 15, 16, 17, 18, 19, 22, 23, 24, 29, 30, 34
**PRD:** `.cursor/plans/demo-account-clone-reset.prd.md`

## What to build

Implement the shared **demo timeline refresh** path: compute one day-offset from the stored anchor to today, shift relevant business dates on the demo account (preserve relative spacing), then rebuild derived data (customer amount recalculation + credit as-of/snapshot rebuild using existing jobs where possible). Integrate account freeze / busy signaling so worker crons do not race the job.

Expose authenticated APIs to **start** reset and **read status**, allowed only when the account is `is_demo` and the caller is an account admin for that account. Reset runs as a **background job** with queryable progress (queued / running / succeeded / failed). On success, update the timeline anchor. Do not re-clone from any source account.

## Acceptance criteria

- [ ] Shared refresh used for reset does date-shift + derived rebuild (not re-clone)
- [ ] Start reset rejected for non-demo accounts and for non-admin callers
- [ ] Demo account admin can start a job and poll status until success/failure
- [ ] Concurrent/cron races are mitigated via existing freeze or equivalent busy guard
- [ ] Successful refresh updates the demo timeline anchor
- [ ] No requirement to add automated tests unless the user explicitly asks

## How to test

1. On a small `is_demo` account with known invoice/activity dates, call start-reset as an account admin.
2. Poll status until completed; confirm business dates moved by the expected day delta and customer overdue/due figures look coherent.
3. If credit insurance is enabled on the account, confirm credit dashboards/snapshots look current (not stuck on pre-shift calendar).
4. Repeat as a non-admin and on a non-demo account → expect authorization/business-rule errors.
5. Start reset twice in a row while one is running → expect a clear conflict/busy response (no double-run corruption).
