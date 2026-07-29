# Credit Insurance Jul 22+ Product Delta — Split Repo Port — PRD

Status: ready-for-agent

## Problem Statement

Credit insurance work after 22 July 2026 landed on the monolith
`credit-insurance` branch in archaser. Production development has moved to
separate frontend and backend repositories with a Nest (backend framework) API
beside a Next.js UI.

Two product capabilities from that Jul 22+ window are missing or incomplete in
the split repos:

1. **Report Builder formula chaining** — editors can define formulas that
   depend on other formula columns; execution order and edit-time validation
   must stay correct. Frontend has older formula support but lacks the chaining
   pieces. Nest report execute has no formula engine, so traffic that hits Nest
   would drop or mis-evaluate formulas.
2. **Overnight as-of rewrite drain reliability** — late invoices, payments,
   policy edits, and top-ups enqueue coalesced rewrite windows on
   `CreditAsOfRewriteQueue` so Customer Policy Trend (CPT) history can be
   corrected overnight. The hardened drain (checkpoint resume, reclaim stuck
   `processing` rows, fail the cron clearly, skip when admin backfill is
   active) exists on the monolith but not in the split layout. Frontend still
   owns live cron and the mutation services that should enqueue; backend owns
   Prisma (database schema) and a Nest copy of CPT snapshot logic without the
   queue.

A blind git merge or cherry-pick fails because monolith paths (`server/`, Pages
API) do not match Nest modules and the two git histories are unrelated after
the Initial Commit split.

## Solution

Manually port only the **Jul 22+ product delta** that is still missing—not the
full credit-insurance branch history, not skills/tooling, and not work already
identical in the split repos (policy general UI, recharts bump).

Deliver as **two parallel tracks** with separate PRs to `master` on each repo.

### Track 1 — Formula chaining

- Bring chaining, dependency ordering, and edit-time expression behavior into
  the frontend Report Builder and frontend report execution path.
- Copy the formula core into Nest reports and wire Nest report execute so
  chained formulas produce the same results as the frontend path.
- Accept dual copies for this phase (no new shared npm package).

### Track 2 — As-of rewrite drain reliability

- Add `CreditAsOfRewriteQueue` (including `checkpoint_date`) to backend Prisma;
  frontend regenerates its Prisma client from that schema.
- Port queue enqueue/drain helpers to frontend services; wire enqueue from
  Payment, Customer Top-Up, and Customer Policy mutations (where writes still
  live).
- Update the frontend Customer Policy Trend Daily Snapshot cron wrapper so
  drain always runs after today’s snapshot attempt (even if today fails),
  matching monolith reliability rules.
- Copy queue/drain into Nest credit-insurance domain and hook Nest’s CPT
  snapshot entry for later cron cutover—but **do not** schedule Nest drain in
  production while the frontend cron still drains the same queue.

Port the related unit tests from the monolith and copy the supporting PRDs into
both repos’ plan folders. Each track merges when its tests and smoke checklist
pass.

## User Stories

1. As a report editor, I want formula columns that reference other formula
   columns, so that I can build multi-step calculations without flattening
   everything into one expression.
2. As a report editor, I want the builder to validate chained formulas at edit
   time, so that I cannot save a cycle or an unresolved dependency.
3. As a report editor, I want dependent formulas evaluated in a stable order,
   so that results do not change between runs.
4. As a report reader, I want chained formula values in the on-screen report,
   so that I can trust interactive results.
5. As a report consumer, I want chained formula values in CSV, Excel, PDF, and
   scheduled output, so that exports match the viewer.
6. As a report reader on Nest-backed execute, I want the same chained formula
   results as on the frontend execute path, so that API rewrite does not
   silently change numbers.
7. As a finance user, I want invalid chained calculations to stay blank with
   warning summaries, so that bad rows do not look like zero.
8. As a platform owner, I want chained formulas to stay within existing formula
   safety limits (no `eval`), so that expression evaluation remains bounded.
9. As a developer, I want frontend and Nest formula copies to share the same
   algorithms for dependency order and evaluation, so that dual-copy drift is
   detectable in tests.
10. As a QA engineer, I want unit tests for chaining, dependency graphs, and
    execution order ported from the monolith, so that regressions are caught
    before merge.
11. As a credit analyst, I want late invoice and payment changes to enqueue an
    as-of rewrite window, so that historical CPT days can be corrected
    overnight.
12. As a credit manager, I want top-up create/update/cancel to enqueue rewrite
    from the relevant start date, so that cover history stays consistent.
13. As a credit manager, I want customer policy field changes that affect limits
    or cover to enqueue rewrite, so that utilization history reflects the
    corrected policy.
14. As the system, I want overlapping enqueue requests to coalesce on
    `CreditAsOfRewriteQueue`, so that bulk edits do not create job storms.
15. As the system, I want overnight drain to run even when today’s CPT
    snapshot write fails, so that historical corrections are not skipped
    because of a today-only error.
16. As the system, I want drain to resume from `checkpoint_date` after a crash
    or timeout, so that long windows can finish across nights.
17. As the system, I want stuck `processing` rows to be reclaimable, so that a
    killed worker does not block an account forever.
18. As the system, I want drain to skip accounts with an active admin as-of
    backfill, so that overnight work does not race full-history backfill.
19. As the system, I want drain failures to fail the CPT cron (or mark it
    unclean) when drain does not complete cleanly, so that ops can alert on
    real failures.
20. As an operations engineer, I want the live overnight path to be the
    frontend CPT cron until Nest cron cutover, so that production behavior
    matches where `ENABLE_CRON_JOBS` actually runs today.
21. As a developer, I want Nest credit-insurance domain to contain the same
    queue/drain logic ready for cutover, so that moving the cron later is a
    wiring change, not a rewrite.
22. As a developer, I want Prisma schema for the queue to live only on the
    backend, so that frontend and Nest share one database contract.
23. As a developer, I want frontend Prisma generate to pick up the new queue
    model from backend schema, so that enqueue code typechecks against the real
    table.
24. As an operations engineer, I want only one scheduled drain of the queue at
    a time, so that frontend and Nest do not double-process the same rows.
25. As a QA engineer, I want as-of queue and cron-wrapper unit tests ported
    from the monolith, so that reclaim, checkpoint, and failure rules stay
    locked.
26. As a product owner, I want formula and as-of delivered as separate PR
    tracks, so that one can ship without waiting on the other.
27. As a product owner, I want skills sync, recharts bumps, and already-ported
    policy general UI excluded, so that the port stays small and reviewable.
28. As a product owner, I want local monolith commits ahead of
    `origin/credit-insurance` (billing connector backfill) excluded, so that
    this port does not expand into unrelated work.
29. As an agent or developer, I want the overnight drain and formula PRDs
    copied into both repos, so that follow-on work has the same context.
30. As a release engineer, I want PRs targeted at `master` on frontend and
    backend, so that the split-repo default branch is the only integration
    line.
31. As a support engineer, I want Credit Portfolio Health and CPT period views
    to improve after overnight drain once enqueue is live, so that hollow or
    stale history starts correcting next morning for newly queued windows.
32. As a credit analyst, I accept that already-hollow history still needs the
    existing admin full-history as-of backfill per account, so that overnight
    drain is not mistaken for a fleet healer.
33. As a developer, I want Nest formula parity to include execute-path wiring,
    not only unused copied modules, so that Nest execute actually applies
    formulas.
34. As a QA engineer, I want a short manual smoke checklist per track, so that
    unit tests are complemented by one happy-path verify in a running
    environment.
35. As a platform owner, I want no new shared npm package for formulas in this
    phase, so that delivery is not blocked on package publish plumbing.
36. As a platform owner, I want worker peel of as-of drain out of this port, so
    that BullMQ cutover stays a separate migration.
37. As a developer, I want enqueue to remain on frontend mutation services
    until those APIs move to Nest, so that behavior matches where writes happen
    today.
38. As a developer, I want Nest domain drain code present but unscheduled until
    frontend CPT cron for this job is disabled, so that cutover is explicit.
39. As a product owner, I want this PRD to describe the port of existing
    monolith behavior, not redesign as-of open-AR math, so that scope stays the
    Jul 22+ reliability and chaining deltas.
40. As a release engineer, I want Track 1 (formula) FE and BE PRs reviewable as
    a pair, so that Nest and frontend do not diverge on chaining semantics at
    merge time.
41. As a release engineer, I want Track 2 (as-of) BE schema PR mergeable before
    or with FE enqueue/cron PRs, so that the table exists before enqueue
    writes.
42. As a database owner, I want migrations shaped for whether the queue table
    already exists in the shared DB (create vs add `checkpoint_date` only), so
    that staging and production apply cleanly.
43. As a credit analyst, I want English and Hebrew formula UI strings for any
    new chaining validation messages, so that both locales stay usable.
44. As a developer, I want prior-art tests in frontend report formula and
    credit-insurance cron suites reused as patterns, so that new tests match
    repo conventions.
45. As a developer, I want Nest reports tests for formula helpers and execute
    behavior, so that Nest parity is not smoke-only.
46. As an architect, I want dual-copy sync debt documented, so that a later
    shared package or single owner can retire duplication.
47. As an on-call engineer, I want CPT cron failure visibility when drain
    fails, so that overnight rewrite problems are not silent.
48. As a product owner, I want the full credit-insurance vs develop history
    left out of this port, so that Nest strangler progress already in the split
    repos is not overwritten by monolith paths.

## Implementation Decisions

### Scope and method

- Port **Jul 22+ product delta only** from `origin/credit-insurance` on the
  monolith: formula chaining commits and overnight as-of rewrite drain
  reliability commit (plus required schema/migration).
- **Manual feature port** into frontend and backend paths as new commits—no
  cherry-pick replay of monolith history.
- **Skip:** skills sync; recharts version bump (already aligned); policy
  general UI redesign (already present); local monolith commits ahead of origin
  (billing connector dated backfill); full CI branch vs develop.
- PR base branch: `master` on both repositories.
- Ship as **parallel tracks** with separate PR pairs; no cross-feature merge
  gate.
- Copy related plan/PRD markdown into both repos’ `.cursor/plans/` folders.

### Formula track — implementation

- Frontend remains the UI and edit-time source: shared report-formula modules,
  frontend report execution, formula editor components, locales, and tests.
- Nest reports receives a **copied** formula core (parser, validation,
  dependency ordering, edit-time helpers, execution helpers as needed) and
  wires them into Nest report execute so chained formulas apply on that path.
- No new publishable shared package in this phase; document dual-copy sync
  debt.
- Nest parity means execute behavior, not dormant unused files.
- Preserve existing formula safety rules (no dynamic JS evaluation; existing
  limits on count, length, depth).

### As-of track — implementation

- Backend Prisma is the single schema source of truth for
  `CreditAsOfRewriteQueue`, including `checkpoint_date` for
  resume-after-interrupt.
- Migration must be chosen against the discovery gate: full table create if
  missing in shared DB; additive column-only if table already exists without
  checkpoint.
- Frontend owns **enqueue** at Payment, Customer Top-Up, and Customer Policy
  mutation boundaries (current write owners).
- Frontend owns **live overnight drain** via the Customer Policy Trend Daily
  Snapshot cron wrapper (always attempt drain after today snapshot attempt;
  harden failure/reclaim/checkpoint/backfill-skip per monolith PRD behavior).
- Nest credit-insurance domain receives queue enqueue/drain helpers and a drain
  hook on its CPT snapshot entry for **future** cutover only.
- **Do not** enable a second scheduled drain on Nest/worker while frontend cron
  still drains the queue.
- Worker / BullMQ peel of this job is out of scope for this port.
- Admin full-history as-of backfill product remains as already specified in the
  as-of daily snapshot rewrite PRD; this port hardens overnight drain, it does
  not replace per-account hollow-history backfill.

### Delivery packaging

- Track 1: frontend PR + backend Nest reports PR (review as a semantic pair).
- Track 2: backend schema/domain PR + frontend enqueue/cron PR (schema before
  or with first enqueue write).
- Definition of done per track: ported monolith unit tests green + short manual
  smoke checklist.

## Testing Decisions

### What makes a good test

- Assert **external behavior**: evaluation order of chained formulas,
  blank/invalid handling, cron success/failure when drain fails, checkpoint
  resume, coalesce enqueue, skip-when-backfill-active.
- Do not assert private helper names, Nest vs frontend file layout, or
  incidental log wording unless product-facing.
- Prefer the highest existing seam; avoid new seams when a ported monolith test
  already targets the right boundary.

### Chosen seams

1. **Formula engine / report execution seam (primary for Track 1)** — Same
   boundary the monolith uses: formula dependency ordering +
   apply-formulas-to-rows (and grouped aggregation where already covered). Run
   equivalent suites on frontend report execution and Nest report execution
   helpers/execute path. One conceptual seam, two host adapters (FE and Nest)
   because of dual copy.
2. **As-of rewrite queue service seam (primary for Track 2)** — Enqueue
   coalesce + drain behavior (checkpoint, reclaim, backfill skip, failure
   counts), as in monolith credit-insurance queue tests.
3. **CPT cron wrapper seam (secondary for Track 2)** — Wrapper always attempts
   drain after today snapshot; today failure does not skip drain; unclean drain
   fails the job—matching monolith cron wrapper tests.

Ideal number of new seams: **zero**. Reuse monolith seams; only adapt imports
to split-repo modules.

### Modules under test

- Frontend: report formula shared modules, report formula execution, formula
  editor validation for chaining, as-of rewrite queue helpers, CPT cron
  wrapper, Payment / Top-Up / Customer Policy enqueue call sites (behavior via
  queue seam where possible).
- Backend: Nest formula copies + report execute wiring; Nest as-of queue domain
  helpers; Prisma model presence covered indirectly by queue tests against the
  client.

### Prior art

- Frontend unit tests under reports for formula execution and validation.
- Frontend cron wrapper rethrow tests and credit-insurance cron/service tests.
- Monolith as-of rewrite queue tests and updated CPT snapshot cron tests (port
  these).
- Nest API unit/http tests for reports execute patterns where they already
  exist; extend rather than invent a parallel style.

### Manual smoke (per track)

- Track 1: save a two-step chained formula; execute via frontend path and Nest
  execute path; confirm matching values and warnings.
- Track 2: enqueue via a top-up or policy edit; run CPT cron (or drain helper
  in a controlled env); confirm checkpoint/progress and no double-drain when
  only FE cron is enabled. Confirm shared DB migration applied.

## Out of Scope

- Full `credit-insurance` branch history vs `develop` / Nest strangler rewrite
  of unrelated domains.
- Skills sync and other Cursor tooling commits.
- Policy general UI redesign (already ported).
- Recharts dependency bump (already aligned).
- Local monolith commits not on `origin/credit-insurance` (billing connector
  dated backfill and related).
- New shared npm package for formula or as-of queue code.
- Moving Payment / Top-Up / Customer Policy mutations to Nest.
- Enabling Nest or worker as the live CPT cron / drain scheduler in this port.
- Redesign of as-of open-AR ledger math, admin full-history backfill UI, or
  hollow-day fleet scanners.
- Insurance policy trend as-of rewrite.
- Frontend/backend monorepo reunification.

## Further Notes

### Source commits (monolith `origin/credit-insurance`, product only)

- Formula: enhance report builder formula functionality/UI; formula chaining.
- As-of: overnight as-of rewrite drain reliability (schema `checkpoint_date`,
  queue drain, CPT cron wrapper, tests, PRD).

### Related existing PRDs

- Report Builder Formula Fields
- As-of Daily Snapshot Rewrite
- Overnight as-of rewrite drain reliability (copy from monolith into both repos
  as part of Track 2 docs)

### Discovery gates (ops / DB)

1. **CPT cron host (blocking, Track 2)** — If staging/prod still runs CPT on
   frontend: smoke via FE cron. If not: revisit scheduling before done.
2. **Nest report execute in env (informational, Track 1)** — If Nest
   execute is used: Nest smoke is mandatory. If not: FE smoke still required;
   Nest unit tests still required.
3. **Queue table shape (blocking, migration)** — If
   `CreditAsOfRewriteQueue` exists without `checkpoint_date`: additive column
   migration. If table is missing: full create-table migration.

### Dual-copy and cutover debt

- Formula: FE and Nest copies; plan a later single owner (package or Nest-only
  execute) outside this PRD.
- As-of: FE live drain + Nest ready copy; cutover = disable FE CPT cron for
  this job, enable Nest schedule once, never both.

## Issues (vertical slices)

Tracer-bullet breakdown under
`.scratch/ci-jul22-product-delta-split-port/issues/`.
Implement in dependency order; fresh session per issue.
Formula (#1–#2) and as-of (#3–#4) tracks may run in parallel.

| # | Title | Issue file | Blocked by |
| --- | --- | --- | --- |
| 1 | FE formula chaining | `01-frontend-formula-chaining.md` | — |
| 2 | Nest formula parity | `02-nest-formula-execute-parity.md` | #1 |
| 3 | As-of FE live loop | `03-asof-schema-enqueue-fe-drain.md` | — |
| 4 | Nest as-of ready | `04-nest-asof-domain-ready.md` | #3 |

User stories: #1 → 1–5, 7–8, 10, 43–44; #2 → 6, 9, 33–34, 40, 45;
#3 → 11–20, 22–23, 25, 31, 37, 41–42, 47; #4 → 21, 24, 29, 38.
