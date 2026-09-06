# Connector customer import — wire up the four dropped fields

**Status:** ready-for-agent

## Problem

The Priority connector's customer field catalog advertises eleven mappable fields, and
`buildDefaultMappingRules` happily produces mapping rules for all of them. Four of those rules are
silently inert: the mapped value is read from the ERP record, normalized, stored on the row object,
and then discarded.

The cause is a narrow projection in `importCustomerBatch`. Every row is reshaped into a `prepared`
object before any work happens, and everything downstream reads only from `prepared`:

```125:137:packages/billing-connector/src/import/entityImporter.ts
    const prepared = rows.map((row, index) => ({
        index,
        customerNumber: str(row.customer_number),
        name: str(row.name) || str(row.customer_number),
        countryIso2: str(row.country_iso2 || row.country || "IL"),
        customerType:
            str(row.type).toLowerCase() === "person" ? "Person" : "Company",
        city: str(row.city) || null,
        address_line1: str(row.address_line1) || null,
        address_line2: str(row.address_line2) || null,
        postal_code: str(row.postal_code) || null,
        crn: str(row.crn) || null,
    }));
```

Missing from the projection, and therefore never written:

| Canonical field | Priority ERP field | Target column | Needs lookup |
|---|---|---|---|
| `business_unit` | `IDG_COMPANYNAME` | `Customer.business_unit_id` | `BusinessUnit` by account |
| `owner_email` | `EMAIL` | `Customer.owner_id` | `User` by account + email |
| `state_iso2` | `STATECODE` | `Customer.state_id` | `State` by country + iso2 |
| `parent_customer_number` | `MCUSTNAME` | `Customer.parent_customer_id` | `Customer` by account + number |

Beyond the projection, there is no resolver for any of them. Grepping `packages/billing-connector`
for `businessUnit` returns zero hits in `src/` — no lookup, no create, nothing. The same is true for
state and owner resolution on the customer path.

This is why account 10149's customers all landed with `business_unit_id = NULL` despite a correct
mapping to `IDG_COMPANYNAME`.

## Decisions taken

1. **Unmatched business unit** — match an existing `BusinessUnit` for the account by `external_id`
   first, then by `name` (case-insensitive); if neither matches, fall back to the account's primary
   business unit (`is_primary = true`). Do **not** auto-create business units from ERP data.
2. **Empty incoming values on re-import** — preserve whatever Archaser already has for **owner,
   state, and parent**. A missing owner email, state code, or parent number must never null out an
   existing value; only non-empty incoming values are written for those three.
3. **Business unit is the exception** — it is always assigned, on inserts *and* on updates. A blank
   `IDG_COMPANYNAME` on re-import resolves to the account's primary business unit rather than being
   left alone. A customer must never sit without a business unit.

## Behaviour specification

### Business unit (`business_unit` → `business_unit_id`)

- Trim the incoming value. Unlike the other three fields, an empty value is **not** a signal to skip
  the write — it resolves to the account's primary business unit. `business_unit_id` is therefore
  present in every payload, insert and update alike.
- Resolution order per account: exact `external_id` match → case-insensitive `name` match →
  primary BU (covers both "unrecognised name" and "no value supplied") → `null` only when the
  account has no primary BU at all.
- This makes the field self-healing: re-running a sync repairs customers that are currently `NULL`,
  which is exactly the account 10149 situation. It also means a manual business-unit assignment made
  in the Archaser UI will be overwritten on the next sync unless the ERP sends a matching value —
  see Risks.
- Load all business units for the account **once per batch** into a lookup map. Do not query per
  row; batches can be thousands of customers.
- When resolution falls back to primary because the name was unrecognised, emit a row-level warning
  through `options?.onLog` naming the unmatched value, so operators can spot ERP/Archaser drift.

### Owner (`owner_email` → `owner_id`)

- Resolve against `User` scoped to `account_id`, matching `email` case-insensitively. Prefer users
  with `status = Active`; if several match, pick the active one deterministically (lowest `id`).
- Batch-load the distinct emails in one `findMany` rather than per row.
- Unmatched email: leave `owner_id` untouched and log a warning. Never fail the row — an unknown
  collector email must not block invoice ingestion for that customer.

### State (`state_iso2` → `state_id`)

- `State` rows are keyed by `country_id` + `iso2`, so resolution depends on the country already
  resolved for that row. Reuse the existing per-row `countryId` the importer computes.
- Batch-load candidate states with a single `findMany` over the distinct
  `(country_id, iso2)` pairs present in the batch, then look up from a map.
- Unmatched code: leave `state_id` untouched, log a warning. `Customer.state_id` is nullable.

### Parent customer (`parent_customer_number` → `parent_customer_id`)

This one has ordering hazards and should be handled as a **second pass after inserts**, because a
parent may be created in the same batch as its child, or in a later batch entirely.

- After the existing insert/update work completes and `createdByNumber` is populated, collect rows
  that carried a non-empty `parent_customer_number`.
- Resolve each against the union of pre-existing customers and customers created in this batch,
  scoped to the account.
- Skip and warn when the parent is not found — it may arrive in a later page. Do not fail the row.
- Guard against self-reference (`parent_customer_number === customer_number`) and reject it with a
  warning; the column is a self-FK and a self-pointing row is corrupt data.
- Cycle detection across multiple levels is **out of scope** unless requested. Note the risk: the
  schema permits `A → B → A` and nothing currently prevents it.

## Implementation outline

All changes are inside `importCustomerBatch` in
`packages/billing-connector/src/import/entityImporter.ts` unless noted.

1. **Extend the projection.** Add `businessUnit`, `ownerEmail`, `stateIso2`, and
   `parentCustomerNumber` to the `prepared` object using the existing `str()` helper, matching the
   `|| null` convention used by the other optional fields.
2. **Add a batch resolver step** after the existing `Promise.all` that loads countries and existing
   customers. Extend that same `Promise.all` with three more queries — business units for the
   account, users for the distinct emails, states for the distinct country/iso2 pairs — so the
   round-trip count stays flat.
3. **Build lookup maps** keyed for case-insensitive matching (lowercase the keys on insert and on
   read).
4. **Thread resolved ids into `data`.** `business_unit_id` goes into the shared `data` object
   unconditionally, so inserts and updates both carry it. `owner_id`, `state_id`, and
   `parent_customer_id` are conditional — add each key only when the incoming value was non-empty
   and resolved, so an absent key leaves the stored value untouched on update.
5. **Add the parent-resolution pass** after `createdByNumber` is built, issuing a batched
   `commitOps` of `prisma.customer.update` calls in the same style as the existing `updates` block.
6. **Surface warnings** via `options?.onLog` and, where a row is meaningfully degraded, append to
   `result.errors` without incrementing `result.failed`.

## Codebase scan

### Required

| File | Why |
|---|---|
| `packages/billing-connector/src/import/entityImporter.ts` | The projection, the resolvers, the write payloads, and the parent second pass all live here. |

### Optional / out of scope unless requested

| File | Why |
|---|---|
| `packages/billing-connector/test/priorityCustomerFields.test.ts` | Already asserts the mapping catalog including `business_unit`. Would be the natural home for resolver tests, but tests are only added on explicit request. |
| `scripts/update-business-units-data.ts` | Its `--fix-orphans` pass only repairs customers whose `business_unit_id` is non-null and dangling. A backfill for existing `NULL` customers is a separate task. |
| `api/src/import/import.service.ts` | Stages `importRecord` rows only; it does not construct customer payloads. |
| Contact / Invoice / Payment importers | Same file, same projection idiom. Worth auditing for the identical class of silent drop, but not part of this change. |

### No change needed

| File | Why |
|---|---|
| `packages/billing-connector/src/utils/connectorFieldUtils.ts` | The catalog and the Priority default mappings are already correct; the fields are declared and mapped. The bug is purely on the consumption side. |
| `prisma/schema.prisma` | All four target columns (`business_unit_id`, `owner_id`, `state_id`, `parent_customer_id`) already exist, are nullable, and carry the right foreign keys and indexes. No migration required. |
| Frontend mapping UI | It renders whatever the catalog exposes, which already includes these fields. |

## Easy-to-miss touchpoints

- **`crn` and `type` are written on updates**, so the `data` object is reused for both paths. Adding
  `owner_id`, `state_id`, or `parent_customer_id` there unconditionally would violate the preserve
  rule on re-import — hence the conditional keys in step 4. `business_unit_id` is the one field that
  is safe to add unconditionally.
- **`lastWinsByKey` dedupes by `customerNumber`** before any resolution runs, so a later row in the
  same page silently overrides an earlier one. Resolution must happen on the winners, not on `valid`.
- **`Customer.owner_id` is a `String`, not an `Int`** — it references `User.id`, which is a string
  primary key. Easy to mistype given every other foreign key here is numeric.
- **The account may have no primary business unit at all.** `scripts/migrate-business-units.ts`
  creates one per account, but a newly created account that skipped that script will have none. The
  fallback must tolerate `null` rather than throwing.
- **`State.iso2` is nullable** in the schema, so the lookup map build must skip null iso2 rows to
  avoid a `null` key collision.

## Risks

- Assigning a primary-BU fallback changes existing import behaviour for every account, not just
  10149. Accounts that deliberately left customers unassigned will start seeing them scoped to the
  primary unit, which affects business-unit-filtered dashboards and login scoping.
- Because the fallback also applies on **update**, a business unit set manually in the Archaser UI
  is overwritten on the next sync whenever the ERP value is blank or unrecognised. For accounts that
  do not populate `IDG_COMPANYNAME`, every customer is pinned to the primary unit permanently and
  manual sub-unit assignment becomes impossible. If any account manages business units by hand, this
  needs an opt-out before rollout.
- Owner assignment from ERP email will start reassigning customer ownership on every sync for
  accounts that map `owner_email`. Since the preserve rule only guards *empty* values, a non-empty
  ERP value will overwrite a manual assignment made in Archaser.

## How to test

1. In the local database, confirm the target account has a primary business unit:
   `select id, name, is_primary from "BusinessUnit" where account_id = 10149;`
   If none exists, create one or run `scripts/update-business-units-data.ts` first.
2. Ensure the account's customer import mapping includes `business_unit → IDG_COMPANYNAME`,
   `owner_email → EMAIL`, `state_iso2 → STATECODE`, and `parent_customer_number → MCUSTNAME`.
3. Run a customer sync for account 10149.
4. Verify assignment:
   `select count(*), business_unit_id from "Customer" where account_id = 10149 group by 2;`
   Expect zero rows with `business_unit_id is null`.
5. Verify the other three resolved where source data existed:
   `select count(*) filter (where owner_id is not null) as owners,
           count(*) filter (where state_id is not null) as states,
           count(*) filter (where parent_customer_id is not null) as parents
    from "Customer" where account_id = 10149;`
6. Verify the preserve rule for owner/state/parent: manually set a customer's owner in the UI, re-run
   the sync with a blank `EMAIL` for that customer, and confirm the manual owner survives.
7. Verify the business-unit override: re-run the sync with a blank `IDG_COMPANYNAME` and confirm the
   customer is now on the primary business unit — for this field the sync deliberately wins over a
   manual assignment.
8. Verify no self-parenting: `select count(*) from "Customer" where id = parent_customer_id;`
   must return zero.
