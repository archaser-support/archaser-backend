# 04 — Multi-run history + Start run picker

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 2, 3, 6, 7, 16, 18, 19, 28, 29, 31, 32, 33 (and revised 1–30 in PRD)
**PRD:** `.cursor/plans/billing-import-mongo-cache.prd.md`

## What to build

Revise v1 same-day **replace** so each successful entity backup is stored under a required **`execution_id`** and same-day runs **accumulate**. Change cache-check to return **today’s runs** (connector timezone) with time + per-entity row counts. Change Start to accept **`use_cached_execution_id` + `use_cached_import`**. Write Mongo **once** after the entity finishes all windows for the run; if save fails after Postgres import, **fail that entity and stop later entities**. Update Billing Integration Settings to a run list (newest preselected) + entity checkboxes for the selected run.

## Acceptance criteria

- [x] Second successful same-day run for the same entity/mode/scope **adds** a new backup; the first run’s backup remains.
- [x] Mongo unique key includes `execution_id` (v1 same-day unique index removed/replaced).
- [x] Cache write requires `execution_id`; missing id fails the entity step.
- [x] Cache write runs once after the entity fully completes the run (not after each date window).
- [x] Cache save failure fails the entity and stops the run (no later entities); not best-effort silence.
- [x] Zero-row successful entities still save and appear in cache-check.
- [x] GET cache-check returns `runs[]` for today only (mode + customer scope), newest first, with per-entity `row_count` / availability.
- [x] Incomplete runs appear; entities without a backup on that run are not selectable.
- [x] Start with `use_cached_execution_id` + `use_cached_import` loads only those entities from that run; others pull ERP.
- [x] Missing entity on the selected execution returns a clear error (no silent ERP fallback).
- [x] UI: run list shows time + per-entity counts; newest preselected; checkboxes only for entities on the selected run; uncheck = ERP; omit cache flags = full ERP.
- [x] Cron still never auto-reads cache; preview still never writes.

## How to test

1. Complete two manual backfills the same day for Payment + Invoice (different row counts). Confirm Mongo has **two** Payment backups with distinct `execution_id`s.
2. GET cache-check `mode=backfill` — list shows both runs with times and per-entity counts; newest first.
3. Start with newest `use_cached_execution_id` and `use_cached_import: ["Payment"]` only — Payment from cache, Invoice from ERP.
4. Start requesting Invoice cache on a run that only has Payment — clear error.
5. Simulate Mongo save failure after Payment import — run stops before Invoice; no silent success with stale cache.
6. UI Start: picker shows both runs; switching runs updates entity checkboxes; Continue sends execution id + selected entities.
7. Confirm scheduled sync still hits the ERP when today’s backups exist.

## Notes

Slices 01–03 delivered v1 (same-day replace + entity-only cache-check/UI). Treat this slice as the product revision from the 2026-09-07 grill; see PRD Decision log D2–D14 and superseded S1–S4.
