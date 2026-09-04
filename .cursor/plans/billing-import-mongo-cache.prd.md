---
name: billing-import-mongo-cache
overview: Store filtered billing-connector import rows in Mongo for 6 months so analysts can reuse a same-day backup on manual Start instead of re-fetching from the ERP.
source: grill-me session + /start-work CU-869evkavc
clickup_task_url: https://app.clickup.com/t/869evkavc
isProject: false
---

# Billing import Mongo cache (6-month reference)

## Problem Statement

Billing connector backfill and daily (incremental) sync pull entity data from the customer’s ERP (Enterprise Resource Planning) system every time. Raw and mapped pull rows are not kept as a durable reference — Mongo today only stores sync run summaries (`connector_sync_executions`, 90-day TTL). When an analyst re-runs Start the same day (or wants to re-import without hitting the ERP again), there is no backup to offer. Ops also lack a 6-month reference of what entered import after filtering.

## Solution

After each successful entity type in a backfill or incremental run (manual or scheduled), save the **mapped rows that entered import** into a new Mongo collection with a 6-month TTL. Same calendar day for the same account, entity, sync mode, and customer scope **replaces** the prior backup. On manual Start, a GET cache-check endpoint reports available same-day backups; the analyst can pass `use_cached_import: ImportType[]` so those entities skip the ERP pull, load from Mongo, and continue map → Postgres import as usual. Scheduled cron always fetches from the ERP but still writes Mongo. Preview never writes this cache.

## User Stories

1. As a credit/ops analyst, I want a same-day Mongo backup after a successful Invoice incremental, so that I can re-import without calling the ERP again.
2. As an analyst, I want two incremental Invoice runs on the same day to overwrite each other in Mongo, so that only the latest same-day backup is offered.
3. As an analyst, I want incremental Payment backups to stay separate from Invoice, so that one entity’s re-run does not wipe another.
4. As an analyst, I want backfill and incremental backups keyed separately, so that a backfill does not replace today’s incremental slot.
5. As an analyst, I want “same day” to follow the account timezone, so that late-evening and early-morning runs use the correct local calendar day.
6. As an analyst, I want Start to tell me when a backup exists before I fetch from the ERP, so that I can choose cache deliberately.
7. As an analyst, I want to pass `use_cached_import` for only some entities, so that Invoice can come from Mongo while Payment still pulls fresh.
8. As an analyst, I want cached replay to still upsert into Postgres, so that choosing cache is not view-only.
9. As an analyst, I want `clear_before_import` to still purge Postgres when I use cache, so that purge and fetch-source stay independent.
10. As an analyst, I want customer-scoped backfill backups not to collide with full-account backups, so that a one-customer run cannot overwrite the whole-account cache.
11. As an analyst, I want scheduled daily sync to populate Mongo, so that morning Start can offer last night’s incremental backup.
12. As an analyst, I want scheduled sync never to auto-use cache, so that nightly jobs always refresh from the ERP.
13. As an analyst, I want preview runs excluded from this cache, so that dry validation does not create reusable import backups.
14. As an ops engineer, I want backups to expire after 6 months via Mongo TTL, so that reference storage does not grow unbounded.
15. As a developer, I want both extension and legacy sync paths to write and read the same cache, so that connector setup does not fork behavior.
16. As a developer, I want the cache write to happen only after an entity type completes successfully, so that failed pulls do not publish a bad backup.
17. As a developer, I want stored rows to be mapped rows that enter import (after pull filters), excluding importer skips, so that replay matches what we intended to import.
18. As a QA engineer, I want cache-check to list per-entity availability for the chosen mode and customer scope, so that the UI can show accurate suggestions.
19. As a QA engineer, I want a second same-day run without `use_cached_import` to replace the Mongo document, so that override semantics are verifiable.
20. As a product owner, I want this separate from sync execution history, so that 90-day run audit TTL is unchanged.
21. As an analyst on a large Invoice backfill, I want the system to handle payloads that would exceed a single Mongo document limit, so that large accounts still get a usable backup (chunking or equivalent after size spike).
22. As a developer, I want a single import-cache module seam for write/read, so that tests can assert backup replace and replay without driving the full ERP.
23. As an admin, I want missing account timezone to fall back to `Asia/Jerusalem`, so that day keys remain defined.
24. As an analyst, I want cache suggestion only on manual Start, so that automated jobs stay predictable.
25. As a developer, I want cron and manual paths to share the same write helper, so that scheduled and manual backups use one code path.
26. As a QA engineer, I want replay to skip ERP network calls for selected entities, so that we can prove cache use without ERP credentials in a controlled test harness.
27. As an analyst, I want Contact/Customer backups under the same rules as Invoice/Payment, so that all enabled billing entities are covered.
28. As an ops engineer, I want each backup document to record `execution_id` and row count, so that we can audit which run produced the reference.
29. As a frontend user, I want Billing Integration Settings to call cache-check and offer use-cache per entity, so that I do not need raw API flags.
30. As a developer, I want preview mode and file-import paths left unchanged, so that this feature stays scoped to billing-connector live sync.

## Implementation Decisions

### Primary seam (testing and behavior)

The highest seam is a new **import cache** module beside existing sync history: `saveEntityImportCache` / `loadEntityImportCache` / `findSameDayCaches`, called from both `stagedExtensionSync` and the legacy loop in `runInProcessSync` after a successful entity, and from Start orchestration before pull when `use_cached_import` includes that entity. Prefer this over scattering Mongo writes inside `entityImporter`.

### Stored payload (D1 / D15)

- Store **mapped rows that enter import** after pull filters, date window / customer scope / partition drops, and field mapping.
- Do **not** store full ERP pages, Postgres snapshots, or rows the importer would skip (e.g. missing `customer_number`).
- On replay: load those rows and run the normal import path into Postgres (skip ERP pull only).

### Override key (D2 / D4 / D10)

Unique logical key per backup:

- `account_id`
- `import_type` (`Customer` | `Contact` | `Invoice` | `Payment`)
- `sync_mode` (`BACKFILL` | `INCREMENTAL`)
- `cache_day` — calendar date in the **account timezone** (`Account.time_zone`, default `Asia/Jerusalem` if null)
- `customer_scope` — customer number string, or sentinel `"all"` for full-account runs

Same-day second write for the same key **replaces** the document (and any chunks).

### Write timing (D5)

Write (or replace) only after that entity type **completes successfully** in the run. No mid-page streaming; no write if the entity fails.

### Cron vs manual (D8 / D9)

- Scheduled sync: always ERP fetch; still writes Mongo after successful entities.
- Manual Start: may use cache when confirmed.
- Preview: never writes this cache.

### API (D3 / D7 / D12 / D17)

- `GET …/billing-connector/sync/cache-check?mode=backfill|incremental` (+ optional customer scope) → per-entity availability, row counts, `cache_day`, timestamps.
- Start body: `use_cached_import: ImportType[]` — only listed entities skip ERP; others fetch normally.
- Invalid/missing cache for a listed entity → clear error (do not silently fall back unless product later asks).

### clear_before_import (D16)

Independent of cache. Purge Postgres as today; cache only replaces the ERP pull source.

### Document shape and retention (D13 / D14)

- New collection (e.g. `connector_import_entity_cache`), separate from `connector_sync_executions`.
- Preferred shape: one document per key with `rows` array, plus metadata (`row_count`, `execution_id`, `created_at`, `connector_id`, `provider`).
- Mongo TTL index on `created_at` for **180 days** (6 months).
- **Blocking discovery gate:** if filtered row payloads exceed Mongo’s 16MB document limit on large backfills, Phase 1 must switch to chunked documents under the same logical key (delete-all-then-write) before shipping large accounts.

### Connector paths (D18)

Both extension (`stagedExtensionSync`) and legacy (`runInProcessSync` without extension) read/write the same cache helpers.

### Frontend

Billing Integration Settings Start flow: call cache-check before/at Start; when backups exist, suggest using cached data per entity and send `use_cached_import` accordingly. No new global styles without approval — reuse existing confirmation/dialog patterns.

## Testing Decisions

**What makes a good test:** Assert observable outcomes — document replace on same key, cache-check payload, replay skips pull and still imports, cron never reads cache, preview never writes, customer_scope isolation, timezone day boundary.

**Primary seam:** import-cache store with injectable Mongo/memory backend; sync runner injection points that accept `loadPullRows` from cache vs ERP.

**Prior art:** `packages/billing-connector/src/syncHistory/*` (mongoose store + memory store), billing-connector sync tests under `tests/backend` if present, Start sync accept path in `billing-connector.service.ts`.

**Modules to test:**

- Day-key helper from account timezone + “now”.
- Same-key replace / load / find for cache-check.
- Replay branch: entities in `use_cached_import` do not call pull; others do.
- Write only after successful entity completion.

Do not require new automated tests in slices unless the user explicitly asks at implementation time.

## Out of Scope

- Changing authoritative Postgres entity storage or sync watermarks.
- Auto-using cache on scheduled/cron runs.
- Preview-run backups.
- File-import (`ImportJob` / `ImportRecord`) Mongo mirroring.
- Extending `connector_sync_executions` TTL or merging collections.
- Storing raw unfiltered ERP pages or post-Postgres snapshots.
- Parallel multi-account cache admin UI / purge tooling (beyond TTL).
- Translation file edits unless explicitly permitted.
- New global theme/styles without approval.

## Further Notes

### Decision log (grill)

| # | Topic | Decision |
|---|-------|----------|
| D1/D15 | Stored payload | Mapped rows entering import |
| D2 | Override key | account + entity + sync mode + day (+ customer scope) |
| D3 | Reuse UX | Pre-check + confirm flag |
| D4 | Calendar day | Account timezone |
| D5 | Write timing | After entity completes successfully |
| D6 | Replay | Skip ERP → import from Mongo to Postgres |
| D7 | Flag scope | Per entity type |
| D8 | Cron | Write-only; suggestion manual-only |
| D9 | Preview | Excluded |
| D10 | Customer scope | Separate key dimension |
| D12 | Pre-check API | Dedicated GET cache-check |
| D13 | Doc shape | One doc per key with `rows` (chunk if 16MB) |
| D14 | Retention | Mongo TTL 6 months |
| D16 | clear_before_import | Independent of cache |
| D17 | API shape | `use_cached_import: ImportType[]` |
| D18 | Paths | Extension + legacy |

### Discovery gates

| Gate | If Yes | If No | Blocks |
|------|--------|-------|--------|
| Payload exceeds 16MB single doc | Chunked docs under same key | Ship single-doc design | Large backfill write path |
| Account `time_zone` null | Fall back `Asia/Jerusalem` | Use IANA zone | Informational |

### Codebase scan

**Required**

- New import-cache module under billing-connector (model, store, day-key helper).
- `stagedExtensionSync` / `runInProcessSync` write + optional pull bypass.
- `billing-connector.service.ts` / controller: cache-check + Start body parsing.
- Frontend `billingConnectorService` + `BillingIntegrationSettings` Start UX.
- Account timezone read for day key.

**Optional / out of scope unless requested**

- Ops admin list/delete cache UI.
- Metrics dashboards for cache hit rate.
- Automated size-benchmark fixtures for 16MB.

**No change needed**

- `connector_sync_executions` schema/TTL (stays run audit).
- Preview pipeline (excluded by design).
- Portfolio Health Generate paths (unrelated).

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/billing-import-mongo-cache/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/billing-import-mongo-cache/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Mongo cache write + same-day replace | `issues/01-mongo-cache-write.md` | — | 1, 2, 3, 4, 5, 10, 11, 13, 14, 15, 16, 17, 20, 21, 23, 25, 27, 28 |
| 2 | Cache-check + Start replay from Mongo | `issues/02-cache-check-and-replay.md` | 01 | 6, 7, 8, 9, 12, 18, 19, 22, 24, 26 |
| 3 | Billing UI cache suggestion on Start | `issues/03-frontend-cache-suggestion.md` | 02 | 6, 7, 29, 30 |

**Status:** `ready-for-agent` on all slices.
