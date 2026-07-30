# Credit Insurance Jul 28+ Product Delta — Split Repo Port — PRD

Status: ready-for-agent

## Problem Statement

Credit insurance work after yesterday morning’s split-repo port still lands on
the monolith `credit-insurance` branch. Production development continues on
separate frontend and backend repositories with a Nest (backend API framework)
layer beside a Next.js UI.

Three product capabilities from the Jul 28 noon → today window are missing or
incomplete in the split repos:

1. **Billing connector dated backfill** — Admins need optional backfill start
   date, include-older-open-invoices, and skip-reporting-breach-on-backfill
   controls, with Priority (ERP) pull filters and sync semantics that match the
   monolith.
2. **Credit Portfolio Health charts and range cost** — Daily utilization /
   portfolio charts and Costs & Effectiveness period/monthly Policy cost math
   (including `portfolioRangeCost`) advanced on the monolith while the split
   dual copies of portfolio-health services stayed behind.
3. **Payment-triggered AR replay and deferred-payment import hardening** —
   Late payment imports and related post-ingest paths should run chronological
   AR (accounts receivable) replay and live overdue / MEP (Maximum Extension
   Period) / capacity refresh the same way invoice import already does, with
   past snapshot days still corrected by overnight as-of rewrite drain.

A blind git merge or cherry-pick fails because monolith paths do not match Nest
modules, the two git histories are unrelated after the Initial Commit split, and
Nest import payment leaves are still empty stubs (not a real import pipeline).

## Solution

Manually port only the **Jul 28 noon+ product delta** still missing from the
split repos—not the full `credit-insurance` history, not overnight as-of /
formula chaining already delivered by the Jul 22+ port, and not large
operator testing scripts.

Deliver as **one batch**: a single backend PR and a single frontend PR to
`master`, with backend merging first so Prisma (database schema) columns exist
before frontend generate and Nest settings use them.

Ownership matches today’s runtime:

- Frontend stays the **live** host for billing-connector sync/pull filters,
  payment import, AR post-ingest / replay, admin Billing UI, and Credit
  Portfolio Health UI.
- Backend owns Prisma schema and **idempotent** migrations for the three new
  billing-connector columns.
- Nest gets **billing-connector settings/reset field parity** and a **lockstep
  dual copy** of Credit Portfolio Health service math (including range cost).
- Nest **import payment / job-complete stubs stay stubs**; do not pretend Nest
  rewrite can run real payment import or AR replay in this port.

Copy the related monolith product PRDs and this split-port PRD into both
repos’ plan folders before or with the implementation PRs.

## User Stories

1. As an account admin, I want an optional billing-connector backfill start
   date, so that initial ERP pulls do not fetch unnecessary ancient history.
2. As an account admin, I want “include older open invoices” when a start
   date is set, so that open AR and credit capacity stay correct for invoices
   opened before the cutover day.
3. As an account admin, I want related payments for those older open invoices
   included, so that balances match the ERP.
4. As an account admin, I want to skip reporting-breach stamping during
   backfill when we do not import actual reporting dates, so that false breach
   flags are not created.
5. As an account admin, I want those three controls saved and reloaded on the
   Billing integration screen, so that operators can configure backfill without
   code changes.
6. As an account admin, I want Nest billing-connector get/upsert/reset to
   preserve the same three fields when API rewrite hits Nest, so that settings
   are not silently dropped.
7. As the billing sync, I want dated-backfill filters applied on the live
   frontend sync path, so that Priority pulls honor the admin controls.
8. As the billing sync, I want customers and contacts to still pull full
   history when a start date is set, so that master data is not truncated.
9. As the billing sync, I want deferred-payment chronological ingest order
   preserved when older open invoices are fetched first, so that AR replay
   stays correct.
10. As a credit analyst, I want Credit Portfolio Health daily utilization and
    portfolio charts to match the monolith behavior, so that trend views are
    trustworthy.
11. As a credit analyst, I want Costs & Effectiveness Policy cost for a date
    range to use method-aware range math (Actual Sales vs Limit), so that
    period totals answer the right cost question.
12. As a credit analyst, I want monthly policy cost bars to use the same range
    math, so that monthly views do not show last-day-only artifacts.
13. As a credit analyst, I want the old daily cost sparkline removed where the
    monolith removed it, so that the UI does not reinforce the wrong daily-burn
    model.
14. As a credit analyst on Nest-backed portfolio-health APIs, I want the same
    numbers as the frontend service copy, so that rewrite does not change
    charts or costs.
15. As a developer, I want frontend and Nest portfolio-health services kept in
    lockstep for this delta, so that dual-copy drift is not introduced by the
    port.
16. As an import operator, I want payment import job completion to trigger
    chronological AR replay for affected customers, so that live capacity and
    MEP refresh after late payments.
17. As an import operator, I want connector payment-only sync post-ingest to
    run the same AR replay path, so that connector payments do not leave live
    metrics stale.
18. As a collections user creating a backdated payment via UI/API on the live
    frontend path, I want the same replay + live refresh behavior, so that one
    payment create does not leave wrong open AR stamps.
19. As the system, I want past Customer Policy Trend and dashboard snapshot
    days to keep relying on overnight as-of rewrite drain, so that payment
    requests do not try to rewrite full history inline.
20. As a developer, I want Nest import payment and job-complete stubs left
    unchanged, so that this port does not expand into a Nest import cutover.
21. As a developer, I want real payment import AR replay implemented only on
    the frontend live path, so that behavior matches where imports actually
    run today.
22. As a platform owner, I want Nest API rewrite left off for real payment
    import until Nest owns import, so that empty Nest stubs cannot silently
    “succeed” with no row work.
23. As a database owner, I want Prisma updated with
    `backfill_start_date`, `include_older_open_invoices`, and
    `skip_reporting_breach_on_backfill`, so that both apps share one contract.
24. As a release engineer, I want migrations to add those columns only if
    missing, so that shared databases already migrated by the monolith do not
    fail deploys.
25. As a frontend developer, I want Prisma client regeneration from the backend
    schema after the backend merge, so that typed clients see the new fields.
26. As a QA engineer, I want monolith unit tests for dated backfill bounds,
    Priority filters, AR post-ingest, portfolio range cost, and portfolio
    health ported or adapted, so that regressions are caught before merge.
27. As a QA engineer, I want large monolith operator scripts under
    `scripts/testing` skipped in this port, so that the PR stays about product
    behavior.
28. As a product owner, I want the billing dated-backfill, payment-triggered AR
    replay, and portfolio-health range-cost PRDs copied into both repos, so
    that follow-on work has the same product context.
29. As a product owner, I want this split-port PRD in both repos, so that agents
    and reviewers share ownership and merge rules.
30. As a release engineer, I want one backend PR and one frontend PR for the
    whole window, so that review stays a single batch.
31. As a release engineer, I want the backend PR merged to `master` before the
    frontend PR merges, so that schema exists before FE generate and Nest
    settings use the columns.
32. As a release engineer, I want the frontend PR openable in parallel for
    review, so that FE review is not blocked on merge order.
33. As a developer, I want a manual port (not cherry-pick replay), so that
    Nest/frontend module layouts are respected.
34. As a developer, I want overnight as-of drain and formula chaining excluded
    from this port, so that already-delivered Jul 22+ work is not re-done.
35. As an account admin, I want account details changes that ship with this
    monolith delta (for example balance evaluation method persistence on the
    live accounts path) preserved where the split UI already edits them, so
    that admin saves keep working under Nest entities update.
36. As a localization user, I want English and Hebrew dashboard strings for new
    portfolio-health and costs copy updated, so that both locales stay usable.
37. As an on-call engineer, I want billing backfill reset and sync-runs
    endpoints to keep working after settings field additions, so that operators
    can recover stuck backfills.
38. As a credit manager, I want include-older-open default semantics to match
    the monolith PRD when a start date is set, so that operators are not
    surprised by missing open invoices.
39. As a developer, I want dual-copy sync debt for portfolio health documented,
    so that a later single owner can retire duplication.
40. As a platform owner, I want no new shared npm package for portfolio health
    or billing filters in this phase, so that delivery is not blocked on
    package publish.
41. As a QA engineer, I want a short manual smoke checklist for backfill
    settings, portfolio health costs/charts, and frontend payment AR replay, so
    that unit tests are complemented by one happy-path verify.
42. As a support engineer, I want live customer capacity/MEP after a late
    payment import to look correct without waiting for overnight drain, so that
    same-day support tickets drop.
43. As a credit analyst, I accept that historical CPT hollow days still wait
    for overnight as-of drain or admin full-history backfill, so that payment
    AR replay is not mistaken for history rewrite.
44. As a developer, I want Nest billing dated-backfill pull/filter engines left
    out of Nest this batch, so that sync ownership stays on frontend.
45. As a product owner, I want scope limited to monolith commits after the
    yesterday-morning port cutoff, so that unrelated Nest strangler progress is
    not overwritten.
46. As a release engineer, I want PRs targeted at `master` on both
    repositories, so that the split-repo default branch is the only integration
    line.
47. As a developer, I want connector AR post-ingest helpers ported on the
    frontend sync path, so that connector payment steps enqueue the same replay
    behavior as file import.
48. As a developer, I want ImportPayment and PaymentService live-path behavior
    updated together where the monolith did, so that UI create and import job
    paths stay consistent.
49. As a database owner, I want column defaults to match the monolith
    (`include_older_open_invoices` default true,
    `skip_reporting_breach_on_backfill` default false), so that existing rows
    behave safely after migration.
50. As an agent or developer, I want implementation to follow this PRD’s
    ownership map without re-opening Nest import cutover, so that the port
    finishes in one batch.

## Implementation Decisions

### Scope and method

- Port the product delta from monolith `credit-insurance` commits after the
  yesterday-morning split port (overnight as-of + formula already delivered):
  dated-backfill PRD + portfolio chart work; billing connector backfill admin
  controls; deferred payment / payment-triggered AR replay / portfolio range
  cost.
- Source SHAs (monolith): `d7e6120d3`, `5e02e36f1`, `ef5184f47`.
- **Manual feature port** into frontend and backend paths as new commits—no
  cherry-pick replay of monolith history.
- Ship as **one batch**: one backend PR + one frontend PR to `master`.
- **Merge gate:** backend merges first; frontend may open for review in
  parallel but merges only after backend is on `master`.
- Copy this split-port PRD and the related product PRDs into both repos’ plan
  folders.

### Ownership map

- **Frontend live:** Billing connector sync, Priority dated-backfill filters,
  backfill bounds, admin Billing integration UI, payment import / job complete
  hooks, AR post-ingest and AR replay services, PaymentService create path,
  Credit Portfolio Health UI and frontend portfolio-health service copy,
  locales.
- **Backend:** Prisma schema for the three billing-connector columns;
  idempotent SQL migrations (add column only if missing); Nest billing-connector
  get/upsert/reset (and related responses) field parity; Nest credit-insurance
  portfolio-health domain copy including range-cost helpers; Nest unit tests for
  those mirrors.
- **Nest import:** No behavioral change to payment / job-complete stubs in this
  port. Document that real payment import requires frontend (Nest rewrite off
  for that path) until a later Nest import cutover.

### Billing connector

- Add the three columns and wire admin controls with monolith semantics
  (start date in account timezone; include older open + related payments;
  skip reporting breach on backfill writes only).
- Nest exposes and persists the new settings fields; does **not** receive the
  full Priority filter/pull engine in this batch.
- Preserve deferred-payment chronological ingest constraints called out in the
  dated-backfill product PRD.

### Credit Portfolio Health

- Port chart/section UI changes and service math, including method-aware range
  cost and removal of the obsolete daily cost sparkline where the monolith did.
- Keep frontend and Nest portfolio-health implementations in lockstep for this
  delta (dual copy, no new shared package).

### Payment-triggered AR replay

- Port live-path behavior on frontend only: payment import completion,
  connector payment post-ingest, and payment create paths that the monolith
  updated.
- Keep past-day history correction on existing overnight as-of rewrite drain
  (already ported); do not inline full history rewrite inside payment requests.
- Update deferred-payment chronological import product notes if the monolith
  PRD changed executor/manual-import guidance.

### Delivery packaging

- Definition of done: ported/adapted unit tests green for the seams below +
  short manual smoke checklist + both plan folders updated with PRDs.
- Dual-copy sync debt for portfolio health remains accepted for this phase.

## Testing Decisions

### What makes a good test

- Assert **external behavior**: settings round-trip; dated-backfill filter
  inclusion/exclusion; backfill bounds; AR replay invoked for affected
  customers after payment ingest; portfolio range-cost totals; chart series
  shape/contract the UI relies on.
- Do not assert private helper names, Nest vs frontend file layout, or
  incidental log wording unless product-facing.
- Prefer the highest existing seam; reuse monolith unit-test boundaries adapted
  to split modules. Ideal number of new seams: **zero**.

### Chosen seams

1. **Billing connector settings + backfill bounds / dated filters
   (primary)** — Admin settings persistence and pull-filter/bounds behavior
   on the live frontend sync path; Nest get/upsert/reset asserts the three
   fields survive API rewrite. One product seam, two hosts only where Nest
   already owns settings routes.
2. **Credit Portfolio Health service + range cost (primary)** — Same service
   boundary as today’s dual copy: portfolio health payload and range-cost
   math. Run equivalent suites on frontend and Nest copies.
3. **Payment AR post-ingest / replay (frontend-only)** — Import job complete,
   connector payment post-ingest, and payment create hooks that trigger
   chronological replay + live overdue/MEP/capacity refresh—ported from
   monolith unit tests onto frontend services only.

### Modules under test

- Frontend: billing connector service/sync, Priority dated-backfill filters,
  backfill bounds, Billing integration UI behavior via service contracts where
  possible, ImportPayment / AR post-ingest / AR replay / PaymentService,
  credit portfolio health + range cost, related locales covered indirectly by
  UI smoke.
- Backend: Prisma migration applicability (idempotent add); Nest billing
  connector settings field parity; Nest portfolio-health / range-cost dual
  copy.

### Prior art

- Monolith unit tests for billing connector older-open pull, backfill bounds,
  Priority dated-backfill filters, BillingConnectorService, connector preview
  sync, AR post-ingest, import AR replay, ImportPayment, PaymentService create,
  portfolio range cost, credit portfolio health, accounts balance-evaluation
  API where still relevant to Nest entities update.
- Existing frontend billing connector and import payment unit tests; Nest
  accounts-nested billing-connector and credit-insurance domain tests—extend
  rather than invent a parallel style.

### Manual smoke

- Save and reload the three backfill admin controls; confirm Nest settings
  path returns them when rewrite is on.
- Run or dry-run a dated backfill configuration against a non-prod Priority
  fixture/account if available; confirm older-open inclusion semantics.
- Open Credit Portfolio Health Costs and utilization sections; confirm period
  Policy cost and charts align with expected method-aware behavior.
- Complete a frontend payment import (Nest rewrite **off** for import) with a
  backdated payment; confirm live capacity/MEP refresh path runs and as-of
  queue still handles past days overnight.

## Out of Scope

- Full `credit-insurance` branch history versus unrelated Nest strangler work.
- Re-port of overnight as-of rewrite drain reliability and report formula
  chaining (already delivered by the Jul 22+ split port).
- Nest payment-import cutover or replacing Nest import stubs with a real
  import pipeline.
- Porting the full Priority dated-backfill filter/pull engine into Nest.
- Large monolith operator scripts (`diff-import-order-kpis`,
  `run-123456-import-compare`, `run-asof-backfill`, and similar).
- New shared npm package for portfolio health, billing filters, or AR replay.
- Enabling Nest or worker as the live billing sync or CPT drain scheduler.
- Redesign of as-of open-AR ledger math, hollow-day fleet scanners, or admin
  full-history as-of backfill product.
- Frontend/backend monorepo reunification.
- Skills sync and other Cursor tooling-only commits.

## Further Notes

### Source commits (monolith `credit-insurance`)

- `d7e6120d3` — Billing connector dated backfill PRD + Credit Portfolio Health
  chart enhancements.
- `5e02e36f1` — Billing connector backfill admin controls, schema, Priority
  filters, sync services, tests.
- `ef5184f47` — Deferred payment PRD updates; payment-triggered AR replay PRD
  and live-path implementation; portfolio range cost; related UI/locales/tests.

### Related product PRDs to copy

- Billing connector dated backfill
- Payment-triggered AR replay
- Portfolio health range cost
- Deferred payment chronological import (updates from the same window)

### Discovery gates

1. **Shared DB already has the three billing columns from monolith**
   (informational, migration) — If yes: idempotent migration no-ops the
   ADD. If no: migration adds columns.
2. **Nest API rewrite enabled for billing-connector settings in env**
   (informational) — If yes: Nest settings parity smoke is mandatory. If
   no: FE settings smoke still required; Nest unit tests still required.
3. **Nest API rewrite enabled for `/api/import/*`** (blocking for real
   import smoke) — If yes: keep rewrite **off** for payment import until
   Nest import cutover. If no: FE import smoke is the live path.

### Dual-copy and cutover debt

- Portfolio health: FE and Nest copies must stay lockstep after this port;
  later single owner (package or Nest-only API) is outside this PRD.
- Billing dated-backfill pull engine: FE-only until an explicit Nest sync
  cutover.
- Payment import / AR replay: FE-only until Nest import is a real pipeline.

### Grill decision log (locked)

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Commit window | After yesterday-morning port; Jul 28 noon → today |
| D2 | Method | Manual port |
| D3 | Live ownership | FE live + Nest mirror on Nest surfaces; Prisma on BE |
| D4 | Packaging | One FE PR + one BE PR |
| D5 | Nest billing | Settings/reset field parity only |
| D7 | Nest import | Leave stubs; AR replay on FE only (D6 superseded) |
| D8 | Portfolio health | FE + Nest lockstep including range cost |
| D9 | Scripts | Skip large testing scripts; port unit tests |
| D10 | Migrations | Idempotent add-if-missing |
| D11 | Docs | Write this split-port PRD + copy product PRDs, then implement |
| D12 | Merge order | Backend first, then frontend |

## Issues (vertical slices)

Tracer-bullet breakdown published under
`.scratch/ci-jul28-plus-split-port/issues/`. Implement with a **fresh session
per issue**. Slices may run in parallel; land as one backend PR then one
frontend PR (`master`, BE first).

**Overview:** `.scratch/ci-jul28-plus-split-port/OVERVIEW.md`

1. **Billing dated backfill E2E** —
   `issues/01-billing-dated-backfill-e2e.md` — no blockers — stories 1–9,
   23–25, 28, 30–31, 33, 37–38, 41, 44, 46, 49
2. **Portfolio health + range cost dual-copy** —
   `issues/02-portfolio-health-range-cost-dual-copy.md` — no blockers —
   stories 10–15, 26, 28, 36, 39–41, 46
3. **Payment-triggered AR replay (FE live)** —
   `issues/03-payment-triggered-ar-replay-fe.md` — no blockers — stories
   16–22, 26–28, 42–43, 47–48, 50

Paths are relative to `.scratch/ci-jul28-plus-split-port/`.
