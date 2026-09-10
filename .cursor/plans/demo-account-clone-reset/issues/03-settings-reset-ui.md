# 03 — Settings Reset UI with progress

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [02-timeline-refresh-reset-api](02-timeline-refresh-reset-api.md)
**User stories:** 13, 14, 15, 16, 17, 18, 19, 26, 34
**PRD:** `.cursor/plans/demo-account-clone-reset.prd.md`

## What to build

Wire the Settings Demo section to the reset APIs: confirm dialog, start job, show progress/status (including after navigating away and returning), and success/failure messaging. Visible only for `is_demo` accounts and usable by account admins. Ship all new user-facing strings in English and Hebrew together. Reuse existing long-job / status UI patterns where they already exist (e.g. as-of backfill status), rather than inventing a one-off design system.

## Acceptance criteria

- [ ] Account admin on a demo account can confirm and start reset from Settings → Demo
- [ ] Progress/status is visible and recoverable after leaving/returning to Settings
- [ ] Non-demo accounts still hide the section; unauthorized roles cannot start reset from UI
- [ ] Matching English and Hebrew locale keys are added/updated together
- [ ] No new styling beyond existing theme patterns unless explicitly approved

## How to test

1. Log in as System Administrator (or equivalent account admin) on a demo account.
2. Open Settings → Demo → start Reset → confirm dialog → see job progress update to success.
3. Spot-check a customer list / invoice due dates look near “today,” and a credit screen if enabled.
4. Switch locale to Hebrew and confirm Demo/Reset copy is present (not English-only fallbacks).
5. As a non-admin demo user, confirm Reset is not available (hidden or rejected).
