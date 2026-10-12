# 03 — Policy history: Removed and Cancelled by remove

**Status:** done
**Priority:** normal
**Blocked by:** —
**User stories:** 49, 51, 52, 53, 54
**PRD:** `.cursor/plans/customer-policy-dated-unassign.prd.md`

## What to build

Make a Remove visible in the customer **Policy history** accordion. On the version that ended on Remove (inactive, has an insurance policy, `policy_change_end_date` after its start, and no later non-cancelled version starts on that end date), show its end date and a **Removed** chip next to the existing previous policy / previous version chip; the header keeps its modified at / by. Versions voided by the Remove (end date equal to start date) stay in the list with a **Cancelled by remove** chip and no date range. Superseded versions (ended at a successor's start) keep today's look. Put the chip-kind rule in `shared/creditInsurance/customerPolicyHistoryPresentation.ts` next to `resolveCustomerPolicyHistoryChipKind`. `policy_change_end_date` already reaches the frontend (`types/Customer.ts`, `shared/customerPolicyAdapter.ts`). Reuse existing `Chip` usage in the accordion header; no new styles. English and Hebrew in the same change.

Backend prerequisite already shipped: Remove no longer rewrites untouched old versions, so their modified at / by stays true.

## Acceptance criteria

- [ ] Ended-on-Remove version shows its end date and a Removed chip
- [ ] Voided versions (end = start) show Cancelled by remove, no Removed chip, no date range
- [ ] Superseded versions unchanged
- [ ] Removed version header shows the remover and remove time; older versions keep their own modified at / by
- [ ] Matching EN + HE keys

## How to test

1. Pick a customer on TF1 with a few older versions (e.g. limit changes) and an active version that started on day S. Remove policy with a date X after S (a date before S is rejected, see PRD D26).
2. Open the customer → Policies tab → Policy history.
3. Expect: the version that was active shows "Active: S → X" and a **Removed** chip with your name and today's time; the older versions look as before and keep their original modified date.
4. On another customer, Remove with date = the active version's start day S. Expect that version to show **Cancelled by remove**, with no Removed chip and no date range.
5. Switch to Hebrew: chips and dates read correctly in RTL.
