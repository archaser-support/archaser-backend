# 03 — Top-up overlap guard + rewrite enqueue audit

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** —
**User stories:** 17, 18, 19, 20, 21, 22
**PRD:** `.cursor/plans/policy-change-snapshot-recalc.prd.md`

## What to build

Harden customer top-ups: on create, if the top-up insurance policy has `allow_concurrent_top_ups=false`, reject when the new `[start_date, end_date]` intersects any non-cancelled top-up for the **same** `insurance_policy_id` on that customer. Different top-up products may overlap. When concurrent is allowed, overlapping dates remain OK. Audit API create/cancel (already enqueue) and customer checkpoint/import paths that write `CustomerTopUp` so every write enqueues as-of rewrite from the earliest affected `start_date`. No pending status for top-ups; no cleanup of existing illegal overlaps.

## Acceptance criteria

- [ ] Create rejects same-product date overlap when `allow_concurrent_top_ups` is false (clear error)
- [ ] Create allows overlap when concurrent is true; allows overlap across different top-up policies
- [ ] API create/cancel still enqueue rewrite from `start_date` (no regression)
- [ ] Checkpoint/import (or other in-scope writers) enqueue rewrite after top-up inserts using earliest affected `start_date`
- [ ] Existing overlapping rows are not auto-fixed
- [ ] Any new user-facing error strings include EN+HE

## How to test

1. Pick a top-up product with concurrent disabled; create a top-up Jan–Jun; try another same product Mar–Aug — expect rejection.
2. Same product with concurrent enabled — overlapping create succeeds; rewrite queue from the new `start_date` when that date ≤ today.
3. Different top-up products with overlapping dates — both succeed.
4. Create a historical top-up from year start; after queue drain, confirm daily snapshots from that start date reflect the top-up; a day before start does not.
5. Load top-ups via checkpoint/import path used in-app; confirm rewrite queue covers earliest `start_date`.
