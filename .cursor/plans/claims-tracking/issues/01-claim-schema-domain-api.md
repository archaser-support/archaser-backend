# 01 — Claim schema, domain, and API

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 4–5, 10–18, 22–23, 27–30
**PRD:** `.cursor/plans/claims-tracking.prd.md`

## What to build

Introduce the Claim model and account-scoped create/list/get/update APIs, plus domain rules for eligibility checks, Primary policy anniversary year resolution, default recognized loss (open × insured %), and excess apply/reverse (SDL remaining for the year first, then Aggregate) when status first enters or leaves `{Approved, Paid}`. Claims always attach to the account’s Primary InsurancePolicy; invoice link is optional but unique when present.

Statuses: Draft, Submitted, Under Inquiry, Approved, Paid, Rejected, Canceled. Transition to Submitted requires submission date and insurer submission reference. Persist enough applied-excess detail to reverse exactly. Expose remaining Aggregate/SDL excess per policy year for a Primary policy (derived from commercial terms minus applied deductions).

## Acceptance criteria

- [ ] Claim schema and API create/list/get/update round-trip for an account
- [ ] At most one claim per invoice when invoice_id is set
- [ ] Submitted requires submission date + insurer reference
- [ ] First transition into Approved or Paid deducts SDL-then-Aggregate for the correct anniversary policy year; Approved→Paid does not double-deduct
- [ ] Leaving `{Approved, Paid}` reverses the prior deduction
- [ ] Remaining excess per policy year API/helper matches applied claims
- [ ] TopUp is not used as claim owner; Primary only

## How to test

1. Apply schema (`db push` per project rules).
2. Create a Draft claim via API linked to an invoice on a Primary policy with NQL, insured %, Aggregate, and SDL set.
3. Move to Submitted with date + reference — succeeds; without them — rejected.
4. Move to Approved — SDL remaining for that policy year drops first; Aggregate only after SDL is exhausted; remaining-excess endpoint reflects it.
5. Move Approved → Paid — remaining excess unchanged (no second deduction).
6. Move to Canceled — excess restored.
7. Attempt a second claim for the same invoice — rejected.
