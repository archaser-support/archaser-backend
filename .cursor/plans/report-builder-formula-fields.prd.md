---
name: report-builder-formula-fields
overview: Add safe row-level arithmetic formula columns to Report Builder, expose customer policy pricing percentages as formula operands, and (follow-up) allow formulas to reference other formulas at row level.
source: grill-me session, attached monthly-report screenshot, and formula-chaining grill (2026-07-26)
clickup_task_url: null
isProject: false
---

# Report Builder Formula Fields

## Problem Statement

Report Builder supports ordinary fields and built-in aggregations, but users cannot define a calculated column from other report fields. Finance users therefore cannot calculate values such as an invoice-level insurance premium and then aggregate those calculated values by customer. After base formulas ship, editors also need to compose formulas from other formulas (for example Premium + Registration fee) without re-typing the same field arithmetic.

The attached Monthly Report demonstrates the target reporting shape: Customer Name, Customer Number, Insurance Policy, Invoice COUNT, and Amount SUM. Those columns are already available in Report Builder. The missing capability is to add visible customer policy pricing operands—Insurance Premium Rate (%) and Registration Fee (%)—and use selected numeric fields in formulas such as:

`[Invoice.amount] * [Customer.cost_percent]`

Insurance Premium Rate (`cost_percent`) and Registration Fee (`registration_fee_percent`) are stored as percent points (enter `3` for 3%). Formula evaluation divides those two fields by 100 automatically, so editors do **not** write `/ 100`.

Report configuration already has a dormant formula declaration, but formulas have no editor, validation, execution, rendering, export, warning, or test behavior. Using unrestricted JavaScript expression evaluation would also introduce an unacceptable security boundary.

## Solution

Add first-class formula columns to Report Builder. A report editor will enter a formula in a text editor with autocomplete over visible, selected numeric fields. The first version will support numeric constants, field references, parentheses, and the four arithmetic operators.

Formulas will be evaluated for every source row before grouping. Grouped reports will then aggregate the calculated row values using an explicitly selected SUM, AVG, MIN, or MAX operation. This gives correct results when different rows use different rates; the system will calculate each invoice with its own report-field values rather than multiplying one aggregate amount by an arbitrary group-level rate.

Expose Customer Insurance Premium Rate (%) and Registration Fee (%) as credit-insurance-gated numeric fields in Report Builder. The existing screenshot columns remain available through their current metadata and aggregation behavior. Formula columns will be shown in the report viewer and included consistently in CSV, Excel, PDF, and scheduled report output.

## User Stories

1. As a report editor, I want to add a formula column, so that I can calculate values not stored as standalone report fields.
2. As a report editor, I want formula fields to work with any supported report object, so that formulas are not specific to insurance or invoices.
3. As a report editor, I want autocomplete to list visible selected numeric fields, so that I can insert valid field references quickly.
4. As a report editor, I want canonical references such as `[Invoice.amount]`, so that formulas remain stable when labels or aliases change.
5. As a report editor, I want to use numeric constants, addition, subtraction, multiplication, division, and parentheses, so that I can express basic arithmetic.
6. As a report editor, I want locale-aware decimal input, so that numeric constants follow my locale while I edit.
7. As a report owner, I want expressions normalized when saved, so that one report behaves identically for users in different locales.
8. As a report editor, I want Insurance Premium Rate and Registration Fee to be treated as percentages automatically in formulas, so that `[Invoice.amount]*[Customer.cost_percent]` means amount × rate% without typing `/ 100`.
8a. As a report editor, I want a warning when my expression still divides those rate fields by 100, so that I know results will be 100× too small if I leave `/ 100` in place.
9. As a report editor, I want formula evaluation to use each source row's field values, so that calculations respect row-level differences.
10. As a report editor, I want to select SUM, AVG, MIN, or MAX for a formula in a grouped report, so that I control how calculated rows are reduced.
11. As a report editor, I want aggregation to be required explicitly, so that the builder does not silently assume SUM.
12. As a report editor, I want ungrouped reports to show each row's formula result, so that formulas also work in detail reports.
13. As a report editor, I want to choose Number, Currency, or Percentage formatting, so that the calculated column communicates its business meaning.
14. As a report editor, I want a Currency formula to identify a referenced amount field as its currency source, so that values use the correct existing currency resolver.
15. As a report reader, I want mixed-currency grouped formula results to be blank, so that an invalid cross-currency total is not presented as one currency.
16. As a report reader, I want mixed-currency groups included in formula warnings, so that I understand why a result is blank.
17. As a report reader, I want missing operands, division by zero, and non-finite calculations to produce blank cells, so that invalid calculations are not shown as zero.
18. As a report reader, I want a per-formula invalid-row count, so that I can assess calculation quality without failing the report.
19. As an API consumer, I want formula warning summaries in report execution responses, so that clients can communicate calculation issues.
20. As an export consumer, I want invalid formula values to remain blank without adding warning rows or sheets, so that export shapes remain stable.
21. As a report editor, I want formula labels to be unique without regard to case, so that columns and export headers are unambiguous.
22. As a report editor, I want formula labels to remain editable, so that I can improve presentation after creating a formula.
23. As a report owner, I want every formula to have a stable generated identity, so that renaming it does not break saved configuration.
24. As a report editor, I want formula columns interleaved with ordinary columns in the draggable field list, so that I control report and export order.
25. As a report editor, I want field removal blocked when formulas depend on that field, so that I cannot accidentally create a broken formula.
26. As a report editor, I want the builder to name the dependent formulas when removal is blocked, so that I know what to edit first.
27. As a report editor, I want invalid syntax and references caught before save, so that broken formulas are not persisted.
28. As a report owner, I want the server to validate formulas independently of the browser, so that malformed API payloads cannot bypass safety rules.
29. As a report reader, I want formula values calculated with decimal arithmetic, so that financial results do not accumulate binary floating-point drift.
30. As a report reader, I want calculation values rounded only for formatting, so that row-level rounding does not distort grouped totals.
31. As a report reader, I want formula columns in the on-screen report, so that calculated values are available without export.
32. As a report consumer, I want formula columns in CSV and Excel exports, so that exported data matches the viewer.
33. As a report consumer, I want formula columns in PDF output, so that printable reports match the viewer.
34. As a scheduled-report recipient, I want formula columns calculated server-side, so that scheduled output matches interactive execution.
35. As a report editor, I want Formula UI labels and validation messages in English and Hebrew, so that the feature works in both supported locales.
36. As an authorized report editor, I want formula editing to follow existing report permissions, so that no separate role is required.
37. As a platform owner, I want formulas evaluated without `eval` or dynamic JavaScript execution, so that report expressions cannot execute arbitrary code.
38. As a platform owner, I want at most 10 formulas per report, so that formula work remains bounded.
39. As a platform owner, I want each expression limited to 500 characters and an AST depth of 10, so that parsing and execution cannot be abused.
40. As a credit-insurance report editor, I want Customer Insurance Premium Rate (%) available as a numeric report field, so that I can use the applicable report value in formulas.
41. As a credit-insurance report editor, I want Customer Registration Fee (%) available as a numeric report field, so that I can use policy registration pricing in formulas.
42. As a credit-insurance report editor, I want policy pricing fields hidden for accounts without credit insurance, so that product gating remains consistent.
43. As a report editor recreating the Monthly Report, I want Customer Name, Customer Number, Insurance Policy, Invoice COUNT, and Amount SUM to retain their existing behavior, so that adding formulas does not regress the shown report.
44. As a finance user, I want to calculate each invoice amount multiplied by the customer's insurance premium rate (with % auto-applied), so that grouped totals account for each row's values.
45. As a report editor, I want formula values to use the normal semantics of each referenced report field, so that the formula engine does not introduce object-specific lookups.
46. As a report owner, I want saved formulas to retain normalized expression text, so that formulas remain editable and inspectable.
47. As a developer, I want one formula engine to own parsing, validation, dependency extraction, normalization, decimal evaluation, and runtime errors, so that behavior cannot drift across execution paths.
48. As a QA engineer, I want formulas verified through report execution behavior, so that tests cover calculation, aggregation, formatting, and warnings through the production seam.

### Follow-up — formula-to-formula references (after ClickUp slices 1–4)

49. As a report editor, I want a formula to reference another formula’s row-level result, so that I can compose calculations without duplicating expressions.
50. As a report editor, I want a formula that only names other formulas to be valid when those formulas eventually use real report fields, so that I can write Premium + Fee style totals.
51. As a report owner, I want saved expressions to store stable `[formula:<id>]` references, so that renaming a formula label does not break dependents.
52. As a report editor, I want the expression box to show formula labels (including spaces) while editing and convert to IDs on save, so that formulas stay readable without sacrificing rename safety.
53. As a report editor, I want cycles and self-references rejected on save, so that formula chains cannot loop forever.
54. As a report editor, I want deleting a formula blocked when other formulas depend on it, with those dependents named, so that I cannot orphan a chain.
55. As a report editor, I want formula labels that match an allowed field name (e.g. `Invoice.amount`) rejected, so that `[Invoice.amount]` always means the field.
56. As a report editor, I want a Currency formula built only from other Currency formulas to inherit their shared currency source when they agree, so that compose-only currency columns still format correctly.
57. As a report reader, I want only the upstream formula to warn when it fails a calculation, so that dependents that go blank do not double-count the same bad row.
58. As an API consumer, I want the server to accept only `[formula:<id>]` in persisted expressions (not display labels), so that one canonical shape is stored.
59. As a platform owner, I want no separate formula-chain depth cap beyond the existing max of 10 formulas per report, so that limits stay simple.

## Implementation Decisions

- Formula behavior is generic across Report Builder objects. Insurance pricing fields are operands delivered through ordinary report metadata and field-resolution behavior, not special cases in the formula engine.
- Formula definitions become first-class ordered report columns with a stable generated ID, a case-insensitively unique display label, normalized expression text, result format, optional currency-source reference, and optional aggregation.
- Formula references use bracketed canonical field names such as `[Invoice.amount]`. Display labels and aliases do not participate in expression identity for **fields**.
- Only numeric or amount-compatible ordinary fields (per the shipped formula operand rules) and other formulas in the same report may be referenced. Hidden/unselected field policy follows the shipped base-formula behavior; formula-to-formula references are a **follow-up** (stories 49–59), not part of ClickUp slices 1–4.
- A selected field cannot be removed while a formula references it. The builder identifies the dependent formulas and requires the user to edit or delete them first.
- **Follow-up — formula chaining (locked grill 2026-07-26):**
  - Nested formulas read the **row-level raw** value of the referenced formula before grouping. Each formula still applies its **own** SUM/AVG/MIN/MAX when the report is grouped.
  - Persisted / server-validated references use `[formula:<stableId>]` only. The client may show `[Label]` (spaces allowed) while editing and must convert label → id on save; id → label on load.
  - When resolving edit-time `[…]` tokens, an allowed **field** name wins over a formula label. Formula labels that case-insensitively match an allowed field canonical name are rejected.
  - Expressions may reference only other formulas (no direct fields) if a transitive walk reaches at least one real report field. Missing/orphan formula ids are rejected on save.
  - Cycles and self-references are rejected on save. There is no separate chain-depth limit beyond `MAX_FORMULAS_PER_REPORT` (10).
  - Deleting a formula is blocked while other formulas reference it; the UI names those dependents (same pattern as field removal).
  - Execution evaluates formulas in **dependency (topological) order** so formula operands read already-computed row output keys.
  - Currency compose: if a Currency formula’s expression has no direct amount field, inherit `currencySource` when all referenced formulas that contribute a currency source agree on one field; reject Currency save when they disagree or none exist. Direct amount fields in the expression continue to use the existing resolver.
  - If formula A is null on a row (including calc failure), dependents treat that operand as a blank/missing value. **Only A** increments invalid-row warnings for real calc failures; dependents do not double-count.
  - Operand pickers list other formulas (by label) and insert edit-time `[Label]` tokens, excluding self and picks that would create a cycle with the current draft.
- The editor is text-based with autocomplete. It accepts locale-aware numeric constants and normalizes constants to a locale-neutral representation when saved.
- The v1 grammar supports numeric constants, canonical field references, unary signs, parentheses, and addition, subtraction, multiplication, and division.
- Formula expressions are parsed through a constrained grammar. Dynamic JavaScript execution is prohibited.
- Formula parsing, normalization, validation, dependency extraction, decimal evaluation, and runtime error classification belong to one formula-engine module.
- The server validates formula count, length, depth, labels, field references, operand types, formats, currency source, and aggregation on report create and update.
- Execution validates persisted formulas again so that direct database changes or legacy malformed configurations cannot bypass safety checks.
- Formula values are calculated from formatted source-row field values after relation expansion and before grouping and aggregation.
- Formula arithmetic uses decimal values and retains calculation precision through aggregation. Rounding occurs only when formatting viewer or export output.
- Null operands, division by zero, invalid numeric conversion, overflow, and non-finite results produce a null formula value for that row.
- Execution accumulates invalid-row counts by formula and returns warning summaries without exposing row details.
- Warning summaries are included in the execution API and interactive viewer. CSV, Excel, PDF, and scheduled files preserve their existing tabular shape and represent invalid values as blank.
- Ungrouped reports display row-level formula values directly.
- Grouped reports require an explicit formula aggregation of SUM, AVG, MIN, or MAX. There is no default aggregation.
- The formula's selected aggregation applies to calculated row values. Aggregation configured on an operand's visible column does not change the raw row value used by the formula.
- Formula result formatting is explicitly selected as Number, Currency, or Percentage; it is not inferred from the expression.
- Currency formulas require a resolvable currency source: a referenced amount field in the expression (base behavior), or — in the formula-chaining follow-up — a single inherited source shared by referenced Currency formulas.
- If a grouped Currency formula encounters more than one non-null source currency in a group, its grouped result is null and its invalid-group count contributes to the formula warning.
- Formula columns and ordinary fields share one draggable column-order model used by the viewer and every export path.
- Formula columns are calculated server-side so interactive, exported, and scheduled reports receive the same values.
- Existing report create/edit authorization controls formula editing. No formula-specific permission or feature flag is introduced.
- A report may contain no more than 10 formulas. Each expression is limited to 500 characters and an AST depth of 10.
- Insurance Premium Rate (%) maps to the existing compatible `cost_percent` contract. It is exposed as a numeric Customer report field and retains the field's existing report-time semantics for **columns** (percent points). In **formulas only**, `cost_percent` and `registration_fee_percent` are divided by 100 when read.
- Percentage formula result formatting treats the calculated raw value as a fraction (`0.03` displays as `3%`).
- Saving a formula that still divides those rate fields by literal `100` produces a soft warning but does not block save.
- Registration Fee (%) maps to the customer policy pricing field introduced by the policy-pricing prerequisite. It is exposed as a nullable numeric Customer report field.
- Both policy pricing operands follow existing credit-insurance account gating and saved-report enforcement.
- The screenshot's Customer Name, Customer Number, Insurance Policy, Invoice COUNT, and Amount SUM fields already exist. Their metadata, aggregation, and rendering contracts are retained rather than reimplemented.
- Formula controls and validation messages ship in English and Hebrew. Canonical expression references remain locale-neutral.
- Existing design-system controls and layout patterns are reused. No new global styles, theme overrides, or feature-specific CSS hooks are required.
- Report persistence continues to use the existing JSON report configuration; no report database schema migration is required.

## Testing Decisions

- Good tests assert externally observable report behavior: accepted or rejected report configurations, calculated output rows, grouped values, formatting metadata, warnings, and export parity. Tests should avoid coupling to parser implementation details or internal method order.
- The primary test seam is report execution with a report configuration and representative source rows. It should prove row-level calculation, grouping, explicit aggregation, null handling, decimal precision, currency behavior, warning counts, and canonical output keys.
- Formula-engine unit tests are limited to grammar and safety boundaries that are difficult to exercise clearly through full report execution: normalization, operator precedence, parentheses, unary values, malformed references, maximum length, maximum depth, and prohibited tokens.
- Report-service validation tests cover formula count, duplicate labels, missing dependencies, non-numeric operands, unsupported aggregation, invalid currency source, and malformed direct API payloads.
- Builder behavior tests cover autocomplete, locale-aware constant normalization, live validation, required aggregation, stable identity across rename, interleaved ordering, and blocked removal of referenced fields.
- Follow-up chaining tests cover: formula→formula row results and per-formula aggregation; topo evaluation order; transitive field validation; cycle/self-ref rejection; delete-blocking for formula dependents; label↔id editor conversion; label/field collision; currency inheritance for compose-only Currency formulas; warning counts only on the upstream failure; server rejection of label-form formula refs in API payloads.
- Viewer tests cover formula columns, selected formatting, blank invalid values, and per-formula warning summaries.
- Export tests cover formula column order, labels, values, blank invalid cells, canonical aggregate keys, and parity across CSV, Excel, PDF, and scheduled execution.
- Pricing-field tests cover metadata visibility, credit-insurance gating, extraction from Customer report rows, joined Invoice-plus-Customer reports, null values, and saved-report enforcement after product access is removed.
- Regression tests recreate the screenshot shape with Customer Name, Customer Number, Insurance Policy, Invoice COUNT, and Amount SUM, then add visible pricing fields and a SUM formula.
- The existing report grouping tests provide prior art for row grouping, SUM output keys, and formatted aggregate values.
- Existing report service, field-selector, viewer, column-generator, export, report-table utility, and credit-insurance field-usage tests should be extended rather than creating duplicate seams.
- Manual QA should create an Invoice-plus-Customer report, select the screenshot columns and Insurance Premium Rate, add `[Invoice.amount] * [Customer.cost_percent]`, choose Currency and SUM, and verify viewer and all exports (amount `2000`, rate `3` → `60`).
- Manual QA should verify that leaving `/ 100` after a rate field shows a soft warning and under-scales results until removed.
- Manual QA should also verify null rates, zero denominators, locale decimal entry, formula rename, dependency-removal blocking, mixed currencies, non-credit account gating, and scheduled output.
- Manual QA (chaining follow-up): create Premium and Fee formulas, then Total = Premium + Fee using label insert; rename Premium and confirm Total still works; attempt a cycle and confirm save is blocked; attempt to delete Premium while Total depends on it; verify grouped SUM on Total; verify a divide-by-zero on Premium warns only on Premium while Total stays blank.

## Out of Scope

- Formula sorting in the builder or viewer.
- Filtering report rows or groups by a formula result.
- Formula fields as chart axes or chart series.
- References to hidden or unselected fields.
- Referencing another formula’s **grouped/aggregated** result (chaining is row-level only; each formula aggregates itself).
- Server-side acceptance or persistence of display-label formula references (client converts; API is id-only).
- Rich-text / tokenized expression editors that hide ids underneath labels (plain text + convert on load/save only).
- Separate formula-chain depth limits beyond the existing max of 10 formulas.
- Conditional expressions, comparisons, date arithmetic, string operations, and functions such as ROUND, MIN, MAX, or IF inside expressions.
- Automatic percentage conversion; users explicitly divide percentage-point values by 100.
- Automatic result-format inference.
- Foreign-exchange conversion or aggregation of mixed currencies.
- Row-level formula error details in the execution response.
- Warning rows, worksheets, or sections inside exported files.
- Changing the source or temporal semantics of existing report fields.
- Recomputing insurance pricing or daily insurance cost inside the formula engine.
- Adding CustomerPolicyTrend as a selectable report object.
- Changing the existing screenshot columns or the Monthly Report's current grouping behavior.
- New global styling or a Report Builder redesign.

## Further Notes

The intended Monthly Report formula is:

`[Invoice.amount] * [Customer.cost_percent]`

(`cost_percent` / `registration_fee_percent` are auto-scaled by ÷100 in formula evaluation only. Ordinary report columns still show percent points. Percentage formula **results** format the raw fraction with the percent formatter and do not divide again.)

Because formulas may reference only visible selected fields, Insurance Premium Rate (%) must remain a displayed report column when this formula is used. The formula's SUM is calculated from invoice-level results; it is not `SUM(Invoice.amount)` multiplied by one group-level rate.

The Registration Fee (%) report operand depends on the separate policy-pricing work that adds and synchronizes that value onto active customer policy assignments. Formula infrastructure can be implemented independently, but Registration Fee metadata and execution cannot be completed until that persisted customer field exists.

**Formula chaining follow-up:** Implement only after base formula slices (ClickUp 1–4 / equivalent shipped behavior) are available. Vertical slices for chaining live under `.scratch/report-builder-formula-chaining/` (not ClickUp). Example composed Monthly Report shape: Premium = `[Invoice.amount]*[Customer.cost_percent]`, Fee = `[Invoice.amount]*[Customer.registration_fee_percent]`, Total = `[Premium] + [Fee]` in the editor (persisted as `[formula:…] + [formula:…]`).

### Codebase scan

#### Required (base formulas — ClickUp slices 1–4)

- `server/services/ReportService.ts` — replace the dormant formula declaration with the validated first-class formula contract.
- `server/services/ReportExecutionService.ts` and execution types — evaluate formulas before grouping, aggregate formula values, resolve currency, and return warnings.
- `utils/reportTableUtils.ts` — define canonical formula output keys and ordered-column helpers.
- A focused formula-engine module under report services — parse, normalize, validate, extract dependencies, and evaluate decimal arithmetic.
- `app/[locale]/app/reports/builder/page.tsx` — hydrate, edit, validate, order, and persist formula columns.
- `components/reports/DragDropFieldSelector.tsx` and a formula editor component — interleave formula columns and provide text autocomplete.
- `components/reports/ReportViewer.tsx` and `shared/utils/viewColumnGenerator.tsx` — render formatted formula columns and warning summaries.
- `server/services/ReportExportService.ts` — use canonical output keys and include formula columns in CSV, Excel, PDF, and scheduled output.
- `server/services/reportMetadata.ts` and customer policy report-field adapters — expose Insurance Premium Rate (%) and Registration Fee (%) as Customer numeric fields.
- `server/utils/reportCreditInsuranceFieldUsage.ts` — enforce product gating for the two pricing operands.
- English and Hebrew report/customer translation files — add approved field, editor, format, aggregation, validation, and warning labels.
- Existing report service, execution, grouping, field selector, viewer, column generator, export, table utility, and credit-insurance field tests.

#### Required (formula-chaining follow-up)

- `shared/reportFormula/parser.ts` — allow saved `[formula:<id>]` references; support client edit-time spaced `[Label]` only in the convert layer (not as persisted grammar).
- `shared/reportFormula/validateFormulaDraft.ts` / `server/services/reportFormulaEngine.ts` — allow formula operands; transitive field check; cycle detection; reject label-form on server; currency inherit from formula operands; block labels colliding with field names.
- `server/services/reportFormulaExecution.ts` — topological evaluation order; resolve formula operands from computed row output keys; warning rule for dependents (D14).
- `shared/reportFormula/columnOrder.ts` — `findFormulasDependingOnFormula` (and related helpers); formula operands in autocomplete option lists.
- `components/reports/FormulaUpsertModal.tsx` / `FormulaColumnEditor.tsx` — label↔id conversion; formula operands in insert UI; delete/cycle messaging.
- Builder delete/remove guards for formula→formula dependents (parity with field removal).
- Unit/execution/builder tests for stories 49–59.

#### Optional or deferred

- Formula sorting and formula filtering, which would require full in-memory execution before pagination for ungrouped reports.
- Formula chart support after the current chart builder is complete.
- Hidden operands, richer functions, and conditionals.
- A future shared calculated-field registry if additional developer-defined and user-defined calculation systems need one interface.
- Rich-text expression editors that display labels as chips over stored ids.

#### No change needed

- The Report database model and existing report migrations, because report configuration is JSON.
- Report sharing, user-default report behavior, and system-report copying, which already preserve report configuration JSON.
- Report scheduling orchestration, provided formula execution and export are centralized.
- Customer Name, Customer Number, Insurance Policy, Invoice Amount, and existing COUNT/SUM aggregation metadata shown in the screenshot.
- Daily insurance premium calculations, policy trend writers, and dashboard KPI formulas.
- Customer-facing policy presentation layouts.

### Rollout gates

| Gate | If Yes | If No |
| --- | --- | --- |
| Existing saved report JSON contains dormant `formulas` entries | Inventory and explicitly migrate or reject each legacy shape before strict validation ships | Introduce the new formula contract without a data migration |
| Registration Fee (%) is persisted on active customer policies | Expose it with Insurance Premium Rate in the formula release | Ship generic formulas and Insurance Premium Rate first; keep Registration Fee metadata blocked on the pricing prerequisite |
| Existing currency resolvers can return a row currency for every eligible amount field | Reuse them as formula currency sources | Restrict Currency formulas to supported amount operands and document the unsupported fields |

The legacy-formula inventory is a blocking pre-deployment check. The Registration Fee and currency-resolver gates block only their respective operand/format slices, not the generic arithmetic engine.

## Issues (vertical slices)

### Base formulas (ClickUp)

Tracer-bullet breakdown published to the ClickUp ARchaser list. **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description Markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Calculated fields under report builder](https://app.clickup.com/t/869e6ebhx)

| # | Title | ClickUp | Waiting on | User stories |
| --- | --- | --- | --- | --- |
| 1 | Formula columns — safe arithmetic from builder to viewer | [869e6efj2](https://app.clickup.com/t/869e6efj2) | — | 1–9, 12, 17–30, 36–39, 45–48 |
| 2 | Grouped formulas — aggregation, formats and runtime warnings | [869e6efj1](https://app.clickup.com/t/869e6efj1) | #1 | 9–20, 29–30, 44–45, 48 |
| 3 | Formula output parity — exports, schedules and localization | [869e6efj3](https://app.clickup.com/t/869e6efj3) | #2 | 24, 31–35, 43, 48 |
| 4 | Policy pricing operands — premium rate, registration fee and Monthly Report | [869e6efj4](https://app.clickup.com/t/869e6efj4) | #3; pricing sync [869e6ebk9](https://app.clickup.com/t/869e6ebk9) | 40–45, 48 |

**Assignee / status / priority:** Nilotpal Bose on parent and all slices; Selected for Development; High.

**Task type note:** The ClickUp API did not expose the configured Task or Feature types for this list, so the existing parent and new slices use the list's default task type.

### Formula chaining follow-up (local markdown)

Published under `.scratch/report-builder-formula-chaining/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Soft prerequisite: base formula behavior from ClickUp slices 1–3 (engine, grouping, export) should already work in the branch you implement on. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.scratch/report-builder-formula-chaining/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Formula→formula evaluation — refs, topo calc, currency inherit | `issues/01-formula-to-formula-evaluation.md` | — | 49–51, 53, 56–59 |
| 2 | Formula chain editor safety — labels, delete block, collisions | `issues/02-formula-chain-editor-safety.md` | #1 | 52, 54–55, 58 |

**Status:** `ready-for-agent` on all chaining slices.
