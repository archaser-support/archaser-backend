# 03 — Wire Failure Notification into Sync Lifecycle

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [02-notify-service](02-notify-service.md)
**User stories:** 4, 5, 9
**PRD:** `.cursor/plans/billing-connector-grafana-and-failure-email.prd.md`

## What to build

Wire the `BillingConnectorNotifyService` into the billing connector sync lifecycle so that after every sync execution is finalized, a failure notification is sent if appropriate.

### Integration point

The cleanest seam is `finalizeSyncHistoryAfterRun` in `packages/billing-connector/src/syncHistory/finalizeSyncHistoryAfterRun.ts`. After the execution is written to Mongo (`completeExecution` or `deferExecutionCompletionUntilPostIngestDrain`), call `notifyService.notifyOnFailure(...)` with the resolved status, error, and execution ID.

Alternatively, the call can be placed at the call site in `inProcessSyncLifecycle.ts` (`runAcceptedInProcessSync`) after `finalizeSyncHistoryAfterRun` returns. Choose whichever makes the data available most cleanly — the status and error are available from the `RunInProcessSyncResult` at both points.

### Fire-and-forget

Wrap the notify call in a `.catch(() => { /* never block the sync lifecycle */ })` pattern — a notification failure must never propagate to the sync run or the BullMQ job.

### For deferred post-ingest executions

The `deferExecutionCompletionUntilPostIngestDrain` branch does not write a terminal status immediately. Notification for these executions should fire when `finalizeAwaitingPostIngestDrainExecutions` (in `syncHistory`) writes the terminal status. Locate that finalization code and add the same notify call there.

### No new env vars in this slice

All configuration is read by `BillingConnectorNotifyService` (slice 02). This slice only adds the call sites.

## Acceptance criteria

- [ ] `notifyOnFailure` is called after `finalizeSyncHistoryAfterRun` completes (or at the equivalent call site)
- [ ] Notification call is fire-and-forget — errors are caught and logged, never thrown
- [ ] For deferred post-ingest executions, notification is also wired into the drain-finalizer path
- [ ] A sync that finishes SUCCESS does not trigger a notification call that would send email (gated in the service)
- [ ] TypeScript compiles without errors
- [ ] Existing sync lifecycle tests (if any) still pass

## How to test

1. Configure `BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED=true` and `BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS` in the connectors `.env`.
2. Trigger a billing connector sync for a test account that will fail (e.g. wrong API key, or use a test account with an intentionally bad connector config).
3. Confirm a failure email is received at the configured address.
4. Trigger a successful sync — confirm no email is sent.
5. Trigger a second failing sync for the same account within 60 minutes — confirm no second email (cooldown working end-to-end).
