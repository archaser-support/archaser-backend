# QA Test Steps: Credit Insurance Top-Up

This document outlines the Quality Assurance (QA) test plan and step-by-step verification procedures for the **Credit Insurance Top-Up** feature. The tests cover the schema, feature gate, settings configuration, top-up CRUD and validations, effective limit calculations, customer screen UI, credit dashboard metrics, charts, reporting, and localization.

---

## 🛠️ Test Setup & Prerequisites
1. **Database Access**: Ability to run SQL queries or use Prisma Studio to verify database state.
2. **User Roles**: At least one user with write permissions (e.g., `update_insurance_policy`, `view_customer`, `view_settings`) and one user with read-only permissions (e.g., `view_customer`).
3. **Environment**: A running local or staging environment with exchange rates loaded (FX).

---

## 1. Feature Gate (`hasTopUpPolicies`)
Verify that the top-up feature is correctly gated and does not impact existing accounts that have not set up top-up policies.

### Test 1.1: Default State (Gate Inactive)
* **Setup**: An account with zero `InsurancePolicy` records of type `TopUp` (only `Primary` policies exist).
* **Steps**:
  1. Login and navigate to the **Credit Dashboard**.
  2. Inspect the dashboard KPI cards, toolbar, and the **Policy Usage** chart.
  3. Navigate to any customer page.
  4. Inspect the header, details page tabs, and Policies tab.
  5. Attempt to send a `GET` or `POST` request directly to `/api/entities/customers/:id/top-ups`.
* **Expected Result**:
  * **Dashboard**: No "Active top-up cover" or "Top-ups expiring soon" cards are rendered. No urgent top-up toolbar banner is visible. The **Policy Usage** chart renders only 2 bars (Policy max total cover, Policy max DCL/SDL cover).
  * **Customer Page**: No "Top-up active", "Top-up scheduled", or expiration chips are shown in the header. The approved limit card shows only the base limit (no "+ top-up" breakdown). The Policies tab has no badge. The Policies tab does not contain a "Top-up cover" section or modal trigger. No header banner is shown.
  * **API**: The top-ups endpoint returns a `404 Not Found` or `{ enabled: false }` with a `403/404` status code.

### Test 1.2: Unlocking the Feature (Gate Active)
* **Setup**: An account with at least one `InsurancePolicy` record of type `TopUp`.
* **Steps**:
  1. Navigate to **Settings** -> **Insurance Policies**.
  2. Create a new policy with `policy_kind = TopUp` (see Section 2).
  3. Navigate back to the **Credit Dashboard** and **Customer Page**.
* **Expected Result**:
  * The dashboard KPI cards and 3rd bar of the **Policy Usage** chart are unlocked.
  * The customer pages show the "Top-up cover" section under the Policies tab.
  * API endpoints for top-ups are operational and return valid payloads.

---

## 2. Settings: Insurance Policies by Kind
Verify that the `InsurancePolicy` creation and edit forms adapt to the selected policy kind.

### Test 2.1: Primary Policy Fields
* **Setup**: Settings -> Insurance Policies page.
* **Steps**:
  1. Click **Create Policy** (or equivalent modal trigger).
  2. Set **Policy Kind** = `Primary`.
  3. Verify fields visible.
  4. Fill in `insurer_name` (e.g., "Euler Hermes"), `policy_number` (e.g., "POL-123"), and standard details. Save the policy.
* **Expected Result**:
  * The form renders all standard limit inputs (Max total cover, DCL/SDL, terms, reporting days).
  * The `insurer_name` is optional.
  * Saving is successful. On details, the policy displays as `Euler Hermes – POL-123` (using the `formatPolicyLabel` helper).

### Test 2.2: Top-Up Policy Fields & Validations
* **Setup**: Settings -> Insurance Policies page.
* **Steps**:
  1. Click **Create Policy**.
  2. Set **Policy Kind** = `TopUp`.
  3. Verify UI adjustments.
  4. Verify the **Parent Primary Policy** dropdown lists only `Primary` policies for the current account.
  5. Verify the **Allow Concurrent Top-Ups** toggle is available and defaults to `true`.
  6. Fill in details: `insurer_name = "Atradius"`, `policy_number = "TOP-456"`, `policy_kind = TopUp`, select a parent primary policy, leave `allow_concurrent_top_ups = true`. Save.
* **Expected Result**:
  * Limits sections, country caps tabs, and named customer tabs are **hidden** for TopUp policies.
  * Saving is successful. The list and select boxes display `Atradius – TOP-456`.

---

## 3. Customer Top-Up CRUD & Business Rules
Verify the management of customer-specific top-up limits and enforcement of validation rules.

### Test 3.1: Create Fixed Top-Up
* **Setup**: Customer Page -> Policies tab (with a TopUp policy available on the account).
* **Steps**:
  1. In the **Top-up cover** section, click **Add Top-up**.
  2. Set **Type** = `Fixed`.
  3. Enter **Value** = `50,000`.
  4. Select **Currency** = `USD`.
  5. Select valid start and end dates (e.g., current month).
  6. Save.
* **Expected Result**:
  * The record is created successfully.
  * The table display shows `50,000.00 USD`.
  * Database entry has `top_up_type = Fixed`, `top_up_value = 50000.0000`, `currency = USD`.

### Test 3.2: Create Percentage Top-Up
* **Setup**: Customer has an active `CustomerPolicy` with `approved_limit = 100,000 USD`.
* **Steps**:
  1. In the **Top-up cover** section, click **Add Top-up**.
  2. Set **Type** = `Percentage`.
  3. Enter **Value** = `50` (representing 50%).
  4. Verify the **Currency** field is hidden or disabled and cleared.
  5. Select dates and Save.
* **Expected Result**:
  * The record is created successfully.
  * The table display shows `50%` and a calculated breakdown in parentheses: `(50,000.00 USD)`.
  * Database entry has `top_up_type = Percentage`, `top_up_value = 50.0000`, `currency = null`.

### Test 3.3: Percentage Top-Up Validation (No Base Limit)
* **Setup**: Customer has **no** active primary policy, or primary policy `approved_limit` is null/zero.
* **Steps**:
  1. Add Top-up for this customer.
  2. Select **Type** = `Percentage`, enter `50`. Save.
* **Expected Result**:
  * The form blocks saving and shows an error message: *"Cannot create a percentage-based top-up when there is no active primary policy limit"* (or similar validation rejection).

### Test 3.4: Concurrent Top-Up Restrictions
* **Setup**: A Top-Up policy `TOP-CONC-FALSE` has `allow_concurrent_top_ups = false`.
* **Steps**:
  1. Create Top-up Row 1 for Customer X using `TOP-CONC-FALSE` with dates `2026-06-01` to `2026-06-30`. Save.
  2. Create Top-up Row 2 for Customer X using `TOP-CONC-FALSE` with dates `2026-06-15` to `2026-07-15`. Save.
* **Expected Result**:
  * Row 1 is created successfully.
  * Row 2 creation fails with a `409 Conflict` or a clear validation error: *"Overlapping top-up ranges are not allowed for this policy"* (or similar validation message).

### Test 3.5: Parent Primary Policy Matching
* **Setup**: 
  - Top-Up policy `TOP-PARENT-X` has `parent_insurance_policy_id = 10` (Primary Policy A).
  - Customer 1 has an active `CustomerPolicy` linked to Primary Policy A.
  - Customer 2 has an active `CustomerPolicy` linked to Primary Policy B.
* **Steps**:
  1. Try to add a top-up for **Customer 1** using Top-Up policy `TOP-PARENT-X`. Save.
  2. Try to add a top-up for **Customer 2** using Top-Up policy `TOP-PARENT-X`. Save.
* **Expected Result**:
  * **Customer 1**: Top-up is saved successfully.
  * **Customer 2**: Saving fails with a validation error indicating a parent policy mismatch.

---

## 4. Effective Limit Resolver Calculations
Verify that the `resolveEffectiveApprovedLimit` service correctly calculates the effective approved limit under various scenarios.

### Test 4.1: Percentage Top-Up Tracking Base Limit
* **Setup**: Customer with active primary `approved_limit = 100,000 USD`. Top-up is `50% Percentage`.
* **Steps**:
  1. View effective limit. (Expected: `150,000 USD`).
  2. Update the customer's primary policy limit to `80,000 USD`.
  3. View effective limit again.
* **Expected Result**:
  * The effective limit recomputes to `120,000 USD` (80,000 base + 40,000 top-up). No manual update to the top-up record was required.

### Test 4.2: Fixed Top-Up Baseline Stability
* **Setup**: Customer with active primary `approved_limit = 100,000 USD`. Top-up is `50,000 USD Fixed`.
* **Steps**:
  1. View effective limit. (Expected: `150,000 USD`).
  2. Update the customer's primary policy limit to `80,000 USD`.
  3. View effective limit again.
* **Expected Result**:
  * The effective limit recomputes to `130,000 USD` (80,000 base + 50,000 fixed).

### Test 4.3: Stack Concurrent Top-Ups
* **Setup**: 
  - Top-Up Policy A (concurrent = true) has active top-ups: `10,000 USD Fixed` and `20,000 USD Fixed` overlapping.
  - Top-Up Policy B (concurrent = false) has active top-up: `15,000 USD Fixed`.
  - Base Primary Limit = `100,000 USD`.
* **Steps**:
  1. Retrieve effective limit for the customer.
* **Expected Result**:
  * Effective Limit = `100,000 (Base) + 30,000 (Policy A) + 15,000 (Policy B) = 145,000 USD`.

### Test 4.4: Exclusions & Outdated DCL
* **Setup**: Customer with `approved_limit = 100,000 USD` and active top-up `20,000 USD Fixed`.
* **Steps**:
  1. Set `excluded_from_policy = true` on the primary customer policy. Check effective limit and capacity gap.
  2. Revert, and set `outdated_dcl = true` on the primary customer policy. Check effective limit and capacity gap.
* **Expected Result**:
  * In both cases, the top-up contribution is ignored. Effective limit remains `100,000 USD` (or calculations fallback to base-only capacity math).

---

## 5. Customer Screen Visual Indicators
Verify that the top-up statuses and limits are prominently displayed in the customer interface.

| Indicator | Location | Scenario & Verification | Expected Visual / Behavior |
|:---|:---|:---|:---|
| **1. Header Chip** | Header (near tags) | Active top-up exists | Displays a chip **"Top-up active"**. |
| | | Active top-up expiring in <= 30 days | Displays a warning-colored chip **"Expires YYYY-MM-DD"**. |
| | | Future top-up exists, no current active | Displays a muted chip **"Top-up scheduled"**. |
| **2. Effective Limit Display** | Policy Card | Active top-up exists | Title shows **"Effective limit"**. Subtext shows `Base {{base}} + top-up {{top_up_total}}` (e.g. `Base $100k + top-up $50k`). Usage bar is calculated against effective limit. |
| **3. Policies Tab Badge** | Tab navigation | Active top-up exists | Tab header shows a dot or number badge (e.g., `Policies 2`). |
| **4. Policies Section** | Policies Tab page | Any state | Rendered above the primary policy accordion. Displays a table listing all top-ups, types, start/end dates, values, and status. Contains a button to open the "Add Top-up" modal. |
| **5. Header Info Banner** | Below header | Top-up expiring soon or multiple active | Displays warning banner: `+{{amount}} top-up cover until {{date}}`. |

* **Navigation Action**: Verify that clicking the Header Chip (1), Tab Badge (3), or Info Banner (5) automatically scrolls the page to the **Top-up cover** section under the Policies tab.

---

## 6. Credit Dashboard KPI Cards
Verify aggregated credit indicators reflect top-up coverages.

### Test 6.1: Active Top-Up Cover KPI
* **Setup**: Multiple customers with active top-ups.
* **Steps**:
  1. Navigate to the dashboard.
  2. Locate the **Active top-up cover** card.
* **Expected Result**:
  * **Value**: Displays the sum of all active, resolved top-up amounts across the account (converted to account currency).
  * **Footnote**: Displays `{{count}} customers with active top-up`.
  * **Click Action**: Clicking the card navigates to the `top_up` report.

### Test 6.2: Cover Declined Warning on KPI Card
* **Setup**: 
  - Customer Y has a `50% Percentage` top-up.
  - Yesterday, customer Y's base limit was `100,000 USD` (top-up resolved to `50,000 USD`).
  - Today, customer Y's base limit was reduced to `60,000 USD` (top-up resolved to `30,000 USD`).
* **Steps**:
  1. View the **Active top-up cover** card on the dashboard.
* **Expected Result**:
  * Footnote shifts to a warning tone: *"Cover down $20,000.00 — 1 customer (approved limit reduced)"*.
  * Clicking the warning footnote redirects to the `top_up_cover_declined` report.

### Test 6.3: Top-Ups Expiring Soon KPI
* **Setup**: At least one active top-up expiring in <= 30 days.
* **Steps**:
  1. View the **Top-ups expiring soon** card on the dashboard.
* **Expected Result**:
  * **Value**: Count of customers with expiring top-ups in the next 30 days.
  * **Footnote**: Shows `{{totalAmount}} at risk · within 30 days`.
  * **Urgent State**: If any end date is <= 7 days from today:
    - Footnote is displayed in error/red tone.
    - A toolbar banner appears saying: *"X top-ups expire within 7 days"*. Clicking it navigates to the expiring report filtered by 7 days.

---

## 7. Credit Policy Usage Chart (3rd Bar)
Verify the visual breakdown of top-up utilization.

### Test 7.1: Stacking Segments
* **Setup**: 
  - Customer A: Base limit = `100,000 USD`. Top-up = `50,000 USD`. Open AR = `120,000 USD`. (Used top-up = `20,000`, Remaining = `30,000`, Over effective = `0`).
  - Customer B: Base limit = `100,000 USD`. Top-up = `50,000 USD`. Open AR = `180,000 USD`. (Used top-up = `50,000`, Remaining = `0`, Over effective = `30,000`).
* **Steps**:
  1. View the **Policy Usage** chart on the dashboard.
  2. Hover over the **Top-up cover** (3rd) bar.
* **Expected Result**:
  * Columns 1 and 2 display normally.
  * Column 3 (Top-up cover) displays stacked categories matching the sums:
    - **Used**: `70,000 USD` (supplemental cover consumed).
    - **Remaining**: `30,000 USD` (unused top-up capacity).
    - **Over limit**: `30,000 USD` (receivables exceeding effective limit).
  * Legend colors match the existing columns (Used, Remaining, Over Limit).

---

## 8. Daily Snapshots, Trends, and Reports
Verify data persistence and batch processing logic.

### Test 8.1: Daily Snapshot Cron
* **Setup**: Run the daily snapshot generation script manually or wait for the scheduled run.
* **Steps**:
  1. Check database records in `CreditDashboardDailySnapshot`.
* **Expected Result**:
  * New columns `top_up_cover_total_amount`, `customers_with_active_top_up_count`, and `top_up_expiring_customer_count` are successfully persisted with correct values.

### Test 8.2: Customer Policy Trend
* **Setup**: Run the trend capture job.
* **Steps**:
  1. Check `CustomerPolicyTrend` table for a customer with active top-up cover.
* **Expected Result**:
  * `top_up_total` holds the resolved sum of active top-ups on that date.
  * `effective_approved_limit` matches `approved_limit + top_up_total`.
  * `usage_pct` uses the `effective_approved_limit` as the denominator.

### Test 8.3: Top-up Reports
* **Steps**:
  1. Open reports:
     - `top_up`
     - `top_up_expiring`
     - `top_up_cover_declined`
* **Expected Result**:
  * Each report correctly populates rows matching the active filters.
  * CSV/Excel exports include all fields (top-up policy label, end date, amounts, parent policy, etc.).

---

## 9. Localization & RTL
Verify Hebrew translations and layouts.

### Test 9.1: Hebrew Locales
* **Setup**: Toggle application language to Hebrew (HE).
* **Steps**:
  1. Verify all new labels: "Top-up active", "Effective limit", "Base + top-up", "Top-ups expiring soon".
  2. Open the "Add Top-up" modal and check field labels and error validation messages.
  3. Inspect the stacked chart tooltips and KPI cards.
* **Expected Result**:
  * All strings are translated accurately (no raw English keys shown).
  * Layout elements align to the right (RTL support behaves correctly, usage bars grow from right to left).
