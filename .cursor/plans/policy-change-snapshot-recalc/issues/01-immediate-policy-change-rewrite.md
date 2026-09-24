# 01 — Immediate policy_change_date + rewrite enqueue + date UI

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 13, 15, 16, 23, 24, 25, 26
**PRD:** `.cursor/plans/policy-change-snapshot-recalc.prd.md`

## What to build

Add `policy_change_date` and `status` (`active` | `pending` | `inactive`) on customer policy, migrate existing rows, and wire **immediate** Policies-tab saves (`policy_change_date` ≤ UTC today): require the date (≥ insurance policy start), copy-on-write version the active row, keep `is_active` in sync, and enqueue customer-scoped as-of rewrite from that date through today. Expose the required date field on the Policies tab (default UTC today) with English and Hebrew copy. Do not implement pending/future activation in this slice beyond storing the schema values needed later (future dates may be rejected or deferred to slice 02 — prefer reject future until 02 if simpler).

## Acceptance criteria

- [ ] Schema + migration: status from `is_active`; `policy_change_date` = `created_at` UTC day for existing rows
- [ ] Immediate save requires `policy_change_date` ≥ primary insurance policy `start_date` and ≤ UTC today
- [ ] Successful immediate save leaves one `active` row, prior row `inactive`, `is_active` consistent
- [ ] `enqueueAsOfRewrite` called for that customer with `fromDate = policy_change_date`
- [ ] Policies tab shows required date control defaulting to UTC today; EN+HE strings updated together
- [ ] Days before `policy_change_date` are not required to change in this slice’s manual check; on/after days update after drain

## How to test

1. Migrate/apply schema on a dev DB; open an existing customer Policies tab — date defaults to today.
2. Change approved limit with `policy_change_date` = a past UTC day (≥ policy start); save.
3. Confirm new active `CustomerPolicy` has that date/status; old row inactive; rewrite queue pending from that date.
4. After CPT cron drain (or drain helper), spot-check `CustomerPolicyTrend` on that day and a later day for the new limit; a day before the change date should still show the previous stored values.
5. Attempt a change date before insurance policy start — expect validation error.
6. Switch UI to Hebrew and confirm the new date label/error strings.
