# Stale ImportJob cron freeze recovery

Stuck `ImportJob` rows left in `Processing` keep accounts cron-frozen forever. This feature adds a 2-hour idle sweeper (Failed + clear message), wires it into freeze resolve and import start, heartbeats post-import `modified_at`, and ops-clears account 10149.

**PRD:** `.cursor/plans/stale-importjob-cron-freeze.prd.md`

Vertical slices live under `issues/`.
