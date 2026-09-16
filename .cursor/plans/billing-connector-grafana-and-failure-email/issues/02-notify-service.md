# 02 — BillingConnectorNotifyService with In-Memory Cooldown

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 4, 5, 6, 7, 8, 9, 10, 11
**PRD:** `.cursor/plans/billing-connector-grafana-and-failure-email.prd.md`

## What to build

Create a new plain TypeScript class `BillingConnectorNotifyService` inside `packages/billing-connector/src/notify/`. It must have no Nest DI dependency so it can be called from the BullMQ worker context in the connectors service.

### Core behaviour

The service exposes one public method:

```
notifyOnFailure(params: {
  accountId: number;
  provider: string;
  status: 'FAILED' | 'PARTIAL' | 'TIMEOUT';
  errorMessage: string | null | undefined;
  executionId: string;
  completedAt: Date;
}): Promise<void>
```

1. **Environment gate:** return early unless `BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED=true` OR `NODE_ENV=production`.
2. **Recipients:** read `BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS` (comma-separated). If empty/missing, return early.
3. **Cooldown check:** read the last-notified timestamp for `accountId` from a module-level `Map<number, Date>`. If `now - lastNotified < cooldownMs`, return early (skip silently).
4. **Send:** compose a minimal HTML email via `sendSmtpHtmlEmail` from `packages/cron-jobs`:
   - Subject: `[ARchaser] Billing Connector Sync Failure — Account {accountId} ({provider}) — {status}`
   - Body: include account ID, provider, status, error message (truncated to 500 chars), execution ID, timestamp.
5. **After send:** update the cooldown map only if the result is not `{ skipped: true }` (i.e. SMTP is configured and a send was attempted).

### Configuration read

- `BILLING_CONNECTOR_ERROR_NOTIFY_COOLDOWN_MINUTES` → cooldown in minutes (parse to number, default 60). Read once per class instantiation or per-call (either is fine; per-call allows runtime changes).
- `BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS` → split on `,`, trim each entry, drop empties.

### Dependency check

Verify whether `packages/billing-connector/package.json` already lists `packages/cron-jobs` as a workspace dependency. If not, add it (workspace protocol reference). Alternatively, copy only the minimal `sendSmtpHtmlEmail` logic into a thin wrapper in `packages/billing-connector/src/notify/` to avoid a heavyweight dependency — decide based on what other packages the billing-connector package.json already imports.

### Exports

Export `BillingConnectorNotifyService` from `packages/billing-connector/src/notify/index.ts` and re-export from the package root `packages/billing-connector/src/index.ts`.

## Acceptance criteria

- [ ] `BillingConnectorNotifyService` class exists in `packages/billing-connector/src/notify/`
- [ ] Environment gate: does not send when `BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED` is absent and `NODE_ENV !== "production"`
- [ ] Recipients gate: does not send when `BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS` is empty
- [ ] Cooldown: does not send a second notification for the same account within the cooldown window
- [ ] Cooldown window default is 60 minutes; overridable via env var
- [ ] Cooldown map is not updated when `sendSmtpHtmlEmail` returns `{ skipped: true }`
- [ ] Subject line matches the specified format
- [ ] Error message is truncated to 500 chars in the email body
- [ ] Unit tests cover: env gate, recipient gate, cooldown skip, cooldown expire, SMTP-skipped does not update cooldown
- [ ] TypeScript compiles without errors

## How to test

**Automated:**
Run the unit tests for the new service after implementation.

**Manual (requires SMTP configured in .env):**
1. Set `BILLING_CONNECTOR_ERROR_NOTIFY_ENABLED=true`, `BILLING_CONNECTOR_ERROR_NOTIFY_EMAILS=your@email.com`, and SMTP vars in `.env`.
2. Add a temporary call to `notifyOnFailure` with a hardcoded FAILED result in the connectors bootstrap or a test script.
3. Start the connectors service and trigger the call.
4. Confirm an email arrives at the configured address with the correct subject and body.
5. Trigger a second call within 60 minutes — confirm no second email is sent.
