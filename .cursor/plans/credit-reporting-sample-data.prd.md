---
name: credit-reporting-sample-data
overview: Dev-only script that seeds a fixed credit-insurance account with six months of realistic, chronologically accurate sample data for a future credit reporting page.
source: grill-me session (D1–D44) + to-prd synthesis
clickup_task_url: null
isProject: false
---

# Credit reporting sample data generator

## Problem Statement

Developers need to build a new credit insurance reporting page with KPIs driven by invoices, payments, customers, policies, capacity gaps, terms breaches, top-ups, and time-series history. Production and typical dev databases lack enough realistic, varied credit-insurance data at meaningful volume — especially multi-currency exposure, top-up lifecycle states, capacity-gap scenarios, and **six months** of daily trend snapshots.

Without a repeatable way to generate that corpus, reporting UI work depends on manual setup, incomplete edge cases, and charts that do not reflect how production credit services aggregate data over time.

## Solution

Deliver a **single dev script** that provisions (or reuses) a fixed account (`credit-reporting-dev`), wipes only credit-scoped entities on each full run, and **rebuilds six months of sample data** using a **day-by-day chronological loop**:

1. Seed or upsert global FX rates for each day.
2. Onboard ~100 customers in the first 30 days; spread ~1,000 invoices and payments across 180 days.
3. Assign insurance policies, customer policies, and top-ups with balanced scenario variety.
4. After each day's events, run production credit services (gap sync, trend snapshots, dashboard snapshots) so historical rows reflect DB state as-of that day.
5. Support `--resume-from` checkpointing, progress/ETA logging, and safety guards (`NODE_ENV`, `--confirm`).
6. Print a post-run summary (login, entity counts, scenario breakdown).

The script does **not** define or implement the new reporting KPIs — it creates the underlying data substrate.

## User Stories

1. As a developer building the credit reporting page, I want a **one-command** way to populate a known account with six months of credit data, so that I can develop charts and KPIs without manual DB work.

2. As a developer, I want the sample account at a **stable subdomain** (`credit-reporting-dev`), so that I can bookmark the environment and log in consistently.

3. As a developer, I want a **dedicated admin user** with known credentials on first run, so that I can access the account immediately.

4. As a developer, I want **credit-scoped wipe** on regenerate (not full account delete), so that users, permissions, and system reports persist between runs.

5. As a developer, I want **`--confirm`** and a **non-production guard**, so that I cannot accidentally destroy data in production.

6. As a developer, I want **180 days** of history by default, so that half-year reporting views have full daily series.

7. As a developer, I want **`--days 90`** and **`--days 30`** fast modes, so that I can iterate without waiting for a full six-month generation.

8. As a developer, I want **`--resume-from YYYY-MM-DD`**, so that a interrupted full run can continue without restarting from day 1.

9. As a developer, I want **per-day progress and ETA** in the console, so that I know a long run is healthy.

10. As a developer, I want a **post-run summary** (entity counts, scenario buckets, cap utilization), so that I can verify the dataset before opening the UI.

11. As a developer building portfolio KPIs, I want **CustomerPolicyTrend** rows for every day × customer, so that customer- and portfolio-level trend charts work.

12. As a developer building portfolio KPIs, I want **CreditDashboardDailySnapshot** rows matching **full cron scope** (account, per-policy, per-business-unit), so that dashboard-style aggregates match production.

13. As a developer building policy charts, I want **InsurancePolicyTrend** rows daily, so that policy master rollups have history.

14. As a developer, I want **accurate historical snapshots** (not backfilled from today's AR), so that trend lines change over time realistically.

15. As a developer testing capacity gap KPIs, I want a **balanced scenario mix** (~70% compliant, ~15% gap, ~10% breach mix, ~5% excluded/zero-limit), so that each bucket has visible counts.

16. As a developer testing terms-breach KPIs, I want invoices that trigger **MEP, reporting, outdated DCL, and post-policy-end** flags, so that breach charts are populated.

17. As a developer testing multi-currency, I want an **ILS account** with **80% ILS / 20% USD** customers, so that FX conversion paths are exercised.

18. As a developer testing dual-currency headers, I want **~10% of customers** with open invoices in **both ILS and USD**, so that secondary currency buckets appear.

19. As a developer, I want **`approved_limit_currency`** to **match each customer's primary invoice currency**, so that usage % and gap math are not misleading.

20. As a developer, I want **USD→ILS CurrencyRate** rows for each day in the window (synthetic daily drift), so that gap sync does not flag `missingRate`.

21. As a developer testing top-up KPIs, I want **~20% of customers** with active top-ups, so that top-up cards and policy usage bars show data.

22. As a developer, I want a mix of **Fixed (70%) and Percentage (30%)** top-ups, so that both resolution paths are represented.

23. As a developer, I want **varied top-up windows** (~60% full half-year, ~25% expiring ≤30d, ~15% expiring ≤7d), so that expiring-soon alerts appear during the timeline.

24. As a developer, I want top-ups **staggered** on days 1, 30, 60, 90, 120, so that effective limits change mid-history.

25. As a developer testing top-up cap KPIs, I want **3 cap-buster customers** with large Fixed top-ups and a **500k ILS** TopUp `max_total_cover`, so that cover-declined / over-effective metrics can appear.

26. As a developer, I want **two business units** with a **70/30** customer split, so that BU-filtered reporting can be tested.

27. As a developer, I want a **credit-only account** (`has_credit_insurance` true, `has_collection` false), so that the dataset matches a credit-insurance product focus.

28. As a developer, I want **Primary and TopUp insurance policies** (TopUp child of Primary), so that `hasTopUpPolicies` gating is active.

29. As a developer, I want policy calendar dates spanning **window −30 through window +30 days**, so that post-policy-end scenarios are possible without invalid policy state.

30. As a developer, I want customers onboarded in the **first 30 days** only, so that portfolio growth stabilizes while invoice activity continues for 180 days.

31. As a developer, I want **Payment-Based** balance evaluation, so that payments are explicit `InvoicePayment` rows.

32. As a developer, I want **inline gap sync** for affected and gap-flagged customers each day (serial), so that capacity fields stay current without syncing all 100 customers daily.

33. As a developer, I want a **final full gap sync and customer amount recalc**, so that end-state KPIs are consistent.

34. As a developer, I want optional **`--dry-run`** that prints planned counts without writes, so that I can validate configuration quickly.

35. As a QA engineer, I want the generated data to be **deterministic given a fixed seed**, so that regressions in the script are detectable (stretch goal if feasible).

36. As a developer, I want the script to use **production credit services** for stamping, gap sync, and snapshots, so that sample data matches real aggregation behavior.

37. As a developer on the future reporting page, I want up to **180 daily snapshot rows** queryable from standard history APIs (up to 365-day cap), so that half-year charts do not require custom backfill.

38. As a developer, I want **no translation file changes**, so that i18n remains untouched by this tooling.

39. As a developer, I want the script to live alongside existing **stress-test / backfill scripts**, so that patterns are familiar to the team.

40. As a developer, I want **notification rule sets** seeded on first account create (optional stretch), so that credit alert configuration exists if the reporting page surfaces alert counts later.

## Implementation Decisions

### Account and identity

- **Fixed account**: subdomain `credit-reporting-dev`, display name "Credit Reporting Dev". Find-or-create on first run; lookup by subdomain on subsequent runs.
- **Products**: credit-only — `has_credit_insurance: true`, `has_collection: false`.
- **Currency**: account currency **ILS**.
- **Balance method**: **Payment-Based**.
- **Admin user**: create on first run (e.g. `credit-reporting@dev.local` with documented password); retain on credit-scoped wipe.
- **Business units**: **2** active BUs; **70/30** customer assignment split.

### Insurance policy bootstrap

- **Primary** policy: Active, ILS, spans **data window −30 to +30 UTC calendar days** (210-day span around 180-day history).
- **TopUp** policy: Active, child of Primary, ILS, same date span, `allow_concurrent_top_ups: true`, `max_total_cover: 500_000` ILS.
- On first account create: clone credit permissions/reports via existing account-creation flows; optionally seed default credit notification rule sets.

### Wipe semantics

- Require `NODE_ENV !== 'production'` **and** `--confirm` before destructive work.
- **Credit-scoped delete** in FK-safe order: trend/snapshot tables → invoice payments → invoices → customer top-ups → customer policies → customers (and related company/person records created by the script). Preserve account shell, users, BUs, permissions, reports.
- Skip wipe when resuming mid-window unless `--confirm` without `--resume-from` (full regenerate).

### History window

- **Default: 180 UTC calendar days** ending today (`windowStart = today − 179 days`).
- CLI `--days` overrides window length; presets: default **180**, fast **90**, smoke **30**.

### Customer and volume

- **~100 customers** onboarded over **days 1–30** (~3–4 per day).
- **~1,000 invoices** total spread across days 1–180 (~5–6 per day average).
- **~10 open invoices per customer** on average (configurable via CLI).
- **Scenario mix (balanced preset)**: ~70% compliant, ~15% capacity gap, ~10% terms breach variety, ~5% excluded/zero-limit.

### Currency model

- **80% ILS-primary customers, 20% USD-primary**.
- **~10% mixed-currency customers** (subset of ILS-primary only): open invoices in both ILS and USD.
- **`approved_limit_currency`** matches each customer's primary invoice currency.
- **Invoice amounts**: for non-ILS invoices, set `customer_outstanding_debt` in customer currency and `outstanding_debt` in ILS using that day's FX rate.
- **FX seeding**: upsert **USD base → ILS** `CurrencyRate` per day in window; synthetic drift from base **3.65** with **±0.5% per day**; upsert only days in window (do not wipe unrelated global rates).

### Top-up model

- **~20% of customers** (~20) receive exactly **one** `CustomerTopUp` row each.
- **Type mix**: 70% Fixed, 30% Percentage (Percentage rows have `currency: null`).
- **Amounts**: Fixed **25–40%** of `approved_limit`; Percentage **25–50%**; Fixed `currency` matches limit currency.
- **3 cap-buster customers**: large Fixed top-ups sized to push aggregate toward **500k ILS** cap.
- **Window mix**: ~60% span full half-year; ~25% expire within 30 days of some snapshot; ~15% expire within 7 days.
- **Stagger waves**: assign ~4 top-up customers per wave on days **1, 30, 60, 90, 120**.
- Top-up customer's active `CustomerPolicy` must reference the **Primary** policy that is the TopUp policy's parent.

### Chronological day loop (core algorithm)

For each UTC day `D` from `windowStart` to `windowEnd`:

1. Upsert `CurrencyRate` for `D`.
2. If `D ≤ day 30`: create scheduled customers (+ company/person, `CustomerPolicy`, BU assignment).
3. Insert that day's invoices, payments, and any top-ups scheduled for `D`.
4. Stamp insurance fields on new invoices **as-of `D`** (not wall-clock today).
5. Recalculate customer due/overdue amounts for **affected** customers.
6. Run **gap sync serially** for **affected customers ∪ customers with open capacity-gap invoices**, passing `rateDate: D`.
7. `syncCustomerPolicyTrendSnapshotForAccount(accountId, { snapshotDate: D })`.
8. `syncInsurancePolicyTrendSnapshotForAccount(accountId, { snapshotDate: D })`.
9. **Full cron mirror** dashboard snapshots for `D`: for each scope (account-wide, each active Primary/TopUp policy) × (null BU, each of 2 BUs) — compute summary and upsert `CreditDashboardDailySnapshot`.
10. Write checkpoint: `lastCompletedDay = D`.

After loop:

- Final full gap sync for all customers.
- Final `recalculateAllAmountsForCustomers` for all customers.
- Print summary.

### Data creation approach

- **Direct persistence** via Prisma and existing domain services (not CSV import pipeline).
- Reuse: invoice insurance stamping as-of date, credit gap pipeline, customer amount recalculation, trend snapshot services, dashboard summary + snapshot upsert logic.
- Reference patterns from golden import harness (credit prerequisites), stress-test account provisioning (tagging, user creation), and existing backfill scripts (gap sync orchestration).

### CLI surface

| Flag | Purpose |
|------|---------|
| `--confirm` | Required for wipe/write |
| `--days N` | Window length (default 180) |
| `--resume-from YYYY-MM-DD` | Continue from day after checkpoint |
| `--dry-run` | Print plan/counts only |
| `--customers N` | Override customer count (default 100) |
| `--invoices-per-customer N` | Override average open invoices |
| `--usd-customer-pct` | Override 20% USD split |

### Checkpoint file

- Persist under a well-known path in the repo or local cache (e.g. scripts testing checkpoints directory).
- Store: `accountId`, `subdomain`, `lastCompletedDay`, `windowStart`, `windowDays`.

### Performance expectations

- Full 180-day run with full cron mirror: **~30–70+ minutes** local dev.
- Fast 90-day: **~15–25 min**; smoke 30-day: **~5–10 min**.
- Gap sync **serial** (concurrency 1) per D32.

### Modules touched (new / extended)

| Area | Role |
|------|------|
| New script entrypoint | CLI parsing, guards, orchestration, checkpointing |
| Event scheduler (in-script or small helper) | Pre-compute customer/invoice/payment/top-up calendar |
| Account bootstrap | Find-or-create fixed account, policies, BUs, admin user |
| Credit-scoped wipe | Ordered deletes for sample entities |
| FX seeder | Daily USD→ILS upserts with drift |
| Existing credit insurance services | Stamping, gap pipeline, trend snapshots, dashboard summary |
| Existing customer amount services | Due/overdue recalc |

No Prisma schema changes required.

### Architectural constraints

- Do not call global cron entrypoints that process **all** accounts — always scope to the sample account and pass explicit `snapshotDate`.
- Do not modify translation files or add new UI.
- Do not run in production.

## Testing Decisions

### Test seam (locked)

**Primary seam: the script CLI (black box)** — invoke the script with environment guards and short windows; assert **exit code** and **post-run DB invariants**. No extracted scheduler module for v1.

Layers:

1. **Dry-run (no DB writes)**: `--dry-run --days 30` → exit 0; stdout contains planned entity counts matching configured presets.
2. **Smoke integration (optional CI / manual)**: `--confirm --days 7` against local dev DB → exit 0; query invariants below.
3. **Post-run assertion helper** (shell or small verify script): counts and bucket checks without importing script internals.

### What makes a good test

- Assert **observable outcomes**: row counts, scenario bucket tallies, absence of `missingRate` gaps, checkpoint file contents, exit codes.
- Do **not** assert internal call order of services unless testing a extracted pure scheduler.
- Prefer **smoke window (7–30 days)** over full 180-day runs in automated tests.

### Post-run invariants (smoke / manual)

- Account exists with `has_credit_insurance`, subdomain `credit-reporting-dev`.
- ~100 customers (or CLI override), all created within first 30 days of window.
- `CustomerPolicyTrend` row count ≈ `days × active customers` (order of magnitude).
- `CreditDashboardDailySnapshot` row count ≈ `days × ~9 scopes` (account + 2 policies × 3 BU scopes).
- `InsurancePolicyTrend` row count ≥ `days × 2 policies`.
- ~20 active top-ups on final day; ~10 customers with dual currency buckets.
- 0 customers with gap sync `missingRate` after final pass.
- 3 cap-buster customers; aggregate Fixed top-up cover approaches 500k ILS on at least one day.
- Admin user can authenticate (manual).

### Prior art

- Golden import harness: prerequisite validation, production API import, KPI comparison patterns.
- Stress-test setup: runId tagging, account/user provisioning, concurrency utilities.
- Backfill scripts: gap sync loop, dry-run flag, `tsx` entrypoint style.
- Unit tests under credit insurance: gap math, top-up resolution, policy lifecycle — for formula reference when debugging failures, not for seed script unit coverage.

### Out of scope for automated tests (v1)

- Full 180-day generation in CI.
- Performance benchmarking / SLA enforcement.
- Visual chart verification.

## Out of Scope

- **New reporting page UI** and **KPI definitions** (user will add later).
- CSV import-based generation path.
- Collection product workflows (`has_collection` data).
- Modifying translation files or theme/styles.
- Production execution or hosted environment seeding.
- ClickUp issues (use `/to-issues` separately).
- Notification rule seeding is **optional stretch** — not required for v1 unless needed for alert KPIs.
- Deterministic random seed (stretch goal only).
- EUR/GBP or currencies beyond ILS/USD.
- Chronological customer ramp over full 180 days (chosen: first 30 days only).
- Parallel gap sync (chosen: serial).
- Weekly snapshot cadence (chosen: daily full cron mirror).

## Further Notes

### Decision log reference (grill-me D1–D44)

Key locked decisions: fixed account wipe/regenerate; Prisma-direct generation; 180-day default window; day-by-day chronological loop; full cron snapshot mirror; ILS account with 80/20 USD customers; 10% dual-currency; top-up 20% with staggered waves and cap-busters; 2 BUs 70/30; progress + `--resume-from`; env safety guards.

### API history limits (informational)

Existing **portfolio trend** service caps chart queries at **90 days**; **dashboard summary history** supports up to **365 days**. The new reporting page should query snapshot tables or history APIs that accept `days ≤ 180`. Sample data will contain 180 rows regardless.

### Runtime UX

Print day index, date, entities inserted, gap sync count, snapshot scope count, rolling ETA. On interrupt, checkpoint enables `--resume-from` next day.

### Follow-up after implementation

1. Run smoke (`--days 30`) locally and verify invariants.
2. Run full 180-day overnight or with resume.
3. Log in as seeded admin → validate credit dashboard and future reporting routes.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Credit reporting sample data generator](https://app.clickup.com/t/869e28wdj)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | CLI, account bootstrap, credit-scoped wipe, dry-run | [869e28wha](https://app.clickup.com/t/869e28wha) | — | US 2–5, 27–29, 34, 39 |
| 2 | Event scheduler and 30-day customer onboarding | [869e28whp](https://app.clickup.com/t/869e28whp) | 1 | US 15–19, 26, 30 |
| 3 | Daily FX, invoices, payments, stamping, gap sync | [869e28wj2](https://app.clickup.com/t/869e28wj2) | 2 | US 17–19, 31–32, 36 |
| 4 | Top-up waves, cap-busters, window variety | [869e28wm8](https://app.clickup.com/t/869e28wm8) | 3 | US 21–25, 28 |
| 5 | Daily trend and dashboard snapshots (full cron mirror) | [869e28wmk](https://app.clickup.com/t/869e28wmk) | 4 | US 11–14, 12 |
| 6 | Full 180-day orchestration, resume, progress, final pass | [869e28wmz](https://app.clickup.com/t/869e28wmz) | 5 | US 6–10, 33, 37 |
| 7 | Smoke verify helper and CLI documentation | [869e28wng](https://app.clickup.com/t/869e28wng) | 6 | Testing seam |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development per `.cursorrules`
