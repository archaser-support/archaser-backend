---
name: billing-connector-sync-schedule
overview: Enforce per-account ERP billing connector sync schedules via cron-eval due-checks, friendly UTC presets in admin UI, and server-computed next sync time.
source: grill-me session
clickup_task_url: https://app.clickup.com/t/869dwn2t8
isProject: false
---

# Billing connector sync schedule

## Problem Statement

When an Archaser admin configures the billing integration for an account, they set a sync schedule expecting automated ERP pulls to run at that cadence — for example every six hours or daily at a specific time. Today the admin UI exposes a raw cron expression and the platform stores it on the billing connector, but the global **Sync Billing Connectors** cron job ignores that setting and runs every enabled, active connector on each fifteen-minute platform tick.

Admins cannot reliably control when an account’s billing data is pulled. A connector configured for every six hours may sync every fifteen minutes, increasing ERP load and diverging from product expectations. The UI also lacks a friendly way to pick sync times and does not show when the next automated sync will occur. The ERP billing connector plan already specified per-connector schedule enforcement, but that behavior was never implemented end-to-end.

## Solution

Wire up per-account sync scheduling so the stored schedule actually governs automated runs:

1. **Due-check on each global tick** — Before starting a scheduled sync for an INCREMENTAL connector, evaluate whether a cron fire time has occurred since the last **scheduled successful** run. Skip connectors that are not yet due.

2. **Friendly schedule picker** — Replace the raw cron field with UTC-labeled presets (every 4 / 6 / 12 hours, daily at a time, weekly on a day and time). Store the equivalent cron expression server-side. Offer an optional **Advanced** section with raw cron for `archaser_admin` and for legacy custom expressions.

3. **Next sync visibility** — Return a server-computed **next scheduled sync (UTC)** and human-readable schedule summary on connector config GET so admins see when the next automated pull will happen.

4. **Backfill exception** — While a connector is in BACKFILL mode, ignore the cron schedule and continue running on every eligible global tick (within existing caps) so initial import is not artificially slowed.

5. **Transition and edge cases** — After backfill completes, run the first INCREMENTAL sync on the next global tick once (ignoring cron), then respect the schedule. If the platform missed a fire time, run once on the next tick as catch-up. When an admin changes the schedule, recalculate from save time and run immediately if due under the new cron.

Manual “Run sync now” does not reset or satisfy the automated schedule clock.

## User Stories

1. As an **archaser_admin**, I want to enable sync for a billing connector with a clear schedule preset, so that I do not need to write cron syntax to configure automated ERP pulls.

2. As an **archaser_admin**, I want the default sync schedule to be every six hours UTC, so that new connectors behave predictably without extra configuration.

3. As an **archaser_admin**, I want to choose “every 4 hours”, “every 6 hours”, or “every 12 hours” as sync frequency presets, so that I can match ERP polling to business needs without exceeding platform minimums.

4. As an **archaser_admin**, I want to schedule a **daily** sync at a specific time in UTC, so that incremental pulls happen at a predictable wall-clock moment.

5. As an **archaser_admin**, I want to schedule a **weekly** sync on a chosen weekday and UTC time, so that low-volume accounts can sync less frequently.

6. As an **archaser_admin**, I want all schedule times labeled as UTC in the UI, so that I understand exactly when syncs will fire regardless of my local timezone.

7. As an **archaser_admin**, I want to see a human-readable summary of the current schedule (e.g. “Every 6 hours UTC”), so that I can confirm settings without reading cron syntax.

8. As an **archaser_admin**, I want to see **Next scheduled sync (UTC)** on the billing integration settings page, so that I know when the next automated pull will run.

9. As an **archaser_admin**, I want the next sync time to update after I save schedule changes, so that the display reflects my new configuration immediately.

10. As an **archaser_admin**, I want changing the schedule to take effect from the save moment (and run soon if already due under the new cron), so that I do not wait an extra cycle on the old schedule after editing.

11. As an **archaser_admin**, I want an optional **Advanced** section to edit raw cron expressions, so that non-standard schedules remain possible for power users.

12. As an **archaser_admin**, I want connectors with legacy custom cron expressions to open the Advanced section pre-filled when I edit them, so that existing configurations are not lost or misrepresented.

13. As an **archaser_admin**, I want invalid cron expressions rejected on save with a clear error, so that I cannot save a broken schedule.

14. As an **archaser_admin**, I want schedules faster than thirty minutes apart rejected, so that ERP and platform load stay within agreed limits.

15. As an **archaser_admin**, I want initial **backfill** to run as fast as the platform allows (every eligible global tick within caps), regardless of the incremental cron schedule, so that onboarding is not delayed by a “every 6 hours” setting.

16. As an **archaser_admin**, I want incremental syncs after backfill completes to respect the configured schedule, so that steady-state polling matches my preset.

17. As an **archaser_admin**, I want the first incremental sync after backfill to run on the next global tick without waiting for the next cron slot, so that the account transitions promptly to scheduled maintenance.

18. As an **archaser_admin**, I want a manual “Run incremental sync now” to pull data immediately without changing when the next **scheduled** sync runs, so that ad-hoc catch-up does not disrupt the automated cadence.

19. As an **archaser_admin**, I want failed scheduled syncs not to push back the next attempt indefinitely, so that a transient ERP error does not permanently skip the schedule.

20. As an **archaser_admin**, I want only **successful** scheduled runs to advance the schedule clock, so that failed runs can retry on the next due tick.

21. As an **archaser_admin**, I want the platform to run **once** if a scheduled fire time was missed during downtime, so that accounts catch up without a backlog of duplicate runs.

22. As an **archaser_admin**, I want connectors with sync disabled to never run on the global scheduler, so that pausing sync is effective.

23. As an **archaser_admin**, I want connectors in **Error** status skipped by the scheduler, so that broken credentials do not hammer the ERP until fixed.

24. As an **system operator**, I want the global **Sync Billing Connectors** job to remain on a fifteen-minute tick, so that due-check granularity is sufficient without per-account cron jobs.

25. As a **platform engineer**, I want schedule due-check logic centralized in one module, so that the cron job, API next-run computation, and tests share one source of truth.

26. As a **platform engineer**, I want preset-to-cron mapping owned server-side, so that the client cannot submit inconsistent schedule representations.

27. As a **platform engineer**, I want GET connector config to include `schedule_summary`, `schedule_preset` (when mappable), and `next_scheduled_sync_at_utc`, so that the UI does not duplicate schedule math.

28. As a **platform engineer**, I want PUT connector config to accept either a preset payload or raw cron (Advanced), so that both UX paths persist to the same `sync_cron_expression` column.

29. As an **archaser_admin**, I want a warning (non-blocking) if my chosen schedule is more frequent than the ERP provider’s recommended poll interval, so that I can avoid rate-limit issues when that guidance exists.

30. As a **support engineer**, I want scheduled sync history in MongoDB to continue recording `trigger: scheduled`, so that I can distinguish automated runs from manual ones when debugging.

31. As an **account user**, I want `Account.last_sync_date` (App header) to continue reflecting only successful **scheduled incremental** syncs, so that the displayed “last synced” time remains meaningful for automated billing pulls.

32. As an **archaser_admin**, I want toggling sync enabled off to stop scheduled runs without deleting schedule configuration, so that I can pause and resume with the same preset.

33. As an **archaser_admin**, I want saving credentials or entity toggles without changing the schedule to leave the next sync time unchanged, so that unrelated edits do not reset the cadence.

34. As a **QA engineer**, I want automated tests that prove a connector with a six-hour cron is skipped when last scheduled success was two hours ago, so that regressions in due-check are caught in CI.

35. As a **QA engineer**, I want tests that prove BACKFILL connectors are always eligible on the global tick, so that the backfill exception cannot regress silently.

## Implementation Decisions

### and **BillingConnectorService** (config GET/PUT, validation, next-run and summary fields).

### Schedule module (single seam)

Introduce a dedicated **billing connector schedule** module as the **single source of truth** for:

- Preset catalog and preset ↔ cron conversion (UTC only).
- Whether a connector is **due** for a scheduled run on the current global tick.
- Computing **next scheduled sync at (UTC)** from cron expression and anchor timestamp.

All consumers call this module:

- Global cron job (due-check before `runSync`).
- Connector config GET (next run + summary).
- Connector config PUT (preset → cron before persist).

**Primary test seam:** pure functions in this module — no database or cron manager required for core behavior tests.

### Due-check algorithm

On each **Sync Billing Connectors** global tick, for each candidate connector (`sync_enabled = true`, `status = Active`, no non-stale `RUNNING` execution):

| Condition | Eligible for scheduled run? |
|-----------|---------------------------|
| `sync_mode = BACKFILL` | **Yes** — ignore cron (existing priority and caps unchanged) |
| Post-backfill one-shot flag | **Yes** — first INCREMENTAL after mode flip; consume flag |
| Missed cron fire since last scheduled SUCCESS | **Yes** — single catch-up run |
| Cron fire due since last scheduled SUCCESS | **Yes** |
| Schedule changed on save and new cron due from `modified_at` | **Yes** |
| Otherwise (INCREMENTAL) | **No** — skip this tick |

**Anchor for “last run”:** timestamp of the most recent **scheduled** sync execution with status **SUCCESS** (from MongoDB `ConnectorSyncExecution`). Manual, preview, and backfill triggers do not advance the schedule clock. Failed or partial scheduled runs do not advance the clock.

**Missed runs:** If one or more cron fire times occurred since the anchor and the connector was not synced, treat as due **once** on the next global tick (not one run per missed slot).

**Schedule change on PUT:** Recompute due-ness from connector `modified_at` when `sync_cron_expression` changes. If the new expression has a fire time at or before “now” relative to that save, the next eligible global tick may run the connector even if the old schedule would not have been due yet.

**Post-backfill transition:** When `sync_mode` flips from BACKFILL to INCREMENTAL (all enabled entities `backfill_completed`), set a one-shot eligibility flag (implementation choice: transient field on connector, in-memory for the completing run, or derived rule “first INCREMENTAL tick after flip”) so the **next** global tick runs INCREMENTAL regardless of cron, then normal schedule applies.

### Preset catalog (UTC)

| Preset | Stored cron (examples) |
|--------|------------------------|
| Every 4 hours | `0 */4 * * *` |
| Every 6 hours (default) | `0 */6 * * *` |
| Every 12 hours | `0 */12 * * *` |
| Daily at HH:mm UTC | `mm HH * * *` |
| Weekly on DOW at HH:mm UTC | `mm HH * * DOW` |

Minimum interval remains **thirty minutes** (existing `validateSyncCronExpression` using `cron-parser`). No sub-thirty-minute presets. Global platform tick stays **every fifteen minutes**; effective per-account minimum remains thirty minutes.

**Timezone:** All presets interpreted in **server UTC**. No `BillingConnector.timezone` column. UI labels must say “UTC” explicitly.

**Legacy / non-preset crons:** If stored expression does not match a preset, GET returns `schedule_preset: null` and UI opens **Advanced** with raw cron. Saving via Advanced still validates syntax and minimum interval.

### API contract extensions

**GET billing connector config** — add optional fields:

```typescript
schedule_preset: "every_4h" | "every_6h" | "every_12h" | "daily" | "weekly" | "custom" | null;
schedule_summary: string;           // e.g. "Every 6 hours UTC"
next_scheduled_sync_at_utc: string | null;  // ISO8601
daily_time_utc?: string;            // HH:mm — when preset is daily/weekly (round-trip for UI)
weekly_day?: number;                // 0–6 — when preset is weekly
```

**PUT billing connector config** — accept either:

- `schedule_preset` + optional `daily_time_utc` / `weekly_day`, **or**
- `sync_cron_expression` (Advanced / legacy)

Server converts presets to cron before save. Response includes updated summary and next sync time.

**Validation errors:** retain `400 INVALID_CRON_EXPRESSION` for invalid or sub-thirty-minute crons.

**Priority rate limit (informational):** if provider contract defines a recommended minimum poll interval and chosen schedule is more aggressive, return a warning in the response or a non-blocking UI alert — do not block save.

### Admin UI

Replace raw **Cron expression** field in **Sync schedule** section with:

1. Preset dropdown (standard set).
2. Conditional time picker (daily / weekly) — UTC labeled.
3. Conditional weekday selector (weekly).
4. Read-only **Next scheduled sync (UTC)** from GET.
5. Read-only or derived **schedule summary**.
6. Collapsible **Advanced** (raw cron) for admins; shown expanded when `schedule_preset` is null/custom.

Sync enabled toggle remains in the same section. Entity toggles unchanged.

**Permissions:** Advanced raw cron editable only by roles that can manage billing connector config today (`archaser_admin` pattern).

### Cron job changes

**Sync Billing Connectors** job flow:

1. Fetch enabled, active connectors (existing query, caps, ordering).
2. Run stale execution sweeper (existing).
3. For each connector, call schedule module **isDue**; skip if not due (INCREMENTAL only).
4. Call `BillingConnectorSyncService.runSync` with `trigger: scheduled`, `skipAntiSpam: true` (existing).

No change to global cron seed frequency (`*/15 * * * *`). No per-account cron jobs.

### Schema

**No migration required** for MVP: continue storing schedule as `BillingConnector.sync_cron_expression`. Optional future: `sync_schedule_modified_at` if `modified_at` conflates credential edits with schedule-only changes — **out of scope** unless save-time recalc proves ambiguous in implementation.

Post-backfill one-shot may use a nullable boolean on `BillingConnector` (e.g. `incremental_first_run_pending`) **only if** a derived rule without schema is unreliable — prefer derived rule first.

### MongoDB query

Add or use **ConnectorSyncExecutionService** method to fetch **last scheduled SUCCESS** `completed_at` for a connector (sort by `completed_at` desc, filter `trigger = scheduled`, `status = SUCCESS`). Used by due-check and next-run computation.

### Observability

Existing **stale incremental** metric (no scheduled SUCCESS in 24h) remains valid. No new metrics required for MVP.

## Testing Decisions

### What makes a good test

Test **observable scheduling behavior**, not internal call order:

- Given cron, sync mode, last scheduled success time, and flags → due or not due.
- Given preset inputs → correct cron string and back-conversion where applicable.
- Given cron + anchor → correct next UTC fire time.
- Cron job integration: connector skipped when not due; connector run when due; BACKFILL always processed.

Avoid testing `cron-parser` itself or MUI picker wiring in unit tests.

### Primary seam (recommended)

**Billing connector schedule module** — pure functions:

- `isConnectorDue(input)`
- `presetToCron(preset, options)`
- `cronToPreset(cron)` / `describeSchedule(cron)`
- `computeNextScheduledSyncAt(cron, lastScheduledSuccessAt, now)`

This is the **highest seam** that covers preset mapping, due-check, missed-run catch-up, schedule-change recalc, and next-run display. Cron job tests mock this module or prisma at the boundary; UI tests are manual / optional component tests.

### Modules tested

| Module | Test type |
|--------|-----------|
| Billing connector schedule module | Unit — exhaustive cases for due/skip, presets, next run |
| BillingConnectorService | Unit — PUT preset → cron, GET summary fields, validation |
| syncBillingConnectors cron job | Unit — due connector runs, not-due skipped, BACKFILL always runs |
| BillingConnectorService.validateSyncCronExpression | Unit — existing cases retained |

### Prior art

- `tests/unit/services/BillingConnectorService.test.ts` — cron validation.
- `ReportScheduleService.calculateNextRun` — next-run computation pattern (different domain, reference only).
- ERP billing connector plan Phase 5 — due-check intent.

### Representative test cases

1. INCREMENTAL, cron every 6h, last scheduled SUCCESS 2h ago → **not due**.
2. INCREMENTAL, cron every 6h, last scheduled SUCCESS 7h ago → **due**.
3. BACKFILL, any cron, any last success → **due** (every tick).
4. INCREMENTAL, missed 12h of 6h fires → **due once**, not three times.
5. INCREMENTAL, last scheduled run was manual SUCCESS only → treat as no anchor / use only scheduled SUCCESS.
6. INCREMENTAL, last scheduled FAILED → still due if cron fire passed since previous SUCCESS.
7. Post-backfill one-shot → due on next tick once, then cron governs.
8. Preset daily 03:00 UTC → cron `0 3 * * *`; next run computed correctly.
9. Legacy cron not matching preset → `schedule_preset: custom`, Advanced path.
10. PUT changes cron → next run recalculated from save time.

## Out of Scope

- Per-account timezone column or Account-level timezone for billing sync (UTC only).
- Sub-thirty-minute sync intervals or “every 15 minutes” preset.
- Changing global **Sync Billing Connectors** cron tick from fifteen minutes.
- i18n / translation file updates (requires separate approval).
- New Grafana dashboards or alerts specific to schedule skew.
- SAP Business One–specific schedule behavior (inherits same module).
- Denormalized `next_sync_at` column (cron-eval from expression + anchor unless implementation proves need).
- Automatic throttling of BACKFILL based on cron.
- Customer-facing schedule configuration (admin-only).

## Further Notes

### Relationship to ERP billing connector plan

This PRD implements **Phase 5** schedule enforcement and **Phase 2 / Phase 3** UI/API schedule UX left incomplete in the main ERP billing connector plan. It does not change entity sync, field mapping, backfill caps, or `last_sync_date` semantics beyond ensuring scheduled runs actually follow the configured cadence.

### Decision log (grill-me, locked)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Enforcement | Cron-eval each global tick vs last scheduled SUCCESS |
| D2 | UI | Friendly UTC presets → store cron server-side |
| D3 | Timezone | Server UTC only |
| D4 | Anchor | Last scheduled SUCCESS |
| D5 | Backfill | Ignore cron during BACKFILL |
| D6 | Missed runs | Run once on next tick |
| D7 | Presets | Every 4h / 6h / 12h, daily, weekly |
| D8 | Advanced | Optional collapse; legacy crons in Advanced |
| D9 | Min interval | 30 minutes |
| D10 | Schedule change | Recalculate from save time |
| D11 | Post-backfill | First INCREMENTAL on next tick, cron ignored once |
| D12 | Display | Server-computed next scheduled sync (UTC) on GET |

### Testing seam confirmation

The intended **single implementation seam** is the **billing connector schedule module** (pure schedule/due-check functions). The cron job and config API should delegate to it rather than duplicating cron math. Confirm this matches expectations before `/to-issues` breakdown.

### How to test (manual)

1. Open **Admin → Account Details → Billing integration** for an account with an active connector in INCREMENTAL mode.
2. Set schedule to **Every 6 hours UTC**; confirm summary and **Next scheduled sync (UTC)** display.
3. Trigger global **Sync Billing Connectors** cron (or wait for tick); verify connector **does not** run if last scheduled success was recent.
4. Advance time or use a connector whose last scheduled success is older than six hours; verify scheduled run fires.
5. Set connector to BACKFILL (or incomplete backfill); verify runs every eligible tick regardless of cron.
6. Complete backfill; verify first incremental on next tick, then schedule respected.
7. Change preset to **Daily at 03:00 UTC**; save; confirm next sync updates.
8. Expand **Advanced**; enter custom cron ≥30 min interval; save and reload.
9. Run **manual incremental sync**; confirm next scheduled sync time unchanged.
10. Disable sync; confirm no scheduled runs until re-enabled.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Billing connector sync schedule](https://app.clickup.com/t/869dwn2t8)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Billing sync schedule — enforce due-check & next-run API | [869dwn2uj](https://app.clickup.com/t/869dwn2uj) | — | 8–10, 15–24, 25, 27, 31–35, 18–21 |
| 2 | Billing sync schedule — UTC preset picker & Advanced cron UI | [869dwn2uz](https://app.clickup.com/t/869dwn2uz) | #1 | 1–7, 11–14, 26, 28–29, 32–33 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development

**Related:** [ERP Connector — Scheduled cron, last_sync_date & pilot observability](https://app.clickup.com/t/869dun9xz) (ERP MVP — observability/last_sync_date; due-check overlap)
