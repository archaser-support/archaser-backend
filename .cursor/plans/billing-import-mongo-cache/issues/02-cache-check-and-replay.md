# 02 — Cache-check + Start replay from Mongo

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** [01-mongo-cache-write](01-mongo-cache-write.md)
**User stories:** 6, 7, 8, 9, 12, 18, 19, 22, 24, 26
**PRD:** `.cursor/plans/billing-import-mongo-cache.prd.md`

## What to build

Expose GET cache-check for manual Start and extend Start sync so `use_cached_import: ImportType[]` loads those entities from Mongo (skip ERP pull) and still imports into Postgres. Entities not listed fetch from the ERP as today. Cron never reads cache. `clear_before_import` remains independent of cache. Missing cache for a requested entity fails clearly.

## Acceptance criteria

- [ ] GET cache-check for `mode=backfill|incremental` returns per-entity availability for the account’s same-day keys (respecting optional customer scope).
- [ ] Start with `use_cached_import: ["Invoice"]` skips ERP for Invoice and imports cached mapped rows into Postgres.
- [ ] Other enabled entities in the same run still pull from the ERP.
- [ ] Scheduled sync never uses `use_cached_import` / never auto-loads cache for pull.
- [ ] `clear_before_import` still purges Postgres when provided, whether or not cache is used.
- [ ] Requesting cache for an entity with no same-day backup returns a clear client error (no silent ERP fallback).

## How to test

1. Ensure today’s incremental Invoice backup exists (from slice 01).
2. Call GET cache-check with `mode=incremental` — Invoice shows available with row count; entities without backups do not.
3. Start incremental with `use_cached_import: ["Invoice"]` — confirm no ERP pull for Invoice and Postgres invoices update from cache.
4. Start again without the flag — confirm ERP fetch runs and Mongo same-day Invoice backup is replaced.
5. Start with `use_cached_import: ["Contact"]` when no Contact backup exists — expect a clear error.
6. Confirm a scheduled run still hits the ERP even when a same-day backup exists.
