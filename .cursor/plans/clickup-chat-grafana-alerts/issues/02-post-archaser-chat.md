# 02 — Post production alerts to ARchaser Chat

**Status:** done
**Priority:** normal
**Blocked by:** [01-chat-intent-and-skip-contract](01-chat-intent-and-skip-contract.md)
**User stories:** 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 27, 30, 33, 35, 36, 40, 41, 42, 43, 44
**PRD:** `.cursor/plans/clickup-chat-grafana-alerts.prd.md`

## What to build

When the Chat intent is **post** and operators have set the ClickUp token plus ARchaser channel id, the Grafana webhook Lambda sends one markdown Chat **message** (not a task, not a Post/Announcement, no thread) to the existing **ARchaser** channel.

Critical firing and critical cleared each get their own message (🚨 / ✅, `[CRITICAL]` / `[RESOLVED]`, Grafana drilldown link). High/medium arrive as one digest message listing each alert’s name, severity, summary, and count. Email and Slack stay unchanged. ClickUp HTTP failures are logged, `clickupStatus` = `failed`, webhook still 200 so Grafana does not retry and duplicate email. Token is a NoEcho CloudFormation parameter; never log it. Ops copy stays English. Document parameters and How to test in the SNS README.

Operators must set the token and ARchaser channel id themselves (agents do not read or write dotenv files). Until those values exist, slice 01 skip behavior remains the production-safe default.

## Acceptance criteria

- [x] Critical firing posts one markdown message in ARchaser; no @mention; no assignee
- [x] Critical resolved posts a cleared message in ARchaser even if a firing cooldown would suppress a new fire
- [x] Digest firing posts **one** ARchaser message listing all alerts in the group, with count
- [x] Digest resolved does **not** post to Chat (email may still send)
- [x] Drilldown dashboard URL is in the Chat markdown; generator URL included when Grafana sent it
- [x] Missing or failed ClickUp call does not fail SES Simple Email Service or SNS Simple Notification Service
- [x] Secrets are CloudFormation/Lambda env only (NoEcho token); empty config still skips Chat
- [x] README names the env keys and the manual How to test steps; no Grafana rule or policy edits; no product locale keys

## How to test

1. Operator sets `CLICKUP_CHAT_TOKEN` and `CLICKUP_CHAT_CHANNEL_ID` (ARchaser, not Customers) on the production alert stack. Recreate/update the Lambda.
2. Run the existing SNS test script (or POST the same payloads): critical firing → email + Slack as today **and** a markdown line in ARchaser Chat. No @mention.
3. POST critical resolved → cleared Chat message in ARchaser plus resolved email.
4. POST digest firing (three high/medium alerts) → **one** ARchaser digest message listing all three, plus digest email.
5. POST digest resolved → **no** new ARchaser message; email may still show resolved.
6. Confirm staging Grafana still does not page; nothing new in ARchaser from staging.
7. With token unset (or a bad token), POST critical firing → email still arrives; Chat skipped or `clickupStatus` failed; webhook 200.
