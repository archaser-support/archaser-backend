---
name: clickup-chat-grafana-alerts
overview: Post production Grafana ops alerts into the existing ARchaser ClickUp Chat channel (markdown messages, not tasks), using the existing SNS Lambda fan-out, while keeping email and Slack unchanged.
source: grill-me session
clickup_task_url: null
isProject: false
---

# ClickUp Chat Grafana Alerts

## Problem Statement

On-call engineers already receive production Grafana alerts by email (and Slack when Amazon SNS Simple Notification Service Chatbot is configured), but nothing appears in the ClickUp Chat they already keep open for ARchaser work. Critical events such as PostgreSQL Disconnected can sit in an inbox while the team is looking at the ARchaser channel. Product KPI Key Performance Indicator warning cards and credit notification rules are a different problem (in-app and email to tenant users) and are not what this work solves.

## Solution

When Grafana sends a production alert to the existing webhook Lambda, that Lambda still sends email via SES Simple Email Service and still publishes to SNS Simple Notification Service for Slack. It also posts a markdown Chat **message** (not a ClickUp task, not a Chat Post/Announcement) into the existing public **ARchaser** ClickUp Chat channel.

Routing matches the Grafana split already live:

- **Critical** (PostgreSQL Disconnected, MongoDB Disconnected, Postgres FATAL, billing connector auth failures, and other `severity: critical` rules) — one Chat message as soon as the webhook runs; a second message when the alert **clears**.
- **High and medium** — one **digest** Chat message listing the alerts in that Grafana group (firing only). No Chat message when a digest group clears.
- **Staging** — still silent. Grafana’s silent staging contact point must not reach this Lambda; ClickUp must not get staging noise.

No @mentions and no Chat message assignees. If ClickUp credentials are missing, skip Chat and still deliver email and Slack. If ClickUp posting fails, log the error and still return success for email and Slack so Grafana does not retry and duplicate paging.

## User Stories

1. As an on-call engineer, I want a Chat message in the ARchaser channel when a production critical Grafana alert fires, so that I see database and billing-auth outages without leaving ClickUp.

2. As an on-call engineer, I want that critical Chat message within the same window as today’s email (about 1–2 minutes after Grafana groups the alert), so that Chat is not a slower second-class page.

3. As an on-call engineer, I want a Chat message when a production critical alert **clears**, so that I know when to stand down.

4. As an on-call engineer, I want high and medium production alerts (stuck activities, cron overdue, email bounces, SMS failures, error-rate spikes) to appear in ARchaser as well, so that the channel is a complete ops view, not critical-only.

5. As an on-call engineer, I want those high and medium alerts batched into **one digest Chat message** per Grafana notification group, so that ARchaser is not flooded with one message per rule.

6. As an on-call engineer, I want digest Chat messages to list each alert’s name, severity, summary, and firing status, so that I can triage without opening email first.

7. As an on-call engineer, I do **not** want a Chat message when a high or medium alert clears, so that ARchaser is not doubled by resolved digest noise (email may still show resolved).

8. As an on-call engineer, I want the digest to wait for Grafana’s existing 15–30 minute group window, so that Chat grouping matches the digest email I already receive.

9. As an on-call engineer, I want Chat messages to use the same 🚨 firing and ✅ cleared cues as Slack and email, so that I can scan severity at a glance.

10. As an on-call engineer, I want a Grafana drilldown dashboard link in every Chat message, so that investigation is one click from ARchaser.

11. As an on-call engineer, I want generator or alert-list links preserved when Grafana sends them, so that I can open the firing rule, not only the drilldown board.

12. As an on-call engineer, I want Chat copy in English, matching Grafana email and Slack, so that ops language stays one dialect.

13. As an on-call engineer, I do **not** want @mentions on these Chat messages, so that I am not pinged twice (email already pages).

14. As an on-call engineer, I do **not** want the Chat message assigned to a person, so that ownership stays “whoever is watching ARchaser,” not a stale assignee.

15. As an on-call engineer, I want to keep receiving the existing alert **email**, so that ClickUp Chat is extra visibility, not a replacement pager.

16. As an on-call engineer, I want Slack to keep working if AWS Chatbot is already subscribed to the SNS Simple Notification Service topic, so that this change does not silently drop an existing channel.

17. As an on-call engineer, I want staging Grafana alerts to stay out of ARchaser, so that test-environment flakes do not look like production incidents.

18. As an on-call engineer, I want to still open staging alerts in the Grafana UI, so that I can debug staging without Chat noise.

19. As a team member reading ARchaser for product work, I want alerts as ordinary Chat messages (not tasks in the ARchaser list), so that the board is not filled with incident tickets.

20. As a team member reading ARchaser, I want alerts as Chat **messages**, not titled Posts or Announcements, so that they behave like Slack lines in the same thread of conversation.

21. As a team member reading ARchaser, I want alerts in the **ARchaser** channel, not Customers, so that customer discussion stays separate.

22. As a platform engineer, I want ClickUp posting to live in the existing Grafana webhook Lambda, so that we do not add a second Grafana contact point or a second webhook.

23. As a platform engineer, I want Grafana notification policies unchanged in this slice, so that critical vs digest grouping stays the policy already shipped.

24. As a platform engineer, I want Grafana alert rule UIDs, PromQL, and severities unchanged, so that alert history and dashboards keep working.

25. As a platform engineer, I want ClickUp Chat gated on CloudFormation or Lambda environment values (token, channel id, optional workspace id), so that secrets stay out of git.

26. As a platform engineer, I want Chat posting skipped (not failed) when the ClickUp token or channel id is empty, so that a half-configured deploy still emails.

27. As a platform engineer, I want a ClickUp API Application Programming Interface failure to be logged without failing SES Simple Email Service or SNS Simple Notification Service, so that a Chat outage cannot block paging.

28. As a platform engineer, I want the Lambda HTTP response to include whether Chat was posted, skipped (unconfigured), skipped (digest resolved), or failed, so that the existing test-alerts script can assert behavior without scraping ClickUp.

29. As a platform engineer, I want the existing 24-hour firing cooldown to apply to Chat the same way it applies to email (whole handler skip), so that a repeating firing webhook does not produce a Chat storm while email is suppressed.

30. As a platform engineer, I want resolved **critical** webhooks to bypass that firing cooldown (as email does today), so that a “cleared” Chat message still goes out after a recent fire.

31. As a platform engineer, I want a dry-run or missing-token mode that builds the Chat payload and reports skip/posted intent without calling ClickUp, so that we can regression-test in CI or on a laptop.

32. As a developer, I want a small pure function that turns a Grafana webhook body into Chat intents (post vs skip, markdown body), so that routing rules are unit-testable without AWS or ClickUp.

33. As a developer, I want test-alerts.sh extended with critical firing, critical resolved, digest firing, and digest resolved cases for Chat fields, so that the live webhook contract stays covered.

34. As a developer, I want digest resolved to still send email (current behavior) while Chat is skipped, so that we do not change inbox semantics while quieting ARchaser.

35. As an operator deploying the stack, I want README notes for the new ClickUp parameters and a How to test checklist, so that rollout is repeatable after CloudFormation update.

36. As an operator, I want the Chat bot identity to be whatever token we configure (workspace bot or dedicated user), so that messages are not posted as a random teammate’s personal account unless we choose that.

37. As an operator, I accept possible duplicate Chat lines if Grafana retries after email already succeeded, so that we do not add a second ClickUp-specific dedup store in v1.

38. As a product owner, I want credit Limit warnings, overdue block, capacity gap, and notification-rule emails left unchanged, so that tenant KPI Key Performance Indicator alerts do not land in the internal ARchaser channel.

39. As a product owner, I want collection due notifications and in-app Notification Center unchanged, so that this slice stays Grafana ops only.

40. As a security-conscious operator, I want the ClickUp token treated as a secret CloudFormation parameter (NoEcho), so that it does not appear in logs or git.

41. As an on-call engineer, I want mixed Grafana groups that contain any critical alert treated as critical for Chat (immediate message plus cleared follow-up), so that a critical line is never buried inside a digest skip rule.

42. As an on-call engineer, I want billing-connector critical production rules included, so that ERP Enterprise Resource Planning auth failures appear in ARchaser like database outages.

43. As an on-call engineer, I want the Chat digest to say how many alerts are in the batch, so that I know whether I am looking at one issue or several.

44. As a Hebrew-speaking engineer, I accept ops Chat copy in English only for this slice, so that we do not add product locale keys for an internal Grafana fan-out.

45. As a teammate, I want no new in-app UI, settings screen, or account-level ClickUp integration, so that this remains infrastructure, not a tenant feature.

## Implementation Decisions

### Grill locks

| # | Topic | Decision |
|---|-------|----------|
| D1 | ClickUp surface | Chat **message**, not a task |
| D2 | Signal source | Grafana / ops alerts only |
| D3 | Channel | Existing public **ARchaser** Chat channel |
| D4 | Volume | All **production** severities (critical, high, medium) |
| D5 | Grouping | Critical = its own message; high/medium = one digest message |
| D6 | Cleared | Chat “cleared” **only for critical**; digest is firing-only |
| D7 | Existing paths | Keep email and Slack; **add** ClickUp Chat |
| D8 | Pings | No @mention and no Chat assignee |

Inherited from Grafana alert routing: staging stays silent; production critical is immediate; high/medium wait in Grafana before one webhook.

### Primary architecture

Grafana already fans out: alert rule → notification policy → `sns-alerts` webhook → Lambda → SES Simple Email Service email + SNS Simple Notification Service (Slack and other subscribers). **Add ClickUp Chat as a third side effect in that same Lambda** after email and SNS succeed or independently in parallel with failure isolation.

Do **not** add a Grafana ClickUp contact point. Do **not** add a second API Gateway. Grouping stays in Grafana policies; the Lambda only classifies `deliveryTier` (`critical` vs `digest`) the way it already does for email subjects.

### Chat posting rules

Given a parsed Grafana webhook (`status`, `alerts[]`, `commonLabels`, `groupLabels`):

1. Classify `deliveryTier` with the existing helper (any `critical` label → critical; else digest; honor `delivery: digest` if present).
2. If ClickUp token or channel id is empty → skip Chat (`clickupStatus: skipped_unconfigured`).
3. If `deliveryTier` is digest **and** webhook `status` is `resolved` → skip Chat (`clickupStatus: skipped_resolved_digest`). Still send email and SNS.
4. Otherwise post one markdown Chat **message** to the configured channel (`type: message`, markdown content). No Post title, no Announcement, no `parent_message_id` (no threads in v1).
5. Reuse the existing 🚨 / ✅ and `[CRITICAL]` / `[Digest]` / `[RESOLVED]` wording already used in email/Slack plain text. Include the same Grafana drilldown dashboard URL the email footer already builds. Include a short per-alert list for digest batches.
6. Do not @mention users. Do not set Chat assignee or followers.

### Failure isolation and HTTP contract

- SES and SNS remain the paging path. ClickUp errors are caught, logged, and surfaced as `clickupStatus: failed` on a **200** response when email/SNS already succeeded.
- Do not fail the webhook (5xx) solely because ClickUp failed — Grafana retries would duplicate email.
- Extend the existing JSON response with `clickupStatus` and optional `clickupError` (non-secret). Keep `deliveryTier` and `subject`.

### Configuration (names only — humans set values)

CloudFormation / Lambda environment (illustrative names; do not commit secrets):

- `CLICKUP_CHAT_TOKEN` — NoEcho secret; Chat write access
- `CLICKUP_CHAT_CHANNEL_ID` — ARchaser channel id
- `CLICKUP_CHAT_WORKSPACE_ID` — optional if the Chat API requires workspace scope
- `CLICKUP_CHAT_ENABLED` — optional explicit toggle; default on when token and channel id are both set

Agents must not read or write local dotenv or PEM files. Operators paste values into CloudFormation parameters or their own env.

### Cooldown

Keep the existing DynamoDB 24-hour cooldown on **firing** webhooks (keyed by Grafana group alert name). When the handler returns “suppressed due to cooldown,” skip Chat as well. Resolved critical is not in that firing branch today and must still post to Chat.

Do not add a separate ClickUp cooldown table in v1.

### i18n

No product English/Hebrew locale keys. Chat strings are ops English, same as Grafana email subjects and Slack text.

### Schema / product API

No Prisma changes. No Nest or Next.js routes. No notification-rule `clickup` channel.

### Codebase scan

**Required**

- SNS CloudFormation Lambda handler — add Chat post + response fields
- CloudFormation parameters and Lambda environment for ClickUp token / channel
- Lambda IAM — outbound HTTPS only (no new AWS service); Chat is public ClickUp API
- `test-alerts.sh` — assert `clickupStatus` for critical firing, critical resolved, digest firing, digest resolved (resolved digest → skipped)
- SNS README — document ClickUp parameters and How to test

**Optional / out of scope unless requested**

- Extract inline ZipFile Lambda into a repo TypeScript module for richer unit tests
- Slack integration markdown — one-line “Chat is additive”
- Grafana silent-staging contact point — already correct; no change

**No change needed**

- Grafana production/staging **rule** YAML — conditions unchanged
- Grafana notification policies and contact points — already split critical vs digest vs staging
- Credit notification-rule engine (`in_app` / `email` only)
- Credit dashboard KPI Key Performance Indicator cards (Limit warnings, overdue block, and similar)
- Frontend, Prisma, i18n JSON
- ClickUp task workflow / `/start-work` process docs
- Amazon Chatbot Slack subscription (leave as-is)

### Easy-to-miss

- Contact point `disableResolveMessage` is false, so digest **resolved** webhooks still hit the Lambda; Chat must skip them even though email still sends.
- Cooldown key is Grafana **group** `alertname`; digest batches that share one group name suppress as a group, including Chat.
- ZipFile size: keep Chat client small (HTTPS POST). Do not bundle an SDK if a single fetch suffices.
- Do not log the ClickUp token.

## Testing Decisions

### What makes a good test

Assert **observable delivery intents**, not ClickUp’s internal message ids or CloudFormation YAML shape.

Given a Grafana webhook JSON fixture:

- critical firing → Chat intent posted, markdown contains CRITICAL and 🚨, `clickupStatus` posted (or dry-run equivalent)
- critical resolved → Chat intent posted, markdown contains RESOLVED and ✅
- digest firing (several high/medium alerts) → one Chat intent, markdown lists each alert, Digest marker
- digest resolved → **no** Chat intent (`skipped_resolved_digest`); email/SNS path still described as send
- empty token → `skipped_unconfigured`, no HTTP to ClickUp
- ClickUp HTTP 5xx after SES mock success → handler still 200, `clickupStatus: failed`

Do not assert IAM policy JSON, parameter order, or exact ClickUp request headers beyond auth being present.

### Primary seam (one seam)

**Grafana webhook Lambda contract:** payload in → `{ deliveryTier, subject, clickupStatus }` out, with a pure **Chat intent builder** covering skip vs post and markdown body.

This is the same seam `test-alerts.sh` already uses for email subject prefixes. Prefer extending that script plus unit tests on the intent builder. Do not add a second seam in Grafana provisioning for this feature.

### Prior art

- `infrastructure/sns/test-alerts.sh` — live webhook cases for critical firing, critical resolved, digest firing
- Grafana alert-routing PRD — deliveryTier / subject assertions, not policy YAML internals

### Manual How to test

1. Update the production alert stack with ClickUp parameters set. Confirm ARchaser Chat is the target channel.
2. POST a synthetic **critical firing** payload (existing test script). Expect email + Slack as today, **and** a markdown message in ARchaser. No @mention.
3. POST the matching **critical resolved** payload. Expect a cleared Chat message in ARchaser and a resolved email.
4. POST a **digest firing** payload with three high/medium alerts. Expect **one** ARchaser digest message listing all three, plus digest email.
5. POST a **digest resolved** payload. Expect **no** new ARchaser message; email may still show resolved.
6. Confirm staging Grafana still does not invoke the webhook (silent policy). Nothing new in ARchaser from staging.
7. Temporarily unset the token in a non-prod or dry-run and POST critical firing. Expect email still; Chat skipped; webhook 200.

## Out of Scope

- Creating or updating ClickUp **tasks**, subtasks, or comments
- ClickUp Chat Posts, Announcements, threads, @mentions, or assignees
- A new Grafana contact point or second webhook
- Changing Grafana rule thresholds, PromQL, severities, or notification policy timings
- Replacing or turning off email or Slack
- Staging Chat posts
- Product KPI Key Performance Indicator warnings (Limit warnings, overdue block, capacity gap, reporting countdown, zero-limit)
- Credit or collection notification-rule engine; adding a `clickup` delivery channel for tenant users
- In-app Notification Center changes
- Per-account or tenant ClickUp integrations
- Hebrew (or other) localization of ops Chat copy
- Dashboard reorganization
- A dedicated Alerts ClickUp channel (explicitly not chosen)
- ClickUp-specific dedup storage beyond the existing email cooldown

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/clickup-chat-grafana-alerts/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/clickup-chat-grafana-alerts/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Chat intent and skip contract | `issues/01-chat-intent-and-skip-contract.md` | — | 7, 22, 23, 26, 28, 29, 31, 32, 34, 37–39, 45 |
| 2 | Post production alerts to ARchaser Chat | `issues/02-post-archaser-chat.md` | 1 | 1–6, 8–21, 24, 25, 27, 30, 33, 35, 36, 40–44 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.

## Further Notes

### Decision log (grill)

| # | Topic | Decision | Plan impact |
|---|-------|----------|-------------|
| D1 | Surface | Chat message, not task | Chat API only |
| D2 | Source | Grafana ops only | No product KPI path |
| D3 | Channel | Existing ARchaser | Channel id is a deploy parameter |
| D4 | Severities | All production | Digest still batches high/medium |
| D5 | Grouping | Critical immediate; rest digest | Reuse Lambda `deliveryTier` |
| D6 | Cleared | Critical only on Chat | Skip Chat on digest resolved |
| D7 | Fan-out | Keep email and Slack | Additive Lambda side effect |
| D8 | Mentions | None | No assignee either |

### Blocking setup gate

A ClickUp Chat token with permission to post in ARchaser must exist before production lights up. Until operators set `CLICKUP_CHAT_TOKEN` and `CLICKUP_CHAT_CHANNEL_ID`, the feature is a no-op skip, not a deploy failure.

### Related PRDs

- Grafana alert routing optimization — silent staging, critical vs digest email (do not reopen)
- Advanced notification sets (credit) — tenant email + in-app; follow-up only if product KPI warnings should later enter Chat
