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
6. ~~As a credit analyst, I want the earliest allowed unassign date to be this customer-policy version’s start date~~ (replaced by D28) As a credit analyst, I want to remove a policy from any day on or after the insurance policy's start, even before older versions in the history, so that I can correct coverage that should have stopped earlier.
7. As a credit analyst, I want an unassign date before the insurance policy start rejected with a clear error, so that I know why Save failed.
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
35. As a credit analyst, I want the stop day stored as a Removed history row starting on that day (D27; previously an end date on the TF1 version), so that we still know TF1 ended even if we never assign TF2, without changing older versions.
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
51. As a credit analyst, I want a Remove logged as the newest Policy history entry ("Policy name", **Removed** chip, "From: date") (D27, D32), so that I can see the remove happened and when coverage stopped for new invoices.
52. As a credit analyst, I want that Removed entry to show who removed it and when (modified at / by), so that I know who made the change.
53. As a credit analyst, I want older Policy history versions not changed by a Remove (dates and modified at / by unchanged), so that their audit info stays true. Only the version active at the Remove is switched to inactive (D30).
54. As a credit analyst, I want versions saved before the Remove that start on or after the remove date kept unchanged in Policy history with a **Not applied (after remove)** chip (D31), so that I know they never gave coverage.
55. As a credit analyst, I want the TF1 policy chart for the unassign day through today rebuilt after a past-dated Remove, so that it matches the customer's rebuilt Customer Policy Trend.
56. As a credit analyst, I want the TF1 policy chart to keep counting run-off invoices on days after a Remove, so that TF1 usage shows leftover open AR.
57. As a credit analyst, I want the credit dashboard snapshots for the unassign day through yesterday rebuilt after a past-dated Remove, so that past dashboard days stop counting the customer as fully insured.
58. As an operations user, I want customers removed before this change shipped (e.g. customer 21108, removed from July 30) fixed by a one-time data fix, so that their policy chart and dashboard history follow the same rules.

## Implementation Decisions

- **UI:** Policies tab, view mode: **Remove policy** next to Edit (hidden with no active primary assignment, on linked credit-pool children, without write permission, or while a pending change exists). Modal: required unassign date, default UTC today, confirm body with date + run-off + strip. Submit calls a dedicated unassign API (do not send `policy_id: null` on the ordinary customer PUT). Insurance-policy autocomplete in Edit is not clearable.
- **Date semantics:** Unassign date is a UTC calendar day. It is the **first day with no new TF1 invoices**. Covered leftover invoices: `invoice_date` **strictly before** that day. Earliest allowed: the insurance **product** start date (**D28**, replacing the version-start floor of user story 6 / D26), so a Remove may predate older versions.
- **Schema:** Add nullable `policy_change_end_date` (`@db.Date`) on `CustomerPolicy`. Null = open-ended. ~~On immediate or activated unassign, set it on the TF1 version being ended~~ (superseded by **D27**: a Remove no longer writes end dates; it adds a Removed row — see "Removed row model" below). The live version becomes `status=inactive`, `is_active=false` (existing freeze-on-deactivation). Do **not** leave an active row with null `insurance_policy_id`. Existing rows: null end date.
- **Future pending:** Reuse at-most-one pending row. Create `status=pending`, `insurance_policy_id` null, `policy_change_start_date` = unassign day; do not set end date, clip top-ups, strip invoices, or rewrite on save. Cancel-pending: pending → inactive; no rewrite. CPT daily activation **before** tip/drain: if due pending is an unassign (null policy id), run the same orchestration as immediate unassign (end date, deactivate TF1, inactivate pending **without** promoting it to active), then rewrite. Ordinary pending **policy** rows keep today’s activate-to-active behavior.
- **Top-ups:** On apply (immediate or activation), for each non-cancelled `CustomerTopUp` on that customer: if `start_date` ≥ unassign day, end effectiveness from that start (cancel or equivalent) so rewrite from that start does not touch earlier days; if the window overlaps the unassign day, set `end_date` to the UTC day **before** unassign (last day top-up still applies). Do **not** use today’s cancel-from-original-start on overlapping windows — that would remove top-up **before** the unassign day.
- **Invoice stamps:** On apply, invoices for that customer with `policy_id` = the unassigned primary and `invoice_date` ≥ unassign day: set `policy_id` null and refresh created-terms-violation / insurance stamps. Do not attach a later TF2 to those rows. Invoices with `invoice_date` before the unassign day keep `policy_id`.
- **Rewrite:** Immediate (date ≤ UTC today): same in-request customer as-of rewrite used for dated limit changes (`fromDate` = unassign day, `toDate` = now). Future save: no rewrite. Activation: enqueue or rewrite from that day using the same pairing as other pending activations. Days before `fromDate` stay stored.
- **CPT / as-of math (from the unassign day forward):** Keep writing a TF1 customer-policy trend row while open AR remains on invoices still stamped TF1 (run-off). Limit on those days = last TF1 **base** approved limit (no top-up from the unassign day). Usage from those leftover invoices only. A later active TF2 gets its own trend row; unique (customer, customer-policy row, day) already allows both. Snapshot writers must not assume “the one active CustomerPolicy” is the only policy with usage that day.
- **Untouched versions keep their audit stamp** (superseded by **D27/D30**: only the live version is written): On apply, only write versions that actually change — the live (active) version, and any version whose end date moves earlier. Versions already inactive whose end does not change are skipped, because any write bumps `CustomerPolicy.modified_at` (`@updatedAt`), which Policy history shows. (Shipped in `endCustomerPolicyVersionsForUnassign`; earlier removes already overwrote `modified_at` on old versions and that cannot be recovered.)
- **Policy history — Removed version (grill D15, superseded by D32):** On the version that ended on Remove, show its `policy_change_end_date` and a **Removed** chip, plus the existing modified at / by. No separate "policy removed" row. Detection in the UI: inactive, `insurance_policy_id` set, end date after start date, and no later non-cancelled version for the same customer starts on that end date (a supersede ends a version at its successor's start, so it is not "Removed").
- **Policy history — versions after the unassign date (grill D16, superseded by D29/D31):** Versions that start on or after the unassign date are voided by apply (end date = start date, never effective). Keep the rows; in Policy history show a **Cancelled by remove** chip with no Removed chip and no date range. Do not delete them.
- **Removed row model (grill round 4, D27–D37) — replaces end-date writes, D15, D16 and D26:**
  - **Storage (D27, D33):** a Remove (immediate, or a due pending unassign on activation) saves one `CustomerPolicy` row with `insurance_policy_id` null, `policy_change_start_date` = remove day, `status=inactive`, `is_active=false`, `created_by`/`modified_by` = remover. This is the same shape the pending path already creates. No schema change. Older versions are not written: no end-date changes, no voiding, `modified_at` / `modified_by` untouched.
  - **Live version (D30):** the version active at the Remove becomes `status=inactive`, `is_active=false` with the normal write stamp (modified at / by = remover and Remove time). Its dates are unchanged.
  - **Earliest date (D28):** insurance product start only. Drop the D26 check (`UNASSIGN_DATE_BEFORE_VERSION_START`) in backend and modal; restore the slice-01 test to "allowed before later versions" with the new expectations.
  - **Coverage stop (D29, D35):** in `customerPolicyAsOfVersion.ts`, a no-policy row with start S stops every version **saved before it** (lower `id`) from day S on. Versions starting on/after S that were saved before the Remove never give coverage. A version saved **after** the Remove (e.g. assigning TF2 next week) covers normally from its own start.
  - **Prehistory (D36):** when a Removed row exists, do not extend the earliest version backward. Invoices dated before the first version are not covered and lose their policy stamp, even if dated before the remove day. Invoice stamp strip covers `invoice_date` ≥ remove day **or** before the first version's start.
  - **Run-off limit (D37):** run-off invoices use the base approved limit of the version that was **active at the Remove** (as PRD D6 "last base approved limit"), even if that version started after the remove day and never gave coverage of its own. Deliberate exception to D29.
  - **Run-off detection:** run-off rows, the policy chart roll-up, slice 06 detection and the Removed chip key on the Removed row (no-policy row + the version active before it), not on `policy_change_end_date`.
  - **Policy history (D31, D32):** the Removed row is the newest entry: header shows the removed policy's name (from the version active just before it), a **Removed** chip, "From: {remove day}" and modified at / by; no expand / grid. Versions saved before the Remove that start on/after the remove day get a display-only **Not applied (after remove)** chip. "Cancelled by remove" is retired.
  - **Cancelled pending (implementation):** a cancelled pending change (and a pool child's dropped pending mirror) is voided (end = start) so it is never read as a Removed row. Migration `20261011_void_cancelled_pending_unassign.sql` voids existing cancelled pending unassigns (last modified before their start day).
  - **Legacy removes (D34):** extend the slice 06 data fix: for customers removed the old way (end dates written / versions voided), add the missing Removed row and restore end dates from the version order (each version ends at its successor's start; the last one open-ended until the Removed row), keeping their current `modified_at` / `modified_by` (raw SQL, no `@updatedAt` bump). Customers assigned a policy again after an old-style remove keep their old end dates (a Removed row added now would also stop the later assignment). Old removes that voided every version (no ended version left) cannot be detected and are not migrated.
- **Policy chart from Customer Policy Trend rows (grill D17, D18):** Build `InsurancePolicyTrend` (the policy-level chart) for a day by adding up that day's Customer Policy Trend rows for the policy — including run-off rows — instead of looping over customers whose version is active right now. One shared roll-up used for past and future days: run it for every day a Customer Policy Trend rewrite touches (in-request remove/dated-save rewrite, rewrite-queue replay) and for today in the daily job after today's Customer Policy Trend tip. Replaces the live-only loop in `computePolicyRollups`. Policy-level fields not on Customer Policy Trend (e.g. `max_total_cover`, country / named counts) still come from the policy row.
- **Credit dashboard past days (grill D19):** Past-dated Remove also adds the customer to the rewrite queue (`enqueueAsOfRewrite`) from the unassign day through today, so the overnight queue replay rebuilds the credit dashboard snapshot days with the existing shared day writer (`takeCreditDashboardDailySnapshotsForAccount`). The dashboard is **not** built from Customer Policy Trend rows — it also counts customers with no policy and per-invoice counts (reporting countdown, without-policy exposure). Customer Policy Trend stays rewritten in-request.
- **Removes that already happened (grill D20):** One-time data fix under `scripts/datafixes/` for every customer already removed (inactive version with end date after start and no successor): run the policy chart roll-up from each remove date through today, and enqueue the rewrite queue from that date for the dashboard. Dry-run mode first; per-account summary.
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
7. Policy history: ended version shows end date + Removed chip; versions starting on/after the unassign date show Cancelled by remove; older versions keep their modified at / by.
8. Policy chart: for a rewritten day, TF1 totals equal the sum of that day's TF1 Customer Policy Trend rows (run-off included); today's daily write follows the same rule.
9. Dashboard: past-dated Remove leaves one rewrite-queue item from the unassign day; after the queue replay, past dashboard days move the customer's later invoices out of insured exposure.

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
- Adding **dated policy saves** (limit change / switch) to the rewrite queue for dashboard days — only Remove does this here.
- Building the credit dashboard snapshots from Customer Policy Trend rows (they need no-policy customers and per-invoice counts).
- Changing how country / named policy trend rows count customers (only the policy-level `InsurancePolicyTrend` totals move to the roll-up).
- Editing the remove date of a customer already removed.
- Auto-`done` ClickUp or planning-only PR.

## Further Notes

- Grill decisions: D1 unassign like Clear; D2 pending no-policy; D3 not before this version start; D5 issue date before unassign day stays covered; D6 run-off uses TF1 base limit; D7 new policy allowed in parallel; D8 keep TF1 CPT while run-off AR open; D9 stop top-ups from unassign day (clip, do not cancel overlapping from original start); D10 end date on TF1 version; D11 strip later invoice stamps; D12 Policies tab only; D13 confirm with consequences; D14 Remove policy button + modal, dropdown no longer clears.
- Grill round 2 (customer 21108, removed from July 30): D15 Removed chip + end date on the ended version, no extra row; D16 versions starting on/after the unassign date kept and marked Cancelled by remove; D17 rebuild the policy chart for rewritten days from Customer Policy Trend rows; D18 build the daily policy chart the same way (one shared roll-up for past and future); D19 Remove enqueues the rewrite queue so the overnight replay rebuilds past dashboard days with the shared day writer; D20 one-time data fix for removes that already happened.
- Implementation round (open points after slices 03–06):
  - **D21 chips:** "Cancelled by remove" only when the voided version (end = start) has no live version covering its start day, so rows voided by a backdated save get no chip. A no-policy row left by an activated pending unassign does not count as a successor, so the ended version still shows Removed.
  - **D22 pools:** the policy chart roll-up sums limit and open AR from pool roots only (children mirror the root's limit; the root row holds the pool's AR). The customer count includes every member, matching `getCustomerPolicyPortfolioTrend`.
  - **D23 every writer rolls up:** Generate/backfill, the credit-pool parent-history job, daily cron catch-up days and the API copy of the daily job all run the roll-up for the days they wrote. When the account has no Customer Policy Trend rows for a day (e.g. today before the 03:00 job), policy totals are left unchanged rather than zeroed.
  - **D24 enqueue failure:** if the queue step after a Remove fails, it is logged and the Remove still succeeds. Apply returns `rewriteEnqueued`, and pending activation counts only real enqueues. The slice 06 data fix can re-queue.
  - **D26 earliest remove date (superseded by D28 — remove in slice 07):** the active version's `policy_change_start_date`, as user story 6 says, enforced in the backend (`UNASSIGN_DATE_BEFORE_VERSION_START`) and by the modal's date picker minimum. This replaces slice 01's product-start-only floor. The product-start check stays as a first guard. As a result, a new Remove voids no older versions; "Cancelled by remove" now only appears when the active version is removed on its own start day, or on rows voided by removes made before D26.
  - **Grill round 4 (Remove before older versions, history untouched):** D27 Removed row instead of end-date writes; D28 earliest = product start (replaces D26); D29 nothing on/after the remove day is covered, later versions never apply; D30 live version gets the normal write stamp; D31 "Not applied (after remove)" display chip; D32 Removed row is header-only with policy name; D33 reuse the no-policy row, no schema change; D34 data fix migrates old-style removes; D35 the stop only applies to versions saved before the Removed row; D36 no prehistory coverage when removed; D37 run-off uses the limit of the version active at the Remove. Details in "Removed row model" above; slice 07.
  - **D25 data fix scope:** includes customers who later got a new policy, i.e. no "no active version" filter. A live version starting exactly on the remove date is a supersede, not a Remove.
- Related: `.cursor/plans/policy-change-snapshot-recalc.prd.md` (dated limit/switch and pending). This PRD extends **unassign** only.
- Related: `.cursor/plans/as-of-daily-snapshot-rewrite.prd.md` deferred `InsurancePolicyTrend` as-of rewrite (its D3). D17/D18 bring the policy-level chart into scope through the Customer Policy Trend roll-up, not a separate as-of replay.
- Domain rule: snapshot day D must use data as of D; from the unassign day, “as of D” for this customer includes TF1 run-off invoices and excludes new invoices from TF1.
- Codebase scan (required / optional / no change): **required** — CustomerPolicy end date + migration; customer-policy write/unassign API; pending activation special case; top-up clip; invoice `policy_id` strip + terms restamp; in-request/queued as-of rewrite; CPT writers/membership for inactive+run-off; credit-pool remirror; Policies tab Remove modal + disable clear; EN/HE locales. **optional** — run-off hint on Policies readonly grid. **no change** — Named delete, import unassign, insurance product end-date CTV, collection-only customers.
- Codebase scan, round 2: **required** — `frontend/app/[locale]/app/customers/[customerId]/CustomerCreditInsuranceInfo.tsx` (end date, Removed / Cancelled by remove chips; `policy_change_end_date` already on `types/Customer.ts` and `shared/customerPolicyAdapter.ts`); `frontend/shared/creditInsurance/customerPolicyHistoryPresentation.ts` (chip-kind helper); `frontend/locales/{en,he}/customers.json`; `packages/credit-insurance-domain/.../insurancePolicyTrendService.ts` (`computePolicyRollups` → roll-up from Customer Policy Trend rows, callable for any day); `asOfRewriteQueue.ts` (`rewriteCustomerAsOfRange` and `drainAsOfRewriteQueue` call the roll-up for rewritten days); `datedCustomerPolicyUnassign.ts` (`enqueueAsOfRewrite` after the in-request rewrite); `packages/cron-jobs/src/handlers.ts` (Customer Policy Trend handler runs today's roll-up after its tip; the separate Insurance Policy Trend handler must not overwrite it with live-only totals); new `scripts/datafixes/` script next to `backfill-customer-policy-end-dates.ts`. **optional / out of scope** — dated policy save enqueue; country / named trend rows. **no change** — `deleteInactiveCustomerPolicyTrendRowsForScope` and per-day prune (already delete trend rows for voided versions); `closeCustomerPolicyVersionsFromDate` (already skips unchanged rows).

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/customer-policy-dated-unassign/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/customer-policy-dated-unassign/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Immediate Remove policy (run-off + rewrite) | `issues/01-immediate-remove-runoff.md` | — | 1–4, 6–14, 19–27, 29–43, 46–50 |
| 2 | Pending future Remove + cron activation | `issues/02-pending-unassign-activation.md` | 01 | 5, 15–18, 28 |
| 3 | Policy history: Removed and Cancelled by remove | `issues/03-policy-history-removed-chips.md` | — | 49, 51–54 |
| 4 | Policy chart rolled up from Customer Policy Trend | `issues/04-policy-chart-cpt-rollup.md` | — | 55, 56 |
| 5 | Remove rebuilds past dashboard days | `issues/05-remove-enqueues-dashboard-rewrite.md` | — | 57 |
| 6 | Data fix for removes that already happened | `issues/06-datafix-existing-removes.md` | 04, 05 | 58 |
| 7 | Remove saved as a Removed history row; older versions untouched | `issues/07-removed-history-row.md` | 01–06 | 6, 7, 35, 51–54 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
