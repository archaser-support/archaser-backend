---
name: billing-import-mongo-cache
overview: Store filtered billing-connector import rows in Mongo for 6 months; keep every successful sync-run backup (no same-day overwrite); on manual Start, list today’s runs and let the analyst pick one run plus which entities to replay from cache.
source: grill-me session + /start-work CU-869evkavc + 2026-09-07 multi-run grill
clickup_task_url: https://app.clickup.com/t/869evkavc
isProject: false
---

# Billing import Mongo cache (6-month reference)

## Problem Statement

Billing connector backfill and daily (incremental) sync pull entity data from the customer’s ERP (Enterprise Resource Planning) system every time. Raw and mapped pull rows are not kept as a durable reference — Mongo today only stores sync run summaries (`connector_sync_executions`, 90-day TTL). When an analyst re-runs Start the same day (or wants to re-import without hitting the ERP again), they need a durable backup of what entered import after filtering.

**Observed gap (v1 same-day replace):** a later successful backfill can import far more rows into Postgres while Mongo still offers an older, smaller same-day backup (e.g. Payment **296** in cache vs **10,965** imported later) when the cache write fails silently or overwrite semantics hide history. Analysts need to **see every successful run** and pick which backup to replay.

## Solution

After each successful entity type in a backfill or incremental run (manual or scheduled), **append** a Mongo backup of the **mapped rows that entered import** (6-month TTL). Do **not** overwrite other successful runs the same day. Each backup is keyed by **`execution_id`** (required) plus account, entity, sync mode, calendar day, and customer scope.

On manual Start, `GET cache-check` returns **today’s successful runs** (connector timezone) with time and per-entity row counts. The analyst **picks one run**, then checks which entities to load from that run’s cache (`use_cached_execution_id` + `use_cached_import`). Unchecked entities still pull from the ERP. Scheduled cron always fetches from the ERP but still writes Mongo. Preview never writes this cache.

**v1 shipped:** same-day replace per entity/mode/scope + entity checkboxes. **This PRD revises v1** to multi-run history + run picker (see Decision log). Follow-up work: slice `04-multi-run-cache-picker.md`.

## User Stories

1. As a credit/ops analyst, I want a Mongo backup after a successful Invoice incremental, so that I can re-import without calling the ERP again.
2. As an analyst, I want two successful Invoice runs on the same day to **both** remain available, so that I can choose morning or afternoon deliberately.
3. As an analyst, I want Payment and Invoice backups from the same run grouped together, so that I pick one sync run rather than mixing unrelated mornings/afternoons by accident.
4. As an analyst, I want backfill and incremental backups listed separately by mode, so that Start backfill does not offer incremental runs (and vice versa).
5. As an analyst, I want “today” to follow the connector timezone, so that late-evening and early-morning runs use the correct local calendar day.
6. As an analyst, I want Start to list today’s successful import backups before I fetch from the ERP, so that I can choose cache deliberately.
7. As an analyst, I want to pick a run and still pass only some entities as cached, so that Invoice can come from Mongo while Payment still pulls fresh.
8. As an analyst, I want cached replay to still upsert into Postgres, so that choosing cache is not view-only.
9. As an analyst, I want `clear_before_import` to still purge Postgres when I use cache, so that purge and fetch-source stay independent.
10. As an analyst, I want customer-scoped backups not to appear in full-account Start (and vice versa), so that scopes cannot be mixed.
11. As an analyst, I want scheduled daily sync to populate Mongo, so that morning Start can offer last night’s incremental backup as a run in today’s list when the calendar day matches.
12. As an analyst, I want scheduled sync never to auto-use cache, so that nightly jobs always refresh from the ERP.
13. As an analyst, I want preview runs excluded from this cache, so that dry validation does not create reusable import backups.
14. As an ops engineer, I want backups to expire after 6 months via Mongo TTL, so that reference storage does not grow unbounded (no extra same-day cap).
15. As a developer, I want both extension and legacy sync paths to write and read the same cache, so that connector setup does not fork behavior.
16. As a developer, I want the cache write to happen only after an entity type completes successfully for the **whole run**, so that mid-window partials do not publish a backup.
17. As a developer, I want stored rows to be mapped rows that enter import (after pull filters), excluding importer skips, so that replay matches what we intended to import.
18. As a QA engineer, I want cache-check to return today’s runs with per-entity counts for the chosen mode and customer scope, so that the UI can render an accurate picker.
19. As a QA engineer, I want a second same-day success to **add** a new run entry (not replace the first), so that history semantics are verifiable.
20. As a product owner, I want this separate from sync execution history, so that 90-day run audit TTL is unchanged.
21. As an analyst on a large Invoice backfill, I want chunked Mongo documents when payloads exceed 16MB, so that large accounts still get a usable backup.
22. As a developer, I want a single import-cache module seam for write/read/list-by-run, so that tests can assert append + replay without driving the full ERP.
23. As an admin, I want billing connector settings to include an IANA `time_zone` (default Asia/Jerusalem), so that “today” listing follows the connector calendar.
24. As an analyst, I want cache suggestion only on manual Start, so that automated jobs stay predictable.
25. As a developer, I want cron and manual paths to share the same write helper, so that scheduled and manual backups use one code path.
26. As a QA engineer, I want replay to skip ERP network calls for selected entities on the selected run, so that we can prove cache use without ERP credentials in a controlled test harness.
27. As an analyst, I want Contact/Customer backups under the same rules as Invoice/Payment, so that all enabled billing entities are covered.
28. As an ops engineer, I want each backup document to record required `execution_id` and row count, so that we can audit which run produced the reference.
29. As a frontend user, I want Billing Integration Settings to show today’s runs (time + entity counts), preselect the newest, and let me check entities for that run, so that I do not need raw API flags.
30. As a developer, I want preview mode and file-import paths left unchanged, so that this feature stays scoped to billing-connector live sync.
31. As an analyst, I want a run that only cached some entities to still appear, with checkboxes only for entities present on that run, so that I can replay Payment alone if Invoice was never backed up.
32. As an analyst, I want a successful zero-row entity backup to still be saved and shown, so that history stays honest.
33. As a developer, I want cache save failure after a successful Postgres import to **fail that entity and stop the run** (no later entities), so that Start never offers a stale “success” without a listable backup.

## Implementation Decisions

### Primary seam (testing and behavior)

Import-cache module: `saveEntityImportCache` (append per `execution_id`, not same-day replace) / `loadEntityImportCache` (by execution + entity + mode + day + scope) / `findSameDayCaches` → **group by `execution_id`** for cache-check. Called from `stagedExtensionSync` and `runInProcessSync` after entity success; Start loads when `use_cached_execution_id` + `use_cached_import` are set.

### Stored payload

- Store **mapped rows that enter import** after pull filters, date window / customer scope / partition drops, and field mapping.
- Do **not** store full ERP pages, Postgres snapshots, or importer-skipped rows.
- On replay: load those rows and run the normal import path into Postgres (skip ERP pull only).
- Zero-row successful entities still write a backup (empty `rows`, `row_count: 0`).

### Logical key (multi-run)

Unique logical key per backup document (chunked under the same key):

- `account_id`
- `execution_id` (**required** — fail entity if missing)
- `import_type` (`Customer` | `Contact` | `Invoice` | `Payment`)
- `sync_mode` (`BACKFILL` | `INCREMENTAL`)
- `cache_day` — calendar date in **`BillingConnector.time_zone`** (IANA; default `Asia/Jerusalem`)
- `customer_scope` — customer number string, or `"all"`
- `chunk_index` (for chunking)

**Blocking:** drop v1 unique index on `(account, entity, mode, day, scope, chunk)` and unique on `(account, execution_id, entity, chunk)` (keep day/scope indexes for listing).

Same-day second successful run **appends** a new backup; it does **not** delete the prior run’s documents.

### Write timing and failure

- Write **once** after that entity type **fully finishes for the whole run** (all date windows). No mid-window Mongo publish.
- No write if the entity fails before completion.
- **`execution_id` required** — missing id → fail the entity step.
- If Postgres import succeeded but Mongo save fails → **fail that entity step and stop the run** (do not start later entities). Do not leave a silent best-effort miss.
- Preview: never writes.

### Cron vs manual

- Scheduled sync: always ERP fetch; still writes Mongo after successful entities (each run is a listable backup when its `cache_day` is “today”).
- Manual Start: may use cache when the analyst picks a run + entities.
- Preview: never writes.

### API

- `GET …/billing-connector/sync/cache-check?mode=backfill|incremental` (+ optional customer scope) → **`runs[]`** for **today** only:
  - `execution_id`, `created_at` / display time (connector TZ), `sync_mode`, `customer_scope`, `cache_day`
  - `entities[]`: `{ import_type, row_count, available }`
- Newest run first (default selection).
- Incomplete runs included; entities without a backup on that run are `available: false`.
- Start body:
  - `use_cached_execution_id: string` — required when any entity uses cache
  - `use_cached_import: ImportType[]` — only listed entities skip ERP; must exist on that execution
- Unchecked / omitted entities → ERP as today.
- Missing backup for a listed entity on that execution → clear error (no silent ERP fallback).

### clear_before_import

Independent of cache. Purge Postgres as today; cache only replaces the ERP pull source.

### Document shape and retention

- Collection: `connector_import_entity_cache` (unchanged name).
- Chunk when over ~10MB / 16MB Mongo limit under the same logical key.
- TTL on `created_at` for **180 days**. **No same-day cap** — keep every successful run until TTL.

### Connector paths

Both extension (`stagedExtensionSync`) and legacy (`runInProcessSync`) read/write the same helpers.

### Frontend

Billing Integration Settings Start flow:

1. Call cache-check for mode (+ customer scope).
2. If today’s runs exist: dialog lists runs as **time + per-entity row counts**; **preselect newest**.
3. Entity checkboxes only for entities available on the selected run; user may uncheck to force ERP.
4. Start sends `use_cached_execution_id` + `use_cached_import` for checked entities; omit both (or empty entities) for full ERP fetch.
5. Reuse existing dialog patterns; no new global styles without approval.

## Testing Decisions

**What makes a good test:** Two same-day successes both listable; newest preselected; mix cache/ERP within a run; incomplete run only offers present entities; missing entity on selected run errors; cache save failure fails entity and stops later entities; cron never reads cache; preview never writes; customer_scope isolation; timezone day boundary; `execution_id` required.

**Primary seam:** import-cache store with injectable Mongo/memory backend; sync runner write-once-per-entity; Start load by execution + entities.

Do not require new automated tests in slices unless the user explicitly asks at implementation time.

## Out of Scope

- Changing authoritative Postgres entity storage or sync watermarks.
- Auto-using cache on scheduled/cron runs.
- Preview-run backups.
- File-import (`ImportJob` / `ImportRecord`) Mongo mirroring.
- Extending `connector_sync_executions` TTL or merging collections.
- Storing raw unfiltered ERP pages or post-Postgres snapshots.
- Same-day overwrite / “keep larger row count” heuristics.
- Cap on number of same-day runs (TTL only).
- Parallel multi-account cache admin UI / purge tooling (beyond TTL).
- Translation file edits unless explicitly permitted.
- New global theme/styles without approval.

## Further Notes

### Decision log (grill)

#### Original (v1 — still relevant where not superseded)

| # | Topic | Decision |
|---|-------|----------|
| O1 | Stored payload | Mapped rows entering import |
| O2 | Calendar day | `BillingConnector.time_zone`, default `Asia/Jerusalem` |
| O3 | Replay | Skip ERP → import from Mongo to Postgres |
| O4 | Cron | Write-only; suggestion manual-only |
| O5 | Preview | Excluded |
| O6 | Customer scope | Separate key dimension / list filter |
| O7 | Retention | Mongo TTL 6 months |
| O8 | clear_before_import | Independent of cache |
| O9 | Paths | Extension + legacy |
| O10 | Chunking | Chunk under logical key when over Mongo size limit |

#### Superseded (v1 same-day replace)

| # | Topic | Old decision | Replaced by |
|---|-------|--------------|-------------|
| S1 | Override key | account + entity + mode + day + scope; same-day **replace** | Multi-run key + **append** |
| S2 | cache-check | Per-entity “today’s one backup” | **`runs[]`** for today |
| S3 | Start API | `use_cached_import` only | + **`use_cached_execution_id`** |
| S4 | Best-effort cache save | Log and continue | **Fail entity + stop run** |

#### 2026-09-07 multi-run grill

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Later run vs older backup | **Superseded** — keep every successful backup | List + picker |
| D2 | Import OK, cache write fails | Fail the entity step | No silent stale backup |
| D3 | Cache fail; later entities pending | Stop the run — do not start Invoice/Contact/… | Obvious failure |
| D4 | When to write Mongo | Once after entity fully finishes the whole run | No mid-window partial publish |
| D5 | Zero-row (reopened → D11) | See D11 | — |
| D6 | Selection unit | Pick one whole sync run | Bind Start to that run |
| D7 | Mix cache and ERP | Choose a run, then check/uncheck entities | Unchecked → ERP |
| D8 | List window | Same calendar day only (connector TZ) | Short picker; TTL still 6 months |
| D9 | Default selection | Newest successful run | Preselect latest |
| D10 | Incomplete runs | Show; checkboxes only for entities on that run | Flexible replay |
| D11 | Zero-row success | Still save and show | Honest history |
| D12 | Same-day volume | No cap until 6-month TTL | Simplicity |
| D13 | Sync run id | Required to save; fail entity if missing | Picker grouping |
| D14 | List row UI | Time + per-entity row counts | Distinguish 296 vs 10,965 |
| D15 | PRD update | Full PRD rewrite for multi-run | This document |

### Discovery gates

| Gate | If Yes | If No | Blocks |
|------|--------|-------|--------|
| Drop v1 unique index; unique on `(account_id, execution_id, import_type, chunk_index)` (+ list indexes) | Multi-run same day works | Second run cannot save | Schema / write path |
| Payload exceeds 16MB single doc | Keep/verify chunking under execution key | Spike | Large Payment/Invoice write (D2) |
| Invalid `BillingConnector.time_zone` | Reject on PUT; fall back to Asia/Jerusalem on read/cache day | Store valid IANA | Informational |

### Codebase scan

**Required**

- `packages/billing-connector/src/importCache/*` — stop same-day replace; key by `execution_id`; list/group by run; require `execution_id`; fail save loudly to callers.
- `stagedExtensionSync` — flush **once** after entity completes all windows; on cache save failure fail entity and abort later entities.
- `runInProcessSync` — same write/fail semantics.
- `billing-connector.service.ts` / controller — cache-check `runs[]`; Start parse `use_cached_execution_id` + `use_cached_import`.
- Frontend `billingConnectorService` + `BillingIntegrationSettings` — run list + entity checkboxes for selected run.
- Mongo index migration for multi-run uniqueness.

**Optional / out of scope unless requested**

- Ops admin list/delete cache UI.
- Metrics for cache hit rate / save failures.
- Automated size-benchmark fixtures.

**No change needed**

- `connector_sync_executions` schema/TTL (stays run audit).
- Preview pipeline (excluded).
- Portfolio Health Generate paths (unrelated).

## Issues (vertical slices)

Tracer-bullet breakdown under `.cursor/plans/billing-import-mongo-cache/`.

**Overview:** `.cursor/plans/billing-import-mongo-cache/OVERVIEW.md`

| # | Title | File | Status | Notes |
|---|-------|------|--------|-------|
| 1 | Mongo cache write + same-day replace | `issues/01-mongo-cache-write.md` | done (v1) | Superseded by multi-run; do not re-implement replace |
| 2 | Cache-check + Start replay from Mongo | `issues/02-cache-check-and-replay.md` | done (v1) | Extend via 04 |
| 3 | Billing UI cache suggestion on Start | `issues/03-frontend-cache-suggestion.md` | done (v1) | Extend via 04 |
| 4 | Multi-run history + Start run picker | `issues/04-multi-run-cache-picker.md` | ready-for-agent | Implements this PRD revision |

**Status:** slice **04** is the active follow-up; 01–03 remain historical v1.
