# 01 — Demo flag + Settings Demo shell

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 13, 20, 21, 26
**PRD:** `.cursor/plans/demo-account-clone-reset.prd.md`

## What to build

Add `is_demo` (and the demo timeline anchor field) on Account, expose `is_demo` to the client on the account payload Settings already relies on, and show a **Settings → Demo** section/tab **only** when the current account is a demo. Ship English and Hebrew labels for the section even if the Reset action is wired in a later slice (shell can explain that reset comes next, or show a disabled placeholder — prefer a clear empty state that does not call a missing API).

Non-demo accounts must not see the Demo section.

## Acceptance criteria

- [ ] `Account` has `is_demo` (default false) and a durable timeline anchor field for later reset math
- [ ] Client can read `is_demo` for the current account without a one-off hack
- [ ] Settings shows a Demo section/tab only when `is_demo` is true
- [ ] Non-demo accounts never show the Demo section
- [ ] Matching English and Hebrew locale keys are added/updated together

## How to test

1. Apply schema for a local/dev account; set `is_demo=true` on one test account (SQL or Prisma) and leave another false.
2. Log in as an admin on the demo-flagged account → open Settings → confirm Demo section/tab is visible (EN + switch to HE for labels).
3. Log in on a normal account → Settings → confirm Demo section is absent.
