---
name: billing-connector-clear-before-import
overview: Per-entity delete-before-import switches and a single customer field on the billing integration backfill flow, with confirmation, live purge progress, and optional scoped reimport.
source: grill-me session
clickup_task_url: null
isProject: false
---

# Billing connector — clear before import

## Problem Statement

Admins re-running billing connector backfill often need a clean slate for one or more entities (Customer, Contact, Invoice, Payment), or a focused reimport for a single customer. Today the billing integration page can reset backfill *progress* but never deletes imported rows. Payments live in `InvoicePayment`; linked children block naive deletes; Start backfill has no confirmation for destructive or customer-scoped runs; and there is no way to limit a Start backfill to one customer without editing pull filters permanently.

## Solution

On the billing integration page, each entity tab gets a session-only “Delete existing data before import” switch (shown, greyed out when the entity is disabled). The backfill section always shows one optional customer number field. On **Start backfill** only:

- If any delete switch is on and/or the customer field is set, show a confirmation dialog (copy distinguishes wipe vs scoped reimport; whole-account Customer delete warns strongly).
- When customer is set, validate the customer exists on the account before opening the dialog.
- When confirmed, purge selected enabled entities first (cascading children in a safe order), with live “Deleting…” progress and deleted counts on the sync run, then run backfill.
- When customer is set, scope the whole Start run’s ERP pull for all enabled entities to that customer (runtime `CUSTNAME` AND with existing pull filters; not saved).
- When customer is set and all delete switches are off, skip purge and only do that scoped reimport (still confirm).
- Resume never deletes and ignores the customer field. Preview and incremental sync are unchanged.

## User Stories

1. As a billing admin, I want a delete switch under each entity tab, so that I can choose which tables to wipe before a fresh backfill.
2. As a billing admin, I want Payment delete to clear `InvoicePayment` rows, so that payment reimport starts from an empty payment table for the chosen scope.
3. As a billing admin, I want delete switches to be session-only, so that I do not accidentally wipe data on a later visit.
4. As a billing admin, I want the delete switch greyed out when an entity is disabled, so that I cannot configure a purge for an entity that will not sync.
5. As a billing admin, I want only enabled entities with delete on to be purged, so that disabled entities are left alone.
6. As a billing admin, I want one global customer number field on the backfill section, so that I do not manage a customer picker per entity.
7. As a billing admin, I want the customer field always visible with helper text, so that I understand it limits this Start backfill to one customer and that delete switches control wipe.
8. As a billing admin, I want an empty customer field to mean whole-account scope, so that I can wipe/reimport the full account when needed.
9. As a billing admin, I want a filled customer field with no delete switches to reimport only that customer for all enabled entities without deleting, so that I can refresh one customer safely.
10. As a billing admin, I want a filled customer field with some delete switches to still scope the whole Start pull to that customer, so that one field consistently means “this run is about this customer.”
11. As a billing admin, I want delete switches to control only which tables are purged, so that pull scope and wipe are separate concerns.
12. As a billing admin, I want Start backfill to show a confirmation when any delete switch is on, so that I do not wipe data by accident.
13. As a billing admin, I want Start backfill to show a confirmation when the customer field is set (even with no deletes), so that I knowingly start a scoped reimport.
14. As a billing admin, I want confirmation copy to list entities to delete and account vs customer scope, so that I know exactly what will happen.
15. As a billing admin, I want a strong warning when Customer delete is on and scope is whole account, so that I understand all customers and related data will be removed.
16. As a billing admin, I want unknown customer numbers rejected before the confirm dialog, so that I fix typos without starting a sync.
17. As a billing admin, I want delete and customer scope to apply only on Start backfill, so that preview and incremental sync stay unchanged.
18. As a billing admin, I want Resume backfill never to delete, so that a partial import is not wiped when I continue.
19. As a billing admin, I want Resume to ignore the customer field, so that resume continues from existing cursors without rescoping mid-run.
20. As a billing admin, I want purge to run before ERP pull on Start when deletes are on, so that import writes into a cleared table for that scope.
21. As a billing admin, I want purge to cascade linked children in a safe order, so that foreign keys do not block Invoice or Customer deletes.
22. As a billing admin, I want Invoice delete and Payment delete both runnable in one Start, so that leftover payments are still cleared even if Invoice cascade already removed many `InvoicePayment` rows.
23. As a billing admin, I want live “Deleting…” progress with per-entity counts like other sync steps, so that long purges are not a silent wait.
24. As a billing admin, I want deleted counts stored on the sync run and visible in sync history, so that I can audit what was wiped.
25. As a billing admin, I want Stop during purge to finish the current delete batch then halt without starting import, so that I can abort a long wipe without waiting for full purge.
26. As a billing admin, I want purge to commit before import, so that a failed import does not try to restore deleted rows automatically.
27. As a billing admin, I want customer amount recalculation skipped during purge, so that totals are fixed by the subsequent import / post-ingest path.
28. As a billing admin, I want the same `manage_billing_connector` permission as today, so that existing roles can use this without a new permission grant.
29. As a billing admin, I want runtime customer scoping ANDed with existing pull filters and not saved to connector config, so that permanent pull filters stay as I configured them.
30. As a billing admin, I want Reset backfill to remain progress-only (no data delete), so that wipe stays explicit via the new switches.
31. As a support engineer, I want Contact and Customer purges scoped by account and optional customer number, so that other accounts are never touched.
32. As a support engineer, I want failed purge to abort the run before import, so that we never import on top of a half-intended wipe without a deliberate retry.

## Implementation Decisions

### Product rules (from grill)

- **Entities:** Customer, Contact, Invoice, Payment. Payment maps to `InvoicePayment`.
- **Delete switches:** Session UI state only; not persisted on the billing connector.
- **Customer field:** Single optional `customer_number` on the backfill section; always shown; empty = account-wide.
- **Start backfill payload:** Include `clear_before_import` (list of import types) and optional `customer_number`.
- **Purge eligibility:** Entity must be enabled for sync **and** present in `clear_before_import`.
- **Pull scope on Start:** If `customer_number` is set, AND a runtime `CUSTNAME` (or equivalent) filter onto **all enabled** entities for that run only; merge with saved pull filters; do not persist.
- **No deletes + customer set:** No purge; scoped reimport only; still confirm.
- **Empty customer + no deletes:** Unchanged Start backfill; no confirm from this feature.
- **Resume:** No purge; ignore `customer_number`; existing cursor behavior.
- **Preview / incremental:** No purge; no customer field application from this feature.
- **Confirm dialog:** Open when any selected delete **or** customer field non-empty; validate customer exists on account first when field set.
- **Cascade:** Fixed child-before-parent delete order (align with customer checkpoint delete order where applicable). Customer whole-account delete allowed with explicit dialog warning.
- **Invoice + Payment both selected:** Run Payment purge even if Invoice cascade already cleared many payments (deleted count may be zero).
- **Failure model:** Purge commits separately; if import fails later, deleted data stays deleted; user re-runs Start.
- **Recalc:** Do not recalculate customer amounts during purge; rely on import / post-ingest.
- **Cancel:** Cooperative cancel between delete batches; do not start import after cancel during purge.
- **Permissions:** Existing `manage_billing_connector` only.
- **Observability:** Per-entity deleted counts on sync run `entity_stats` (or equivalent) and live progress updates during purge.

### Modules / interfaces

- **Billing integration UI:** Entity delete switches, global customer field, confirm dialog gating for Start, pass options into Start backfill client call; Resume unchanged regarding purge/customer.
- **Billing connector API Start backfill:** Accept and validate `clear_before_import` + optional `customer_number`; reject unknown customer before sync starts when provided from trusted clients (UI already validates; server should still enforce for safety on Start).
- **Sync lifecycle:** New purge phase before staged entity pull/import on Start backfill only; emit progress comparable to existing entity/tail steps; honor cancel between batches.
- **Purge helper (new deep module preferred):** Given account id, optional customer id/number, and entity list, delete in safe order and return deleted counts. Prefer one account-scoped purge seam rather than ad-hoc `deleteMany` calls in the UI or controller.
- **Pull filter resolution:** Extend Start-run filter resolution to AND customer scope for all enabled entities without writing connector pull filter JSON.
- **Progress / history UI:** Render purge/deleted stats alongside existing entity stats.

### Schema

- No Prisma schema change required for MVP if delete switches and customer field stay session/request-scoped.
- No new “imported by connector” source tag in this PRD.

### API contract (conceptual)

Start backfill request body (in addition to today’s empty/minimal body):

- `clear_before_import`: array of `Customer` | `Contact` | `Invoice` | `Payment` (optional / empty = no purge)
- `customer_number`: optional string

Sync run stats include deleted counts per entity involved in purge.

## Testing Decisions

### What makes a good test

Test external behavior at the highest stable seam: given Start backfill options, assert purge happened (or did not), pull scope was applied (or ignored), progress/stats expose deleted counts, and Resume/preview/incremental ignore these options. Do not assert internal batch sizes or exact SQL unless a dedicated purge module’s public return value is the seam.

### Proposed primary seam (confirm if this matches expectations)

**Primary seam:** Start backfill entry on the billing connector sync API / service — one call that accepts `clear_before_import` + optional `customer_number` and drives purge-then-import (or scoped import only). Prefer this over testing UI switches or Prisma `deleteMany` call sites.

**Secondary seams (only if primary cannot cover):**

- Purge module public function: returns deleted counts for account/customer/entity list without running ERP pull.
- UI confirm gating helpers: pure functions deciding when the dialog opens and what copy keys/scope apply (no DOM).

### Modules to cover

- Start backfill with Payment clear → `InvoicePayment` rows for scope removed before import; deleted count on run.
- Start with customer only (no clears) → no purge; pull scoped; confirm required in UI helper tests.
- Start with clears + customer → purge scoped + whole-run pull scoped.
- Resume with clears/customer in UI state → no purge, no customer rescope.
- Cascade: Invoice clear removes blocking children; Customer clear uses subtree order.
- Cancel mid-purge → import does not start; partial deletes remain.
- Unknown `customer_number` → rejected before sync (and UI before dialog).

### Prior art

- Billing connector sync/progress and `entity_stats` patterns in connector sync runtime.
- Customer checkpoint delete order for subtree safety.
- Existing Start/Resume/preview action-stage helpers on the billing integration page.
- Pull filter OData compile / `CUSTNAME` related-entity AND helpers.

## Out of Scope

- Delete on Resume, preview sync, or incremental sync.
- Persisting delete switches or customer field on connector config.
- Tagging rows as connector-imported and deleting only those rows.
- Automatic restore / undo after purge if import fails.
- Recalculating customer amounts during purge.
- New permission roles beyond `manage_billing_connector`.
- Changing Reset backfill to delete data.
- Per-entity customer fields.
- Translation file updates unless explicitly approved later.
- New visual styles beyond existing dialog/switch/progress patterns unless approved.

## Further Notes

- Grill decisions D1–D28 (with D15 superseded by D26; D16 revised to allow scoped reimport without delete; D6 revised to confirm on customer field as well as deletes).
- Discovery gates: large-account purge must batch enough for cancel between batches and finish within sync timeout; Contact account scoping via customers/`company_id` should be verified during implementation.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under `.scratch/billing-connector-clear-before-import/`. **Hard blockers** are recorded in each slice’s **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.scratch/billing-connector-clear-before-import/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Payment clear before Start backfill | `issues/01-payment-clear-before-start.md` | — | 1, 2, 3, 4, 5, 12, 14, 17, 18, 20, 26, 27, 28, 30 |
| 2 | Customer-scoped Start backfill | `issues/02-customer-scoped-start.md` | 01 | 6, 7, 8, 9, 10, 11, 13, 16, 19, 29 |
| 3 | Invoice, Contact, and Customer purge | `issues/03-invoice-contact-customer-purge.md` | 01 | 1, 4, 5, 14, 15, 21, 22, 31, 32 |
| 4 | Purge progress, history, and Stop | `issues/04-purge-progress-and-cancel.md` | 01 | 23, 24, 25 |

**Status:** `ready-for-agent` on all slices.

*Soft ordering:* prefer 02 before or with 03 for customer-scoped multi-entity demos; 04 works against Payment alone after 01.
