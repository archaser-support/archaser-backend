# 03 — Customer outreach gate (email / SMS / WhatsApp)

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [01-schema-admin-demo-toggle](01-schema-admin-demo-toggle.md)
**User stories:** 5, 6, 7, 8, 9, 17, 18
**PRD:** `.cursor/plans/demo-account-toggle.prd.md`

## What to build

Wire the shared policy from slice 01 into customer-facing send paths: activity workflow email/SMS/WhatsApp, manual customer send-email, dispute-resolution customer mail, and any equivalent contact outreach.

When staging **and** Demo OFF: do not call SMTP/SMS vendors; still create timeline/delivery records as not sent with a stable Demo-disabled reason; surface a toast-friendly error/message on manual send.

Explicitly **do not** gate: password reset, welcome/password-setup, internal email templates, credit notification rules, billing-connector ops alerts.

Outside staging: always allow customer outreach regardless of `is_demo`.

English and Hebrew for user-visible toast/reason copy.

## Acceptance criteria

- [ ] Staging Demo OFF blocks debtor/contact Email/SMS/WhatsApp; activity shows not-sent + reason; manual send shows toast
- [ ] Staging Demo ON sends customer outreach normally
- [ ] Staff/ops mail still sends when Demo OFF
- [ ] Non-staging ignores `is_demo` for outreach
- [ ] EN + HE strings for new user-facing messages

## How to test

1. Staging Demo OFF: send customer email from customer page — toast says not sent; timeline has not-sent Demo reason; no inbox delivery.
2. Same account: trigger SMS path if available — skipped similarly.
3. Password reset + create user welcome still arrive with Demo OFF.
4. Turn Demo ON: same customer send delivers.
5. Local/production: customer mail works with `is_demo` false.
