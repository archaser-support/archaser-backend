# Dated customer policy unassign (run-off)

Short overview: Policies-tab **Remove policy** modal with a required unassign date; leftover invoices stay on the old policy (run-off); top-ups stop from that day; later invoice stamps are stripped; Customer Policy Trend (CPT) and as-of rewrite from that day. Future dates use pending activation.

Round 2 (slices 03–06): Policy history shows the remove (end date + Removed chip; later versions marked Cancelled by remove); the policy-level chart is rolled up from Customer Policy Trend rows for past and future days; Remove queues past credit dashboard days for the overnight rebuild; a one-time data fix covers removes that already happened (e.g. customer 21108).

Round 4 (slice 07): a Remove is saved as one new "Removed" history row starting on the remove date, instead of writing end dates onto older versions. Older versions stay untouched; the coverage rules stop at that row. Removes may predate older versions (earliest = insurance product start). Replaces D15, D16 and D26 (decisions D27–D37 in the PRD).

**PRD:** `.cursor/plans/customer-policy-dated-unassign.prd.md`

**Related:** `.cursor/plans/policy-change-snapshot-recalc.prd.md` (dated limit/switch and pending; this feature is unassign only)

Vertical slices live under `issues/`.
