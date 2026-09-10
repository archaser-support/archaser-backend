---
name: billing-import-mongo-cache
overview: Store filtered billing-connector import rows in Mongo for 6 months; keep every successful sync-run backup; on manual Start, pick any cache day in TTL then a run on that day, and choose which entities to replay from Mongo (ERP skip always available).
source: grill-me session + /start-work CU-869evkavc + 2026-09-07 multi-run grill + 2026-09-09 historical day grill
clickup_task_url: https://app.clickup.com/t/869evkavc
isProject: false
---

# Billing import Mongo cache (6-month reference)

## Problem Statement

Billing connector backfill and daily (incremental) sync pull entity data from the customer’s ERP (Enterprise Resource Planning) system every time. Raw and mapped pull rows are not kept as a durable reference — Mongo today only stores sync run summaries (`connector_sync_executions`, 90-day TTL). When an analyst re-runs Start the same day (or wants to re-import without hitting the ERP again), they need a durable backup of what entered import after filtering.

**Observed gap (v1 same-day replace):** a later successful backfill can import far more rows into Postgres while Mongo still offers an older, smaller same-day backup (e.g. Payment **296** in cache vs **10,965** imported later) when the cache write fails silently or overwrite semantics hide history. Analysts need to **see every successful run** and pick which backup to replay.

**Observed gap (multi-run “today only”):** Start cache-check only lists **today’s** runs (connector timezone). After a calendar day rolls over — common when re-running backfill with **delete-before-import** (`clear_before_import`) — yesterday’s Mongo backup is invisible even though TTL still holds it. Analysts need **prior-day** (within 6-month TTL) Mongo replay, not only “current date.”

## Solution

After each successful entity type in a backfill or incremental run (manual or scheduled), **append** a Mongo backup of the **mapped rows that entered import** (6-month TTL). Do **not** overwrite other successful runs the same day. Each backup is keyed by **`execution_id`** (required) plus account, entity, sync mode, calendar day, and customer scope.

On manual Start (backfill or incremental), `GET cache-check` returns **`days[]`** for every calendar day in TTL that has at least one selectable entity for this Start (mode + customer scope + enabled entities), plus **`runs[]` for the default day** (most recent day with a backup). The analyst **picks a day**, then **one run** on that day, then which entities to load (`use_cached_execution_id` + `use_cached_import`). Changing day refetches with `?cache_day=`. Unchecked entities / skip-cache still pull from the ERP. Replay **loads by `execution_id` only** (calendar day is for listing/UI). `clear_before_import` stays **independent** of cache. Scheduled cron always fetches from the ERP but still writes Mongo. Preview never writes this cache.

**Shipped:** v1 same-day replace → multi-run append + today’s run picker (slices 01–04) → historical day picker within TTL (slice `05-historical-cache-day-picker.md`).

## User Stories

1. As a credit/ops analyst, I want a Mongo backup after a successful Invoice incremental, so that I can re-import without calling the ERP again.
2. As an analyst, I want two successful Invoice runs on the same day to **both** remain available, so that I can choose morning or afternoon deliberately.
3. As an analyst, I want Payment and Invoice backups from the same run grouped together, so that I pick one sync run rather than mixing unrelated mornings/afternoons by accident.
4. As an analyst, I want backfill and incremental backups listed separately by mode, so that Start backfill does not offer incremental runs (and vice versa).
5. As an analyst, I want cache calendar days to follow the connector timezone, so that late-evening and early-morning runs use the correct local calendar day.
6. As an analyst, I want Start to list successful import backups from any day still in the 6-month TTL (not only today) before I fetch from the ERP, so that I can replay a previous state deliberately — including after delete-before-import on a later day.
7. As an analyst, I want to pick a run and still pass only some entities as cached, so that Invoice can come from Mongo while Payment still pulls fresh.
8. As an analyst, I want cached replay to still upsert into Postgres, so that choosing cache is not view-only.
9. As an analyst, I want `clear_before_import` to still purge Postgres when I use cache, so that purge and fetch-source stay independent.
10. As an analyst, I want customer-scoped backups not to appear in full-account Start (and vice versa), so that scopes cannot be mixed.
11. As an analyst, I want scheduled daily sync to populate Mongo, so that later Start can offer that run under its cache day within TTL.
12. As an analyst, I want scheduled sync never to auto-use cache, so that nightly jobs always refresh from the ERP.
13. As an analyst, I want preview runs excluded from this cache, so that dry validation does not create reusable import backups.
14. As an ops engineer, I want backups to expire after 6 months via Mongo TTL, so that reference storage does not grow unbounded (no extra same-day cap).
15. As a developer, I want both extension and legacy sync paths to write and read the same cache, so that connector setup does not fork behavior.
16. As a developer, I want the cache write to happen only after an entity type completes successfully for the **whole run**, so that mid-window partials do not publish a backup.
17. As a developer, I want stored rows to be mapped rows that enter import (after pull filters), excluding importer skips, so that replay matches what we intended to import.
18. As a QA engineer, I want cache-check to return TTL days with selectable entities and per-day runs with per-entity counts for the chosen mode and customer scope, so that the UI can render an accurate day + run picker.
19. As a QA engineer, I want a second same-day success to **add** a new run entry (not replace the first), so that history semantics are verifiable.
20. As a product owner, I want this separate from sync execution history, so that 90-day run audit TTL is unchanged.
21. As an analyst on a large Invoice backfill, I want chunked Mongo documents when payloads exceed 16MB, so that large accounts still get a usable backup.
22. As a developer, I want a single import-cache module seam for write/read/list-by-run, so that tests can assert append + replay without driving the full ERP.
23. As an admin, I want billing connector settings to include an IANA `time_zone` (default Asia/Jerusalem), so that cache_day listing follows the connector calendar.
24. As an analyst, I want cache suggestion only on manual Start, so that automated jobs stay predictable.
25. As a developer, I want cron and manual paths to share the same write helper, so that scheduled and manual backups use one code path.
26. As a QA engineer, I want replay to skip ERP network calls for selected entities on the selected run, so that we can prove cache use without ERP credentials in a controlled test harness.
27. As an analyst, I want Contact/Customer backups under the same rules as Invoice/Payment, so that all enabled billing entities are covered.
28. As an ops engineer, I want each backup document to record required `execution_id` and row count, so that we can audit which run produced the reference.
29. As a frontend user, I want Billing Integration Settings to show a day picker (only days with selectable backups), then that day’s runs (time + entity counts), preselect the most recent day and newest run, and let me check entities for that run — or skip cache for full ERP — so that I do not need raw API flags.
30. As a developer, I want preview mode and file-import paths left unchanged, so that this feature stays scoped to billing-connector live sync.
31. As an analyst, I want a run that only cached some entities to still appear, with checkboxes only for entities present on that run, so that I can replay Payment alone if Invoice was never backed up.
32. As an analyst, I want a successful zero-row entity backup to still be saved and shown, so that history stays honest.
33. As a developer, I want cache save failure after a successful Postgres import to **fail that entity and stop the run** (no later entities), so that Start never offers a stale “success” without a listable backup.
34. As an analyst, I want the first cache-check (no `cache_day`) to return `days[]` plus `runs[]` for the default (most recent) day, so that the dialog opens ready without an extra hop.
35. As an analyst, I want changing the selected day to reload that day’s runs, so that I never mix runs across days.
36. As an analyst, I want days that only have backups for disabled/unusable entities hidden from the day list, so that I do not open empty run lists.
37. As a developer, I want Start replay to load Mongo rows by `execution_id` (and mode/scope/entity) without requiring today’s `cache_day`, so that prior-day picks do not 404.

## Implementation Decisions

### Primary seam (testing and behavior)

Import-cache module: `saveEntityImportCache` (append per `execution_id`) / **load by `execution_id` + entity + mode + scope** (do not require “today’s” `cache_day` on read) / **list cache days within TTL** + **list runs for a `cache_day`**. Called from `stagedExtensionSync` and `runInProcessSync` after entity success; Start loads when `use_cached_execution_id` + `use_cached_import` are set.

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

- Scheduled sync: always ERP fetch; still writes Mongo after successful entities (each run is listable under its `cache_day` until TTL).
- Manual Start (backfill **and** incremental): may use cache when the analyst picks a day + run + entities, or skip for full ERP.
- Preview: never writes.

### API

- `GET …/billing-connector/sync/cache-check?mode=backfill|incremental` (+ optional customer scope):
  - Without `cache_day`: return **`days[]`** (calendar days in connector TZ within TTL that have ≥1 selectable entity for this Start) **newest first**, plus **`runs[]` for the default day** (most recent day in `days[]`).
  - With `?cache_day=YYYY-MM-DD`: return **`days[]`** (same list) and **`runs[]` for that day** only.
  - Each day entry: `cache_day`, optional `run_count` (or equivalent).
  - Each run: `execution_id`, `created_at` / display time (connector TZ), `sync_mode`, `customer_scope`, `cache_day`, `entities[]`: `{ import_type, row_count, available }`.
- Newest run first within the selected day (default selection).
- Incomplete runs included; entities without a backup on that run are `available: false`.
- Days with no selectable entities for enabled connector entities are omitted (server and/or UI; same outcome as story 36).
- Start body (unchanged flags):
  - `use_cached_execution_id: string` — required when any entity uses cache
  - `use_cached_import: ImportType[]` — only listed entities skip ERP; must exist on that execution
- Replay loads by **`execution_id`** (+ mode/scope/entity); **do not** resolve load key from “now” / today’s `cache_day`.
- Unchecked / omitted entities / skip-cache → ERP as today.
- Missing backup for a listed entity on that execution → clear error (no silent ERP fallback).

### clear_before_import

Independent of cache (O8). Purge Postgres as today; cache only replaces the ERP pull source. Delete toggles do **not** force, hide, or require Mongo.

### Document shape and retention

- Collection: `connector_import_entity_cache` (unchanged name).
- Chunk when over ~10MB / 16MB Mongo limit under the same logical key.
- TTL on `created_at` for **180 days**. **No same-day cap** — keep every successful run until TTL. List window = full TTL (not today-only).

### Connector paths

Both extension (`stagedExtensionSync`) and legacy (`runInProcessSync`) read/write the same helpers.

### Frontend

Billing Integration Settings Start flow:

1. Call cache-check for mode (+ customer scope) with no `cache_day`.
2. If `days[]` is empty: proceed with ERP (no dialog), same as no cache today.
3. If days exist: dialog shows **day picker** (only listed days) + **runs for selected day** (time + per-entity counts); **preselect most recent day** and **newest run** on that day; keep **skip / fetch all from ERP**.
4. Changing day → refetch cache-check with `?cache_day=` and reset run + entity checkboxes for that day.
5. Entity checkboxes only for entities available on the selected run; user may uncheck to force ERP.
6. Start sends `use_cached_execution_id` + `use_cached_import` for checked entities; omit both (or empty entities) for full ERP fetch.
7. Reuse existing dialog patterns; no new global styles without approval.

## Testing Decisions

**What makes a good test:** Prior-day run listable and replayable; default day = most recent with selectable entities; day change reloads runs; load by `execution_id` ignores “today”; empty TTL → ERP; skip-cache still works; two same-day successes both listable; mix cache/ERP within a run; missing entity on selected run errors; cron never reads cache; preview never writes; customer_scope isolation; timezone day boundary.

**Primary seam:** import-cache store list-days + list-runs-for-day; Start load by execution id without today’s day; UI day → run flow.

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
- Gating prior-day cache on `clear_before_import` (delete stays independent).
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
| S2 | cache-check | Per-entity “today’s one backup” | **`runs[]`** (then historical days) |
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
| D8 | List window | ~~Same calendar day only~~ → **superseded 2026-09-09 H1** | Was short picker; now full TTL |
| D9 | Default selection | Newest successful run **on selected day** | Still applies within a day |
| D10 | Incomplete runs | Show; checkboxes only for entities on that run | Flexible replay |
| D11 | Zero-row success | Still save and show | Honest history |
| D12 | Same-day volume | No cap until 6-month TTL | Simplicity |
| D13 | Sync run id | Required to save; fail entity if missing | Picker grouping |
| D14 | List row UI | Time + per-entity row counts | Distinguish 296 vs 10,965 |
| D15 | PRD update | Full PRD rewrite for multi-run | This document |

#### 2026-09-09 historical cache-day grill

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| H1 | Cache list window | Any day still in **6-month TTL** | Replaces multi-run D8 “today only” |
| H2 | Picker shape | **Day first** (only days with backups) → run on that day | Extends current run list |
| H3 | Default day | **Most recent day** with a backup | Then newest run (D9) |
| H4 | Replay load key | By **`execution_id` only** | Fix load that used “today” `cache_day` |
| H5 | Modes | Same prior-day rules for **backfill and incremental** Start | Still filter by mode |
| H6 | cache-check API | Light **`days[]`**; **`runs[]` for `?cache_day=`** | |
| H7 | Delete vs cache | Stay **independent** (O8) | Delete + historical Mongo can combine |
| H8 | Skip cache | Always allow **full ERP** | Dialog opens more often; must not force Mongo |
| H9 | First paint | Omit `cache_day` → **`days[]` + default day’s `runs[]`** | Day change uses `?cache_day=` |
| H10 | Day list contents | Only days with **≥1 selectable entity** for this Start | Mirror today’s run filter |

### Discovery gates

| Gate | If Yes | If No | Blocks |
|------|--------|-------|--------|
| Drop v1 unique index; unique on `(account_id, execution_id, import_type, chunk_index)` (+ list indexes) | Multi-run same day works | Second run cannot save | Schema / write path (done with 04) |
| Payload exceeds 16MB single doc | Keep/verify chunking under execution key | Spike | Large Payment/Invoice write |
| Invalid `BillingConnector.time_zone` | Reject on PUT; fall back to Asia/Jerusalem on read/cache day | Store valid IANA | Informational |
| Distinct `cache_day` list within TTL is fast enough (index/aggregate) | Ship `days[]` on cache-check | Spike query/index before UI | Slice 05 |
| Load-by-`execution_id` works with current unique key (no day required on read) | Change `loadImportCachesForReplay` | Revisit optional `cache_day` on Start despite H4 | Slice 05 replay |

### Codebase scan

**Required (slice 05 — historical day picker)**

- `packages/billing-connector/src/importCache/*` — list distinct `cache_day`s in TTL; list runs for a day; **load replay by `execution_id` without today’s day**.
- `billing-connector.service.ts` / controller — cache-check `days[]` + optional `cache_day`; default-day `runs[]`.
- Frontend `billingConnectorService` + `BillingIntegrationSettings` — day picker → run list; refetch on day change; keep ERP skip.
- Mongo list index for `(account_id, sync_mode, customer_scope, cache_day)` if missing for day aggregation.

**Already done (01–04)**

- Multi-run append by `execution_id`; fail-loud cache save; Start `use_cached_execution_id` + entity checkboxes; today-only list (to be extended).

**Optional / out of scope unless requested**

- Ops admin list/delete cache UI.
- Metrics for cache hit rate / save failures.
- Automated size-benchmark fixtures.

**No change needed**

- `connector_sync_executions` schema/TTL (stays run audit).
- Preview pipeline (excluded).
- Portfolio Health Generate paths (unrelated).
- `clear_before_import` purge semantics (stay independent).

## Issues (vertical slices)

Tracer-bullet breakdown under `.cursor/plans/billing-import-mongo-cache/`.

**Overview:** `.cursor/plans/billing-import-mongo-cache/OVERVIEW.md`

| # | Title | File | Status | Notes |
|---|-------|------|--------|-------|
| 1 | Mongo cache write + same-day replace | `issues/01-mongo-cache-write.md` | done (v1) | Superseded by multi-run; do not re-implement replace |
| 2 | Cache-check + Start replay from Mongo | `issues/02-cache-check-and-replay.md` | done (v1) | Extended by 04 |
| 3 | Billing UI cache suggestion on Start | `issues/03-frontend-cache-suggestion.md` | done (v1) | Extended by 04 |
| 4 | Multi-run history + Start run picker | `issues/04-multi-run-cache-picker.md` | done | Today-only list; superseded list window by 05 |
| 5 | Historical cache day picker (TTL) | `issues/05-historical-cache-day-picker.md` | done | Implements 2026-09-09 H1–H10 |

**Status:** all vertical slices **01–05** done.
