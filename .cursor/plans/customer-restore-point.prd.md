---
name: customer-restore-point
overview: Account-flagged, non-production customer checkpoint save/restore on the customer page so QA can repeatedly test invoice and payment imports from the same baseline.
source: grill-me session (Jul 2026)
clickup_task_url: null
isProject: false
---

# Customer Restore Point

## Problem Statement

QA and implementation teams need to test invoice and payment import scenarios repeatedly against the same starting customer state. Today there is no in-app way to capture a customer's current AR, collection, and related records and roll back after a test run. Ad-hoc scripts (e.g. prefix-based cleanup) only delete rows matching test markers and do not restore collection periods, activities, disputes, credit-policy state, or computed rollups to an exact prior point.

Without a restore point, each re-test requires manual data repair or re-seeding, which is slow, error-prone, and blocks confident iteration on import flows (including deferred payments and chronological replay).

## Solution

Add a **customer checkpoint** feature controlled by an account-level flag:

1. **Enable per account** — System admins toggle `enable_customer_checkpoints` on Account Details (alongside product flags like collection and credit insurance).
2. **Save checkpoint** — On the customer page, users on enabled accounts see a **Save checkpoint** button that snapshots the customer's in-scope subtree into a single JSON payload (one checkpoint per customer; save overwrites the previous).
3. **Restore checkpoint** — A **Restore checkpoint** button (with confirmation showing when the checkpoint was saved) wipes the in-scope subtree and re-inserts the saved rows, preserving primary keys, then runs customer amount recalculation and credit-insurance field sync.
4. **Safety gates** — Save and restore are allowed only when `NODE_ENV !== 'production'`. The API enforces the account flag and customer access independently of the UI.

The feature is for **test and staging workflows**, not production operations.

## User Stories

### Account configuration

1. As an archaser admin, I want to enable customer checkpoints on a specific account, so that only test tenants expose save/restore on customer pages.

2. As an archaser admin, I want the checkpoint toggle on Account Details next to existing product flags, so that configuration follows familiar account setup patterns.

3. As an archaser admin, I want only system-admin users to edit the checkpoint flag, so that customer accounts cannot turn the feature on themselves.

4. As a product owner, I want the flag stored on the Account record, so that all customers under that account inherit the same QA capability without per-customer setup.

### Visibility and access

5. As a user on a checkpoint-enabled account, I want save/restore buttons on the customer page when I can already view that customer, so that QA teams can use the tool without special archaser-admin login.

6. As a user on an account without the flag, I want no checkpoint UI, so that normal tenants never see testing controls.

7. As a user in production, I want save/restore APIs to reject requests even if the flag were mistakenly enabled, so that production data cannot be bulk-rewritten through this path.

8. As a user viewing a customer in another account via view-as, I want checkpoint actions to respect the **customer's account** flag (not only my login account), so that testing works when admins operate on tenant customers.

### Save checkpoint

9. As a QA tester, I want to save the current customer state as a checkpoint with one click, so that I can freeze a baseline before running imports or manual edits.

10. As a QA tester, I want saving to overwrite any previous checkpoint for that customer, so that I always have one clear "last saved" restore target.

11. As a QA tester, I want the UI to show when a checkpoint was last saved (timestamp and optionally who saved it), so that I know whether restore will return to the state I expect.

12. As a QA tester, I want the checkpoint to include invoices, invoice payments, legacy payments, collection periods, activities, disputes, aggregated rollups, customer policy, top-ups, contacts, and bank links, so that import re-runs start from a realistic AR and collection baseline.

13. As a QA tester, I want the customer row itself (due/overdue totals, collection status, category fields, etc.) included in the checkpoint, so that header KPIs match the saved point after restore.

14. As a QA tester, I want saving to complete quickly enough for interactive QA on typical test customers, so that the tool does not block my workflow.

15. As a developer, I want save to be idempotent for the same customer state, so that repeated saves simply refresh the snapshot without side effects on live data.

### Restore checkpoint

16. As a QA tester, I want to restore the last saved checkpoint with a confirmed action, so that I do not accidentally wipe my current test data.

17. As a QA tester, I want restore to remove rows created after the checkpoint and bring back deleted/changed in-scope rows, so that I can re-run the same import file and get comparable results.

18. As a QA tester, I want restore to preserve the customer primary key and `customer_uuid`, so that bookmarks, portal links, and URLs keep working.

19. As a QA tester, I want restore to clear invoice payment unique-key conflicts from my test run, so that the same payment reference can be imported again after restore.

20. As a QA tester, I want customer due/overdue amounts and credit-insurance derived fields recalculated after restore, so that dashboards and customer header metrics stay consistent even if business rules evolved since the save.

21. As a QA tester, I want restore to run in a transaction, so that a failed restore does not leave the customer in a half-deleted state.

22. As a QA tester, I want a clear success or error message after restore, so that I know whether to proceed with the next import test.

23. As a QA tester, I want the customer page data to refresh after restore, so that grids and tabs reflect the rolled-back state without a manual full reload.

### Import testing workflow

24. As a QA tester, I want to save → import invoices → import payments → restore → re-import the same files, so that I can compare import job behavior run over run.

25. As a QA tester, I want deferred payment and chronological replay scenarios testable via checkpoint restore, so that AR timeline tests do not require database scripts.

26. As a QA tester, I want import job history left intact after restore, so that I can still audit what each job did even after rolling customer data back.

### Scope boundaries

27. As a QA tester, I understand that restoring a child customer does not automatically update a parent customer's aggregated data, so that I checkpoint parent and child separately when testing hierarchy scenarios.

28. As a QA tester, I understand that Person and Company master rows are not rolled back, so that I should not rely on restore to undo name or CRN edits on those entities.

29. As a QA tester, I understand that policy trend snapshots and communication-learning tables are not in the checkpoint, so that historical trend charts may differ from the saved moment.

30. As a developer, I want activity attachment files on disk excluded from restore, so that the feature does not require blob storage snapshotting (metadata may be omitted or documented as best-effort).

### Regression and coexistence

31. As a product owner, I want checkpoint storage isolated in a dedicated table, so that production customer tables are not polluted with snapshot columns.

32. As a developer, I want one service module to own serialize, deserialize, delete-order, and insert-order logic, so that restore ordering bugs are fixed in one place.

33. As a security reviewer, I want API authorization to verify customer access using existing account and business-unit rules, so that checkpoint cannot bypass tenant isolation.

## Implementation Decisions

### Locked product decisions (grill-me)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Restore scope | AR + collection core: Customer row, Invoice, InvoicePayment, Payment, CustomerCollectionPeriod, Activity (+ ActivityContact), CustomerDispute (+ DisputeInvoice links), CustomerAggregatedData, CustomerPolicy, CustomerTopUp |
| D2 | Checkpoint slots | Single overwrite per customer |
| D3 | Access model | Account flag `enable_customer_checkpoints` (replaces archaser-admin-only on customer page) |
| D4 | Environment | Non-production only (`NODE_ENV !== 'production'`) |
| D5 | Parent/child | Selected customer only — no recursive parent/child snapshot |
| D6 | Restore mechanism | Transactional wipe of in-scope subtree, then re-insert preserving primary keys |
| D7 | UI | Two header buttons: Save checkpoint + Restore checkpoint; restore requires confirm dialog with saved timestamp |
| D8 | Flag admin UI | Account Details → General Information; only archaser admin (account 10013) can edit |
| D9 | Contacts & banks | Include Contact and CustomerBanks |
| D10 | Import jobs | Leave ImportJob / ImportJobRow history unchanged |
| D11 | Post-restore | Run `recalculateAllAmountsForCustomers` + `syncCustomerInsuranceFields` after commit |
| D12 | Person/Company | Customer row only — do not snapshot Person or Company |
| D13 | Non-prod gate | `NODE_ENV !== 'production'` server-side |
| D14 | Button operator | Any authenticated user who can open the customer page on a flagged account |
| D15 | Storage | `CustomerCheckpoint` table with JSONB payload |

### Primary seam: Customer checkpoint service

Introduce one module (working name: **Customer checkpoint service**) that owns the full checkpoint lifecycle:

**Capture**

- Input: `customerId`, `savedByUserId`
- Load all in-scope entities for that customer in a deterministic order
- Serialize to a versioned JSON document (include `schemaVersion` for forward-compatible migrations)
- Upsert `CustomerCheckpoint` row (`customer_id` unique)

**Restore**

- Input: `customerId`
- Validate: account flag, non-prod, checkpoint exists
- Within a DB transaction:
  - Delete in-scope rows in **reverse FK order** (children before parents)
  - Re-insert rows from JSON preserving original primary keys
  - `UPDATE` the Customer row in place (do not delete the customer)
- After commit: trigger post-restore recalc (due/overdue rollups + credit-insurance sync for that customer)

**Status**

- Return `{ exists, savedAt, savedBy }` for UI enablement and confirm dialog

This is the **single test seam**. HTTP handlers only authenticate, authorize, check gates, and delegate. UI only calls the API and refreshes queries.

### Delete / insert ordering (conceptual)

Reverse order for delete (and forward for insert):

1. ActivityContact, ActivityAttachment (if included — see Further Notes)
2. Activity
3. DisputeInvoice
4. CustomerDispute
5. InvoicePayment
6. Payment
7. Invoice
8. CustomerCollectionPeriod
9. CustomerTopUp
10. CustomerPolicy
11. CustomerAggregatedData
12. CustomerBanks
13. Contact (scoped by `customer_id`)
14. Customer — update only on restore, not delete

Exact order must be validated against live Prisma relations during implementation; the service owns the canonical ordered table list.

### Schema changes

**Account**

- `enable_customer_checkpoints Boolean @default(false)`

**CustomerCheckpoint**

- `id` — surrogate PK
- `customer_id Int @unique` — one checkpoint per customer
- `account_id Int` — denormalized for diagnostics
- `payload Json` — versioned snapshot document
- `saved_at DateTime`
- `saved_by String?` — user id
- `created_at` / `modified_at`

Optional: index on `account_id` for support queries.

### JSON payload shape (decision-rich sketch)

```typescript
type CustomerCheckpointPayload = {
  schemaVersion: 1;
  capturedAt: string; // ISO
  tables: {
    customer: CustomerRow;
    invoices: InvoiceRow[];
    invoicePayments: InvoicePaymentRow[];
    payments: PaymentRow[];
    collectionPeriods: CustomerCollectionPeriodRow[];
    activities: ActivityRow[];
    activityContacts: ActivityContactRow[];
    disputes: CustomerDisputeRow[];
    disputeInvoices: DisputeInvoiceRow[];
    aggregatedData: CustomerAggregatedDataRow | null;
    customerPolicies: CustomerPolicyRow[];
    customerTopUps: CustomerTopUpRow[];
    contacts: ContactRow[];
    customerBanks: CustomerBanksRow[];
  };
};
```

Store rows as plain serializable objects (dates as ISO strings). Omit relations not needed for re-insert.

### API contract

All routes scoped to `/api/customers/:customerId/checkpoint` (exact routing convention to match existing customer APIs).

| Method | Path | Behavior |
|--------|------|----------|
| GET | `.../checkpoint` | Status: exists, savedAt, savedBy; 404 if no checkpoint |
| POST | `.../checkpoint/save` | Capture and upsert; returns status |
| POST | `.../checkpoint/restore` | Restore + recalc; returns summary counts |

**Server gates (every mutating route):**

1. `NODE_ENV !== 'production'` → 403
2. Customer exists; caller has customer view access per existing rules
3. Customer's account has `enable_customer_checkpoints === true` → else 403
4. Restore: checkpoint must exist → else 404

No separate permission key; account flag + customer page access suffice.

### UI

- Location: customer header action area (alongside category change, open portal)
- Visible when: customer's account has flag enabled (fetch from existing account/customer context)
- **Save checkpoint** — always enabled when visible; toast on success
- **Restore checkpoint** — disabled when no checkpoint; opens confirm dialog with `savedAt` / `savedBy`; toast + invalidate customer queries on success
- Styling: reuse existing header IconButton / Button patterns; no new theme tokens without approval

### Account admin UI

- Add toggle to Account Details General Information section
- Editable only when session user is archaser admin (account 10013)
- Persist via existing account update API; include field in account types

### Post-restore side effects

After successful transaction commit:

1. `CustomerService.recalculateAllAmountsForCustomers([customerId])`
2. `syncCustomerInsuranceFields(customerId)` (invoice-scoped or full customer per existing helper conventions)
3. Dashboard cache invalidation for the account if existing helpers are used elsewhere after bulk customer changes

Do **not** run chronological AR replay on restore — the snapshot already contains persisted invoice/payment state; recalc only re-derives rollups and insurance fields per D11.

### Entities explicitly excluded from snapshot

- CustomerPolicyTrend, InsurancePolicyTrend, and other cron snapshot / trend tables
- CommunicationChannelPreference, CommunicationLearningData
- Person, Company (Customer FKs restored as stored; linked Person/Company rows untouched)
- ImportJob, ImportJobRow
- Parent or child Customer rows (D5)
- Activity attachment binary files on disk

## Testing Decisions

### What makes a good test

Test **observable customer state** after save/restore cycles, not internal JSON layout or private delete-order helpers unless a regression specifically targets ordering. Prefer tests that:

- Mutate customer subtree (insert invoice + payment)
- Restore
- Assert row counts, key field values, and uniqueness constraints (e.g. payment reference reusable)
- Assert recalc ran (due totals or insurance fields match expected post-recalc values)

### Primary seam under test

**Customer checkpoint service** — comprehensive unit (or integration) suite:

| Scenario | Assert |
|----------|--------|
| Save on empty-ish customer | Checkpoint row created; payload contains customer + empty arrays |
| Save after invoices/payments | Payload row counts match DB |
| Restore after adding rows | Added rows gone; original rows back with same PKs |
| Restore enables re-import | Same `reference` can be inserted again after restore wiped test payment |
| Missing checkpoint | Restore throws / returns error |
| Post-restore recalc | Mock or spy recalc helpers called once with customer id |

### API layer (thin)

- Flag off → 403 on save/restore
- `NODE_ENV=production` → 403 (use env mock in test)
- No customer access → 403/404 per existing patterns

### Prior art

- `linkDeferredPaymentAndRecalc.test.ts` — post-mutation recalc side effects
- `ImportPaymentService.test.ts` — payment idempotency and customer scoping
- `cleanup-import-data.ts` — reverse dependency delete ordering (script prior art, not production seam)
- Portal/dispute integration fixtures — customer subtree setup and teardown patterns

### Seam confirmation

The intended **highest seam** is the **Customer checkpoint service** (capture + restore + post-restore orchestration). API routes and customer header buttons stay thin; one comprehensive test suite on this seam should cover snapshot correctness and restore safety. Environment and account-flag gates need only a small API test matrix.

## Out of Scope

- Multiple named checkpoints or checkpoint history per customer
- Production use or production escape hatch
- Archaser-admin-only operator (replaced by account flag + customer page access)
- Snapshotting Person, Company, or parent/child customer trees
- Import job deletion or rollback
- Chronological AR replay on restore (recalc only)
- CustomerPolicyTrend and other historical trend tables
- Activity attachment file storage / S3 restore
- Combined save+restore single button
- Per-user checkpoints (checkpoint is per customer, shared by all users on the account)
- Automatic checkpoint before every import job
- Translation file updates unless explicitly approved in implementation (UI labels may use English defaults initially per project i18n rules)

## Further Notes

### QA workflow example

1. Enable `enable_customer_checkpoints` on staging test account.
2. Open customer → **Save checkpoint**.
3. Run payment import, then invoice import (or connector sync).
4. Inspect customer header, invoices grid, deferred payments.
5. **Restore checkpoint** → confirm dialog → data returns to step 2 baseline.
6. Re-run same import files → compare job results and AR totals.

### Parent customer caveat

Restoring a child customer does not recalculate the parent's `CustomerAggregatedData`. For parent/child tests, save and restore each customer involved, or manually refresh parent after child restore.

### Person / Company caveat

Editing company name or person details during a test run will not roll back on restore. Checkpoint only restores the Customer scalar fields and FK ids as saved.

### Payload size

Large test customers (thousands of invoices/activities) may produce large JSONB payloads. Log payload size on save; consider a soft warning in API response if row counts exceed a threshold (e.g. 10k total rows) — implementation detail, not blocking MVP.

### Activity attachments

`ActivityAttachment` rows reference files on disk. MVP should **exclude** ActivityAttachment from snapshot to avoid broken file links, unless implementation confirms metadata-only restore is acceptable. Document in release notes.

### Relationship to deferred payment import

This feature complements chronological AR import work: checkpoint restore returns customer AR to a known baseline so deferred-payment and replay scenarios can be repeated without SQL scripts.

### i18n

Button labels, confirm dialog, and toasts require `locales/en` and `locales/he` updates — obtain explicit approval before modifying translation files per project rules.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Customer Restore Point](https://app.clickup.com/t/869e08562)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Checkpoint foundation — schema, account flag, save API & capture service | [869e085af](https://app.clickup.com/t/869e085af) | — | US 1–4, 7, 9–15, 31–33 |
| 2 | Checkpoint restore — transactional rollback, recalc & restore API | [869e085c4](https://app.clickup.com/t/869e085c4) | 1 | US 16–22, 32 |
| 3 | Customer page checkpoint UI — save/restore buttons & confirm dialog | [869e085dv](https://app.clickup.com/t/869e085dv) | 2 | US 5–6, 8, 11, 23–26 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development per `.cursorrules`
