# Policy change date and daily snapshot recalculation

Short overview: required `policy_change_date` and `active`/`pending`/`inactive` on customer policies, as-of rewrite from that date, pending activation in the CPT daily cron, Policies-tab UI, plus top-up overlap guards and rewrite enqueue hardening.

**PRD:** `.cursor/plans/policy-change-snapshot-recalc.prd.md`

**ClickUp:** [Recalculate customer daily snapshots when policy or top-up changes](https://app.clickup.com/t/869f6t266)

Vertical slices live under `issues/`.
