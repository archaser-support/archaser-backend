# 02 — Show sync mode in progress and schedule UI

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-reconcile-sync-mode](01-reconcile-sync-mode.md)
**User stories:** 10, 11, 12, 14
**PRD:** `.cursor/plans/billing-sync-mode-flip.prd.md`

## What to build

Show the connector **sync mode** (Backfill / Incremental) in two places on the billing integration tab so admins can tell why Start backfill vs Run incremental appears.

- Next to the progress / primary action area.
- In the Schedule section.
- Use existing config `sync_mode`; reuse existing layout patterns (no new style system).
- Ship matching **English and Hebrew** locale keys in the same change.
- Visible to users who can view the tab (`view_billing_connector`), not only manage.

## Acceptance criteria

- [ ] Progress / primary-action area shows Backfill or Incremental from config
- [ ] Schedule section shows the same mode
- [ ] Labels update after config reload / mode repair without a full page hard-refresh beyond normal query invalidation
- [ ] English and Hebrew keys added/updated together
- [ ] No new styles beyond existing theme/MUI patterns already used on the tab

## How to test

1. Open Billing integration on a Backfill account: expect **Backfill** near the primary action and in Schedule.
2. After slice 01 repair/promote (or a completed full-account backfill): expect **Incremental** in both places and **Run incremental sync now**.
3. Switch UI locale to Hebrew: expect matching mode labels (spot-check both places).
4. As a view-only user (if available): mode still visible; manage actions remain gated as today.
