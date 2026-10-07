# 01 — Immediate Remove policy (run-off + rewrite)

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 19, 20, 21, 22, 23, 24, 25, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 46, 47, 48, 49, 50
**PRD:** `.cursor/plans/customer-policy-dated-unassign.prd.md`

## What to build

Add **Remove policy** on the customer Policies tab (view mode). It opens a modal with a required UTC unassign date (default today) and confirm copy that names the date, leftover invoices staying on the old policy, and invoices from that day onward losing it. Past or today applies immediately: store `policy_change_end_date` on the current TF1 customer-policy version (first day with no new TF1 invoices; not before this version’s start), deactivate that row (no live null-policy assignment), clip this customer’s top-ups from that day (overlap: last top-up day is the day before; windows that start on/after the unassign day end entirely — do not cancel overlapping top-ups from their original start), strip `policy_id` from invoices issued on or after that day and refresh terms flags, remirror a credit pool if this is the root, and rewrite Customer Policy Trend (CPT) and as-of from that day through today in-request. Leftover invoices (issue date before the unassign day) keep TF1 and keep using the last **base** limit; CPT still has a TF1 row while that run-off AR is open. A later TF2 assign is allowed; those new invoices go to TF2. Disable clearing the insurance-policy dropdown on Edit. Ordinary Save must not unassign via `policy_id` null. Future dates: reject until slice 02 (same pattern as the first policy-change-date slice). Schema change ships a SQL file under `prisma/migrations/` (no top-level BEGIN/COMMIT). English and Hebrew copy in the same change.

## Acceptance criteria

- [x] Nullable `policy_change_end_date` on CustomerPolicy; existing rows null; SQL under `prisma/migrations/`
- [x] Remove policy modal: date defaults to UTC today; confirm names date, run-off, and strip; EN+HE together
- [x] Unassign date before this version’s `policy_change_start_date` is rejected
- [x] Immediate apply: TF1 inactive with end date; no active assignment; leftover invoices keep `policy_id`; later invoices stripped and restamped
- [x] Overlapping top-ups clipped to the day before unassign; top-ups starting on/after that day fully ended
- [x] In-request CPT/as-of rewrite from the unassign day; days before unchanged; TF1 CPT continues while run-off AR is open (base limit, no top-up from that day)
- [x] Insurance-policy autocomplete is not clearable; customer PUT no longer Clears by emptying policy
- [x] Button hidden/blocked: no active policy, linked pool child, no write permission, pending change exists
- [x] Pool root remirrors descendants (end date, strip, clip, rewrite) like other Policies mutations
- [x] Customer Dashboard keeps no-policy empty state when there is no active assignment; TF1 policy views still include leftover tagged invoices
- [x] Future unassign dates rejected until slice 02

## How to test

1. Open a customer with an active primary policy, leftover open invoices, and a top-up that spans today. Policies tab: **Remove policy** (not Edit → empty dropdown).
2. Modal date defaults to today. Set a past UTC day on or after this version’s start, still before some invoice issue dates and after others. Confirm and save.
3. Expect: TF1 row inactive with that end date; no active policy; invoices issued before that day still TF1; invoices on/after that day have no `policy_id`; overlapping top-up end is the day before; CPT/as-of from that day show run-off usage on TF1 base limit; a day before the unassign date unchanged.
4. Assign TF2 from a later day: new invoice on TF2; leftover TF1 invoice unchanged.
5. Date before this version’s start — validation error. Linked child — no Remove (or forbidden). Hebrew locale: button, modal, confirm, errors.
6. Edit Policies: policy field cannot be cleared; Save does not unassign.
