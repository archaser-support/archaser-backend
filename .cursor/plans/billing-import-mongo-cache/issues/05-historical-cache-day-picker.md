# 05 — Historical cache day picker (TTL)

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 6, 18, 29, 34–37 (and H1–H10 in PRD)
**PRD:** `.cursor/plans/billing-import-mongo-cache.prd.md`

## What to build

Extend multi-run cache-check and Start so analysts can replay Mongo backups from **any calendar day still in the 6-month TTL**, not only today. Cache-check returns **`days[]`** (days with ≥1 selectable entity for this Start) plus **`runs[]` for the default (most recent) day**; `?cache_day=` returns that day’s runs. UI: **day first → run on that day**, preselect most recent day + newest run, keep **skip / full ERP**. Fix Start replay to **load by `execution_id` only** (stop resolving load `cache_day` from “now”). Same behavior for **backfill and incremental** Start. `clear_before_import` stays independent.

## Acceptance criteria

- [x] GET cache-check without `cache_day` returns `days[]` (newest first, TTL window, mode + customer scope) and `runs[]` for the most recent selectable day.
- [x] GET cache-check with `?cache_day=YYYY-MM-DD` returns the same `days[]` and `runs[]` for that day only.
- [x] Days with no selectable entity for this Start’s enabled entities are omitted from `days[]`.
- [x] Empty `days[]` → Start proceeds with ERP (no cache dialog), same as no cache today.
- [x] Start with a prior-day `use_cached_execution_id` loads Mongo rows successfully (load does **not** require today’s `cache_day`).
- [x] Missing entity on the selected execution still returns a clear error (no silent ERP fallback).
- [x] UI: day picker + run list; default day = most recent; default run = newest on that day; changing day refetches runs and resets entity checkboxes.
- [x] UI: skip / fetch all from ERP remains available whenever days exist.
- [x] Backfill and incremental Start both offer prior days (still filtered by mode).
- [x] Cron still never auto-reads cache; preview still never writes; delete-before-import unchanged and independent.

## How to test

1. Complete a backfill on day D that writes Payment + Invoice cache. On a later calendar day (or with connector TZ rolled past midnight), open Start backfill.
2. Cache dialog shows day D (and any other TTL days); default is the most recent day; runs for that day show times + counts.
3. Select day D, pick the run, check Payment only → Start with delete Payments optional. Payment imports from Mongo; Invoice from ERP if unchecked.
4. Skip cache → full ERP pull still works.
5. Start incremental with a prior-day incremental backup → same day/run picker (backfill runs not listed).
6. Request cache for an `execution_id` that exists only on a prior day — import succeeds (no “missing cache” caused by today’s day key).
7. Confirm scheduled sync still hits the ERP when historical backups exist.

## Notes

Implements 2026-09-09 grill **H1–H10**. Slice 04 remains the multi-run append + today-only picker baseline. Prefer extending `findSameDayCacheRuns` / `loadImportCachesForReplay` rather than a parallel cache module. If distinct-day listing is slow, spike the Mongo index/aggregate gate in the PRD before polishing UI.
