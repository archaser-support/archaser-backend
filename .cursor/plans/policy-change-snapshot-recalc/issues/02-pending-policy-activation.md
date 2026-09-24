# 02 — Pending future policy + cancel + cron activation + UI

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-immediate-policy-change-rewrite](01-immediate-policy-change-rewrite.md)
**User stories:** 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 27
**PRD:** `.cursor/plans/policy-change-snapshot-recalc.prd.md`

## What to build

Support **future** `policy_change_date`: create at most one `pending` row without changing the current `active` policy; reject any further Policies-tab mutation (including clear) until cancel-pending. Cancel-pending soft-sets the pending row to `inactive`. In the Customer Policy Trend Daily Snapshot cron, **before** today’s tip and rewrite drain, activate due pending rows (`policy_change_date` ≤ UTC today): previous active → inactive, pending → active, enqueue rewrite from that date. Policies tab shows pending state, blocks saves, and offers cancel-pending (EN+HE).

## Acceptance criteria

- [ ] Future save creates `pending` only; active row unchanged; no rewrite enqueue on save
- [ ] Second Policies save (immediate, future, or clear) while pending exists returns a clear conflict error
- [ ] Cancel-pending sets pending → `inactive` and unlocks saves; row remains in history
- [ ] CPT daily cron activates due pending before tip + drain and enqueues rewrite
- [ ] UI shows pending indicator + cancel action; EN+HE updated together
- [ ] At most one pending per customer enforced in save logic (and DB guard if practical)

## How to test

1. On a customer with an active policy, save a future `policy_change_date` with a new limit — active limit unchanged in UI/API; one pending row exists.
2. Try another Policies save or clear — expect error naming pending; cancel pending — pending becomes inactive; saves work again.
3. Create a pending with `policy_change_date` = UTC today (or backdate a pending row in DB for cron test); run CPT daily snapshot job.
4. Confirm pending became active, prior active inactive, rewrite queued from that date, and today’s tip reflects the new limit.
5. Hebrew locale: pending banner/errors/cancel label present.
