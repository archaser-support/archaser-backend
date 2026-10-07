# 02 — Pending future Remove + cron activation

**Status:** done
**Priority:** normal
**Blocked by:** [01-immediate-remove-runoff](01-immediate-remove-runoff.md)
**User stories:** 5, 15, 16, 17, 18, 28
**PRD:** `.cursor/plans/customer-policy-dated-unassign.prd.md`

## What to build

Allow a **future** unassign date on the Remove policy modal: create the single pending row with no insurance policy and `policy_change_start_date` = that day; leave the current TF1 **active**; do not set end date, clip top-ups, strip invoices, or rewrite on save. Show it on the existing pending banner; cancel-pending drops the schedule with no rewrite. While pending exists, other Policies mutations stay blocked (including a second Remove). In the Customer Policy Trend daily job, **before** today’s tip and rewrite drain: if a due pending row is an unassign, run the **same apply** as immediate Remove (end date, deactivate TF1, clip, strip, remirror, rewrite). Do **not** promote the pending row to an active null-policy assignment — mark it inactive. English and Hebrew for any new pending-unassign copy in the same change.

## Acceptance criteria

- [x] Future Remove creates one pending null-policy row; TF1 stays active; no clip/strip/rewrite until activation
- [x] Pending banner + cancel-pending; cancel does not rewrite or clip top-ups
- [x] Second Remove or Policies save while pending still returns the existing pending conflict
- [x] CPT daily job applies due pending unassign with the same run-off rules as slice 01; pending is not left `active`
- [x] Matching EN+HE for any new strings

## How to test

1. On a customer with active TF1, Remove policy with a future UTC date. Live policy still TF1; one pending row; top-ups and invoice `policy_id`s unchanged; no rewrite from this save.
2. Try Edit/Save or Remove again — pending conflict. Cancel pending — pending inactive; TF1 still active; saves work.
3. Create a pending unassign dated UTC today (or backdate the pending row). Run the CPT daily snapshot job.
4. Expect: TF1 inactive with end date; no active assignment; clip/strip/rewrite as in slice 01; pending not active; today’s tip has no live policy and TF1 run-off if leftover invoices exist.
5. Hebrew: pending banner still readable for a scheduled remove.
