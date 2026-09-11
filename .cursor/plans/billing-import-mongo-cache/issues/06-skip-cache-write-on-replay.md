# 06 — Skip Mongo backup write on cache replay

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** (grill 2026-09-11 R1–R4)
**PRD:** `.cursor/plans/billing-import-mongo-cache.prd.md`

## What to build

When Start loads an entity from import backup (`use_cached_import` + `use_cached_execution_id`), do **not** append a new Mongo import-cache backup for that entity under the new `execution_id`. ERP-fetched entities in the same run still write as today. No frontend copy changes.

Apply on both legacy (`runInProcessSync`) and extension (`stagedExtensionSync`) paths. If Payment is loaded from cache, also skip writing a new PendingInvoiceClose companion under the new execution.

## Acceptance criteria

- [x] Entity loaded from cache does not call `saveEntityImportCacheOrThrow` (legacy + extension).
- [x] Payment loaded from cache does not write a new PendingInvoiceClose cache under the new `execution_id`.
- [x] Entity pulled from ERP still appends a Mongo backup after success (fail-loud save unchanged).
- [x] Mixed Start: new run lists only ERP entities in cache-check (incomplete run).
- [x] Full cache replay: no new import-cache documents for the new execution.
- [x] Replay import row failures do not create a partial re-backup (still skip write).
- [x] No Billing Integration Settings UI/copy changes for this behavior.
- [x] Preview still never writes; cron unchanged (never auto-reads cache).

## How to test

1. Pick a prior run with Invoice + Payment backups. Start with both checked (full cache replay). Confirm Postgres updates and Mongo has **no** new docs for the new `execution_id`.
2. Start again with Invoice from cache and Payment unchecked. Confirm new run has a Payment backup only (Invoice not listed on that run).
3. Start with skip-cache / full ERP — both entities get new backups as before.
4. Confirm scheduled sync still writes Mongo after ERP success.

## Notes

Implements grill **R1–R4** (2026-09-11). Keep original backup as the durable reference; do not re-publish mapped rows after replay.
