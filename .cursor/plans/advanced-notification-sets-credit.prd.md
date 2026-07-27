---
name: advanced-notification-sets-credit
overview: Configurable internal alerts (email + in-app Notification Center) for the five Credit Insurance Exposure Guard card states, built on a shared notification-rule engine with Credit shipping first and Collection rules as a follow-on.
source: grill-me session
clickup_task_url: null
isProject: false
---

# Advanced Notification Sets — Credit Product

## Problem Statement

Credit insurance users rely on the **Exposure Guard** dashboard cards — overdue block, capacity gap, entry/terms breach, action window (reporting countdown), and limit warnings — to spot uninsured exposure before it becomes a claim problem. Today those signals appear only when someone opens the credit dashboard or drills into filtered reports. There is no proactive, account-configurable way to alert the internal credit team when a customer or invoice enters one of these states or approaches a reporting deadline.

The sibling **Advanced Notification Sets — Collection product** initiative defines similar rule-based internal alerts for collection workflows (overdue amount thresholds, promise-to-pay gaps, etc.). Credit needs the same class of capability, aligned to trade-credit-insurance breach semantics, without sending debtor-facing collection communications.

Accounts with `has_credit_insurance` already store warning thresholds on **Account** (`credit_limit_warning_threshold_pct`, `credit_score_validity_warning_days`, `reporting_date_warning_days`, `customer_limit_expiration_warning_days`). Notification sets must reuse those fields so dashboard cards and alerts stay consistent.

## Solution

1. Introduce a **shared notification-rule engine** (product-agnostic schema with a product flag) that stores per-account rule sets, advance-warning offsets, default role recipients, and optional per-rule user overrides.

2. Ship **Credit v1** with five seeded, enabled rules — one per Exposure Guard card type — for accounts with credit insurance enabled.

3. Run a **daily evaluator** (cron) that detects qualifying customers/invoices, applies deduplication (notify once on breach entry until cleared; fire advance warnings at each configured day offset), resolves recipients by role defaults plus overrides, and delivers **email + in-app Notification Center** entries in the same run.

4. Expose configuration in **Settings → Credit Insurance → Notification Sets** (new sub-tab), gated by existing credit settings permissions.

5. Deep-link every alert to the matching **credit insurance report** view (overdue, capacity, terms, reporting, limit warning).

6. Defer **Collection product** rules to a follow-on slice on the same engine.

## User Stories

1. As a CFO on a credit-insurance account, I want to receive an email when a customer enters overdue block, so that I can act before shipping more uninsured exposure.

2. As a credit analyst, I want an in-app notification when a customer exceeds their approved limit (capacity gap), so that I see the alert without checking the dashboard daily.

3. As a credit analyst, I want to be notified when an open invoice has payment terms that breach policy (terms breach) or when a customer has no valid limit (entry gap), so that I can correct vetting before reporting to the insurer.

4. As a credit operations user, I want advance warnings at configurable day offsets before an invoice's target reporting date, so that I can file reports before the action window closes.

5. As a credit operations user, I want a notification when an invoice's reporting deadline passes without filing (`reporting_breach`), so that late reporting is escalated immediately.

6. As a credit manager, I want notifications when a customer reaches the account's limit-warning threshold or has a credit score expiring within the configured warning window, so that limit reviews happen proactively.

7. As an account administrator, I want to configure notification sets under Credit Insurance settings, so that alert behavior is managed alongside other credit product configuration.

8. As an account administrator, I want sensible default rules enabled on new credit-enabled accounts, so that I get value without manual setup.

9. As an account administrator, I want to disable or edit individual card rules, so that I can tune noise for my organization's workflow.

10. As an account administrator, I want advance-warning day offsets configurable per rule (e.g. 14, 7, 3 days before reporting deadline), so that reminders match our internal SLA.

11. As an account administrator, I want default recipients based on credit-insurance roles (CFO, Data Analyst, System Administrator), so that the right team is notified without picking every user manually.

12. As an account administrator, I want to override recipients for a specific rule with named users, so that a dedicated credit ops mailbox or individual owner receives targeted alerts.

13. As a notified user, I want the in-app notification action link to open the matching filtered credit report, so that I land directly on the affected customers or invoices.

14. As a notified user, I want the email to include the same deep link and a concise summary (customer name, invoice number, amounts where relevant), so that I can triage from my inbox.

15. As a notified user, I want breach alerts to fire only once when a condition is entered and not repeat daily while the breach persists, so that my inbox is not spammed.

16. As a notified user, I want to be notified again if a breach clears and later re-enters, so that recurring problems are surfaced.

17. As a notified user, I want each configured advance-warning offset to fire at most once per invoice per offset, so that countdown reminders are predictable.

18. As a credit dashboard user, I want limit-warning and reporting-countdown thresholds on notification rules to match the account fields that drive dashboard cards, so that I never see a dashboard warning without a corresponding notification config (and vice versa for threshold-driven cards).

19. As a dual-product account user (`has_collection` + `has_credit_insurance`), I want credit notification sets to operate independently of collection activity sequences, so that collection automation does not affect credit alerts.

20. As a credit-only account user, I want credit notification sets without any collection communication side effects, so that the product stays internal-team focused.

21. As a user without `view_settings` or `update_insurance_policy`, I want the Notification Sets settings tab hidden, so that configuration stays restricted to authorized roles.

22. As a user with `view_settings` but not `update_insurance_policy`, I want to view notification set configuration read-only, so that I can audit rules without changing them.

23. As a user with `update_insurance_policy`, I want to create, edit, enable, and disable notification rules, so that I can manage alert policy.

24. As an operations engineer, I want the evaluator cron registered with standard timeout and failure observability, so that missed notification runs are detectable.

25. As an operations engineer, I want delivery attempts logged with deduplication keys, so that support can explain why an expected alert did or did not send.

26. As a developer extending Collection notification sets later, I want the shared engine to accept a product discriminator and collection-specific trigger types, so that Credit and Collection do not fork separate persistence models.

27. As a Hebrew-speaking user, I want notification titles and email content localized through the existing i18n pipeline, so that alerts match my UI language where templates support it.

28. As a credit analyst filtering by business unit on the dashboard today, I accept that v1 notification sets are account-wide (all policies and BUs), so that scope stays simple until per-policy or per-BU rules are requested.

29. As a credit analyst, I want overdue-block alerts at customer granularity, so that one notification summarizes the customer's block state rather than one alert per invoice.

30. As a credit analyst, I want capacity-gap and limit-warning alerts at customer granularity, so that exposure is triaged per debtor.

31. As a credit analyst, I want action-window and terms-breach alerts at invoice granularity, so that I can act on specific filing deadlines and contractual breaches.

32. As a notified user, I want deactivated users excluded from recipient resolution, so that ex-employees do not receive alerts.

33. As a notified user, I want users without credit-insurance product permissions excluded from role-based recipient expansion unless explicitly overridden, so that collection-only agents are not flooded with credit alerts.

34. As an account administrator seeding defaults, I want each of the five card rules pre-enabled with standard advance offsets for action window, so that reporting countdown alerts work on day one.

35. As a product owner, I want policy expiry, top-up expiry, and custom field/threshold builders out of v1, so that the first release stays focused on Exposure Guard cards.

## Implementation Decisions

### Primary seam (testing & architecture)

All credit notification behavior is evaluated through **one deep module**: `NotificationRuleEvaluator` (name illustrative).

- **Inputs:** account id, product (`credit_insurance`), persisted rule definitions, and read-only queries against existing credit signal services (dashboard report list functions, `overdue_block`, `reporting_breach`, `ctv_payment_term`, capacity/limit-warning predicates).
- **Outputs:** a list of **delivery intents** — `{ ruleId, recipientUserId, channel, dedupKey, title, message, actionUrl, metadata, priority }` — with no direct DB or email side effects inside the evaluator.
- **Adapters (thin):** `NotificationService` for in-app bell + realtime; `EmailService` / internal email templates for email; a small `NotificationDeliveryLog` writer for dedup state.

This is the **only** seam that unit tests need to mock deeply. Cron registration, settings CRUD APIs, and UI are integration/e2e concerns.

### Shared notification-rule engine

New persistence (names illustrative):

| Concept | Purpose |
|--------|---------|
| `NotificationRuleSet` | Per-account container; `product` enum (`collection`, `credit_insurance`); `trigger_type` enum; `enabled`; audit columns |
| `NotificationRule` | Belongs to set; `advance_day_offsets` (int array, nullable — used for action window); optional JSON metadata for future collection thresholds |
| `NotificationRuleRoleDefault` | Many rows: which roles receive alerts for this rule |
| `NotificationRuleUserOverride` | Optional explicit user additions (additive to role defaults) |
| `NotificationDeliveryLog` | Dedup ledger: `(rule_id, entity_type, entity_id, offset_days?, channel)` + `delivered_at`, `cleared_at` |

**Product flag** on the set ensures Collection rules can be added later without schema fork.

### Credit v1 trigger catalog

| Card | Entity level | Enter condition (reuse existing logic) | Advance warnings | Report deep link |
|------|--------------|----------------------------------------|------------------|------------------|
| Overdue block | Customer | `Customer.overdue_block = true` | None | `overdue` |
| Capacity gap | Customer | Customer in capacity-gap scope (same predicate as capacity report) | None | `capacity` |
| Entry / terms breach | Invoice | Invoice in terms-breach scope OR entry-gap / zero-limit scope | None | `terms` or `zero_limit_warning` as appropriate |
| Action window | Invoice | Open invoice approaching `target_reporting_date` per offset; on breach `reporting_breach = true` | Configurable offsets per rule (e.g. 14, 7, 3) | `reporting` |
| Limit warnings | Customer | Customer in limit-warning scope (threshold %, score validity, limit expiration — same as dashboard) | None | `limit_warning` |

**Threshold source:** Limit warnings and reporting countdown windows **read Account fields** (`credit_limit_warning_threshold_pct`, `credit_score_validity_warning_days`, `reporting_date_warning_days`, `customer_limit_expiration_warning_days`). Notification rules do not duplicate those numbers in v1.

### Timing & deduplication

- **On-breach:** Fire when entity newly qualifies. Record delivery log entry. Do not re-fire while condition persists.
- **On-clear:** When condition no longer holds, mark delivery log `cleared_at` (or delete active key) so a future re-entry can notify again.
- **Advance warnings:** For each `(invoice, rule, offset_days)` tuple, fire once when `today = target_reporting_date - offset_days` (calendar-day semantics aligned with existing credit date helpers). Separate dedup key includes `offset_days`.

### Recipients

- **Role defaults:** CFO, Data_Analyst, System_Administrator (roles with `is_credit_insurance` on their permissions).
- **User overrides:** Additional users merged with role-resolved set (dedupe by user id).
- **Filter:** Exclude deactivated users; exclude users whose role permissions lack credit-insurance applicability unless explicitly named in overrides.

### Delivery channels (v1)

Both channels in the same release:

- **In-app:** `NotificationService.createNotification` with `action_url` pointing to localized credit report route; `metadata` carries `trigger_type`, `entity_type`, `entity_id`, `rule_id`.
- **Email:** Extend `internal_email_template_type` with credit notification variants (or one parameterized template per trigger family). Use existing `InternalEmailTemplate` account override pattern where applicable.

### Cron & scheduling

- New daily job (e.g. `processNotificationRules`) registered in cron manager, running after `computeCustomerOverdueMetrics` so `overdue_block` and `reporting_breach` are fresh.
- Evaluator processes only accounts with `has_credit_insurance = true` and at least one enabled credit rule set.
- v1 scope: **account-wide** — no policy id or business unit filter on rules.

### Settings UI

- New sub-tab under **Settings → Credit Insurance** (alongside existing policy list): **Notification Sets**.
- List five card rules with enable toggle, advance-offset editor (action window only), role defaults display, user override picker.
- Gate: `canViewCreditInsurance` (existing pattern: `has_credit_insurance` + `view_settings` or `update_insurance_policy`).
- Edit actions require `update_insurance_policy`.

### API contracts (illustrative)

- `GET /api/entities/accounts/:id/notification-rule-sets?product=credit_insurance` — list sets with rules and recipients.
- `PUT /api/entities/accounts/:id/notification-rule-sets/:setId` — update enabled, offsets, overrides (permission-gated).
- No public POST for creating sets in v1 — seeded by migration; admin only edits.

### Seed / migration

On deploy, for each account with `has_credit_insurance = true`, insert five enabled `NotificationRuleSet` rows (one per trigger type) with default action-window offsets (e.g. 14, 7, 3) and default role recipients. Idempotent upsert by `(account_id, product, trigger_type)`.

### Collection coordination

Build shared schema and evaluator interface in the Credit slice. Collection-specific trigger types and UI ship later on the same tables with `product = collection`.

### Explicit non-goals in implementation

- No customer/debtor email or SMS.
- No changes to `ActivitiesSequence` / collection period machinery.
- No per-policy or per-BU rule scoping in v1.
- No modification of translation JSON files without separate approval (follow project i18n rules when keys are added).

## Testing Decisions

**What makes a good test:** Assert **external behavior** — given account rules + fixture customers/invoices in known credit states, the evaluator returns the correct delivery intents (recipient count, dedup keys, action URLs, advance vs breach discrimination). Do not assert internal SQL shape or Prisma call order.

**Primary module under test:** `NotificationRuleEvaluator` (credit product path).

**Supporting tests:**

- Dedup ledger: second evaluation while breach persists yields zero new intents; after clear + re-breach yields one new intent.
- Advance offsets: invoice with `target_reporting_date` 7 days out fires only the 7-day offset rule, not 14-day.
- Recipient resolution: role expansion, override merge, deactivated user exclusion.
- Threshold coupling: changing account `credit_limit_warning_threshold_pct` changes which customers qualify without editing notification rules.

**Prior art:**

- `tests/unit/creditInsurance/*` — credit insurance service unit tests with Prisma mocks.
- `tests/unit/services/communication/NotificationService.*` — notification creation patterns.
- `tests/integration/due-notifications/*` — cron + dedup state patterns for sequence-based notifications (analogous dedup discipline, different domain).
- `tests/unit/cron-jobs/cronScheduler.test.ts` — cron registration expectations.

**Integration / e2e (lighter):**

- Settings API round-trip: read seeded rules, update offsets, verify persistence.
- Optional smoke: cron handler invokes evaluator and creates `Notification` rows for a fixture account (if integration test unit exists for credit crons).

## Out of Scope

- **Collection product rules** in v1 (follow-on on shared engine).
- **Customer-facing** email/SMS notifications to debtor contacts.
- **Per insurance policy** or **per business unit** notification scoping.
- **Policy / top-up expiry** alerts.
- **Credit score agency integration** beyond existing customer score validity fields.
- **Full custom rule builder** (arbitrary field/threshold expressions).
- **Scheduled digest-only mode** (daily summary email replacing per-event alerts).
- **WhatsApp / SMS** channels.
- **Grafana / SNS** operational alerting (unchanged; separate from user notification sets).
- **Modifying** existing dashboard card logic — notifications consume the same predicates, not redefine them.

## Further Notes

### Relationship to Exposure Guard

The [ARchaser Trade credit Exposure Guard](https://app.clickup.com/t/869cje69x) parent spec lists **Notification settings per ARchaser account** as section 3. This PRD implements that section for the five card types already built on the credit dashboard.

### Relationship to Collection Advanced Notification Sets

The [Advanced Notification Sets — Collection product](https://app.clickup.com/t/869ck49km) task describes collection-oriented rules (invoice overdue amount/day thresholds, promise-to-pay gaps). Shared engine foundation ships with Credit; Collection rules are a separate vertical slice.

### Report deep-link contract

Action URLs should mirror existing credit report routes (`type` query param: `overdue`, `capacity`, `terms`, `reporting`, `limit_warning`, `zero_limit_warning`) with account-appropriate locale prefix. Optional entity filters (customer id, invoice id) may be appended as query params if the report view already supports them; otherwise land on the unfiltered report for v1.

### Credit-only accounts

Per [credit-only-no-automation-ux](.cursor/plans/credit-only-no-automation-ux.prd.md), credit-only accounts must not receive collection communications. This feature is internal-only and aligns with that product boundary.

### i18n

New settings labels and notification copy require new translation keys in `settings` and `notifications` namespaces — coordinate with explicit translation approval per project rules.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Advanced Notification Sets — Credit product](https://app.clickup.com/t/869dxjwdx)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | Shared notification-rule schema, seed & settings API | [869dxjwny](https://app.clickup.com/t/869dxjwny) | — | 7–12, 21–23, 26, 34 |
| 2 | Credit NotificationRuleEvaluator + unit tests | [869dxjwub](https://app.clickup.com/t/869dxjwub) | 1 | 1–6, 15–18, 29–33 |
| 3 | Dedup ledger, daily cron & in-app delivery | [869dxjx0k](https://app.clickup.com/t/869dxjx0k) | 2 | 13, 15–17, 24–25 |
| 4 | Email delivery & internal templates for credit alerts | [869dxjx8y](https://app.clickup.com/t/869dxjx8y) | 3 | 1–6, 13–14, 27 |
| 5 | Settings UI — Credit Insurance Notification Sets | [869dxjxde](https://app.clickup.com/t/869dxjxde) | 1 | 7–12, 21–23 |

**Assignee / status:** Nilotpal Bose on parent and all slices; Selected for Development

*Slice 5 can proceed in parallel with 2–4 once slice 1 is done (UI before cron is useful for config validation).*
