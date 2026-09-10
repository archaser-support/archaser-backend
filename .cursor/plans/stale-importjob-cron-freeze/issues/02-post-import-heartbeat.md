# 02 — Post-import modified_at heartbeat

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-stale-processing-sweeper](01-stale-processing-sweeper.md)
**User stories:** 4, 10, 13
**PRD:** `.cursor/plans/stale-importjob-cron-freeze.prd.md`

## Goal

While Invoice/Payment post-import keeps the job in `Processing`, bump `modified_at` at least every **60 seconds** (via progress callbacks or an equivalent timer) so a live long orchestrator is not idle-failed by the 2-hour sweeper from slice 01.

## How to test

1. Start (or simulate) Invoice/Payment complete/post-import that stays `Processing` for longer than a couple of minutes.
2. Watch `modified_at` on the job row — it should advance at least about once per minute while work continues.
3. Confirm a job that is actively heartbeating is not marked Failed by the stale sweeper even if wall-clock since `started_at` exceeds 2 hours.
4. When post-import finishes, job still moves to `Completed` as today.
