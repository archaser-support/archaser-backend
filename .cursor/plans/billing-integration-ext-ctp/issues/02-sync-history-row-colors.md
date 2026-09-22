# 02 — Sync History failed/running row colors

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** —
**User stories:** 7, 8, 9, 20
**PRD:** `.cursor/plans/billing-integration-ext-ctp.prd.md`

## What to build

In the Billing Integration Sync History grid, tint the whole row for run-level status `FAILED` using the theme error palette and `RUNNING` using the theme info palette. Leave `SUCCESS`, `PARTIAL`, and `TIMEOUT` on normal zebra striping. Prefer existing theme tokens / minimal row styling — no new global theme blocks unless unavoidable (already approved for palette-based row tints only).

## Acceptance criteria

- [ ] Failed Sync History rows show a red/error-tinted row background
- [ ] Running Sync History rows show a blue/info-tinted row background
- [ ] Success, partial, and timeout rows keep default zebra striping
- [ ] Coloring uses run-level `status` (not entity cell maturity)
- [ ] No unrelated Sync History behavior changes

## How to test

1. Open Account → Billing settings → Integration → Sync History.
2. With a failed run present, confirm the entire row is red-tinted.
3. Start or observe a running sync; confirm that row is blue-tinted.
4. Confirm successful (and if available partial/timeout) rows are not specially tinted beyond zebra.
