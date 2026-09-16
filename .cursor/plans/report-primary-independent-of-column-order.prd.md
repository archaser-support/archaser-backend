---
name: report-primary-independent-of-column-order
overview: Make report grain (primary table) explicit and independent of column order; show nested to-many scalars correctly; repair stuck configs; align builder/viewer/execution.
source: follow-up to formula comparisons blank-date diagnosis (2026-09-09)
isProject: false
---

# Report primary independent of column order

## Problem Statement

Report execution treats `config.tables[0]` as the Prisma root (“grain”). The builder recently started preserving that order when fields change, but three problems remain:

1. **Primary is still implicit** — there is no `primaryTable` field; anything that rebuilds `tables` from field order can still get it wrong, and users cannot see or set grain.
2. **ReportViewer disagrees with execution** — viewer uses `fields[0].table` as primary, while execution uses `tables[0]` (or context override).
3. **To-many nested scalars stay blank** — with Customer as primary, `Invoice.due_date` / `invoice_date` come back as arrays; `extractFieldValue` reads them as objects, so every cell is empty (report 5133).

Column reorder must only change display order. Grain must be stable, visible, and correctly executed.

## Solution

Add an explicit **`primaryTable`** on report config (JSON; no Prisma schema migration). Resolve grain everywhere as:

`CONTEXT_PRIMARY_TABLE[context] ?? config.primaryTable ?? config.tables[0] ?? "Customer"`

Wire builder hydrate/save, execution, and ReportViewer through one shared resolution rule. For Customer→Invoice (and similar list relations), load a **single sample related row** (`take: 1`, stable `orderBy`) and unwrap arrays in extract — matching existing `CustomerCollectionPeriod` / `CustomerPolicy` patterns. Show primary on table chips. Provide a dry-run repair script for stuck saved configs. Keep EN+HE locale updates in the same change when adding UI copy.

### Locked product decisions (recommended)

| Topic | Decision |
|-------|----------|
| Grain storage | Explicit `primaryTable` string on `ReportConfig` |
| Context reports | `CONTEXT_PRIMARY_TABLE` still wins over saved primary |
| To-many scalars | **Sample first related row** (`take: 1`), not row explosion |
| Formula date compares | Still need Invoice-primary for one-row-per-invoice semantics; builder may warn later (optional polish) |
| Stuck configs | Repair script (dry-run + apply); no automatic silent rewrite on every execute |

**Alternative (out of scope unless requested):** forbid non-aggregated to-many scalars in the builder instead of sampling.

## User Stories

1. As a report editor, I want column order to not change which table is the report grain, so that reordering Customer name first does not blank Invoice dates.
2. As a report editor, I want to see which table is primary, so that I understand why the report is one-row-per-customer vs one-row-per-invoice.
3. As a report editor, I want to change the primary table deliberately, so that I can switch grain without deleting and re-adding fields.
4. As a report reader, I want Invoice date columns on a Customer-primary report to show a value when invoices exist, so that cells are not always empty.
5. As a platform owner, I want entity/dashboard contexts to keep forcing their primary table, so that list screens do not pick up a wrong saved primary.
6. As an operator, I want a repair script for reports whose `tables[0]` was flipped by old column-order logic, so that existing demos work without hand-editing JSON.
7. As a developer, I want ReportViewer and execution to use the same primary resolution, so that links and execute behavior stay aligned.
8. As a Hebrew user, I want primary-table labels in Hebrew when translations ship with the UI.

## Implementation Decisions

- Persist `primaryTable?: string` on `ReportConfig` (FE `types/reports.ts` + BE report config typing if present). No DB migration (`report_config` is JSON).
- Shared resolver (FE + BE, or FE helper + BE private method with identical precedence): context → `primaryTable` → `tables[0]` → `"Customer"`.
- On field/table membership changes: keep `primaryTable` if still in active tables; if removed, set to new `tables[0]` after `resolveReportTablesPreservingPrimary` (or relationship-aware fallback — keep simple: first remaining preserved table).
- New reports: set `primaryTable` when the first table is added via table selector (not when the first *column* is dragged).
- Builder: mark primary on existing table chips (`TableCanvas` / `DragDropTableSelector`); click or menu to “Set as primary” — reuse Chip patterns, no new theme styles without approval. EN+HE keys required.
- Execution `buildSelect`: when selecting scalars on a list relation from primary, use `{ take: 1, orderBy: { id: "asc" }, select: { … } }` (same spirit as `CustomerCollectionPeriod`).
- Execution `extractFieldValue`: if nested value is an array, use `[0]?.[field]` (and dotted path on `[0]`).
- ReportViewer: stop using `fields[0].table`; use resolved primary from config + context.
- Harden preserve-primary helper so `tables` order always keeps `primaryTable` at index 0 when present (single source for legacy readers of `tables[0]`).
- Repair script under `scripts/database/`: dry-run / apply; for multi-table reports missing `primaryTable`, set it from current `tables[0]`; optional heuristic flag to prefer Invoice when Invoice date/amount fields exist without aggregation and `tables[0]` is Customer (document heuristic; do not auto-apply without flag).
- Translations: update `locales/en/reports.json` and `locales/he/reports.json` together for any new strings.

## Testing Decisions

- Prefer existing seams: builder unit helpers (`reportTableUtils`), report execution paths, viewer primary derivation.
- Good tests assert: column reorder does not change resolved primary; missing `primaryTable` falls back to `tables[0]`; context override wins; Customer-primary + Invoice.due_date returns a date when invoices exist; empty Invoice relation stays blank.
- Do not add/expand automated tests unless the user explicitly asks in the implementing session.
- Manual How to test on each slice is enough to demo.

## Out of Scope

- Exploding Customer-primary reports into one grid row per invoice.
- Rebuilding formula grouping aggregation execution.
- Extending every Customer to-many join beyond Invoice in the first pass (Contact/Dispute/Activity can follow the same `take: 1` pattern as a follow-up).
- Changing filter `some` semantics.
- New global CSS / theme tokens.
- Automatic production migration without dry-run / operator apply.

## Further Notes

- Related prior work: `resolveReportTablesPreservingPrimary` (frontend), required-scalar `is_not_empty` Prisma fix (backend filters), formula comparisons feature.
- ClickUp: none assigned yet — create only if requested.

## Codebase scan

### Required

| Path | Why |
|------|-----|
| `archaser-frontend/types/reports.ts` | Add `primaryTable` to `ReportConfig`. |
| `archaser-frontend/utils/reportTableUtils.ts` | Resolver + keep primary at `tables[0]`; extend preserve helper. |
| `archaser-frontend/app/[locale]/app/reports/builder/page.tsx` | Hydrate/save/set primary; first-table bootstrap; wire chips. |
| `archaser-frontend/components/reports/TableCanvas.tsx` and/or `DragDropTableSelector.tsx` | Primary badge / set-primary control. |
| `archaser-frontend/components/reports/ReportViewer.tsx` | Replace `fields[0].table` with shared resolver. |
| `archaser-frontend/shared/reportFormula/columnOrder.ts` | Ensure column sync never implies primary (docs/callers). |
| `archaser-frontend/locales/en/reports.json` + `he/reports.json` | Primary UI copy EN+HE. |
| `archaser-backend/reports/src/reports/report-execution.service.ts` | Resolve primary; `take: 1` select; array unwrap in extract. |
| `archaser-backend/reports/src/reports/report.constants.ts` | Keep `CONTEXT_PRIMARY_TABLE` precedence documented. |
| `archaser-backend/reports/src/reports/report-virtual-fields.util.ts` | Reuse `isPrismaListRelation`. |
| `archaser-backend/reports/src/reports/reports.service.ts` | Normalize `primaryTable` on create/update if validation exists. |
| `archaser-backend/scripts/database/*` (new) | Dry-run/apply repair for stuck configs. |

### Optional / out of scope

| Path | Why |
|------|-----|
| `report-filter.util.ts` | Already primary-aware for nested `some`; only if resolver signature changes callers. |
| `report-scope.util.ts` / `report-link.util.ts` | Pass resolved primary from execute only. |
| `FilterBuilder` / `GroupingBuilder` / formulas | Only if primary picker changes membership rules. |
| `viewColumnGenerator.tsx` | Indirect; fix when viewer passes correct primary. |
| Contact/Dispute/Activity to-many display | Same pattern as Invoice; follow-up unless easy in slice 3. |
| Automated tests under `tests/` | Unless user asks. |

### No change needed

| Path | Why |
|------|-----|
| `prisma/schema.prisma` | `report_config` JSON already flexible. |
| `ExecuteReportDto` | Primary comes from saved config + context. |
| `MODEL_NAME_MAP` | Already covers roots. |

## Suggested plan improvements (easy to miss)

- Align **three** consumers in one go: execution, ReportViewer, builder save — not only builder.
- Keep `tables[0] === primaryTable` after every membership change so legacy `tables[0]` readers stay correct during rollout.
- Do not let repair heuristic silently flip grain without `--prefer-invoice-when-dates` (or similar) flag.
- Formula Yes/No date compares on Customer-primary still compare poorly even after sample dates show — optional builder warning is enough for v1.
- Sort still resets to first *column*; call out as polish so primary work is not blamed for sort jumps.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/report-primary-independent-of-column-order/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/report-primary-independent-of-column-order/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Explicit primaryTable on config + shared resolve | `issues/01-explicit-primary-table-config.md` | — | 1, 5, 7 |
| 2 | Align ReportViewer + harden tables[0] sync | `issues/02-align-viewer-tables-sync.md` | #1 | 1, 7 |
| 3 | To-many Invoice scalars (take 1 + unwrap) | `issues/03-tomany-invoice-scalar-sample.md` | #1 | 4 |
| 4 | Builder primary UX + EN/HE + repair script | `issues/04-builder-primary-ux-and-repair.md` | #1, #2 | 2, 3, 6, 8 |

**Status:** `ready-for-agent` on all slices.

## Testing Strategy

| Requirement | Test unit | Seam | Notes |
|-------------|-----------|------|-------|
| Column reorder does not change grain | Manual + optional unit on resolve helper | Builder save → execute | |
| Context override wins | Manual entity/dashboard report | Execute | |
| Customer + Invoice.due_date shows a date | Manual report 5133-style | Execute extract | After slice 3 + restart reports |
| Missing primary falls back | Unit on resolver | `reportTableUtils` / BE helper | Only if tests requested |
| Repair dry-run | Script against local DB | `scripts/database/` | |

## How to test (feature-level)

1. Create Invoice-primary report with Customer name + invoice/due dates; put Customer name first; save; reopen — dates still populate; `primaryTable` stays Invoice.
2. Use “Set as primary” to switch to Customer — row grain becomes customers; after slice 3, date columns show a sample invoice date (not blank).
3. Open a context-forced report (if available) — context primary still wins.
4. Run repair script dry-run on account with stuck reports; apply with flag only after reviewing output.
