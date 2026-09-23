# 04 — Remaining excess per year + policy summary history

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-claim-schema-domain-api](01-claim-schema-domain-api.md)
**User stories:** 18–19
**PRD:** `.cursor/plans/claims-tracking.prd.md`

## What to build

Surface **remaining Aggregate/SDL excess (“access amount”) per Primary policy year** on Primary policy settings and/or commercial/summary surfaces, and add the **last three anniversary policy years** of claims (and remaining excess context) to the Portfolio Health policy summary. Read-only display of derived balances and claim history — no CSV import. EN+HE labels.

Soft note: Claims grid from slice 03 can ship without this; this slice wires policy-facing history.

## Acceptance criteria

- [ ] Primary policy settings/summary shows remaining Aggregate and SDL excess per policy year
- [ ] Portfolio Health policy summary shows claims / excess context for current year and prior two anniversary years
- [ ] Values update after Approve/Paid and after reverse (Canceled/Rejected from those states)
- [ ] English and Hebrew strings added together

## How to test

1. On a Primary policy with Aggregate and SDL set, approve a claim for an invoice whose date falls in year 1 of the policy — remaining SDL (then Aggregate) for that year decreases on the policy settings/summary surface.
2. Open Portfolio Health policy summary — see that year plus up to two prior years’ claim/excess context.
3. Cancel the approved claim — remaining excess restored in both surfaces.
4. Hebrew locale — new labels translate.
