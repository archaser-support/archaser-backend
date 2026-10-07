# 01 — Preview API + today confirm modal

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 6, 7, 16, 19, 21, 22, 31, 32, 35
**PRD:** `.cursor/plans/insurance-policy-save-confirm-pending.prd.md`

## What to build

End-to-end **today** path: when the user saves an Insurance Policy and at least one customer-push field changed, call a preview API and show an approval modal with per-field old→new, per-field customer counts, unique affected count, and skipped-pending count. On confirm with effective date **today**, update the live policy and push **only those changed fields** onto active Customer Policies (skip customers who already have a pending Customer Policy). Non-push-only saves skip the modal and save immediately. English and Hebrew copy for the modal.

## Acceptance criteria

- [x] Preview returns changed push fields with old/new values and counts (per field, unique, skipped for customer pending)
- [x] Modal opens only when ≥1 push field changed; insurer-name-only saves without modal
- [x] Confirm today applies policy update + changed-fields customer versions (or rolls back on failure)
- [x] Customers with pending Customer Policy are skipped and reflected in preview skipped count
- [x] Modal still shown when unique affected customers = 0
- [x] EN + HE strings for modal UI and errors

## How to test

1. Open Settings → Credit Insurance Policies → a Primary policy with several active customers.
2. Change only insurer name → Save → expect save with **no** modal.
3. Change cost % (or max payment term) → Save → expect modal with field list and counts.
4. Confirm with today → expect live policy updated; only customers who differed on the changed field(s) get a new Customer Policy version; payment term unchanged if it was not in the changed set.
5. Repeat with a customer that has a pending Customer Policy → expect them counted as skipped and not versioned.
