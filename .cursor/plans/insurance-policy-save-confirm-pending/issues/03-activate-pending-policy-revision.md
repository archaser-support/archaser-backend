# 03 — Activate due pending Insurance Policy revisions

**Status:** done
**Priority:** high
**Blocked by:** [02-future-pending-banner-lock-cancel](02-future-pending-banner-lock-cancel.md)
**User stories:** 20, 23, 24, 25, 32
**PRD:** `.cursor/plans/insurance-policy-save-confirm-pending.prd.md`

## What to build

A job that finds Insurance Policies whose pending effective date is on or before UTC today, applies the stored full snapshot to the live policy, clears pending columns, then pushes **only fields that changed** versus the pre-activation live policy onto active Customer Policies. Skip customers who have a pending Customer Policy. Wire into the same daily credit cron family as customer pending activation (before CPT tip when possible). Failures must not leave a silent “success” with pending cleared incorrectly.

## Acceptance criteria

- [x] Due pending policies apply snapshot → live row; pending columns cleared only after successful apply
- [x] Customer push uses changed-fields-only overlay; skips pending Customer Policy customers
- [x] Job is scheduled in the credit daily cron path (order documented relative to customer pending activate / CPT tip)
- [x] Partial failure for one policy does not abort unrelated accounts without a clear failure count/log

## How to test

1. Schedule a future push-field change for “today” by temporarily setting `pending_effective_date` to UTC today (or wait until the date), or run the activate function in a controlled env with a known pending payload.
2. Run the activation job.
3. Expect live policy matches the snapshot; pending cleared; customers without their own pending CP get versions only for changed fields; customers with pending CP unchanged.
4. Confirm CPT tip / dashboard path still runs after activation in the daily order (smoke).
