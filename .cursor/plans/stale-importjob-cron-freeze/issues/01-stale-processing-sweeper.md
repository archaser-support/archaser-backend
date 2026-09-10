# 01 — Stale Processing sweeper + freeze/import call sites

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 1–3, 5–7, 9–12, 15–20
**PRD:** `.cursor/plans/stale-importjob-cron-freeze.prd.md`

## Goal

Add a shared helper that marks idle `ImportJob` rows (`status = Processing`, `modified_at` older than 2 hours) as **Failed** with a clear stale/no-progress `error_message` and `completed_at`. Call it before cron freeze resolve builds the frozen set, and before import start asserts no import in progress (account-scoped on that path). Include the one-shot ops clear for account 10149 (SQL or ops script) so production can unblock immediately.

## How to test

1. Create or find an account with a `Processing` ImportJob whose `modified_at` is older than 2 hours.
2. Trigger any account-scoped worker cron that uses freeze resolve (or call the shared helper in a controlled way).
3. Expect: that job is `Failed` with the stale message; the account is no longer treated as frozen solely because of that job.
4. Create a second `Processing` job with a fresh `modified_at`; expect it is **not** swept and still freezes / still causes 409 on a new import.
5. Ops: run the 10149 clear (all Processing → Failed with the same message); confirm worker crons process account 10149 again.
