# MEP / Reporting Substitute Extra Days

Short overview: rename MEP/Reporting substitute fields to extra-days, validate 1–365, and change target-date math to `original target + extra days` when cutoff applies. Payment Term stays on the old next-month-day formula. No invoice backfill.

**PRD:** `.cursor/plans/mep-reporting-substitute-extra-days.prd.md`

Vertical slices live under `issues/`.
