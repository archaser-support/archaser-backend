---
name: mep-invoice-ignore
overview: Let credit users mark an unpaid invoice as ignored for MEP overdue_block, then refresh live capacity gap (customer or shell pool) and enqueue as-of rewrite.
source: grill-me session (/start-work)
clickup_task_url: https://app.clickup.com/t/869fbqvbw
isProject: false
---

# Mark invoice as ignored for MEP calculation

## Problem Statement

Some overdue invoices should not keep a customer (or its credit-pool shell) in **Maximum Extension Period (MEP)** `overdue_block`, for example disputed or one-off lines that operations want out of insurer MEP math. Today every eligible overdue invoice in MEP scope can set the block. There is no per-invoice ignore. Capacity gap still needs a live refresh after the block changes, because at-risk versus capacity-gap split follows open AR and terms state.

## Solution

On the **customer page invoice grid**, credit-insurance users get a one-click action to toggle **ignored for MEP** on unpaid Due or Overdue invoices (not credit notes). The flag lives on the invoice, survives Enterprise Resource Planning (ERP) re-pull of the same row, and is skipped only when computing `overdue_block` (live and as-of). Days overdue / oldest overdue dates still count the invoice. Accounts receivable (AR) and the capacity-gap waterfall still include it.

After each toggle, reuse the existing live insurance + capacity-gap pipeline for that customer (and the shell / pool root when a credit pool exists), then enqueue as-of rewrite from the invoice date through today so past dashboard days catch up.

Rename `UnpaidInvoiceList` to `CustomerInvoiceGrid` in the same feature (imports and cache helper names).

## User Stories

1. As a credit operations user, I want to mark an unpaid invoice as ignored for MEP on the customer invoice grid, so that it no longer keeps the customer in overdue_block.
2. As a credit operations user, I want to un-ignore the same invoice with the same action, so that I can put it back into MEP math without a separate flow.
3. As a credit operations user, I want a toast after the toggle, so that I know the save succeeded or failed.
4. As a credit operations user, I want the ignore icon to look on versus off, so that I can see which invoices are ignored without a new grid column.
5. As a credit operations user, I want the action on Due invoices as well as Overdue, so that ignore is already in place when the invoice later becomes Overdue.
6. As a credit operations user, I want the action hidden on credit notes (negative amount), so that I am not offered a no-op.
7. As a credit operations user, I want the action only on the customer page invoice grid for credit-insurance accounts that have a customer policy, matching report-to-insurer and open-claim.
8. As a credit analyst, I want ignored invoices still included in open AR, so that limit usage does not silently drop.
9. As a credit analyst, I want ignored invoices still in the capacity-gap waterfall, so that ignore is not a way to hide over-limit AR.
10. As a credit analyst, I want customer days overdue and oldest overdue dates to still count ignored invoices, so that aging stays honest.
11. As a credit analyst, I want `overdue_block` to recompute immediately after toggle, so that header and dashboard MEP signaling matches the new flag.
12. As a credit analyst, I want live capacity gap to recompute for that customer after toggle, so that at-risk versus gap cards are not stale.
13. As a credit analyst, I want that capacity-gap refresh to run on the shell / pool root when the customer is in a credit pool, so that group cards match leaf MEP changes.
14. As a credit analyst, I want pool `overdue_block` roll-up to rerun, so that siblings and shells do not stay blocked after every leaf ignore.
15. As a credit analyst, I want past credit-dashboard / as-of days enqueued for rewrite after toggle, so that history does not stay on the old block forever.
16. As a credit operations user, I want the flag kept when the ERP sends the same invoice again, so that nightly sync does not undo ignore.
17. As a credit operations user, I want a newly created ERP invoice to start not ignored, so that ignore is always an explicit user action.
18. As a developer, I want the customer invoice grid file named `CustomerInvoiceGrid`, so that the module name matches the invoices tab rather than “unpaid list”.
19. As a Hebrew-locale user, I want ignore tooltips and toasts in Hebrew as well as English, so that the action is usable in both languages.
20. As a support engineer, I want Paid invoices left unchanged by this action (they are not on this unpaid grid), so that closed AR is out of the click path.
21. As a QA engineer, I want un-ignore to restore overdue_block when that invoice is still the blocking overdue line, so that the toggle is symmetric.
22. As a credit manager, I want reporting breach and payment-term flags unchanged by this flag, so that ignore is MEP-only.

## Implementation Decisions

- Persist `mep_ignored` (boolean, default false) on Invoice. Do not add a report-builder / grid data column in this delivery.
- Toggle API: dedicated authenticated invoice endpoint (same family as last-payment-date), body `{ invoiceId, mepIgnored }`. Reject missing customer, non-account invoice, Paid (or not Due/Overdue), and credit notes (amount less than zero). Credit-insurance account required.
- After a successful write: `syncCustomerInsuranceFields` with follow-up effects (existing gap pipeline + pool member flags) for the invoice’s customer; existing pool breach roll-up so shells get OR of leaf `overdue_block`; `enqueueRewriteForImport` (or equivalent as-of enqueue) with that invoice id and the pool’s customer ids, from invoice date through today.
- MEP skip sites must honor `mep_ignored`: live `syncCustomerInsuranceFields` / `computeOwnCustomerOverdueBlock`, as-of open-AR overdue_block / oldest-in-scope used for block (not ungated aging). Do not skip capacity-gap allocation or AR totals.
- ERP / file import / connector invoice upsert: never copy `mep_ignored` from the source file; omit it from update payloads so the stored flag survives.
- UI: rename `UnpaidInvoiceList` → `CustomerInvoiceGrid` (dynamic import, cache helper `invalidateUnpaidInvoiceListQueries` → name that matches the new module). Add an actions-column icon using the existing IconButton + tooltip pattern (no new theme). One-click toggle + toast. Hide on credit notes and when not credit-insurance + customer policy.
- i18n: English and Hebrew keys together for tooltip (ignore / un-ignore) and toasts.
- Prisma: safe `db push` only; do not run `migrate dev` or force-reset.
- Tests: do not add or expand automated tests unless the user later asks.

## Testing Decisions

Good tests (if later requested) would assert external behavior: after ignore, `overdue_block` is false when that invoice was the only MEP candidate; capacity-gap stored amounts refresh on the pool root; as-of rewrite is enqueued; ERP update of amount does not clear the flag.

Preferred seams (reuse, do not invent a second pipeline):

- Domain: `computeOwnCustomerOverdueBlock` / `syncCustomerInsuranceFields` plus as-of overdue_block helpers
- Gap: `syncCreditInsuranceGapPipelineForCustomer` (already pool-aware)
- As-of: `enqueueRewriteForImport`
- HTTP: invoice toggle endpoint
- UI: customer invoices tab (`CustomerInvoiceGrid`)

Prior art: last-payment-date invoice POST; customer invoice grid claim/report icons; negative-invoice MEP eligibility skip.

## Out of Scope

- New invoice grid column, report metadata, export/import spreadsheet columns, or filters on `mep_ignored`
- Ignore on the global invoices screen, portal, or collection-only accounts
- Excluding ignored invoices from AR, capacity-gap waterfall, reporting, or payment-term
- Changing days-overdue / oldest overdue date formulas
- Rewriting historical `ctv_customer_overdue_mep` on other invoices
- Auto-`done` on ClickUp; planning-only PR

## Codebase scan

### Required

- Invoice Prisma model (and generated client types)
- `syncCustomerInsuranceFields`, `computeOwnCustomerOverdueBlock`, as-of open-AR MEP block paths, created-at-issue overdue MEP helper if it feeds block
- Invoice Nest module (new toggle next to last-payment-date)
- Connector / import invoice create-update maps (preserve flag)
- Frontend customer invoices tab file rename + actions column + locales EN/HE
- Cache invalidation helpers that name the old list
- `CustomerDetailsCombined` dynamic import

### Optional / out of scope unless requested

- Report metadata / viewConfigs invoice fields
- Frontend `types/db.ts` if still hand-maintained alongside Prisma
- Unit tests under `tests/` (cache helper rename would be drive-by if tests are updated)

### No change needed

- Capacity-gap amount formulas (invoice still allocated)
- Shell invoice create guards (ignore is on leaf invoices)
- Collection last-payment-date action

## Further Notes

ClickUp: [Mark invoice as ignored for MEP calculation](https://app.clickup.com/t/869fbqvbw). Primary repo `archaser-backend`; frontend branch with the same name when UI is implemented. Decision log: D1 MEP-block only; D2 toggle; D3 any unpaid sticky; D4 aging still counts; D5 live + enqueue as-of; D6 ERP preserve; D7 one-click toast; D8 icon only; D9 hide credit notes; rename to `CustomerInvoiceGrid`.

## Issues (vertical slices)

Tracer-bullet breakdown under `.cursor/plans/mep-invoice-ignore/`. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/mep-invoice-ignore/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Rename to CustomerInvoiceGrid | `issues/01-rename-customer-invoice-grid.md` | — | 18 |
| 2 | Toggle MEP ignore, refresh gap, enqueue as-of | `issues/02-toggle-mep-ignore-and-recalc.md` | 01 | 1–17, 19–22 |

**Status:** `ready-for-agent` on all slices.
