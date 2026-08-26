---
name: Custom Priority table pull
overview: "Honor a connector's chosen Priority table by discovering its columns at pull time. Intersect $select, pick sort/date from what exists (optional admin date field on the mapping row). Do not hardcode IDG_ARFNCITEMS4 in core or in the account 10149 extension."
todos:
  - id: table-shape-helper
    content: Pure resolveTablePullShape — intersect select, order-by candidates, date field, filter field check
    status: completed
  - id: live-discover-pull
    content: PriorityProviderClient samples the table once per entity, reshapes the GET, fails on zero columns / unknown filter fields
    status: completed
  - id: pull-date-field
    content: ConnectorFieldMapping.pull_date_field + mapping GET/PUT + mapper dropdown
    status: completed
  - id: remove-hardcode
    content: Remove isArFinancialItemsEntitySet omit/orderBy/FNCDATE shortcuts
    status: completed
isProject: false
---

# Custom Priority table pull

## Problem

Account 10149 Payment uses custom table `IDG_ARFNCITEMS4` (connector `entity_sets`), not `TOTARPAY`. Backfill `$select` still asked for TOTARPAY columns (`CREDIT`, `PAYNUM`, …) and returned HTTP 400. Core then special-cased `ARFNCITEMS` names. That encodes a one-off import table in the generic client. The 10149 extension only runs `transform` after the GET, so it cannot fix `$select`.

## Decisions (grill)

| # | Topic | Decision |
|---|-------|----------|
| D1 | Table shape | Live discovered columns — only request fields that exist |
| D2 | When to discover | At pull start, every sync (unfiltered `$top=5`) |
| D3 | `$orderby` | Contract default if present; else first of `FNCNUM`, `IVNUM`, `PAYNUM`, `CUSTNAME` |
| D4–D6 | Date column | Optional `pull_date_field` on the mapping row; else first of `FNCDATE`, `PAYDATE`, `IVDATE`, `BALDATE`, `UDATE` |
| D7 | Incremental | Same date column as the backfill window (not hardcoded `UDATE`) |
| D8 | Pull filters | Fail fast if a filter names a missing column |
| D9 | Empty sample | Fail the entity pull |
| D10 | Sample filter | Unfiltered — do not apply pull filters or the date window |

Extension stays transform-only (shekel / credit sign). `entity_sets` stays a table-name string.

## Behavior

For each entity, once per sync:

1. `GET {table}?$top=5` with no `$select` / `$filter`.
2. If zero columns → fail: table returned no columns.
3. `$select` = (mapping/synthetic request ∪ order-by ∪ date field) ∩ discovered names.
4. `$orderby` per D3. Date `$filter` per D4–D7 when a window/watermark applies.
5. If compiled pull filter uses a name not in discovered columns → fail with those names.

Cache the column list on the provider instance so page 2 does not re-sample.

## Codebase scan

**Required**

- `packages/billing-connector/src/priority/PriorityProviderClient.ts` — live sample + reshape; remove ARFNCITEMS omit list
- `packages/billing-connector/src/priority/PriorityClient.ts` — raw sample without payment synthetics (synthetic names are not OData columns)
- `packages/billing-connector/src/billing/BillingProviderClient.ts` — `preferredDateField`, `createdOnOrAfter` on `PullOptions`
- `packages/billing-connector/src/sync/stagedExtensionSync.ts` — pass date field; stop hardcoding `PAYDATE`/`IVDATE` in the filter
- `packages/billing-connector/src/sync/runInProcessSync.ts` — pass `pull_date_field` from mapping; same PullOptions on legacy path
- `packages/billing-connector/src/services/billingConnectorEntitySets.ts` — remove `isArFinancialItemsEntitySet` if unused
- `packages/billing-connector/src/index.ts` — drop that export
- `prisma/schema.prisma` + SQL migration — `ConnectorFieldMapping.pull_date_field`
- `api/src/billing-connector/billing-connector.service.ts` — get/put mapping
- `shared/services/billingConnectorService.ts` — mapping payload
- `shared/layout-components/import/ConnectorFieldMapper.tsx` — date field dropdown (reuse existing Autocomplete)
- `types/db.ts` — mapping row type

**Optional / out of scope**

- `$metadata` parser (D9 alternative, deferred)
- Extension pull hooks
- Changing `entity_sets` from a string map
- i18n keys (mapper already uses English “Priority table”; same pattern — no translation file edits)
- New tests unless requested

**No change**

- `extensions/account_10149` — still sign/currency only
- Preview sample fetch (already unfiltered, no `$select`) except it should keep working

## Testing strategy (map to decisions)

| Decision | Test unit (when tests are requested) |
|----------|--------------------------------------|
| D1 | Requested `$select` CREDIT+CREDIT1 + discovered CREDIT1 only → GET omits CREDIT |
| D3 | Discovered FNCNUM not PAYNUM → `$orderby=FNCNUM` |
| D6 | No pull_date_field + FNCDATE present → filter uses FNCDATE |
| D8 | Filter `CREDIT ne 0` + columns without CREDIT → throw naming CREDIT |
| D9 | Sample `value: []` → throw no columns |
| D10 | Discovery URL has no `$filter` |

## Rollout

Apply SQL on the DB the API uses. Restart API. For 10149 Payment, FNCDATE is picked by D6 without a UI click; optional mapping date field documents the choice. Re-run payment backfill.
