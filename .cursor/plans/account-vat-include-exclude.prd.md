---
name: account-vat-include-exclude
overview: Account-level include/exclude VAT setting drives how customer AR aggregates are calculated; invoices store with/without/VAT amounts; payments stay with-VAT.
source: grill-me session + start-work CU-869f2bu81
clickup_task_url: https://app.clickup.com/t/869f2bu81
isProject: false
---

# Account VAT include / exclude

## Problem Statement

Credit insurance and collection treat invoice money as a single gross basis. Accounts that need AR, due, overdue, capacity gap, and related metrics on a **without-VAT** basis have no setting for that, no invoice VAT breakdown columns, and no way for payments (which include VAT) to feed exclusive calculations consistently. Report builder and dashboards also cannot reflect a shared fiscal choice without new parallel customer fields.

## Solution

Add an **account settings** toggle: amounts **include VAT** (default, today’s behavior) or **exclude VAT**.

- Invoices import/store **with VAT**, **without VAT**, and **VAT amount** (account currency; `amount` remains the with-VAT figure). Payments stay with-VAT and continue to drive outstanding on the with-VAT ledger.
- When the account **excludes VAT**, customer aggregates (Total AR, due, overdue, capacity gap, and other AR/policy metrics that today sum open outstanding) use open outstanding scaled by without-VAT ÷ with-VAT. Missing without/VAT fields → no scale for that line (treat as include).
- Credits stay on the with-VAT ledger; exclusive mode still scales current outstanding by the stored invoice ratio.
- **Do not** add duplicate without-VAT customer rollup fields. After confirm, persist the setting and **enqueue a background refresh** of existing customer aggregates (with portfolio-health-style progress). Live reads apply the new setting immediately; denormalized fields catch up as the job runs.
- Invoice table shows with / without / VAT amount. Report builder registers the new invoice VAT amount fields (raw imported truth); customer metrics stay on existing fields.

## User Stories

1. As an account admin, I want an include/exclude VAT toggle on account settings, so that one fiscal rule applies to credit insurance and collection.
2. As an account admin, I want new accounts to default to include VAT, so that existing behavior does not change until I opt in.
3. As an account admin flipping to exclude VAT, I want a confirmation warning that all customer totals will recalculate, then a background job with a progress bar (like portfolio health snapshot generate), so that Save does not hang on large accounts.
4. As an account admin flipping back to include VAT, I want the same confirm + background refresh so aggregates return to the with-VAT basis safely.
4a. As an account admin watching the refresh, I want live customer detail AR to use the new setting right away while list rollups catch up, so that I am not blocked on the full batch.
4b. As an account admin flipping again mid-job, I want the old job superseded and a new refresh started, so that the end state matches my last choice.
4c. As an account admin when the job fails, I want a clear failed state with Retry (setting kept), so that I can finish the refresh without a silent rollback.
5. As a collections user, I want invoice list columns for amount with VAT, without VAT, and VAT amount, so that I can see the tax split on each invoice.
6. As an importer, I want to map without-VAT and VAT amount from the ERP, so that exclusive calculations use real source data.
7. As a collections user, I want payments to keep matching invoices on the with-VAT outstanding, so that paid/unpaid status stays correct.
8. As a credit insurance user on an exclude-VAT account, I want capacity gap and policy AR metrics to use the scaled exclusive basis, so that limits are compared to ex-VAT exposure.
9. As a credit insurance user on an include-VAT account, I want all metrics to match today’s gross outstanding, so that nothing regresses.
10. As a user viewing a legacy invoice without without-VAT/VAT fields, I want that line to count at full outstanding under exclude mode, so that incomplete data does not invent a rate.
11. As a user applying a credit note, I want net/outstanding to stay on the with-VAT ledger, so that credit application does not need a second VAT pipeline.
12. As a report builder user, I want invoice without-VAT and VAT amount fields available, so that I can build tax-aware invoice reports when needed.
13. As a report builder user, I want customer Total Due / overdue / open AR fields to already reflect the account setting, so that I do not need new without-VAT customer fields.
14. As a Hebrew-locale user, I want the new setting and invoice column labels in Hebrew, so that the UI is fully localized.
15. As a developer, I want one shared “open AR basis” helper that reads the account toggle and invoice VAT fields, so that collection rollups and credit-insurance gaps share the same math.
16. As a QA engineer, I want a clear How to test path from account toggle through customer header and unpaid invoices, so that I can verify both products.

## Implementation Decisions

- Persist the toggle on **Account** (boolean or enum; default **include VAT**). Expose it on account admin General (or equivalent account settings surface), not on InsurancePolicy.
- Invoice: keep `amount` / `customer_amount` as **with-VAT**. Add without-VAT and VAT amount fields in account currency (and customer-currency twins only if import/display already needs them for the triad; do not invent parallel customer rollup fields).
- Payment apply / outstanding recalc stays on with-VAT net and paid sums.
- Shared basis helper: given account setting + invoice line, return open AR contribution (gross outstanding, or outstanding × without÷with when exclude and both sides present and with ≠ 0; else gross).
- Wire that helper into customer due/overdue rollups, live Total AR / open receivable paths, capacity gap sync, and other policy rules that currently sum open outstanding for the account’s customers.
- On account VAT toggle change: show a **confirmation dialog** (Cancel keeps the previous switch value; Confirm saves the setting, enqueues a **background** account-wide refresh, and shows progress). Dialog copy must warn that all customer totals will recalculate and may take a while (English + Hebrew).
- Refresh is **not** done inside the account-save HTTP request. Enqueue a job (reuse portfolio-health / cron-queue style progress: done/total, ETA when practical). While running, **live reads** (e.g. customer header Total AR) use the new setting immediately; denormalized customer fields catch up as the job writes.
- If the admin flips the switch again mid-job: **supersede** the in-flight job and start a new refresh for the latest setting.
- If the job fails halfway: keep the saved setting; show failed + error on the progress UI; allow **Retry** (or flip again, which supersedes). Do not auto-roll back the setting.
- Unpaid invoice grid / view config: add columns for without-VAT and VAT amount; keep existing amount as with-VAT.
- Import mapping: allow mapping without-VAT and VAT amount; fields optional for backward compatibility.
- Report metadata: register new invoice VAT fields; do not add duplicate customer without-VAT metrics.
- **i18n:** all new labels (setting, columns, report fields) ship English and Hebrew together.
- Primary repo: backend (schema, APIs, domain, reports). Frontend branch with the same name when UI changes.

**Primary seams (preferred):**

1. Account VAT setting read + shared open-AR basis helper (include vs scaled exclude).
2. Background VAT-basis refresh job (enqueue / supersede / progress / retry) + live-read paths that apply the setting immediately.
3. Invoice import/API shape for without-VAT and VAT amount + unpaid list columns / report metadata.

## Testing Decisions

- Prefer behavior checks at the shared basis helper and aggregate refresh seams over UI snapshots.
- Good checks: include mode equals today’s outstanding sums; exclude mode scales when both amounts present; missing without-VAT leaves line unscaled; toggle save updates persisted due/overdue/gap; payments still clear invoices on with-VAT math.
- Do not add automated tests unless the user explicitly asks during implementation.
- Manual How to test on ClickUp and each vertical slice.

## Out of Scope

- Per-insurance-policy VAT override.
- Parallel exclusive outstanding ledger or credit-note VAT triad pipeline.
- Fixed fallback VAT percentage when fields are missing.
- Rewriting every historical report definition beyond registering new invoice fields and relying on existing customer metrics.
- Changing payment import to strip VAT from payment amounts (payments remain include-VAT).

## Further Notes

ClickUp: [Policy including / exluding VAT](https://app.clickup.com/t/869f2bu81). Branch (local): `feat/account-vat-include-exclude-CU-869f2bu81`.

### Grill decision log (addendum)

| # | Topic | Decision |
|---|-------|----------|
| D11 | Recalc on toggle | Background job after save; not sync in HTTP |
| D12 | During job | Live reads use new setting; denormalized catch up; portfolio-health-style progress |
| D13 | Flip mid-job | Supersede and start new refresh for latest setting |
| D14 | Confirm on switch | Cancel keeps old; Confirm saves + enqueue + progress; warn full-account recalc |
| D15 | Job failure | Keep setting; show error; Retry (or flip supersedes); no auto-rollback |

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/account-vat-include-exclude/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/account-vat-include-exclude/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Account VAT setting + open-AR basis helper | `issues/01-account-vat-setting-basis-helper.md` | — | 1, 2, 10, 15 |
| 2 | Invoice VAT fields, import, unpaid list, report builder | `issues/02-invoice-vat-fields-import-ui-reports.md` | 01 | 5, 6, 12, 14 |
| 3 | Aggregates use VAT basis + background refresh | `issues/03-aggregates-recalc-on-toggle.md` | 01, 02 | 3, 4, 4a–4c, 7–9, 11, 13, 16 |

**Status:** `ready-for-agent` on all slices.
