# Staging tip `7680e6b` — split-repo product port

Source: [`archaser-support/archaser`](https://github.com/archaser-support/archaser) `staging` @ `7680e6bcae953622ecee53c89bdb52c0422ae973`.
Skip skills/docs/debug SSH/proxy. Manual Nest/FE port (histories do not merge).

## Locked decisions

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Sync scope | Staging tip `7680e6b` only; missing product behavior | Ignore monorepo `main`-only commits |
| D2 | This-sync payload | All five remaining gaps | Registration fee, DCL date, Priority fields, Policy import, as-of backfill |
| D3 | Policy import | Real Nest Policy importer | NamedPolicy auto-create + exclusion clear + rest of staging policy-import the screen needs |
| D4 | As-of completeness | Full staging as-of on Nest | Admin card/job + enqueue from payment/policy/top-up/import; Nest cron remains the only drain |
| D5 | Translations | Copy staging EN/HE keys only | `settings.json` registration fee + `accounts.json` as_of_backfill |
| D6 | Tests | Nest unit/HTTP + FE unit where forms/types change | DCL, fee parse/save, Priority mapping, policy import rows, as-of enqueue/backfill |
| D7 | Backfill runner | Match staging in-process | HTTP returns immediately; Nest API `void launchRunner`; restart needs Resume |
| D8 | Billing Integration UI | Full staging UI | Lifecycle layout, live progress, per-entity Mapping/Preview, entity sets, cancel sync |
| D9 | Billing Connector API | Port all required routes to Nest | Config, mapping, preview, entity sets, cancel, sync history, and reset routes run against the split API |
| D10 | Admin sync runner | Match staging in-process Nest API | Manual preview/backfill/incremental HTTP call awaits the run; cancellation uses an in-process registry; UI polls state/history |

## Already present (do not re-port)

Formula chaining, credit-dashboard report enrichment, Jul 22 policy-general UI, Jul 28 dated-backfill/range-cost, Jul 30 KPI/CPT, credit-only roles, connector affected-customer IDs, as-of **drain** on Nest cron.

## Batches

1. Registration-fee schema + domain + policy UI/API + tests
2. DCL `active since` boundary in `api` + `reports` copies + date tests
3. Priority customer contract/catalog + import tests
4. Nest Policy import leaf (`ImportPolicyService`)
5. As-of enqueue at Nest write paths + backfill API + FE `AsOfBackfillCard`
6. Billing Connector Nest controller + missing service parity: config, connection test, mappings, field discovery, per-entity preview, entity-set catalog, sync execution/cancellation, history, and reset
7. Full Billing Integration UI: port `BackfillImportProgress`, lifecycle stepper, entity Mapping/Preview tabs, entity-set selectors, cancellation, and polling

## Discovery gates

| Gate | Kind | If Yes | If No |
|------|------|--------|-------|
| Monolith cron still drains the same `CreditAsOfRewriteQueue` in an environment | informational / ops | Do not enable dual drain; Nest cron is the sole drain (D4) | Nest cron drain is enough |
| Nest payment/policy/top-up write paths exist for enqueue | blocking batch 5 | Wire `enqueueAsOfRewrite` there | Enqueue only from import-complete and other live Nest writes |
| Split API deployment has more than one process | blocking batch 6 | In-process cancellation only reaches the process running the sync; use sticky routing or defer horizontal scaling | Match staging's single-process cancel behavior |

## Codebase scan (required)

- **Required:** Prisma + SQL migrations; `customerOutdatedDcl.ts` (api+reports); insurance policy create/update; trend snapshot writes; `packages/billing-connector` Priority contract; Billing Connector config/sync/mapping/cancel services and Nest controller; `api/src/import`; as-of queue helpers; FE Billing Integration, policy settings, and admin account details; locales EN/HE; tests under `tests/backend/api`, `packages/billing-connector/test`, and frontend unit.
- **Optional:** reports formula engine already lists `registration_fee_percent` as a read field.
- **No change:** skills, debug SSH/proxy, formula chaining, Jul 28/30 ports.

## Billing Integration port rules (D8–D10)

- Add `BillingConnector.entity_sets` (`JSONB`, default `{}`), `entity_set_catalog`, `entity_set_catalog_fetched_at`, and `preview_passes` (`JSONB`, default `{}`) with forward-only SQL migrations matching staging.
- Persist a passing preview per enabled entity. Clear the affected pass when its mapping, pull filter, or entity-set override changes. The UI requires every enabled entity to pass preview before first backfill; once backfill is locked or incremental mode is active, preserve staging's existing bypass.
- Manual backfill/incremental sync remains in the Nest API process and awaits completion. Add the cancellation registry and check it between pages/entities. It only works for the process running the sync; do not introduce a second worker or scheduler.
- Retain the existing scheduled connector cron. It uses the same domain service but is not cancellable through the manual-sync registry.
- Reuse staging's UI structure and existing account-card/theme primitives; do not add new global styles.
- Tests: Nest HTTP authorization/route contracts; connector unit tests for entity-set parsing, preview-pass invalidation, and cancellation; frontend unit tests for lifecycle gating/progress helpers; manual smoke for configure → map → preview → backfill → cancel → incremental.
