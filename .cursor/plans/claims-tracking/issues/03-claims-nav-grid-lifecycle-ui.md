# 03 — Claims nav page, grid, and lifecycle UI

**Status:** done
**Priority:** high
**Blocked by:** [01-claim-schema-domain-api](01-claim-schema-domain-api.md)
**User stories:** 6–12, 21, 25–26
**PRD:** `.cursor/plans/claims-tracking.prd.md`

## What to build

Add a top-level **Claims** navigation item and page patterned after Disputes: visible only when `has_credit_insurance` is true. Page hosts a grid of all account claims with customer/invoice context when linked. Support manual create (invoice optional) for historical backfill, edit Draft fields including recognized loss override, and drive status transitions including Submitted required fields and optional Under Inquiry. EN+HE for nav, grid, dialogs, and statuses.

## Acceptance criteria

- [x] Claims nav item shows only for credit-product accounts; hidden otherwise
- [x] Claims page grid lists claims with status and key amounts
- [x] Manual create works with and without an invoice
- [x] Status transitions enforce Submitted required fields in the UI
- [x] Recognized loss can be overridden before Approve/Paid
- [x] English and Hebrew strings added together

## How to test

1. Log into a credit-product account — Claims appears in nav (near Disputes-style placement); open it and see the grid.
2. Log into a non-credit account — Claims nav is absent.
3. Manually create a historical claim without an invoice; it appears in the grid.
4. Move a Draft to Submitted — UI requires date + insurer reference.
5. Override recognized loss, move to Approved — confirm via remaining excess (slice 01/04) that the override was used.
6. Hebrew locale — nav label, statuses, and dialogs translate.
