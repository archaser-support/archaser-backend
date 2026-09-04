# 03 — Billing UI cache suggestion on Start

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [02-cache-check-and-replay](02-cache-check-and-replay.md)
**User stories:** 6, 7, 29, 30
**PRD:** `.cursor/plans/billing-import-mongo-cache.prd.md`

## What to build

Wire Billing Integration Settings (and `billingConnectorService`) so manual Start calls cache-check, surfaces which entities have a same-day backup, and lets the user opt in per entity. Selected entities are sent as `use_cached_import` on Start. Reuse existing dialog/confirmation patterns — no new global styles without approval.

## Acceptance criteria

- [ ] Before or as part of Start, the UI calls cache-check for the chosen mode (and customer scope when applicable).
- [ ] When backups exist, the user can choose which entities to load from cache.
- [ ] Start payload includes `use_cached_import` only for the chosen entities.
- [ ] User can still Start with a full ERP fetch (empty / omitted flag).
- [ ] No translation file changes unless explicitly permitted; no new global theme/styles without approval.

## How to test

1. Open Admin → Account → Billing Integration for an account with a same-day incremental Invoice backup.
2. Start incremental — UI indicates Invoice has cached data and offers to use it.
3. Opt in for Invoice only and start — network/run behavior matches API replay (Invoice from cache).
4. Decline cache and start — run fetches from the ERP as before.
5. Confirm preview Start flow is unchanged (no cache suggestion).
