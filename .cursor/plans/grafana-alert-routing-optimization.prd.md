---
name: grafana-alert-routing-optimization
overview: Reorganize Grafana alerting so production critical alerts page within ~1–2 minutes, high/medium alerts batch into digest emails via the existing SNS path, and staging alerts remain visible in Grafana only with no outbound notifications.
source: grill-me session
clickup_task_url: https://app.clickup.com/t/869dx0z8n
isProject: false
---

# Grafana Alert Routing Optimization

## Problem Statement

ARChaser’s Grafana alerting stack provisions **duplicate rule sets** for staging and production (same twelve core rules, plus additional production-only billing-connector rules). **All environments and severities** currently fan out through a **single SNS webhook** with a **5-minute group wait** and **24-hour repeat interval**, which causes:

1. **Staging noise** — non-production incidents can reach the same notification channels as production.
2. **Alert fatigue** — critical infrastructure failures (e.g. database disconnected) are batched with lower-urgency collection/cron/communication alerts instead of paging quickly.
3. **No severity-aware delivery** — the SNS Lambda already styles emails by `severity` label, but Grafana notification policies do not route critical vs digest tiers differently.

Dashboard sprawl (unified vs domain boards, backup JSON copies) is a related problem but was explicitly **deferred** to a follow-up effort after alerting ships.

## Solution

**Phase 1 (this PRD):** Optimize **notification routing and delivery behavior** without changing which conditions fire or downgrading existing rule severities.

- **Staging:** Rules remain provisioned and visible in Grafana; **notification policies route staging to a silent contact point** (no webhook, no email).
- **Production — critical:** `severity: critical` alerts → existing **SNS webhook** with **minimal grouping** (~1–2 minute effective latency).
- **Production — digest:** `severity: high` and `severity: medium` alerts → **same SNS webhook**, but notification policies use **longer group_wait / group_interval** (15–30 minutes) so they arrive as **batched digest** emails; Lambda may add digest-specific subject/body cues when multiple non-critical alerts are bundled.
- **Rule files:** Keep separate **staging** and **production** provisioned YAML; change **contact points** and **notification policies** only (no rules generator in this slice).

**Phase 2 (follow-up, out of scope here):** Dashboard reorganization (merge/simplify unified vs cron/comms/infrastructure/drilldown boards, remove legacy backup copies).

## User Stories

1. As an on-call engineer, I want **Postgres/MongoDB disconnected** and other **critical** production alerts to notify within **~1–2 minutes**, so that I can respond before customers are broadly impacted.

2. As an on-call engineer, I want **high** and **medium** production alerts (stuck activities, cron overdue, email bounces, etc.) **batched into digest emails**, so that I see signal without constant paging.

3. As an on-call engineer, I want **staging alerts to never page** production channels, so that test/staging instability does not wake the team.

4. As an on-call engineer, I want to **still open staging alerts in Grafana** (alert list, history, drilldown dashboard), so that I can debug staging without notifications.

5. As an on-call engineer, I want digest emails to **clearly indicate batched/digest delivery** vs immediate critical alerts, so that I can triage inbox noise quickly.

6. As an on-call engineer, I want **alert drilldown dashboard links** in emails to keep working for both critical and digest notifications, so that investigation path stays one click.

7. As a developer, I want **existing alert rule UIDs and PromQL** unchanged in this slice, so that provisioning updates do not reset alert history or break dashboards tied to alert names.

8. As a developer, I want **severity labels on rules** (`critical`, `high`, `medium`) to remain as today, so that routing changes are policy-only.

9. As a developer, I want **staging and production rule files** to stay separate, so that `instance="Staging"` vs `instance="Production"` filters remain explicit without a codegen pipeline.

10. As a developer deploying monitoring, I want **contact points and notification policies** provisioned from repo like today, so that changes are reviewable in git and applied via Docker Compose recreate.

11. As a developer, I want the **SNS Lambda** to continue handling HTML email + fan-out, with optional digest formatting for non-critical batches, so that we do not add a second webhook or SMTP path.

12. As an operator, I want a **documented verification checklist** (staging silent, production critical fast, production digest batch), so that rollout is repeatable after Grafana container recreate.

13. As an on-call engineer, I want **billing connector critical alerts** (production-only today) to follow the **critical/immediate** path, so that ERP auth failures page like database outages.

14. As a developer, I want **parity consideration** for staging billing-connector rules documented as optional follow-up, so that staging tests do not require production-only rule drift long term.

15. As a team lead, I want **dashboard reorganization** tracked separately, so that alerting improvements ship without blocking on panel merges.

16. As an on-call engineer, I want **resolved notifications** to still flow for critical alerts when issues clear, so that I know when to stand down.

17. As a developer, I want **test harness scripts** for the SNS webhook updated to cover critical vs digest payload shapes, so that Lambda changes are regression-safe.

18. As an operator, I want **MONITORING_ENV** behavior unchanged (staging Grafana instance mounts staging rules; production mounts production rules), so that environment separation stays one compose variable.

## Implementation Decisions

### Alert routing model (locked from grill)

| Tier | Rule `severity` labels | Grafana notification policy | Delivery |
|------|------------------------|----------------------------|----------|
| Staging (all) | any | Route to **silent** contact point | None (Grafana UI only) |
| Production critical | `critical` | Short `group_wait` (~1m), tight grouping | SNS webhook → immediate email |
| Production digest | `high`, `medium` | Longer `group_wait` / `group_interval` (15–30m) | SNS webhook → digest-style batched email |

**Do not** downgrade or remove any existing alert conditions in this slice.

### Staging silent contact point

- Add a provisioned contact point (e.g. `silent-staging`) that performs **no outbound delivery**. Acceptable patterns: Grafana-supported no-op receiver, or webhook to an internal discard endpoint that is not configured in staging compose — prefer the cleanest approach that provisions without errors and generates zero SNS traffic.
- Notification policy matches staging alerts by **Grafana folder** (`Staging`) and/or consistent **label** (e.g. `instance: Staging` if folder matching is insufficient).

### Production notification policy tree

- Replace the flat single-receiver policy (everything → `sns-alerts` with 5m group_wait) with **nested routes**:
  - Child route 1: staging → silent (evaluated first if on shared Grafana; on split instances, staging Grafana only loads staging rules).
  - Child route 2: `severity = critical` → `sns-alerts` with immediate timing.
  - Default route: `sns-alerts` with digest timing for remaining production alerts.
- Keep **repeat_interval** sensible for ongoing fires (critical may repeat sooner than digest; document chosen values in implementation).

### SNS Lambda (digest behavior)

- Continue using **one webhook URL** (`GRAFANA_SNS_WEBHOOK_URL`).
- Lambda already reads `alert.labels.severity` for HTML styling; extend to:
  - Detect **digest batches** (multiple alerts, or explicit label such as `delivery: digest` if policies add it).
  - Adjust **email subject** (e.g. prefix `[Digest]` vs `[CRITICAL]`) and optional summary line count.
- No new SNS topic required for this slice.

### Rule files (no structural change)

- **Production:** ~14 rules in one group (12 system health + 2 billing connector); severities already `critical` | `high` | `medium`.
- **Staging:** 12 rules; mirror of system health without billing connector rules today.
- **No** YAML generator, Ansible templating, or merge into single file.

### Provisioning & deploy

- Changes live under Grafana **alerting provisioning** (contact points, notification policies) mounted by the logging Docker Compose stack.
- Applying changes requires **Grafana container recreate** (not just dashboard JSON hot-reload).
- `MONITORING_ENV` continues to select `rules-staging.yaml` vs `rules-production.yaml`.

### Codebase scan

| Area | Action |
|------|--------|
| Grafana alerting contact points provisioning | **Required** — add silent staging receiver |
| Grafana notification policies provisioning | **Required** — nested severity/environment routes |
| SNS CloudFormation Lambda handler | **Required** — digest subject/body behavior |
| SNS test alert shell script | **Required** — critical vs digest payload cases |
| SNS README / integration docs | **Optional** — document routing matrix |
| Docker Compose logging stack | **Verify** — mounts unchanged except policy files |
| Grafana alert rules (staging + production YAML) | **No change** in this slice |
| Grafana dashboards (all env JSON) | **Out of scope** — follow-up PRD |
| `_backup_dashboards` legacy copies | **Out of scope** |
| Prometheus metric exporters / app metrics | **No change** |
| `ecosystem.config.js` MONITORING_ENV | **No change** |
| Ansible deploy playbooks | **Verify** — still `docker compose up` logging stack |
| Staging billing-connector alert rules | **Optional follow-up** — parity with production |

### Architectural notes

- **Highest test seam:** provisioned **notification policies** + **SNS Lambda** webhook contract (payload in → email subject/body out). Grafana UI manual verification is secondary.
- **Single seam preferred:** avoid splitting digest to a second Lambda; route tiering stays in Grafana policies + one handler branch.
- Existing **alert drilldown** dashboards remain the investigation target linked from Lambda emails.

## Testing Decisions

### What makes a good test

- Assert **observable delivery behavior**: staging webhook receives **no** invocations; critical payload produces immediate-style subject; batched high/medium produces digest-style subject.
- Do **not** assert internal Grafana policy YAML structure beyond snapshot tests if added — prefer end-to-end webhook tests.

### Primary seam (recommended)

**SNS Lambda handler** (via existing test script or unit extract):

- Send representative Grafana webhook JSON for `severity: critical`, single alert → expect immediate subject line pattern.
- Send bundled JSON with multiple `high`/`medium` alerts → expect digest subject/prefix and grouped body.

### Secondary seams

| Seam | Behavior under test | Prior art |
|------|---------------------|-----------|
| `test-alerts.sh` | Extended cases for critical vs digest payloads | Existing SNS infrastructure tests |
| Staging Grafana (manual) | Fire test alert; confirm UI state, zero SNS/email | Deploy checklist |
| Production Grafana (manual) | Synthetic critical vs high; observe timing | Deploy checklist |

### Manual test plan

1. Deploy policy + Lambda changes to **staging** Grafana; trigger any rule; confirm **no** email/SNS; alert visible in Grafana.
2. On **production**, trigger or wait for a **critical** condition (or use test webhook); confirm notification within **~1–2 minutes**.
3. On **production**, confirm **high/medium** alerts batch over **15–30 minutes** into one digest email.
4. Confirm drilldown links in email still resolve.

## Out of Scope

- Dashboard reorganization (unified vs cron/comms/infrastructure/drilldown, emoji row cleanup, deleting backup JSON).
- Changing alert thresholds, `for:` durations, or PromQL expressions.
- Downgrading severities (e.g. moving stuck activities from `high` to `warning`).
- Rules YAML generator or single-file templating.
- Second SNS topic, second webhook, or Grafana-native SMTP for digest.
- New Prometheus metrics or application code changes.
- Credit-only / collection-automation alert suppression (product logic), unless added in a future slice.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Grafana Alert Routing Optimization](https://app.clickup.com/t/869dx0z8n)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Grafana silent staging + production severity-split notification policies | [869dx0zey](https://app.clickup.com/t/869dx0zey) | — | 3, 4, 7–10, 13, 18 |
| 2 | SNS Lambda digest email formatting + test-alerts regression | [869dx0zg0](https://app.clickup.com/t/869dx0zg0) | — | 1, 2, 5, 6, 16, 17 |

*Slice 2 full E2E digest timing validation is soft-ordered after slice 1 deploy.*

**Assignee / status:** Nilotpal Bose; Selected for Development

## Further Notes

### Grill session decisions (locked)

| # | Decision |
|---|----------|
| 1 | Primary goal: **alert noise & routing**, not dashboards |
| 2 | Staging: **non-paging**, Grafana UI only |
| 3 | Staging impl: **silent contact point**, rules still provisioned |
| 4 | Production: **severity split** (critical immediate, high/medium digest) |
| 5 | **Keep all rule severities** — routing only |
| 6 | Critical latency: **~1–2 minutes** |
| 7 | Digest batch window: **15–30 minutes** |
| 8 | Digest channel: **same SNS webhook**, Lambda differentiates |
| 9 | Rules files: **keep staging + production YAML** |
| 10 | Dashboard reorg: **follow-up slice** |

### Severity taxonomy in use today

Rules use `critical`, `high`, and `medium` (not `warning`). Digest tier = **`high` + `medium`**; immediate tier = **`critical`** only.

### Follow-up PRD candidate

**Grafana dashboard reorganization** — reduce duplication across unified/cron/communications/infrastructure/drilldown boards, remove `_backup_dashboards`, define a single home + domain drilldowns pattern.

### Rollout

After merge: set `MONITORING_ENV`, run `docker compose -f docker-compose.logging.yml up -d grafana --force-recreate`, verify policies in Grafana **Alerting → Contact points / Notification policies**, then run SNS test script.
