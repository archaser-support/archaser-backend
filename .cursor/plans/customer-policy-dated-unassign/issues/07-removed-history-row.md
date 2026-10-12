# 07 — Remove saved as a Removed history row; older versions untouched

**Status:** done
**Priority:** high
**Blocked by:** [01-immediate-remove-runoff](01-immediate-remove-runoff.md), [02-pending-unassign-activation](02-pending-unassign-activation.md), [03-policy-history-removed-chips](03-policy-history-removed-chips.md), [04-policy-chart-cpt-rollup](04-policy-chart-cpt-rollup.md), [05-remove-enqueues-dashboard-rewrite](05-remove-enqueues-dashboard-rewrite.md), [06-datafix-existing-removes](06-datafix-existing-removes.md)
**User stories:** 6, 7, 35, 51, 52, 53, 54
**PRD:** `.cursor/plans/customer-policy-dated-unassign.prd.md` (Implementation Decisions → "Removed row model", decisions D27–D37)

## What to build

Change how a Remove is stored so it can start before older policy versions and never rewrites them.

- **Removed row (D27, D33):** an immediate Remove, and a due pending unassign on activation, both leave one `CustomerPolicy` row with `insurance_policy_id` null, start = remove day, inactive, created/modified by the remover. The pending path already creates this shape; the immediate path must create it too. No schema change.
- **Stop writing older versions (D27):** `datedCustomerPolicyUnassign.ts` no longer sets `policy_change_end_date` on any version and no longer voids versions (end = start). Only the version active at the Remove is switched to inactive, with the normal write stamp (D30).
- **Earliest date (D28):** insurance product start only. Remove the D26 version-start check in the backend (`UNASSIGN_DATE_BEFORE_VERSION_START`) and the modal (`minDate`, client check). Restore the `unassign_date_before_version_start` copy in EN and HE to the product-start wording, or reuse one key for `UNASSIGN_DATE_BEFORE_POLICY_START`.
- **Coverage stop (D29, D35):** in `customerPolicyAsOfVersion.ts`, a no-policy row with start S stops every version with a lower `id` from day S on, including versions that start on or after S (they never apply). Versions saved after the Removed row cover normally.
- **No prehistory after a Remove (D36):** when a Removed row exists, do not extend the earliest version backward. Invoice stamp strip clears the removed policy from invoices dated on/after the remove day **or** before the first version's start.
- **Run-off (D37):** run-off rows and their limit use the base approved limit of the version active at the Remove. Run-off detection (CPT writer membership, policy chart roll-up, slice 06 detection) keys on the Removed row instead of `policy_change_end_date`.
- **Policy history (D31, D32):** the Removed row is the newest entry: header with the removed policy's name (from the version active just before it), a **Removed** chip, "From: {date}" and modified at / by; no expand. Versions saved before the Remove that start on/after the remove day get a display-only **Not applied (after remove)** chip. Retire "Cancelled by remove" and the "Active: start → end" range on the ended version. Chip rule lives in `shared/creditInsurance/customerPolicyHistoryPresentation.ts`. EN + HE. No new styles.
- **Legacy removes (D34):** extend `scripts/datafixes/rebuild-after-existing-policy-removes.ts`: for customers removed the old way, add the missing Removed row and restore end dates from the version order, keeping current `modified_at` / `modified_by` (raw SQL). Dry-run by default.
- **Tests:** update `api/test/dated-customer-policy-unassign.test.ts` expectations to the new model (user approved test changes for this feature).

## Acceptance criteria

- [ ] A Remove from a day before older versions is accepted when on/after the insurance product start
- [ ] A Remove adds exactly one Removed row (no-policy, start = remove day); no other version's dates or modified at / by change except the version that was active
- [ ] No invoice issued on/after the remove day, or before the first version, is covered; run-off invoices before the remove day use the limit of the version active at the Remove
- [ ] Assigning a policy after the Remove gives normal coverage from its start
- [ ] Policy history shows the Removed row on top and "Not applied (after remove)" on later versions saved before it; EN + HE
- [ ] Scheduled Remove activation produces the same result as an immediate Remove
- [ ] Data fix dry-run lists legacy removes; apply adds Removed rows and restores end dates without changing modified at / by
- [ ] Existing automated tests pass with updated expectations

## How to test

1. Restore or pick customer 21036 with versions starting Aug 31, Sep 7, Sep 8, Oct 4 and Oct 6 (active). Note each version's modified at.
2. Customers → 21036 → Policies → **Remove policy**, date **June 30**, confirm. Expect it to save without a date error.
3. Policy history: expect a new top row "Policy 23 · Removed · From: 30/06/2026 · Modified at: now by you". The Aug 31–Oct 4 versions keep their dates and modified at, and show **Not applied (after remove)**. The Oct 6 version shows the Remove time as modified at.
4. On a customer with unpaid invoices before and after the remove day, expect invoices on/after that day (and any before the first version) to show no policy; earlier invoices keep it, and the policy chart counts them with the Oct 6 version's limit.
5. Assign another policy starting next week. Expect new invoices from that day to be covered.
6. Switch to Hebrew: the Removed row, chips and date read correctly in RTL.
