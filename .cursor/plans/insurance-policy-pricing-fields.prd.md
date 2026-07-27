---
name: insurance-policy-pricing-fields
overview: Rename the insurance premium rate and persist a registration-fee percentage across master policies, customer assignments, and historical snapshots.
source: grill-me session
clickup_task_url: null
isProject: false
---

# Insurance Policy Pricing Fields

## Problem Statement

Policy pricing terminology and storage are incomplete. The current “Cost %” label does not clearly communicate that the value is the insurance premium rate, and there is no way to configure or retain a registration-fee percentage.

Customer policy assignments also do not currently retain their own copy of the premium rate. This prevents the system from exposing a coherent customer-policy pricing contract and from retaining the registration fee in customer and master-policy trend snapshots.

## Solution

Rename “Cost %” to “Insurance Premium Rate (%)” throughout policy settings while retaining the existing daily-rate behavior and persisted `cost_percent` contract.

Add an optional Registration Fee (%) for Primary policies. Persist both pricing values on active customer policy assignments, synchronize them when the master policy changes, and snapshot them in customer-policy and insurance-policy trends. Expose the hidden values through customer-policy APIs without rendering them on the customer policy layout.

Registration Fee will not affect daily-cost calculations. Report calculation and report metadata will be handled separately.

## User Stories

1. As a policy administrator, I want “Cost %” renamed to “Insurance Premium Rate (%)”, so that the field’s business meaning is clear.
2. As a policy administrator, I want consistent premium-rate terminology on policy details, so that editing a policy is unambiguous.
3. As a policy administrator, I want consistent premium-rate terminology when creating or editing a policy in a modal, so that creation and detail workflows agree.
4. As a policy administrator, I want consistent premium-rate terminology in the settings list, so that policy comparisons use the approved language.
5. As a policy administrator, I want exported policy settings to use the approved premium-rate heading, so that downloaded data matches the application.
6. As a policy administrator, I want to configure a Registration Fee (%) on a Primary policy, so that the fee can be retained for later reporting.
7. As a policy administrator, I want Registration Fee to be optional, so that policies without a registration charge remain valid.
8. As a policy administrator, I want Registration Fee to accept values from 0 through 100, so that invalid percentages are rejected.
9. As a policy administrator, I want TopUp policies to have no Registration Fee, so that the field follows the agreed policy-type boundary.
10. As a Hebrew-speaking policy administrator, I want approved Hebrew pricing labels, so that policy settings remain localized.
11. As an English-speaking policy administrator, I want approved English pricing labels, so that all policy settings use consistent terminology.
12. As a user assigning a policy to a customer, I want the current master-policy pricing values copied to the customer assignment, so that the assignment has complete pricing data.
13. As a user switching a customer’s policy, I want pricing values copied from the newly selected master policy, so that stale values do not carry across policies.
14. As a policy administrator changing master pricing, I want all active assignments for that policy updated in place, so that current customer data stays synchronized.
15. As a data consumer, I want premium-rate and registration-fee values returned by active customer-policy APIs, so that integrations can use them without relying on the UI.
16. As a data consumer, I want the values returned in customer-policy history and trend APIs, so that historical consumers receive a consistent contract.
17. As a customer user, I do not want the pricing fields added to the customer policy layout, so that the existing customer-facing presentation remains unchanged.
18. As an auditor, I want Registration Fee included in master-policy trend snapshots, so that policy configuration changes are retained.
19. As an auditor, I want both pricing values included in customer-policy trend snapshots, so that daily historical records preserve the applicable values.
20. As an existing customer with an active policy, I want pricing values initialized from the linked master policy during deployment, so that my active assignment is not left incomplete.
21. As an owner of historical customer-policy data, I want old assignment records left untouched when their former values cannot be proven, so that current master values are not presented as historical truth.
22. As a finance user, I want the current daily premium-cost calculation to remain unchanged, so that relabeling does not alter established results.
23. As a future report user, I want Registration Fee defined as a percentage of the calculated insurance premium, so that a later reporting implementation has unambiguous semantics.
24. As a report owner, I want report changes deferred from this feature, so that storage and synchronization can ship without changing report output prematurely.

## Implementation Decisions

- Retain `cost_percent` as the persisted and API-compatible premium-rate field. The rename is presentational and does not introduce a duplicate premium-rate field.
- Preserve the existing daily interpretation and calculation of the insurance premium rate.
- Add nullable `registration_fee_percent` values to the master policy, customer policy, master-policy trend, and customer-policy trend models.
- Add nullable `cost_percent` to customer policies; the customer-policy trend already retains this value.
- Use the existing decimal precision convention for percentage storage.
- Registration Fee is available only for Primary policies. TopUp policies normalize the value to null.
- Registration Fee is optional. Null means no fee is configured.
- A supplied Registration Fee must be between 0 and 100 inclusive. Client and server validation must enforce the same rule.
- Policy creation and policy switching copy both pricing values from the master policy to the active customer policy.
- Updating either master-policy pricing value updates all active customer policies linked to that master policy in place.
- The master-policy update and active-customer synchronization should be atomic so that the records cannot diverge after a partial failure.
- Existing active customer policies are backfilled from their linked master policy.
- Historical customer-policy versions are not backfilled because their former registration fee and premium rate cannot be reconstructed reliably from the current master policy.
- Existing historical trend records are not assigned fabricated registration-fee values.
- Customer-policy trend snapshots read the applicable values from the synchronized customer policy.
- Master-policy trend snapshots include Registration Fee in configuration-change detection and snapshot persistence.
- Active, historical, and trend customer-policy API contracts expose both values, but the customer policy layout does not render them.
- Policy details, policy creation/editing, the policy settings list, and manual settings export include the approved labels and Registration Fee value.
- English labels are “Insurance Premium Rate (%)” and “Registration Fee (%)”.
- Hebrew labels are “שיעור פרמיית ביטוח (%)” and “דמי רישום (%)”.
- Existing theme components and layout patterns are reused; no new styling is required.
- Registration Fee does not participate in daily-cost calculations.
- For future reporting, the fee amount is defined as the calculated insurance premium amount multiplied by Registration Fee (%).
- Report metadata, report fields, and the derived report calculation are deferred to a separate change.

## Testing Decisions

- Tests should assert externally observable behavior through the highest practical seams rather than internal helper implementation.
- The primary seam is policy create/update API behavior because it covers validation, policy-type normalization, persistence, and synchronization of active customer policies.
- API behavior tests should verify:
  - Primary policies accept null, 0, boundary value 100, and valid intermediate registration fees.
  - Values below 0, above 100, non-numeric values, and non-finite values are rejected.
  - TopUp policies normalize Registration Fee to null.
  - Existing premium-rate validation and daily semantics remain unchanged.
  - Updating master pricing synchronizes every linked active customer policy.
  - Historical customer-policy versions are not modified.
  - A synchronization failure rolls back the master-policy update.
- Customer-policy assignment service tests should verify:
  - New assignments copy both values.
  - Policy switches replace both values from the new master policy.
  - Null master values clear stale assignment values.
- Trend service tests should verify:
  - Customer-policy snapshots persist both synchronized values.
  - Master-policy snapshots persist Registration Fee.
  - Registration Fee changes are detected as master-policy configuration changes.
  - Trend API mappings expose the new field while retaining the compatible premium-rate field.
- Migration verification should confirm:
  - New columns are nullable and use the expected decimal precision.
  - Only active customer policies are backfilled.
  - Historical customer policies and historical registration-fee snapshots remain null.
- Policy settings behavior should be tested at existing mapping and export seams:
  - Details and modal submissions send Registration Fee correctly.
  - The list maps and formats both percentage values.
  - Manual export uses the approved translated headings and values.
- Existing daily-cost tests are regression coverage and must continue to prove that the premium rate is interpreted as a daily percentage and Registration Fee is excluded.
- Existing shared fixtures should be extended where multiple tests need the new fields; tests should not introduce local fixture objects.

## Out of Scope

- Calculating Registration Fee in daily cost.
- Adding Registration Fee or renamed premium-rate fields to report metadata or report-builder choices.
- Implementing the derived Registration Fee amount in reports.
- Backfilling unverifiable pricing values into historical customer-policy versions or old trend snapshots.
- Customer-specific pricing overrides.
- Importing independent customer-level pricing values.
- Rendering either hidden pricing field on active or historical customer policy layouts.
- Renaming the physical `cost_percent` field or breaking existing API and saved-report references.
- New styling or layout redesign.

## Further Notes

The future reporting formula is:

`Registration Fee amount = calculated insurance premium amount × Registration Fee (%) / 100`

Codebase scan:

- **Required:** Prisma models and a forward-only migration; policy request validation and persistence; active customer-policy synchronization; assignment and policy-switch copying; customer and policy trend snapshot services; customer-policy API mappings; policy details and modal forms; settings list and manual export; English and Hebrew settings translations; service, API, trend, migration, and regression tests.
- **Optional/out of scope:** report metadata and field-usage helpers; derived report calculations; import field mapping; customer-specific override workflows; historical data reconstruction.
- **No change needed:** customer policy presentation layouts; daily-cost formula; entity route dispatch; generic report query execution; existing historical migrations.

Easy-to-miss implementation touchpoints include the manual export mapper, list sorting allowlist, explicit API row types, client/server validation parity, TopUp null normalization, trend configuration-change scalar lists, and transaction boundaries for propagating master-policy edits.

## Issues (vertical slices)

Tracer-bullet breakdown published to the ClickUp ARchaser list. **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description Markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Changes related to policy costs](https://app.clickup.com/t/869e3jk3k)

| # | Title | ClickUp | Waiting on | User stories |
| --- | --- | --- | --- | --- |
| 1 | Policy pricing settings and master trend audit | [869e6ebka](https://app.clickup.com/t/869e6ebka) | — | 1–11, 18, 22 |
| 2 | Synchronize pricing onto active customer policies | [869e6ebk9](https://app.clickup.com/t/869e6ebk9) | #1 | 12–17, 20–21 |
| 3 | Snapshot customer policy pricing in daily trends | [869e6ebkb](https://app.clickup.com/t/869e6ebkb) | #2 | 16, 19, 22 |

**Assignee / status:** Nilotpal Bose on all slices; Selected for Development.
