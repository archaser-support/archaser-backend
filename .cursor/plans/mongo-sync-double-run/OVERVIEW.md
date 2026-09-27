# Mongo sync one RUNNING per account

Prevent overlapping Mongo sync history `RUNNING` rows for the same account (cron and manual), with a deploy-time cleanup of existing twins. Keep the 2h idle sweeper for stuck runs.

**PRD:** `.cursor/plans/mongo-sync-double-run.prd.md`

Vertical slices live under `issues/`.
