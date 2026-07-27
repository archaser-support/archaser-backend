---
name: grafana-dashboard-reorganization
overview: Reorganize provisioned Grafana dashboards into a slim health-at-a-glance home plus linked domain boards (cron, communications, infrastructure, alert drilldown), with plain-text sections, descriptive titles, deduplicated panels, and preserved UIDs for email drilldown links.
source: grill-me session
clickup_task_url: https://app.clickup.com/t/869dx2gzd
isProject: false
---

# Grafana Dashboard Reorganization

## Problem Statement

ARChaser’s Grafana monitoring stack provisions **five dashboards per environment** (unified home, cron, communications, Prometheus/infrastructure, alert drilldown), plus **legacy JSON copies** under an unmounted backup folder. The **unified home dashboard** duplicates panels that already exist on domain boards, uses **emoji-heavy row headers**, and requires excessive scrolling to find operational signal. Navigation between boards relies on Grafana search/folder browsing rather than explicit cross-links. Dashboard titles are inconsistent (e.g. generic “Dashboard - Production”). On-call engineers waste time finding the right board during incidents; alert email drilldown links must remain stable.

This work was explicitly **deferred** from the [Grafana Alert Routing Optimization](.cursor/plans/grafana-alert-routing-optimization.prd.md) PRD so alerting routing could ship first.

## Solution

**Layout-only reorganization** of provisioned Grafana dashboard JSON (staging + production) with **no new PromQL, metrics, or alert rules**.

- **ARChaser Home** (slimmed unified board): health-at-a-glance — database connectivity, error rate, firing-alert red flags, cron/comms summary stats only; link panels to domain boards for detail.
- **Domain boards retained:** Cron Health, Communications, Infrastructure (Prometheus), Alert Drilldown — relayout with plain-text section headers and top-of-board link panels back to Home and siblings.
- **Naming:** Descriptive titles with environment suffix (e.g. “ARChaser Home - Production”).
- **UIDs preserved:** All dashboard UIDs unchanged so SNS Lambda and in-app drilldown URLs keep working.
- **Cleanup:** Delete unprovisioned `_backup_dashboards` legacy copies; git history is the archive.

## User Stories

1. As an on-call engineer, I want a **single home dashboard** that shows only critical health signals, so that I can assess system state in under a minute.

2. As an on-call engineer, I want **deep cron, communications, and infrastructure detail** on separate boards, so that investigation does not require scrolling through unrelated panels on the home board.

3. As an on-call engineer, I want **link panels** at the top of each dashboard pointing to related boards, so that I can navigate incidents without searching Grafana.

4. As an on-call engineer, I want **plain-text section headers** (no emoji row titles), so that dashboards look professional and scan cleanly on mobile email clients and narrow screens.

5. As an on-call engineer, I want **descriptive dashboard titles** (ARChaser Home, Cron Health, Communications, Infrastructure, Alert Drilldown), so that bookmarks and Grafana search return obvious results.

6. As an on-call engineer, I want the **Alert Drilldown** board to remain dedicated and email-linked, so that alert notifications still open the correct investigation view in one click.

7. As an on-call engineer, I want **no duplicate panels** between home and domain boards, so that metrics are maintained in one canonical place and layout changes do not drift.

8. As a developer, I want **dashboard UIDs unchanged**, so that SNS Lambda drilldown URLs and alert rule annotation references do not break.

9. As a developer, I want **staging and production dashboards structurally identical** (same layout, env-specific queries unchanged), so that staging is a faithful preview of production monitoring UX.

10. As a developer, I want **legacy backup JSON files removed** from the repo, so that there is a single source of truth under `grafana/provisioning/dashboards/`.

11. As an on-call engineer, I want **home cron summary stats** (overdue jobs, not run in 24h, success rate) without heatmaps or log tables, so that I see red flags and click through to Cron Health for detail.

12. As an on-call engineer, I want **home communications summary stats** (bounced/failed email and SMS counts) without full engagement funnels, so that I see comms health at a glance.

13. As an on-call engineer, I want **home infrastructure signals** limited to DB connectivity and error rate, so that host/exporter detail stays on the Infrastructure board.

14. As an on-call engineer, I want **Alert Drilldown** sections relabeled with plain-text headers matching alert domains (cron, automation, activities, communications, customers), so that fired alerts map visually to investigation rows.

15. As a developer deploying monitoring, I want changes applied via **existing Docker Compose Grafana provisioning** (`MONITORING_ENV`, dashboard file mount), so that rollout matches today’s deploy path.

16. As a team lead, I want this slice to be **layout-only**, so that billing-connector panels and new metrics remain in the ERP billing connector plan unless explicitly added later.

17. As an on-call engineer, I want **Infrastructure** to remain a standalone board for Prometheus exporter and app metric detail, so that infra tuning does not clutter the home board.

18. As a developer, I want a **documented manual verification checklist** after deploy, so that link targets, UIDs, and panel grid positions are repeatable to validate.

19. As an on-call engineer, I want **business operations panels** (disputes, imports, PTP) removed from the slim home or collapsed to a single row of summary stats with a note to use app UI, so that the home board stays operations-monitoring focused.

20. As a developer, I want **alert rule descriptions** that reference dashboard UIDs by name to remain valid, so that annotation text like “check Cron dashboard (uid archaser-cron-v1-prod)” still resolves.

## Implementation Decisions

### Dashboard architecture (locked from grill)

| Board | Role | UID (unchanged) | New title pattern |
|-------|------|-----------------|-------------------|
| Unified → Home | At-a-glance health + nav links | `archaser-unified-v1-{env}` | ARChaser Home - {Environment} |
| Cron | Cron job health, duration, execution detail | `archaser-cron-v1-{env}` | Cron Health - {Environment} |
| Communications | Campaign, email, SMS detail | `archaser-comm-unified-{env}` | Communications - {Environment} |
| Prometheus | Infrastructure / exporter metrics | `archaser-prometheus-v1-{env}` | Infrastructure - {Environment} |
| Alert drilldown | Postgres-backed alert investigation | `alert-drilldown-{env}` | Alert Drilldown - {Environment} |

`{env}` = `prod` / `staging` suffix in UID; title uses `Production` / `Staging`.

### Home board slimming rules

**Keep on home (summary tier only):**

- Database connectivity (Postgres, MongoDB)
- Application error count (1h; optional 24h single stat)
- Cron red-flag stats: total jobs, overdue, not run 24h (mirror alert thresholds, not full tables)
- Communications red-flag stats: emails bounced/failed 24h, SMS failed 24h, stuck activities if already present
- Top **navigation link row** to Cron Health, Communications, Infrastructure, Alert Drilldown

**Remove or relocate off home (canonical home = domain board):**

- Cron heatmap, latest cron logs, per-job tables → Cron Health
- Email tracking Loki panels, SMS activity Loki, delivery/open/click funnels → Communications
- Log level distribution, error rate Loki tables, top services → Infrastructure (or trim if duplicate of Prometheus board)
- Deep diagnostics rows, collection-period charts, business ops detail rows → drop from home or reduce to 1–2 summary stats max

**Do not change:** PromQL expressions, datasource UIDs (`Prometheus`, `Loki`, `Postgres`), or panel plugin types — only grid positions, row structure, titles, and which panels exist on which board.

### Domain board relayout rules

- Replace emoji row titles with plain-text equivalents (e.g. “System & Log Overview” not “🖥️ System & Log Overview”).
- Add **link panel row** at top: Home + sibling boards relevant to that domain.
- Re-grid panels for consistent column widths where practical (no new styling/themes).
- **Alert Drilldown:** relayout and rename section rows only; keep Postgres panel queries and datasource bindings.

### Cross-dashboard navigation

Use Grafana **dashboard link panels** (or equivalent link widgets) at the top of each board. Link URLs use `/d/{uid}/{slug}` pattern consistent with existing SNS Lambda construction. Slugs may be updated when titles change **only if** UID-based URLs remain valid (Grafana resolves by UID).

### UID and external link stability

- **Do not** change dashboard `uid` fields in JSON.
- SNS Lambda (`alert-drilldown-prod` / `alert-drilldown-staging`) — **no change** in this slice.
- `SystemMonitoringService` drilldown URLs — **no change** unless slug drift breaks links; verify after title rename.
- Alert rule annotation text referencing cron dashboard UID — **no change** (UIDs preserved).

### Backup cleanup

Delete all files under the unprovisioned backup folder (four legacy JSON copies). They are not mounted by `grafana-dashboards.yml` or `docker-compose.logging.yml`.

### Provisioning and deploy

- Dashboards load from `grafana/provisioning/dashboards/${MONITORING_ENV}/` via existing compose mount.
- `allowUiUpdates: true` in provider config — provisioned file still wins on reload; prefer JSON in repo as source of truth.
- Apply: `docker compose -f docker-compose.logging.yml up -d grafana` (recreate if needed). Dashboard hot-reload interval ~10s per provider config.

### Codebase scan

| Area | Action |
|------|--------|
| `grafana/provisioning/dashboards/{staging,production}/*.json` (10 files) | **Required** — relayout, rename titles, nav links, dedupe |
| `grafana/provisioning/_backup_dashboards/*.json` (4 files) | **Required** — delete |
| `grafana-dashboards.yml` | **No change** — path/mount pattern unchanged |
| `docker-compose.logging.yml` | **No change** — `MONITORING_ENV` dashboard mount unchanged |
| `grafana/provisioning/alerting/rules-*.yaml` | **No change** — layout slice only |
| `infrastructure/sns/cloudformation-sns.yaml` (drilldown URL) | **No change** — UIDs preserved |
| `server/services/SystemMonitoringService.ts` (drilldown URLs) | **Verify** — slugs still resolve after title rename |
| `infrastructure/sns/README.md` | **Optional** — document new dashboard names |
| `docs/AUTO_START_SERVICES.md`, deploy scripts | **No change** |
| ERP billing connector plan (future home tiles) | **Out of scope** — separate PRD; do not add connector panels here |
| Application code / Prisma / API | **No change** |
| i18n / frontend | **No change** |
| Automated dashboard JSON tests | **None today** — manual checklist only |

### Architectural notes

- **Highest test seam:** provisioned dashboard JSON loaded in Grafana — observable behavior is panel presence, grid layout, link targets, and UID stability. Prefer one verification pass per environment over per-file unit tests.
- **Single seam preferred:** all layout changes stay in dashboard JSON provisioning; no Lambda, alert, or app code changes.
- **Parity rule:** apply the same structural edit to staging and production pairs in the same vertical slice to avoid drift.

## Testing Decisions

### What makes a good test

- Assert **observable Grafana behavior**: correct dashboard title, link panel opens target board by UID, home shows summary panels only, domain board retains detail panels, drilldown email URL still loads.
- Do **not** assert internal JSON grid `y` coordinates or panel IDs — prefer checklist-based manual verification.

### Primary seam (recommended)

**Manual verification in Grafana UI** after provisioning reload:

| Check | Staging | Production |
|-------|---------|------------|
| Home title “ARChaser Home - {Env}” | ✓ | ✓ |
| Home has nav link row to 4 domain boards | ✓ | ✓ |
| Home lacks cron heatmap / full comms funnels | ✓ | ✓ |
| Cron / Comms / Infra / Drilldown have plain-text rows | ✓ | ✓ |
| `/d/alert-drilldown-{env}/...` from test email opens board | ✓ | ✓ |
| UIDs unchanged (Grafana settings → JSON model) | ✓ | ✓ |

### Secondary seams

| Seam | Behavior under test | Prior art |
|------|---------------------|-----------|
| SNS `test-alerts.sh` | Drilldown link in email body still contains correct UID | Alert routing slice |
| Alert rule annotations | Text references to cron dashboard UID still valid | Existing rules YAML |

### Optional follow-up (out of scope unless requested)

- JSON schema or snapshot test for dashboard file structure in CI.
- Grafana `curl` API smoke test against provisioned UIDs.

## Out of Scope

- New Prometheus metrics, PromQL, or panel queries.
- Billing connector summary tiles on home (tracked in ERP billing connector plan).
- Alert rule threshold, severity, or notification policy changes.
- Grafana alerting contact points / SNS Lambda changes.
- Staging billing-connector alert rule parity.
- New dashboards beyond the existing five per environment.
- Changing dashboard UIDs or SNS email link targets.
- UI theme overrides, custom CSS, or new global Grafana styling.
- Merging domain boards into one operations board.
- Dissolving Alert Drilldown into domain boards.

## Further Notes

### Grill session decisions (locked)

| # | Decision |
|---|----------|
| 1 | Structure: slim **home** + separate **domain** boards with cross-links |
| 2 | Home: **health-at-a-glance** only |
| 3 | Headers: **plain text**, no emoji |
| 4 | Navigation: **link panels** on home and each domain board |
| 5 | Backups: **delete** `_backup_dashboards` |
| 6 | Drilldown: **keep** separate board; relayout only |
| 7 | Infrastructure: **keep** standalone Prometheus board |
| 8 | Titles: **descriptive names** + env suffix |
| 9 | Scope: **layout-only** |
| 10 | UIDs: **preserve** all |

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Grafana Dashboard Reorganization](https://app.clickup.com/t/869dx2gzd)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Delete backup dashboards + rename titles (all envs) | [869dx2h9x](https://app.clickup.com/t/869dx2h9x) | — | 5, 8, 10, 20 |
| 2 | Slim ARChaser Home layout (staging + production) | [869dx2he1](https://app.clickup.com/t/869dx2he1) | 1 | 1, 7, 9, 11–13, 19 |
| 3 | Cron Health + Communications relayout and nav links | [869dx2hhg](https://app.clickup.com/t/869dx2hhg) | 1 | 2–4, 7, 9 |
| 4 | Infrastructure + Alert Drilldown relayout and nav links | [869dx2hn9](https://app.clickup.com/t/869dx2hn9) | 1 | 3–4, 6, 14, 17–18 |

*Slices 2–4 can run in parallel after slice 1 completes.*

**Assignee / status:** Nilotpal Bose; Selected for Development

### Rollout

After merge: set `MONITORING_ENV`, recreate or restart Grafana, walk the manual checklist for that environment, spot-check one alert email drilldown link.

### Relationship to alert routing PRD

Alert routing (silent staging, critical vs digest) is **complete** in repo provisioning. This PRD addresses the **deferred dashboard sprawl** follow-up and does not alter notification behavior.
