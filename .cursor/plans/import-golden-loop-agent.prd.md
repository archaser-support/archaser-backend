---
name: import-golden-loop-agent
overview: Repo harness + daily KPI timeline that imports golden invoice/payment files for customer 4567, compares 27-day AR KPIs to Expected results.xlsx, and loops with checkpoint restore until match or escalation.
source: grill-me session (Jul 2026)
clickup_task_url: null
isProject: false
---

# Import Golden Loop Agent

## Problem Statement

Implementation and QA teams need a repeatable way to validate deferred-payment and chronological AR import behavior against a known golden dataset. Today, verifying that import + replay produces correct daily Total AR, Term Breach, Capacity, Not insured, and Health Index requires manual file uploads, ad-hoc SQL or spreadsheet checks, and tedious cleanup between runs.

The golden scenario (customer **4567**, Jan 2026 invoices and payments, approved limit 10,000) is already encoded in unit tests for individual replay rules, but there is no end-to-end loop that:

1. Imports real payment and invoice files through production APIs
2. Compares persisted customer state against **Expected results.xlsx** for all 27 calendar days
3. Restores a customer checkpoint and retries after code fixes
4. Integrates with a Cursor `/loop` agent that wakes on failure, debugs application code, and re-runs (up to 10 iterations)

Without this harness, regressions in deferred payment ingest, invoice job replay, capacity-gap stamping, and terms-breach outstanding are easy to miss until manual QA.

## Solution

Deliver an **import golden loop** consisting of:

1. **Golden harness script** — CLI in the testing scripts area that authenticates against local dev, validates prerequisites, saves a customer checkpoint once, then loops: restore → preprocess files → import payments → import invoices (with job completion / replay) → compare → exit 0 or 1.

2. **File preprocessor** — Normalizes the attached Excel sources: maps `customer_id` to `customer_number` **4567**, remaps erroneous `5405` in the payments file to **4567**, fixes column misalignment, converts Excel serial dates to ISO strings, and applies catalog field aliases (`base_amount`, `invoice_amount`, `currency`).

3. **Daily KPI timeline module** — New server-side seam that, after import, reads persisted invoice and payment rows for the customer, walks chronological replay events day by day, and emits daily snapshots of Total AR, Term Breach, Capacity, Not insured (at-risk exposure), and Health Index using the same formulas as the customer credit-insurance dashboard.

4. **Comparator** — Loads Expected results.xlsx, diffs each day (2026-01-01 through 2026-01-27), prints the first mismatch with expected vs actual, and respects tolerance rules.

5. **Cursor loop integration** — Documented workflow: run harness; on non-zero exit, agent fixes **application code only** (import, replay, KPI logic), then re-invokes; escalate to human after 10 failures with diff report.

Golden fixture files should be copied into the repo under a dedicated fixtures directory for reproducibility (source copies may live in the developer Downloads folder during initial setup).

## User Stories

### Harness and workflow

1. As a developer fixing deferred-payment import, I want a single script that runs the full golden import and comparison, so that I get a pass/fail signal without manual UI steps.

2. As a developer, I want the script to authenticate via the existing test auth helper against `http://localhost:3000`, so that I reuse established stress-test patterns.

3. As a developer, I want the script to fail fast when prerequisites are missing, so that I know exactly how to prepare customer 4567 before running.

4. As a developer, I want the script to save a customer checkpoint on the first run and restore before every subsequent attempt, so that each retry starts from the same baseline without manual DB cleanup.

5. As a developer, I want imports to run payments first then invoices, so that the harness exercises the deferred-payment path.

6. As a developer, I want invoice import job completion to trigger chronological replay for affected customers, so that the harness matches production orchestration.

7. As a Cursor loop user, I want the harness to exit non-zero on mismatch, so that `/loop` wakes the agent only when something is wrong.

8. As a Cursor loop user, I want a maximum of 10 automatic retry cycles before human escalation, so that runaway loops do not burn time or produce noisy commits.

9. As a developer, I want a clear diff report on failure (date, column, expected, actual), so that debugging starts at the first diverging day.

10. As a developer, I want golden Excel files versioned in the repo fixtures directory, so that CI and other developers use the same inputs.

### File preprocessing

11. As a developer, I want the preprocessor to map invoice `customer_id` to import `customer_number` **4567**, so that the invoices file imports without manual column renaming.

12. As a developer, I want payment rows listing customer `5405` remapped to **4567**, so that a typo in the source payments file does not block the golden run.

13. As a developer, I want Excel serial dates converted to calendar dates, so that import APIs receive normalized date strings.

14. As a developer, I want misaligned columns in the source spreadsheets corrected during preprocess, so that invoice numbers and amounts land in the right fields.

15. As a developer, I want catalog aliases normalized (`amount base` → base amount, `invoice_amount` → customer amount, `invoice_currency` → currency), so that rows match `normalizeInvoiceImportInput` expectations.

### Daily KPI comparison

16. As a credit-insurance developer, I want all 27 daily rows in Expected results.xlsx compared, so that timeline regressions are caught—not only end-of-month totals.

17. As a credit-insurance developer, I want Total AR compared as open AR at end of each calendar day, so that payment timing is validated.

18. As a credit-insurance developer, I want Term Breach compared to terms-breach outstanding as of each day, so that breach exposure over time is validated.

19. As a credit-insurance developer, I want Capacity compared to sticky per-invoice capacity gap totals as of each day, so that limit-assessed stamping and gap rules are validated.

20. As a credit-insurance developer, I want Not insured compared to at-risk exposure (`min(totalAr, capacityGap + termsBreachForAtRisk)`), so that the Excel “Not insured” column matches product semantics.

21. As a credit-insurance developer, I want Health Index compared on a 0–1 scale with ±0.001 tolerance, so that floating-point drift does not false-fail while real formula bugs still fail.

22. As a credit-insurance developer, I want AR, Term Breach, Capacity, and Not insured compared as exact integers, so that monetary regressions are never silently rounded away.

23. As a developer, I want the daily timeline built from **persisted DB state** after API import, so that the harness validates the real import + replay path—not only in-memory simulation.

### Prerequisites and safety

24. As a developer, I want the script to verify customer **4567** exists and is reachable for the authenticated account, so that imports do not attach to the wrong tenant.

25. As a developer, I want the script to verify an active customer policy with **approved_limit = 10,000**, so that capacity-gap golden rows (e.g. gap 600 when AR = 10,600 on 2026-01-14) are meaningful.

26. As a developer, I want the script to verify credit insurance is enabled on the account, so that gap and breach KPIs are computed.

27. As a developer, I want the script to verify `enable_customer_checkpoints` on the account, so that save/restore APIs succeed.

28. As a developer, I want checkpoint save/restore to respect non-production gates, so that production data cannot be bulk-rewritten through this workflow.

29. As a developer, I want prerequisite failures to print setup instructions, so that I can fix account configuration without reading source code.

### Agent fix scope

30. As a tech lead, I want the loop agent limited to **application code** fixes (import services, replay engine, KPI formulas), so that harness tolerances and live DB seeding are not silently changed to force green builds.

31. As a developer, I want the agent to rerun the harness after each code fix, so that the loop closes only when the golden timeline passes.

### Coexistence with existing features

32. As a QA tester, I want checkpoint restore to leave import job history intact, so that I can still audit what each harness run did.

33. As a developer, I want the harness to reuse the existing import job runner patterns (batch upload, job create, job complete), so that behavior stays aligned with stress tests.

34. As a developer, I want the daily timeline module reusable outside the harness, so that unit tests can assert golden days without standing up HTTP.

## Implementation Decisions

### Locked product decisions (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Agent form | Repo script + Cursor `/loop` on non-zero exit |
| D2 | Comparison scope | Full 27-day timeline (2026-01-01 → 2026-01-27) |
| D3 | Source files | Harness preprocesses; target customer **4567**; remap payments `5405` → `4567` |
| D4 | Checkpoint workflow | Save baseline once; restore before every retry |
| D5 | Fix scope | Application code only |
| D6 | Import order | Payments first, then invoices |
| D7 | Loop bounds | Max 10 iterations, then escalate with diff report |
| D8 | Comparison engine | New daily KPI timeline module reading DB after E2E import |
| D9 | Runtime | Local dev; server already running; auth via env vars |
| D10 | Tolerance | Exact integers for AR / Term Breach / Capacity / Not insured; Health Index ±0.001 on 0–1 scale |
| D11 | Baseline setup | Validate prerequisites only; fail fast with instructions |
| D12 | Loop trigger | Re-run on harness failure only |

### Primary seam: daily KPI timeline

Introduce one module (working name: **customer daily KPI timeline**) that is the **single test seam** for golden comparison logic:

**Input**

- `accountId`, `customerId`
- `fromDate`, `toDate` (inclusive calendar range; golden run uses 2026-01-01 → 2026-01-27)
- Optional `approvedLimit` / `topUpTotal` overrides for pure tests; production path reads active `CustomerPolicy`

**Behavior**

- Load persisted `Invoice` and `InvoicePayment` rows for the customer
- Build chronological replay events (`invoice_open` on `invoice_date`, `payment_apply` on `payment_date`; same-day tie-break: invoice before payment)
- For each calendar day in range, compute end-of-day state:
  - **Total AR** — sum of open outstanding on open invoices after events through that day
  - **Term Breach** — terms-breach outstanding using breach flags and due/overdue rules **as of that day** (see discovery gate below)
  - **Capacity** — sum of sticky per-invoice capacity gap contributions given stamped `limit_assessed_amount` and outstanding as of that day
  - **Not insured** — `computeCustomerRiskExposure({ totalAr, capacityGapAmount, termsBreachOutstanding })`
  - **Health Index** — `(totalAr − atRiskExposure) / totalAr` on 0–1 scale; 1 when totalAr ≤ 0

**Output**

```typescript
type DailyKpiSnapshot = {
  date: string; // ISO date
  totalAr: number;
  termBreach: number;
  capacity: number;
  notInsured: number;
  healthIndex: number; // 0–1
};

type CustomerDailyKpiTimeline = {
  customerId: number;
  accountId: number;
  snapshots: DailyKpiSnapshot[];
};
```

This module should share event ordering and capacity-gap stamping with **import AR replay service** where possible; it extends simulation to emit **per-day KPI rows**, not only final invoice state.

### Secondary seam: golden harness (orchestration only)

Thin CLI script responsibilities:

1. Parse CLI args (fixture paths, customer number default `4567`, iteration label)
2. Authenticate session
3. Resolve customer id from customer number
4. Run prerequisite checks
5. On first iteration: POST checkpoint save
6. Each iteration: POST checkpoint restore → preprocess → payment import job → invoice import job → job complete with `affectedCustomerIds` → invoke daily KPI timeline → compare → exit code
7. Print diff on failure; exit 0 on full match

No business rules in the harness beyond orchestration and file normalization.

### File preprocessor

Pure function module:

- Input: raw rows from three workbooks (or paths)
- Output: normalized payment and invoice payloads ready for import job runner
- Responsibilities per D3 and user stories 11–15
- Golden fixtures checked into repo; CLI accepts overrides for local Downloads paths during bootstrap

### Comparator

Pure function module:

- Input: expected rows from Expected results.xlsx (Date, Total AR, Term Breach, Capacity, Not insured, Health Index)
- Input: `CustomerDailyKpiTimeline`
- Output: `{ match: boolean, firstMismatch?: { date, column, expected, actual } }`
- Map Excel serial dates to ISO dates for row alignment
- Apply D10 tolerance

### Import orchestration

- Reuse existing import job create → batch POST → job complete flow
- Payment import first (deferred rows when invoice missing)
- Invoice import second; **job complete** must pass `affectedCustomerIds` including customer 4567 so `replayArImportForCustomers` runs (invoice job completion path)
- Do not call replay separately unless job complete path is bypassed in tests

### Checkpoint integration

- Save once per harness session (first iteration)
- Restore at start of every iteration including the first import attempt after save (iteration 1: save then import; iteration 2+: restore then import)
- APIs: checkpoint save, restore, status — gated by account flag and non-production environment
- Harness uses authenticated HTTP same as UI; no direct service import required for checkpoint

### Column mapping reference (Expected results ↔ product)

| Excel column | KPI field |
|--------------|-----------|
| Total AR | Open AR end of day |
| Term Breach | Terms-breach outstanding |
| Capacity | Capacity gap amount |
| Not insured | At-risk exposure |
| Helth Index | Health index (0–1); app internally may use 0–100 — normalize before compare |

### Golden dataset parameters

- Customer number: **4567**
- Approved limit: **10,000** (validates capacity gap 600 when AR = 10,600 on 2026-01-14)
- 24 invoices, 12 payments; invoice numbers 5584561–5584585
- Date range: 2026-01-01 through 2026-01-27
- Aligns with existing grill-me replay unit scenarios (invoice 5584561, Jan 2026)

### Cursor loop contract

- Developer runs harness (or `/loop` invokes it)
- Exit 0 → done
- Exit 1 → agent reads diff, edits application code, re-runs harness
- After 10 failures → stop; human reviews diff and code changes
- Agent does **not** widen tolerances, auto-seed account data, or edit golden fixtures to force pass (D5)

### Discovery gate (terms breach as-of date)

**Resolved for golden comparison:** The daily KPI timeline module evaluates term breach **as of each calendar day** in the replay range (invoice-open flags + `shouldSetReportingBreach(..., asOf)`), not from persisted `Invoice.reporting_breach` and not from wall-clock `new Date()`.

| Gate | If Yes | If No |
|------|--------|-------|
| Terms breach helpers support as-of date | Wire into daily timeline | Add as-of breach evaluation in timeline module; add unit tests against golden rows |

**Status:** Timeline module implements as-of evaluation; harness pass/fail uses this seam only.

### Testing principle: invoice timeline state, not wall-clock today

Golden Jan 2026 fixtures validate a **simulated chronological AR state machine** — outstanding, capacity gap, and term-breach exposure **as of each day in the fixture range** — not what the app would show if those rows were imported on the real calendar date the harness runs.

| Layer | Evaluation clock | Golden harness uses it? |
|-------|------------------|-------------------------|
| **Daily KPI timeline** (`customerDailyKpiTimeline`) | Per-day `asOf` in 2026-01-01 → 2026-01-27; `today: invoiceDate` at invoice open | **Yes — sole pass/fail oracle** |
| **Invoice import / refresh** (`InvoiceService`, `syncInvoiceReportingBreach`) | Wall-clock `new Date()` at import/sync time | **No — do not use for golden validation** |
| **Live dashboard / invoice grid** (`reporting_breach` column) | Point-in-time “today” on persisted flags | **No — misleading for historical backfill QA** |

**Rules for agents and QA**

1. **Pass/fail** = 27-day KPI timeline vs `expected-results.xlsx` only.
2. **Do not** treat “all invoices show reporting breach” in the UI as a golden failure when running Jan 2026 data in a later month — persisted `reporting_breach` is stamped with real today at import.
3. **Do not** widen tolerances or change fixtures to match wall-clock breach flags.
4. **Prerequisites** must include customer insurance fields the spreadsheet assumes (e.g. active `CustomerPolicy.max_allowed_mep = 15` for customer 4567). Checkpoint payload includes `customerPolicies` — **re-save checkpoint** after policy changes or restore will revert MEP/limit fields.

**Known gap (persisted state vs oracle):** Import and insurance refresh call `computeInvoiceInsuranceRowData` without `today: invoice_date`, so historical backfill sets `reporting_breach: true` when `target_reporting_date` is before real today. `syncInvoiceReportingBreach` only clears breach when `actual_reporting_date` is set, not when status becomes Paid — so Paid invoices can still display breach. This does not affect golden KPI comparison but confuses manual QA. See **follow-up slice** below.

## Testing Decisions

### What makes a good test

- Test **observable daily KPI rows** after replay logic, not harness CLI wiring or Excel parsing edge cases in isolation
- Use **fixed Jan 2026 golden dates** and customer 4567 invoice numbers from the fixture
- Evaluate KPIs from **replay state as of each fixture day**, never wall-clock today
- Prefer **unit tests on the daily KPI timeline module** with DB fixtures or structured invoice/payment inputs over full HTTP loops for rule coverage
- Full harness is the **E2E oracle**; run manually or in a dedicated integration job—not every unit test run
- **Do not** assert on persisted `Invoice.reporting_breach` or live dashboard KPIs for golden row correctness

### Primary module under test

**Customer daily KPI timeline** — unit tests:

| Scenario | Assert |
|----------|--------|
| 2026-01-01 | Total AR 250; breach/capacity/not insured per golden row 1 |
| 2026-01-03 | After payment on 5584561; AR 600 |
| 2026-01-14 | Capacity gap 600 when AR 10,600 |
| 2026-01-27 | Final row matches Expected results last day |
| Full 27-day sweep | All snapshots match fixture within D10 tolerance |

### Secondary modules (thin)

- **Preprocessor** — column remap, 5405→4567, serial date conversion, sample row counts
- **Comparator** — tolerance edges (health index ±0.001 boundary)

### Integration / harness

- One smoke path: prerequisites pass → save checkpoint → single import + compare (may be manual or nightly; optional CI job with local DB)
- Prior art: `importArReplayService.test.ts` (5584561 scenarios), `customerDashboardKpis.test.ts`, `import-job-runner.ts`, `auth-helper.ts`, `CustomerCheckpointService.test.ts`

### Seam confirmation

The **daily KPI timeline module** is the highest seam for business correctness. The harness orchestrates import and checkpoint restore; one comprehensive unit suite on the timeline plus golden fixture comparison should cover formula regressions. Checkpoint and import job wiring need only thin smoke coverage.

## Out of Scope

- ClickUp issue creation (use `/to-issues` separately)
- Auto-seeding customer 4567, policy limits, or account flags
- Modifying golden Expected results.xlsx or source invoices/payments except copying into repo fixtures
- Widening compare tolerances to force green builds
- Production execution or production checkpoint bypass
- Starting the Next.js dev server from the harness
- Browser/UI automation (FileUploader, manual upload)
- Translating harness output strings
- Comparing import job metadata or row-level import statuses (only daily KPI timeline)
- Parent/child customer aggregation
- Multiple customers in one harness run
- Invoice-only or payment-only partial golden subsets

## Further Notes

### QA workflow example

1. Ensure local dev server running; migrations applied (deferred `invoice_id` nullable, customer checkpoint table, account flag).
2. Configure test user env vars; enable credit insurance and `enable_customer_checkpoints` on account; verify customer **4567** with approved limit 10,000.
3. Copy golden xlsx files into repo fixtures (or pass Downloads paths on first run).
4. Run golden harness → expect exit 0.
5. On failure, Cursor agent fixes import/replay/KPI code, re-runs harness (restore resets customer).
6. After 10 failures, review printed diff and escalate.

### Relationship to other PRDs

- **Deferred payment & chronological AR import** — harness validates that implementation against the Jan 2026 golden spreadsheet
- **Customer restore point** — checkpoint save/restore provides idempotent retry baseline

### Fixture layout (recommended)

```
tests/fixtures/import-golden-loop/
  expected-results.xlsx
  invoices.xlsx
  payments.xlsx
```

### Health index scale

Expected results use 0–1 (e.g. `0.375`). Customer dashboard APIs may return 0–100. Comparator normalizes to 0–1 before applying ±0.001 tolerance.

### Harness exit codes

- `0` — all 27 days match
- `1` — mismatch or prerequisite failure
- Distinct stderr sections: `PREREQ_FAILED`, `MISMATCH`, `IMPORT_FAILED` for agent parsing

### Optional follow-up (not in MVP)

- Nightly CI job against staging with seeded customer 4567
- Cursor skill file documenting `/loop` invocation
- JSON export of actual timeline for diff tooling

### Follow-up slice: as-of insurance stamping on import/replay (implemented)

Align **persisted** invoice insurance fields with the same clock the golden timeline uses, so UI/grid state matches the Jan 2026 scenario during backfill QA.

**Problem:** `InvoiceService.createMany` / `refreshInsuranceFieldsForInvoiceId` called `computeInvoiceInsuranceRowData` with default `today = new Date()`. Historical imports run in July 2026 marked every open invoice `reporting_breach: true` when `target_reporting_date` (due + reporting_days) fell in Feb 2026.

**Implemented behavior:**

1. **Import** (`InvoiceService.createMany`): `today: invoice_date` in `computeInvoiceInsuranceRowData`.
2. **Chronological replay** (`replayCustomerArImport` on `invoice_open`): `stampInvoiceInsuranceFieldsAsOf(invoiceId, invoiceDate)` — new helper in `server/services/creditInsurance/stampInvoiceInsuranceFieldsAsOf.ts`.
3. **Payment → Paid** (`recalculateInvoiceFromLinkedPayments`): sets `reporting_breach: false` when customer outstanding reaches zero.
4. **Live refresh / cron** unchanged: `refreshInsuranceFieldsForInvoiceId` and `syncInvoiceReportingBreach` still use wall-clock today for forward-dated production AR.

**Related:** Deferred payment PRD US 18 — “today” at backfill = **invoice event date**; live AR = wall-clock.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Import Golden Loop Agent](https://app.clickup.com/t/869e0973g)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Golden fixtures & import file preprocessor | [869e09774](https://app.clickup.com/t/869e09774) | — | US 10–15 |
| 2 | Daily KPI timeline & golden comparator | [869e0979g](https://app.clickup.com/t/869e0979g) | 1 | US 16–23, 34 |
| 3 | Golden harness CLI, checkpoint loop & Cursor integration | [869e097ad](https://app.clickup.com/t/869e097ad) | 1, 2 | US 1–9, 24–33 |

**Related (non-blocking):** [Deferred Payment & Chronological AR Import](https://app.clickup.com/t/869dz43h4), [Customer Restore Point](https://app.clickup.com/t/869e08562)

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development per `.cursorrules`
