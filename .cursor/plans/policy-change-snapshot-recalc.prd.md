---
name: policy-change-snapshot-recalc
overview: Add CustomerPolicy.policy_change_date and status (including pending future changes), enqueue as-of snapshot rewrite from that date, and harden top-up create overlap plus rewrite enqueue on API and checkpoint paths.
source: grill-me session /start-work CU-869f6t266
clickup_task_url: https://app.clickup.com/t/869f6t266
isProject: false
---

# Policy change date and daily snapshot recalculation

## Problem Statement

When a customer’s credit policy limit (or related Policies-tab fields) changes, daily customer policy trend snapshots are not recalculated from the day the change should apply. Users also cannot say “this limit change starts on date X” — including scheduling a change for a future day — so history either stays stale or would be rewritten incorrectly if a blunt full rewrite ran. Top-ups already support date windows and usually enqueue rewrite on create/cancel, but overlapping windows are not validated against the product’s concurrent flag, and some import/checkpoint writers may skip rewrite enqueue.

## Solution

Add a required **`policy_change_date`** on each customer policy version and a **`status`** of `active` | `pending` | `inactive`. Immediate changes (date ≤ UTC today) activate now and enqueue an as-of rewrite for that customer from `policy_change_date` through today, leaving earlier snapshot days untouched. Future dates save as the single allowed **pending** row (current active unchanged) until the Customer Policy Trend daily cron activates them on/after that UTC day, then enqueues rewrite. While pending exists, all Policies-tab saves (including clear) are rejected until the user cancels pending (soft `inactive`). Top-ups keep date-bounded behavior (no pending status); create rejects date overlap for the same top-up insurance policy when `allow_concurrent_top_ups` is false; API and checkpoint/import top-up writers enqueue rewrite from the affected `start_date`.

## User Stories

1. As a credit analyst, I want to set a policy change date when I update a customer limit, so that snapshot history only recalculates from that day forward.
2. As a credit analyst, I want the Policies tab to default the change date to today, so that common immediate updates are fast.
3. As a credit analyst, I want to choose a past change date, so that backdated limit corrections rewrite the right historical range.
4. As a credit analyst, I want past change dates rejected when they are before the primary insurance policy start, so that I cannot schedule coverage before the policy exists.
5. As a credit analyst, I want to schedule a future policy change date, so that today’s live limit stays unchanged until that day.
6. As a credit analyst, I want only one pending future change at a time, so that scheduling stays understandable.
7. As a credit analyst, I want the system to reject another Policies-tab save while a pending change exists, so that active and pending do not drift.
8. As a credit analyst, I want to cancel a pending change, so that I can discard a scheduled update without touching the active policy.
9. As a credit analyst, I want cancelled pending changes kept in history as inactive, so that I can see what was scheduled and dropped.
10. As a credit analyst, I want pending changes to activate automatically on the change date, so that I do not have to open the customer that day.
11. As a credit analyst, I want activation to happen before the nightly customer policy trend tip, so that today’s snapshot reflects the new active policy.
12. As a credit analyst, I want clearing/unassigning a policy blocked while pending exists, so that one cancel rule covers all Policies mutations.
13. As a credit analyst, I want English and Hebrew labels for the new date, pending state, and errors, so that both locales stay usable.
14. As a credit analyst, I want to see that a pending change exists on the Policies tab, so that I know why saves are blocked.
15. As a credit analyst, I want a clear cancel-pending control, so that I can unlock the tab without support help.
16. As an operations user, I want existing customer policy rows migrated with status and a change date, so that new rules apply without manual data fix.
17. As a credit analyst, I want adding a historical customer top-up to recalculate snapshots from that top-up’s start date, so that effective limit history stays correct.
18. As a credit analyst, I want cancelling a top-up to rewrite from its original start date, so that removed coverage disappears from history.
19. As a credit analyst, I want create top-up to reject overlapping date ranges on the same top-up insurance policy when concurrent top-ups are not allowed, so that I cannot stack illegal windows.
20. As a credit analyst, I want overlapping top-ups allowed when the product allows concurrent top-ups, so that intentional stacking still works.
21. As a credit analyst, I want different top-up products to overlap freely, so that only same-product concurrency rules apply.
22. As an operations user, I want checkpoint/import top-up writes to enqueue rewrite like the API, so that bulk historical loads backfill snapshots.
23. As a developer, I want rewrite to reuse the existing as-of rewrite queue, so that drain and dashboard snapshot pairing stay consistent.
24. As a portfolio viewer, I want days before the change date left as previously stored, so that I do not silently overwrite older history with the new active limit.
25. As a credit analyst, I want immediate saves when the change date is today or earlier to version the active policy (copy-on-write), so that history of prior active rows remains.
26. As a system, I want `is_active` kept in sync with status for existing readers, so that legacy queries that filter `is_active` still see only the live row.
27. As a credit analyst, I want validation errors that name the pending conflict, so that I know to cancel pending first.
28. As an admin running Generate/backfill, I understand this task does not add date-aware policy version replay, so that I do not expect deep backfill to reconstruct old limits from inactive versions.

## Implementation Decisions

- **Primary mechanism:** reuse `enqueueAsOfRewrite` (customer-scoped) with `fromDate = policy_change_date` (or top-up `start_date`) and `toDate = now`; queue already no-ops when `fromDate > toDate` (future top-ups need no rewrite until the day exists).
- **Schema (`CustomerPolicy`):** add required `policy_change_date` (`@db.Date`); add `status` enum/string `active` | `pending` | `inactive`; keep `is_active` boolean synchronized (`active` ⇒ true; `pending`/`inactive` ⇒ false). Prefer a partial unique constraint / guarded query so a customer has at most one `pending` and at most one `active`.
- **Migration:** map `is_active=true` → `active`, else `inactive`; set `policy_change_date` to the UTC calendar day of `created_at` for existing rows.
- **Policies-tab save rules:** `policy_change_date` always required on create/version/switch; must be ≥ assigned primary insurance policy `start_date`; compare to UTC today for immediate vs pending; if any pending exists, reject all Policies-tab mutations including clear until cancel-pending.
- **Immediate (`policy_change_date` ≤ UTC today):** existing copy-on-write versioning of the active row; new row `status=active`; enqueue customer rewrite from `policy_change_date`.
- **Future (`policy_change_date` > UTC today):** create/replace path is not used for a second pending — reject; create `status=pending` without changing current `active`; do not enqueue rewrite until activation.
- **Cancel-pending:** set pending row to `inactive` (`is_active=false`); no rewrite.
- **Activation:** in Customer Policy Trend Daily Snapshot cron, **before** today’s tip and rewrite drain: find `pending` with `policy_change_date ≤ UTC today`; for each, deactivate current active → `inactive`, set pending → `active`, enqueue rewrite from that `policy_change_date`.
- **Frontend:** Policies tab required date control defaulting to UTC today; pending indicator; cancel-pending action; surface API errors; EN+HE strings in the same change.
- **Top-ups:** no pending status; on create, if same `insurance_policy_id` has non-cancelled rows whose `[start_date,end_date]` intersects and that product has `allow_concurrent_top_ups=false`, reject; enforce on new creates only (no historical cleanup). Audit create/cancel API and customer checkpoint/import writers so every `CustomerTopUp` write enqueues rewrite from the earliest affected `start_date`.
- **i18n:** all new user-facing copy ships English and Hebrew together.
- **Out of product scope for math:** snapshot writers continue to load the current active customer policy for rewritten days (not full as-of version picker across inactive rows).

## Testing Decisions

Prefer the highest external seams; do not add automated tests unless explicitly requested later.

**Primary seams**

1. **Policies-tab customer update API** — save with past/today/future `policy_change_date`; assert status, `is_active`, rewrite queue row `from_date`, and rejection while pending / cancel-pending unlock.
2. **Customer Policy Trend daily cron path** — pending with `policy_change_date ≤ UTC today` becomes active before tip; rewrite enqueued; tip sees new active limits.
3. **Top-up create API** — overlap rejected when concurrent disallowed; allowed when concurrent true; rewrite enqueued from `start_date` when `start_date ≤ today`.
4. **Checkpoint/import top-up write** — after insert of historical top-ups, rewrite queue covers earliest `start_date`.

**What good verification looks like**

- External behavior only: DB status/date, queue range, snapshot values on/after vs before change date, UI blocked/enabled states.
- Manual How to test on each vertical slice is sufficient for delivery.

**Prior art**

- Existing top-up create/cancel enqueue in customers service.
- Insurance policy create/update enqueue and `drainAsOfRewriteQueue` pairing in the CPT cron handler.

## Out of Scope

- Date-aware replay of inactive `CustomerPolicy` versions on every historical day during deep Generate/backfill.
- Pending status model for customer top-ups (date windows already bound effectiveness).
- Cleaning or migrating historically overlapping top-ups.
- Changing account-level `InsurancePolicy` rewrite behavior beyond what already exists.
- Auto-`done` ClickUp or planning-only PR.

## Further Notes

- ClickUp task: https://app.clickup.com/t/869f6t266
- Feature branch (backend primary): `feat/policy-change-snapshot-recalc-CU-869f6t266`
- Frontend uses the same branch name when first touched, created from latest `staging`.
- Domain doc wants limits/top-ups as-of day D; this delivery approximates customer-policy history by rewrite floor + untouched earlier days, not full version-as-of-day selection.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/policy-change-snapshot-recalc/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/policy-change-snapshot-recalc/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Immediate policy_change_date + rewrite enqueue + date UI | `issues/01-immediate-policy-change-rewrite.md` | — | 1–4, 13, 15–16, 23–26 |
| 2 | Pending future policy + cancel + cron activation + UI | `issues/02-pending-policy-activation.md` | 01 | 5–12, 14–15, 27 |
| 3 | Top-up overlap guard + rewrite enqueue audit | `issues/03-top-up-overlap-and-enqueue.md` | — | 17–22 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
