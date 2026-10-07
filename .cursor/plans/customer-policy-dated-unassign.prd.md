---
name: customer-policy-dated-unassign
overview: Add a Policies-tab Remove policy modal with a required unassign date (past or future), keep leftover invoices covered on the old policy (run-off), stop top-ups from that day, strip later invoice policy stamps, and rewrite Customer Policy Trend and as-of history from that day.
source: grill-me session
isProject: false
---

# Dated customer policy unassign (run-off)

## Problem Statement

Analysts need to take a customer off a credit insurance policy from a chosen calendar day. That day can already be in the past or still in the future. Today the only UI path is Edit on the Policies tab, empty the insurance-policy dropdown, and Save. That Confirm dialog is the **Change active policy?** switch copy. The save is **immediate**, ignores the policy change start date, does not rewrite Customer Policy Trend (CPT) or as-of history, and treats the customer as having no policy for **all** open invoices — including invoices issued before the stop day, which should stay covered.

## Solution

Add a **Remove policy** button on the customer Policies tab. It opens a modal with a required unassign date (UTC calendar day, default **today**) and a confirm that names the consequences. After that date the customer is unassigned for **new** invoices (same outcome as today’s Clear). Invoices with **issue date before** the unassign day stay on the old primary policy (run-off): they keep using that policy’s **base** approved limit, terms, and usage until paid. Invoices issued **on or after** that day are not covered; if they already have that policy stamped, the stamp is cleared and terms flags are refreshed. All of this customer’s top-ups **stop from the unassign day** (clip end dates; do not cancel from the original start). Past or today: write an end date on the current customer-policy version, apply side effects, and rewrite CPT and as-of values from that day through today in the same request. Future: one pending “no policy” change; live TF1 stays until that UTC day, then the nightly CPT job activates the same rules. Emptying the policy dropdown no longer unassigns. Named-policy delete and import stay as they are today.

## User Stories

1. As a credit analyst, I want a **Remove policy** button on the Policies tab, so that unassign is an explicit action and not emptying a dropdown.
2. As a credit analyst, I want Remove policy to open a modal, so that I set the stop day before anything is saved.
3. As a credit analyst, I want the unassign date in that modal to default to UTC today, so that a same-day remove is one confirm.
4. As a credit analyst, I want to pick a past unassign date, so that a late correction rewrites history from the real stop day.
5. As a credit analyst, I want to pick a future unassign date, so that today’s live coverage stays until that day.
6. As a credit analyst, I want the earliest allowed unassign date to be this customer-policy version’s start date, so that I cannot stamp “no new coverage” over days before this TF1 version existed.
7. As a credit analyst, I want an unassign date before that version start rejected with a clear error, so that I know why Save failed.
8. As a credit analyst, I want the confirm copy to say leftover invoices stay on the old policy, so that I do not think all coverage vanishes.
9. As a credit analyst, I want the confirm copy to say invoices from the unassign day onward lose that policy, so that I understand the strip rule.
10. As a credit analyst, I want the confirm copy to include the chosen date, so that I can catch a wrong day before Save.
11. As a credit analyst, I want emptying the insurance-policy autocomplete during Edit to be disabled, so that I cannot unassign by accident while changing a limit.
12. As a credit analyst, I want Policies-tab Save to keep using **Change active policy?** only when switching to another policy, so that Remove and switch stay distinct.
13. As a credit analyst, I want Remove policy hidden when the customer has no active policy, so that the control matches live state.
14. As a credit analyst, I want Remove policy blocked while a pending policy change exists, so that I cancel pending first (same rule as other Policies mutations).
15. As a credit analyst, I want a future Remove to create the single pending “no policy” change and leave the current policy active, so that live KPIs stay on TF1 until that UTC day.
16. As a credit analyst, I want that pending unassign to show on the existing pending banner, so that I can see a scheduled remove and cancel it.
17. As a credit analyst, I want cancelling a pending unassign to drop the schedule without rewriting history or clipping top-ups, so that a mistaken future date is harmless.
18. As a credit analyst, I want the nightly Customer Policy Trend job to apply a due pending unassign before today’s tip, so that I do not have to open the customer that morning.
19. As a credit analyst, I want invoices issued before the unassign day to keep `policy_id` on the old policy, so that claims and coverage stay attached to those invoices.
20. As a credit analyst, I want those leftover invoices to keep using the last TF1 **base** approved limit until they are paid, so that run-off usage is real insurance, not audit-only.
21. As a credit analyst, I want invoices issued on or after the unassign day not to be covered by TF1, so that new sales after the stop day are uninsured on that policy.
22. As a credit analyst, I want a backdated Remove to clear TF1 from invoices already saved with that policy whose issue date is on or after the unassign day, so that the invoice grid matches history.
23. As a credit analyst, I want terms flags on those stripped invoices refreshed in the same operation, so that live terms-breach columns are not stale.
24. As a credit analyst, I want new invoices created after unassign to get no policy from the customer’s active assignment, so that import and UI create follow the same rule.
25. As a credit analyst, I want all of this customer’s top-ups to stop from the unassign day, so that run-off does not keep extra limit.
26. As a credit analyst, I want a top-up that spanned the unassign day to keep applying **before** that day, so that March 1–14 coverage is not wiped when we stop on March 15.
27. As a credit analyst, I want a top-up that only starts on or after the unassign day fully ended, so that it never applies.
28. As a credit analyst, I want future Remove **not** to clip top-ups or strip invoices until the pending day arrives, so that scheduling does not change today’s book.
29. As a credit analyst, I want Customer Policy Trend rewritten from the unassign day through today when the date is past or today, so that charts match run-off rules.
30. As a portfolio viewer, I want days **before** the unassign date left as previously stored, so that older TF1 history is not rebuilt.
31. As a credit analyst, I want ACME to keep a TF1 Customer Policy Trend row on days after unassign while leftover TF1 invoices are still open, so that TF1 dashboards still show run-off usage.
32. As a credit analyst, I want TF1 dashboard customer lists that already include open invoices tagged with that policy to keep showing ACME during run-off, so that policy-level views match leftover AR.
33. As a credit analyst, I want to assign a new policy (TF2) on or after the unassign day while INV-9 is still unpaid on TF1, so that new invoices can be insured without moving run-off invoices.
34. As a credit analyst, I want TF2 invoices to use TF2 and INV-9 to stay on TF1, so that two policies can coexist on one customer by invoice issue date and stamp.
35. As a credit analyst, I want the stop day stored as an end date on the TF1 customer-policy version, so that we still know TF1 ended even if we never assign TF2.
36. As a credit analyst, I want that end date to mean “first day with no new TF1 invoices” (issue date before that day stays covered), so that the rule matches policy change start dates.
37. As a credit analyst, I want the old TF1 row inactive after unassign (not a live null-policy assignment), so that “no linked policy” empty states still mean no new coverage.
38. As a credit analyst on a credit-pool **child**, I want Remove policy unavailable, so that I only unassign on the pool root.
39. As a credit analyst on the pool **root**, I want the same unassign, run-off, top-up clip, invoice strip, and rewrite applied to mirrored descendants, so that the pool stays consistent.
40. As a Hebrew-speaking user, I want Remove policy, modal, date, errors, pending, and confirm copy in Hebrew, so that the flow matches the rest of the app.
41. As an English-speaking user, I want the same strings in English, so that both locales ship together.
42. As a user without policy-edit permission, I want Remove policy hidden or rejected, so that unassign uses the same permission as other Policies writes.
43. As a credit analyst, I want Remove policy unused while I am mid-edit of other fields, or clearly disabled until I cancel/save edit, so that the modal does not race an in-progress Policies save (product: button is available in view mode next to Edit, not inside the edit form).
44. As a Named-policy admin, I want deleting a Named row on the policy page to stay immediate as today, so that this work does not quietly change that screen.
45. As an import user, I want policy import/replace unassign behavior unchanged, so that bulk paths are not silently dated.
46. As a developer, I want one dated-unassign orchestration used by the modal API and by pending activation, so that past and future dates apply the same run-off rules.
47. As a developer, I want CPT writers on rewritten days to attribute usage from invoice `policy_id` and the TF1 version’s end date, not only the one active customer policy, so that run-off and a later TF2 do not collapse into one row.
48. As a customer-dashboard user, I want the existing no-policy empty state when there is no **active** assignment, so that Dashboard does not pretend TF1 is still the live policy during run-off (run-off lives on TF1 policy views and leftover invoices).
49. As a credit analyst, I want Policy history to show the TF1 version with its start and end dates, so that I can see when coverage stopped for new invoices.
50. As an operations user, I want existing CustomerPolicy rows migrated with a null end date, so that current assignments stay open-ended until someone Removes.

## Implementation Decisions

- **UI:** Policies tab, view mode: **Remove policy** next to Edit (hidden with no active primary assignment, on linked credit-pool children, without write permission, or while a pending change exists). Modal: required unassign date, default UTC today, confirm body with date + run-off + strip. Submit calls a dedicated unassign API (do not send `policy_id: null` on the ordinary customer PUT). Insurance-policy autocomplete in Edit is not clearable.
- **Date semantics:** Unassign date is a UTC calendar day. It is the **first day with no new TF1 invoices**. Covered leftover invoices: `invoice_date` **strictly before** that day. Earliest allowed: this **active** customer-policy version’s `policy_change_start_date` (not the insurance product start, unless that is the same day).
- **Schema:** Add nullable `policy_change_end_date` (`@db.Date`) on `CustomerPolicy`. Null = open-ended. On immediate or activated unassign, set it on the TF1 version being ended; then `status=inactive`, `is_active=false` (existing freeze-on-deactivation). Do **not** leave an active row with null `insurance_policy_id`. Existing rows: null end date.
- **Future pending:** Reuse at-most-one pending row. Create `status=pending`, `insurance_policy_id` null, `policy_change_start_date` = unassign day; do not set end date, clip top-ups, strip invoices, or rewrite on save. Cancel-pending: pending → inactive; no rewrite. CPT daily activation **before** tip/drain: if due pending is an unassign (null policy id), run the same orchestration as immediate unassign (end date, deactivate TF1, inactivate pending **without** promoting it to active), then rewrite. Ordinary pending **policy** rows keep today’s activate-to-active behavior.
- **Top-ups:** On apply (immediate or activation), for each non-cancelled `CustomerTopUp` on that customer: if `start_date` ≥ unassign day, end effectiveness from that start (cancel or equivalent) so rewrite from that start does not touch earlier days; if the window overlaps the unassign day, set `end_date` to the UTC day **before** unassign (last day top-up still applies). Do **not** use today’s cancel-from-original-start on overlapping windows — that would remove top-up **before** the unassign day.
- **Invoice stamps:** On apply, invoices for that customer with `policy_id` = the unassigned primary and `invoice_date` ≥ unassign day: set `policy_id` null and refresh created-terms-violation / insurance stamps. Do not attach a later TF2 to those rows. Invoices with `invoice_date` before the unassign day keep `policy_id`.
- **Rewrite:** Immediate (date ≤ UTC today): same in-request customer as-of rewrite used for dated limit changes (`fromDate` = unassign day, `toDate` = now). Future save: no rewrite. Activation: enqueue or rewrite from that day using the same pairing as other pending activations. Days before `fromDate` stay stored.
- **CPT / as-of math (from the unassign day forward):** Keep writing a TF1 customer-policy trend row while open AR remains on invoices still stamped TF1 (run-off). Limit on those days = last TF1 **base** approved limit (no top-up from the unassign day). Usage from those leftover invoices only. A later active TF2 gets its own trend row; unique (customer, customer-policy row, day) already allows both. Snapshot writers must not assume “the one active CustomerPolicy” is the only policy with usage that day.
- **Credit pool:** Unassign only on the root; remirror descendants after the same mutation (end date / pending unassign), strip/clip/rewrite per descendant invoices and top-ups as for the root.
- **Permissions:** Same as Policies-tab update / cancel-pending.
- **i18n:** All new copy English and Hebrew in the same change.
- **Styling:** Reuse existing dialog, button, and date-field patterns; no new styles unless explicitly approved.

## Testing Decisions

Prefer the highest external seams. Do not add automated tests unless explicitly requested later.

**Primary seam (one orchestration):** dated unassign apply — used by the Remove-policy API (past/today and future pending) and by CPT pending activation when the due pending row is an unassign.

**What to assert (external behavior)**

1. Immediate unassign: TF1 `policy_change_end_date` set; row inactive; no active assignment; overlapping top-up `end_date` clipped to the day before; invoices with issue date on/after the day lose `policy_id`; invoices before keep it; CPT/as-of from that day reflect run-off vs uncovered; a day before the unassign date unchanged.
2. Future unassign: pending null-policy row; TF1 still active; no clip/strip/rewrite until activation; banner + cancel; second Policies mutation still conflict.
3. Activation: due pending unassign applies the same rules as immediate; pending is not promoted to an active null-policy row; today’s tip can see no live assignment plus TF1 run-off usage.
4. Later TF2 assign: new invoices on TF2; leftover TF1 invoices unchanged.
5. Validation: date before this version’s start rejected; linked child rejected; pending exists rejected.
6. UI (manual): Remove policy modal date defaults to today; autocomplete not clearable; Save does not unassign.

**Prior art**

- Policies-tab dated save, pending activation, and in-request customer as-of rewrite from policy-change-date work.
- Invoice `policy_id` stamp at create/import; policy-scoped customer lists that already include open invoices tagged with `policy_id`.
- Top-up date windows and rewrite-from-start on cancel (this feature must **not** reuse cancel-from-start for overlapping clips).

Manual How to test on each vertical slice is enough for delivery unless tests are requested.

## Out of Scope

- Dated unassign from Named-policy delete, policy import/replace, or other bulk writers.
- A new `run_off` status enum (inactive + end date is enough).
- Full as-of replay of every inactive customer-policy version for deep Generate/backfill beyond this end-date + invoice `policy_id` rule.
- Pending status model for top-ups.
- Moving leftover invoices onto a newly assigned TF2.
- Customer Dashboard run-off KPI cards while unassigned (keep no-policy empty state; TF1 policy views still include run-off).
- Changing insurance **product** `end_date` / `ctv_invoice_after_policy_end` (product expiry stays a separate rule).
- Auto-`done` ClickUp or planning-only PR.

## Further Notes

- Grill decisions: D1 unassign like Clear; D2 pending no-policy; D3 not before this version start; D5 issue date before unassign day stays covered; D6 run-off uses TF1 base limit; D7 new policy allowed in parallel; D8 keep TF1 CPT while run-off AR open; D9 stop top-ups from unassign day (clip, do not cancel overlapping from original start); D10 end date on TF1 version; D11 strip later invoice stamps; D12 Policies tab only; D13 confirm with consequences; D14 Remove policy button + modal, dropdown no longer clears.
- Related: `.cursor/plans/policy-change-snapshot-recalc.prd.md` (dated limit/switch and pending). This PRD extends **unassign** only.
- Domain rule: snapshot day D must use data as of D; from the unassign day, “as of D” for this customer includes TF1 run-off invoices and excludes new invoices from TF1.
- Codebase scan (required / optional / no change): **required** — CustomerPolicy end date + migration; customer-policy write/unassign API; pending activation special case; top-up clip; invoice `policy_id` strip + terms restamp; in-request/queued as-of rewrite; CPT writers/membership for inactive+run-off; credit-pool remirror; Policies tab Remove modal + disable clear; EN/HE locales. **optional** — history accordion showing end date; run-off hint on Policies readonly grid. **no change** — Named delete, import unassign, insurance product end-date CTV, collection-only customers.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/customer-policy-dated-unassign/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/customer-policy-dated-unassign/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Immediate Remove policy (run-off + rewrite) | `issues/01-immediate-remove-runoff.md` | — | 1–4, 6–14, 19–27, 29–43, 46–50 |
| 2 | Pending future Remove + cron activation | `issues/02-pending-unassign-activation.md` | 01 | 5, 15–18, 28 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
