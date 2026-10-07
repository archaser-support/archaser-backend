# Dated customer policy unassign (run-off)

Short overview: Policies-tab **Remove policy** modal with a required unassign date; leftover invoices stay on the old policy (run-off); top-ups stop from that day; later invoice stamps are stripped; Customer Policy Trend (CPT) and as-of rewrite from that day. Future dates use pending activation.

**PRD:** `.cursor/plans/customer-policy-dated-unassign.prd.md`

**Related:** `.cursor/plans/policy-change-snapshot-recalc.prd.md` (dated limit/switch and pending; this feature is unassign only)

Vertical slices live under `issues/`.
