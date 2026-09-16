---
name: billing-sync-mode-flip
overview: Promote billing connectors to INCREMENTAL after full-account backfill completes, repair stuck accounts, demote when new entities are enabled, and show sync mode in the billing integration UI.
source: grill-me session via /start-work
clickup_task_url: https://app.clickup.com/t/869f06np2
isProject: false
---

# Billing connector sync mode flip

## Problem Statement

After a full-account billing backfill finishes, admins still see **Start backfill** on the billing integration page and cannot run (or schedule) the daily incremental sync. Per-entity progress can show completed while the connector stays in **BACKFILL** mode. The product already has **Run incremental sync now** and the scheduled **Sync Billing Connectors** path, but both require `sync_mode = INCREMENTAL`. That mode flip was specified in the original ERP connector design and is missing (or not applied) in practice, so finished accounts look stuck in backfill and daily sync cannot be tested.

## Solution

1. **Promote after full-account backfill** — When every **enabled** entity has `backfill_completed`, set the connector to **INCREMENTAL**. Disabled entities (for example Contact on credit accounts) do not block promotion. Customer-scoped backfill runs never promote.
2. **Repair stuck accounts** — On billing connector config load and at the end of every sync, reconcile mode from enabled-entity completion so opening the page fixes accounts already stuck in BACKFILL.
3. **Demote when enabling a new entity** — If the connector is INCREMENTAL and the admin enables an additional entity, set mode back to BACKFILL until that entity’s full-account backfill completes.
4. **Show sync mode in the UI** — Display current mode (Backfill / Incremental) next to the progress primary actions and in the Schedule section (English and Hebrew).

After promotion, the existing **Run incremental sync now** button and scheduled daily/preset sync behave as already designed—no new manual-run API.

## User Stories

1. As an **archaser_admin**, I want the connector to switch to Incremental when full-account backfill finishes for all enabled entities, so that I can run and schedule daily sync.
2. As an **archaser_admin**, I want Contact (or any disabled entity) not to block Incremental on credit accounts, so that mode matches what we actually import.
3. As an **archaser_admin**, I want a single-customer Start not to flip the account to Incremental, so that partial scoped imports do not unlock daily sync for the whole account.
4. As an **archaser_admin**, I want opening the billing integration tab to repair a stuck BACKFILL connector whose enabled entities are already complete, so that I do not need a script or another backfill.
5. As an **archaser_admin**, I want mode reconciled at the end of every sync, so that promotion happens as soon as the last enabled entity finishes without waiting for a page reload.
6. As an **archaser_admin**, I want to see **Run incremental sync now** after promotion, so that I can manually test the same incremental path the daily schedule uses.
7. As an **archaser_admin**, I want scheduled sync to pick up the account after promotion (subject to existing due-check / first-tick rules), so that daily sync starts working without manual DB edits.
8. As an **archaser_admin**, I want enabling a new entity while Incremental to drop the connector back to Backfill, so that the new entity gets a full backfill before daily sync resumes.
9. As an **archaser_admin**, I want existing completed entities to keep their completion state when a new entity is enabled, so that I only backfill the new entity.
10. As an **archaser_admin**, I want to see sync mode next to the progress / primary action, so that the button and mode stay understandable together.
11. As an **archaser_admin**, I want to see sync mode in the Schedule section, so that schedule settings are clearly tied to Incremental vs Backfill behavior.
12. As an **archaser_admin**, I want mode labels in English and Hebrew, so that locale users get matching copy.
13. As an **archaser_admin**, I want Reset backfill to return the connector to Backfill (existing behavior), so that recovery flows stay consistent.
14. As an **archaser_admin**, I want viewers with `view_billing_connector` to see the mode label even if they cannot manage sync, so that status is visible without edit rights.
15. As an **archaser_admin**, I want never-started enabled entities to keep the connector in Backfill, so that incomplete onboarding never looks Incremental.
16. As an **operator**, I want no new cron job or ops-only endpoint for this fix, so that the existing config GET and sync paths remain the only entry points.

## Implementation Decisions

- Add a shared reconcile helper for connector sync mode: given enabled entities, per-entity sync states, current mode, and whether the completing run was customer-scoped, return the next mode (promote, demote, or unchanged).
- Promote only when **all enabled** entities have `backfill_completed = true` and the trigger context is not customer-scoped. Credit accounts without Contact in `enabled_entities` promote normally.
- Customer-scoped runs must never set mode to INCREMENTAL, even if entity rows look complete.
- Call reconcile at end of in-process sync (backfill and incremental) and on billing connector config GET (repair, similar spirit to existing `backfill_started_at` repair).
- On connector upsert/save when `enabled_entities` gains a type that is not complete, if mode is INCREMENTAL, demote to BACKFILL immediately.
- Do not invent a new “run daily sync” API; after flip, existing incremental Start and scheduled due path are sufficient.
- Frontend: surface `sync_mode` from existing config GET in (1) progress / primary-action area and (2) Schedule section, using clear Backfill / Incremental labels.
- **i18n:** any new user-facing strings ship with matching English and Hebrew locale keys in the same change.
- No schema migration expected if `BillingConnector.sync_mode` and `ConnectorSyncState.backfill_completed` already exist.
- Styling: reuse existing theme / MUI patterns; do not invent new visual styles without approval—prefer Typography/Chip patterns already used on the billing tab.

## Testing Decisions

- Prefer the highest seam: reconcile helper pure logic (promote / no-promote for customer scope / demote on new enabled entity / credit without Contact) and config GET / sync end effects that persist `sync_mode`.
- Good tests assert observable mode outcomes, not internal call order.
- Manual How to test: stuck account → open billing tab → mode Incremental + **Run incremental sync now**; enable new entity → Backfill; full-account finish → Incremental again; Hebrew spot-check for labels.
- Do not add or expand automated tests unless the user explicitly asks in an implementation session.

## Out of Scope

- New manual “run scheduled/daily sync” endpoint distinct from existing incremental Start.
- Changing customer-scoped backfill completion semantics beyond gating promotion.
- Grafana / alert changes, schedule preset redesign, import-cache day picker changes.
- Ops scripts as the primary fix (optional one-off is fine but not required if GET repair works).
- Disconnect / credential UX, or unrelated billing progress UI redesign.

## Further Notes

- Related prior art: ERP billing connector plan (mode flip when all enabled entities complete); billing connector sync schedule PRD (INCREMENTAL due-check; first tick after flip); existing UI `resolveBackfillActionStage` already shows **Run incremental sync now** when `syncMode === INCREMENTAL`.
- ClickUp: https://app.clickup.com/t/869f06np2
- Primary branch (backend): `feat/billing-sync-mode-flip-CU-869f06np2`

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/billing-sync-mode-flip/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/billing-sync-mode-flip/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Reconcile sync mode (promote, repair, demote) | `issues/01-reconcile-sync-mode.md` | — | 1–9, 15–16 |
| 2 | Show sync mode in progress and schedule UI | `issues/02-sync-mode-ui.md` | 01 | 10–12, 14 |

**Status:** `ready-for-agent` on all slices.
