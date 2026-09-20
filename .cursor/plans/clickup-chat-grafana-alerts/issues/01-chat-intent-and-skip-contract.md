# 01 — Chat intent and skip contract

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 7, 22, 23, 26, 28, 29, 31, 32, 34, 37, 38, 39, 45
**PRD:** `.cursor/plans/clickup-chat-grafana-alerts.prd.md`

## What to build

Wire the existing Grafana webhook Lambda so every production alert payload is classified into a ClickUp Chat **intent** (post vs skip) and the HTTP response reports `clickupStatus`, without requiring a live ClickUp token.

Skip Chat (and still send email plus SNS Simple Notification Service) when the token or channel id is missing, when a digest group is **resolved**, and when the existing 24-hour firing cooldown already suppresses the whole handler. Encode the grill routing table in a small pure intent builder: critical firing and critical resolved are posts; digest firing is a post; digest resolved is `skipped_resolved_digest`; empty config is `skipped_unconfigured`. Do not add a Grafana contact point, do not create ClickUp tasks, do not change notification policies or alert rules.

CloudFormation may grow empty-default ClickUp parameters in this slice so skip-unconfigured is real; posting to Chat is the next slice.

## Acceptance criteria

- [x] Grafana webhook JSON still returns 200 with existing `deliveryTier` and `subject` for email/SNS
- [x] Response includes `clickupStatus` of `skipped_unconfigured` when token or channel id is empty
- [x] Digest + resolved payload yields `clickupStatus` of `skipped_resolved_digest` and email/SNS still send
- [x] Critical resolved is **not** skipped by the digest-resolved rule (intent is post)
- [x] Any `critical` label in the group classifies as critical for Chat (not buried as digest)
- [x] Firing cooldown suppression skips Chat along with email (no extra Chat-specific table)
- [x] No ClickUp HTTP call when status is a skip; no @mentions, assignees, tasks, or Posts in the intent
- [x] No Grafana policy/rule YAML changes; no product KPI Key Performance Indicator or notification-rule work

## How to test

1. Deploy or invoke the webhook with ClickUp token and channel id **unset**. POST a critical firing payload (same shape as the existing SNS test script). Expect 200, email/SNS as today, `clickupStatus` = `skipped_unconfigured`, nothing new in ARchaser Chat.
2. POST a digest firing payload (several high/medium alerts). Expect `deliveryTier` digest and Chat intent **post** (status may still be skipped_unconfigured if creds are empty).
3. POST a digest **resolved** payload. Expect email may still send; `clickupStatus` = `skipped_resolved_digest`; no Chat message.
4. POST a critical **resolved** payload with empty creds. Expect intent is post, `clickupStatus` = `skipped_unconfigured` (not `skipped_resolved_digest`).
5. Confirm staging Grafana still uses the silent contact point (no new webhook traffic, nothing in ARchaser).
