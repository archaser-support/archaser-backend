---
name: transaction-hardening-roadmap
overview: Harden all identified multi-write flows with Prisma transactions, delivered in low-risk phases with compile and behavior validation after each phase.
todos:
  - id: phase1-lowrisk
    content: Implement transactions in handleDisputeReasonsPUT, handleTemplatesPUT, and handleCompanyRelation
    status: pending
  - id: phase2-payment
    content: Make PaymentService.createInvoicePayment atomic with invoice recalculation/update
    status: pending
  - id: phase2-permissions
    content: Wrap PermissionService.updateRolePermissions in atomic transaction and remove partial-write behavior
    status: pending
  - id: phase3-notifications
    content: Add transaction boundaries in DueNotificationService.processInvoicesForDueStep and entities handleCustomerLogCallActivity
    status: pending
  - id: phase3-closure-delivery
    content: Add transaction boundaries in CollectionPeriodService.closeCollectionPeriod and ActivityService.handleEmailDelivery DB updates
    status: pending
  - id: validation-tests
    content: Run tsc/lint and add rollback-focused tests mapped to each transactional business flow
    status: pending
isProject: false
---

# Transaction Hardening Plan

## Goal
Implement transactions for all high-confidence non-atomic write flows found in the project, prioritizing low-risk/high-impact paths first, then medium-risk services, then complex orchestration flows.

## Findings To Implement
- **Account creation already covered** in [`/Users/ofiramitai/Sites/archaser/archaser/server/services/AccountService.ts`](/Users/ofiramitai/Sites/archaser/archaser/server/services/AccountService.ts); use this as the transaction pattern baseline.
- **High-priority remaining candidates**:
  - [`/Users/ofiramitai/Sites/archaser/archaser/server/services/PaymentService.ts`](/Users/ofiramitai/Sites/archaser/archaser/server/services/PaymentService.ts) (`createInvoicePayment`)
  - [`/Users/ofiramitai/Sites/archaser/archaser/server/services/DueNotificationService.ts`](/Users/ofiramitai/Sites/archaser/archaser/server/services/DueNotificationService.ts) (`processInvoicesForDueStep`)
  - [`/Users/ofiramitai/Sites/archaser/archaser/server/services/ActivityService.ts`](/Users/ofiramitai/Sites/archaser/archaser/server/services/ActivityService.ts) (`handleEmailDelivery`)
  - [`/Users/ofiramitai/Sites/archaser/archaser/server/services/CollectionPeriodService.ts`](/Users/ofiramitai/Sites/archaser/archaser/server/services/CollectionPeriodService.ts) (`closeCollectionPeriod`)
  - [`/Users/ofiramitai/Sites/archaser/archaser/pages/api/entities/[...path].ts`](/Users/ofiramitai/Sites/archaser/archaser/pages/api/entities/[...path].ts) (`handleCustomerLogCallActivity`)
  - [`/Users/ofiramitai/Sites/archaser/archaser/pages/api/operations/[...path].ts`](/Users/ofiramitai/Sites/archaser/archaser/pages/api/operations/[...path].ts) (`handleDisputeReasonsPUT`)
  - [`/Users/ofiramitai/Sites/archaser/archaser/pages/api/activities/[...path].ts`](/Users/ofiramitai/Sites/archaser/archaser/pages/api/activities/[...path].ts) (`handleTemplatesPUT`)
  - [`/Users/ofiramitai/Sites/archaser/archaser/pages/api/import/customer/index.ts`](/Users/ofiramitai/Sites/archaser/archaser/pages/api/import/customer/index.ts) (`handleCompanyRelation`)
  - [`/Users/ofiramitai/Sites/archaser/archaser/server/services/PermissionService.ts`](/Users/ofiramitai/Sites/archaser/archaser/server/services/PermissionService.ts) (`updateRolePermissions`)

## Implementation Strategy

### Phase 1: Low-Risk API Handlers (fast wins)
1. Add transaction wrappers to:
   - `handleDisputeReasonsPUT`: `disputeReason.update` + language `deleteMany/create` in one `prisma.$transaction`.
   - `handleTemplatesPUT`: template update + language mutation branch in one transaction.
   - `handleCompanyRelation`: company create + customer relation update in one transaction.
2. Keep response shape and validation behavior unchanged.
3. Preserve non-DB side effects (logging/notifications) outside transaction when not part of consistency boundary.

### Phase 2: Medium-Risk Service Flows
1. `PaymentService.createInvoicePayment`
   - Move payment create + invoice aggregate/totals/status update into one transaction.
   - Ensure any derived totals are computed from reads inside the same tx.
2. `PermissionService.updateRolePermissions`
   - Wrap `deleteMany + upsert loop` in one transaction.
   - Fail atomically on DB errors to avoid partial ACL state.

### Phase 3: Complex Orchestration Flows
1. `DueNotificationService.processInvoicesForDueStep`
   - Tx boundary: `activity.create` + related invoice state updates + `activityContact` inserts.
2. `CollectionPeriodService.closeCollectionPeriod`
   - Tx boundary: disputes closure + scheduled activity cancellation + collection-period close + customer status transition.
3. `entities/[...path].ts::handleCustomerLogCallActivity`
   - Tx boundary: activity create(s) + activity-contact links + collection-period updates + reminder rows if DB-backed.
4. `ActivityService.handleEmailDelivery`
   - Tx boundary only for DB state propagation (`activityContact/contact/activity/customerCollectionPeriod` updates).
   - Keep external operations (email transport/fallback handling) outside tx; if needed, follow-up with outbox design.

## Shared Patterns To Apply
- Reuse the `DbClient` pattern from [`/Users/ofiramitai/Sites/archaser/archaser/lib/prisma.ts`](/Users/ofiramitai/Sites/archaser/archaser/lib/prisma.ts) for methods that can run with either root prisma or tx client.
- Keep transactions short: no network calls or long loops that can be moved outside DB-critical sections.
- Maintain current API/service return contracts to avoid frontend regressions.

## Testing Strategy

### Static Safety
- Run `npx tsc --noEmit` after each phase.
- Run `npm run lint` at end of each phase (or at least before merge).

### Unit/Integration Mapping To Business Requirements
- **Atomic create/update/delete for related rows**
  - Add/extend tests in service or API test suites to simulate mid-flow failure and assert rollback.
- **Payment consistency**
  - Test that invoice totals/status and payment rows are either both updated or both unchanged.
- **Role-permission consistency**
  - Test that failed permission update keeps prior permission set intact.
- **Notification/activity consistency**
  - Test that no orphan activity exists without matching invoice/contact updates.
- **Collection period closure integrity**
  - Test that closure either applies all required transitions or none.

### Suggested Test Targets
- [`/Users/ofiramitai/Sites/archaser/archaser/tests/unit/services`](/Users/ofiramitai/Sites/archaser/archaser/tests/unit/services)
- [`/Users/ofiramitai/Sites/archaser/archaser/tests/integration/services`](/Users/ofiramitai/Sites/archaser/archaser/tests/integration/services)

## Delivery Order
1. Phase 1 (quick, low regression risk)
2. Phase 2 (critical correctness)
3. Phase 3 (highest complexity, potentially split into multiple PRs)

## Exit Criteria
- All listed flows have explicit transaction boundaries.
- Type-check and lint pass.
- Regression tests for rollback behavior are in place for each phase.
