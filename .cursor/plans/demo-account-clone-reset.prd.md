---
name: demo-account-clone-reset
overview: Clone a source account (starting with 10149) into a new anonymized, scaled demo account marked is_demo, and let demo account admins reset dates via a background job that rebuilds derived AR and credit data.
source: grill-me session (/start-work)
clickup_task_url: https://app.clickup.com/t/869ezzh4e
isProject: false
---

# Demo account clone, anonymization, and date-shift reset

## Problem Statement

Sales needs a realistic Archaser tenant to walk potential customers through collection and credit-insurance flows. Using a live customer account (for example 10149) is unsafe: names, company IDs, invoice numbers, contacts, and uploaded documents can identify the real customer, and money amounts are too close to production. Even after a one-time copy, demo data ages; due dates and snapshots drift into the past and the walkthrough no longer looks “current.” There is no product support today for marking an account as a demo or for refreshing demo timelines safely.

## Solution

Provide an **ops-only clone** that creates a **new** account from a source account (default target source: 10149), copies almost all business data except secrets and live connectors, replaces identifying values with realistic fakes, applies one account-wide money scale factor, creates a small fixed set of demo users (no real user clone), copies attachment **metadata only**, sets `is_demo`, and finishes with the same **date-shift + recalculation** used for reset so the demo is walkthrough-ready immediately.

Later, **account admins on that demo account** can open **Settings → Demo** and start a **background reset job** that applies one day-offset to relevant business dates (preserving relative spacing), then rebuilds derived data (customer amount rollups and credit as-of / snapshots), with progress visible in Settings. Multiple demo accounts are allowed. Reset never re-clones from the source.

## User Stories

1. As a sales engineer, I want a dedicated demo account that looks like a real tenant, so that I can walk a prospect through the product without using production customer data.
2. As a sales engineer, I want customer and company names to look real but invented, so that demos feel authentic without leaking identity.
3. As a sales engineer, I want emails, phones, and addresses anonymized, so that contact details cannot identify the source customer.
4. As a sales engineer, I want customer numbers, CRNs, and invoice numbers replaced with fake stable codes, so that business IDs cannot re-identify the source.
5. As a sales engineer, I want money amounts scaled consistently across related records, so that invoices, payments, and limits still add up but are not near-copies of production.
6. As a sales engineer, I want credit-insurance policies, trends, and reports included in the demo, so that I can show the full product story.
7. As a sales engineer, I do not want live billing connectors or email/SMS/SSO secrets copied, so that the demo cannot talk to the customer’s ERP or send mail as them.
8. As a sales engineer, I want fixed demo logins with known credentials, so that I can sign in reliably before a call.
9. As a sales engineer, I do not want real employee users from the source account cloned, so that personal accounts are not exposed.
10. As an operations engineer, I want a script that creates a brand-new Account and fills it from a source id, so that I can provision demos without hand-building tenants.
11. As an operations engineer, I want the clone to finish already date-aligned and recalculated, so that the first demo does not require an extra reset step.
12. As an operations engineer, I want attachment file binaries skipped while keeping attachment metadata, so that activity histories look populated without copying real PDFs.
13. As an account admin on a demo account, I want a Settings Demo section visible only when `is_demo` is true, so that reset is discoverable and not shown on real tenants.
14. As an account admin on a demo account, I want to start a demo data reset, so that dates look current before a sales call.
15. As an account admin on a demo account, I want relative gaps between invoice, due, payment, and activity dates preserved, so that the collection story still makes sense after a shift.
16. As an account admin on a demo account, I want customer overdue/due rollups recalculated after the shift, so that list KPIs match the new calendar.
17. As an account admin on a demo account, I want credit as-of / snapshot data rebuilt after the shift, so that credit dashboards are coherent.
18. As an account admin on a demo account, I want reset to run as a background job with progress status, so that long runs do not time out in the browser.
19. As an account admin on a demo account, I want to leave Settings and return later to see job status, so that I can multitask while reset runs.
20. As an account admin on a real (non-demo) account, I must not see or call demo reset, so that production tenants cannot wipe timelines by mistake.
21. As a platform engineer, I want `is_demo` stored on Account, so that API and UI gates are explicit and queryable.
22. As a platform engineer, I want an stored demo data anchor date (or equivalent), so that each reset computes a single day-offset from that anchor to today.
23. As a platform engineer, I want reset to reuse existing freeze / long-job patterns where appropriate, so that crons do not race the demo refresh.
24. As a platform engineer, I want clone and reset to share one “refresh demo timeline” path, so that day-one clone and later reset stay consistent.
25. As a product owner, I want multiple demo accounts allowed, so that different stories or regions can each have a demo later.
26. As a product owner, I want Hebrew and English copy for the Settings Demo UI in the same change, so that bilingual admins see complete UI.
27. As a QA engineer, I want to verify a cloned account is marked `is_demo` and has no source secrets/connectors, so that safety gates are testable.
28. As a QA engineer, I want to spot-check that scaled amounts remain internally consistent after clone, so that books do not break.
29. As a QA engineer, I want to run reset twice and see dates move relative to today without breaking relationships, so that repeated demos stay usable.
30. As a support engineer, I want clear failure status if recalculation fails mid-reset, so that I can retry or investigate without guessing.
31. As a security reviewer, I want confirmation that attachment binaries are not copied, so that document leakage risk is bounded.
32. As a sales engineer, I want owners and created-by fields on cloned rows mapped to demo users, so that the UI does not show missing users.
33. As an operations engineer, I want the clone script to accept a source account id (defaulting to 10149), so that future demos are not hard-coded forever.
34. As an account admin, I want a confirm step before reset starts, so that accidental clicks do not kick off a long job.
35. As a developer, I want role permissions for the new demo account bootstrapped (without cloning real people), so that demo admins can use Settings and core screens.

## Implementation Decisions

### Product rules (locked)

- **D1:** Reset does not re-clone from source; only date-shift + recalculate.
- **D2:** Clone is ops/script only; reset is in-product.
- **D3:** Persist `is_demo` (boolean) on `Account`.
- **D4:** Only account admins on that demo account may start reset (e.g. System Administrator); not any role, not Archaser-admin-only.
- **D5:** Clone almost everything except secrets and live connectors; include credit insurance and reports.
- **D6:** Create a small fixed set of demo users; do not clone real users.
- **D7:** Realistic fake display names.
- **D8:** One account-wide money scale factor; then recalculate.
- **D9:** One day-offset for relevant business dates; preserve relative spacing.
- **D10:** Clone ends with the same date-shift + recalculate as reset.
- **D11:** Reset UI lives under Settings, visible only when `is_demo`.
- **D12:** Attachment metadata only; no binary file copy.
- **D13:** Also fake business IDs (customer numbers, CRN, invoice numbers, similar codes).
- **D14:** Script creates a brand-new Account.
- **D15:** After date shift, rebuild derived data: customer amounts + credit as-of/snapshots (reuse existing jobs where possible).
- **D16:** Background job with progress/status in Settings.
- **D17:** Multiple demo accounts allowed.

### Schema / account marking

- Add `is_demo` boolean on `Account` (default false).
- Add a durable **demo timeline anchor** field (date) used to compute the day-offset on each reset; update it when a refresh completes successfully.
- Expose `is_demo` (and reset job status as needed) on the account payload the frontend already uses for settings/session so the Demo section can gate without a special admin console.

### Clone (ops)

- Script (or ops CLI) parameters: source account id (default 10149), optional scale factor, optional demo account name/subdomain, demo user credentials via env/flags (never commit secrets).
- Create new Account; copy non-secret account settings; set `is_demo=true`.
- Explicit exclude list: email server password and similar secrets, SSO secrets, billing connector config/credentials, and any live outbound provider secrets.
- Copy graph of business entities needed for collection + credit + reports (customers/companies/persons/contacts, invoices/payments, activities/disputes/templates/sequences as required for coherence, insurance policies/customer policies/trends/top-ups, reports definitions owned by the account, role permission matrix, business units, etc.). Exact entity inventory is an implementation checklist derived from Prisma relations for the source account — prefer completeness within D5 over a minimal AR-only subset.
- Anonymize identifying fields with deterministic-enough mapping so internal FKs and repeated references stay consistent (same source customer → same fake name/IDs across tables).
- Apply one scale factor to monetary fields that must stay proportional; then run recalculation rather than hand-fixing every derived rollup column.
- Create fixed demo users; map `owner_id` / `created_by` / `modified_by` (and similar) onto those users.
- Attachment rows: copy metadata (filename, etc.); do not copy storage blobs; downloads may fail or show a clear placeholder.
- End of clone: run shared timeline refresh (date-shift to current + derived rebuild).

### Shared timeline refresh (clone end + reset)

- Compute `deltaDays = today − anchor` (or equivalent); if delta is 0, no-op dates but still allow derived rebuild if requested.
- Shift relevant **business** dates on source-of-truth rows (invoice dates, due dates, payment dates, activity dates, policy dates, snapshot dates that are not purely derived, etc.). Prefer shifting inputs and rebuilding derived snapshots over trusting shifted derived KPI columns alone.
- Do not treat audit-only timestamps as the product “freshness” story unless needed for UI consistency; document the chosen list in the implementation slice.
- After shifts: run customer amount recalculation for the account; run credit as-of / snapshot rebuild for the account using existing backfill/rewrite capabilities.
- While refresh runs, treat the account as busy using existing freeze/long-job patterns so worker crons do not race the rebuild.
- Persist job status (queued / running / succeeded / failed) queryable by the demo account admin API.

### Reset API + UI

- API: start reset only if `is_demo` and caller is an account admin for that account; reject otherwise.
- API: get status for the in-flight or last job.
- Frontend: Settings Demo section/tab only when `is_demo`; confirm dialog; start job; poll/show progress; EN+HE strings together.
- No Archaser-admin-only requirement for reset (D4).

### i18n

- All new Settings Demo strings ship in English and Hebrew locale files in the same change.

### Testing seams (preferred)

Prefer highest existing seams:

1. **Demo timeline refresh module** — given an account with known dates/amounts, applying a fixed day-offset and rebuild updates business dates and derived rollups without re-cloning.
2. **Reset authorization API** — non-demo and non-admin callers are rejected; demo admin can start and read status.
3. **Clone anonymization mapping** — source identifying fields are not present on destination rows for a sampled customer/invoice set; scaled money stays proportional on a sample invoice+payment pair.

Do not require new automated tests unless explicitly requested later; seams above guide manual How to test and any future tests.

## Testing Decisions

- Good tests assert external behavior (dates moved by expected delta, unauthorized reset blocked, identifying strings absent) rather than private helper structure.
- Modules under test if/when tests are requested: demo timeline refresh service, reset API guards, anonymization/scale helpers used by the clone script.
- Prior art: credit as-of backfill status API/UI, account freeze guards, `recalculateCustomerAmounts`, permission clone/bootstrap patterns.

## Out of Scope

- Re-cloning from source on every reset.
- In-product UI to clone arbitrary accounts (ops script only in v1).
- Copying real users, passwords, or personal logins from the source.
- Copying attachment binaries / object storage files.
- Copying billing connector, SMTP, SMS provider secrets, or SSO secrets.
- Making Archaser admins the only reset operators.
- Compressing or selectively shifting only open invoices (v1 is full-account day-offset).
- Automatically creating ClickUp tasks or provisioning demos in customer environments without ops.
- Guaranteeing pixel-perfect report pixel parity with source beyond coherent cloned definitions + data.
- Expanding automated test suites unless separately requested.

## Further Notes

- Primary implementation repo: **archaser-backend** (schema, clone script, refresh job, APIs). Frontend Settings Demo UI lands in **archaser-frontend** on the same branch name when that repo is first touched: `feat/demo-account-clone-reset-CU-869ezzh4e`.
- Source account **10149** is the first production of the script; keep source id parameterized.
- Scale factor default should be clearly below 1.0 (e.g. mid/high 80s–90s percent) and configurable for ops.
- Entity inventory for “almost everything” should be validated against account 10149’s actual populated tables during implementation (codebase scan + live counts), and the exclude list for secrets must be reviewed before running against any shared environment.

## Codebase scan

### Required

- `Account` Prisma model (+ migration / safe schema apply process per project rules) for `is_demo` and demo timeline anchor.
- Account read/API or session payload consumed by Settings so `is_demo` reaches the client.
- New or extended Nest API for demo reset start + status (pattern after as-of backfill status controllers).
- Shared demo timeline refresh service orchestrating date-shift + `recalculateCustomerAmounts` + credit as-of/snapshot rebuild.
- Account freeze / long-job integration so refresh does not race worker crons.
- Ops clone script under backend scripts (new), using Prisma and existing domain helpers.
- Anonymization + scale helpers; ID remapping tables for cloned FKs.
- Role permission bootstrap for the new account (existing `cloneRolePermissions` / account bootstrap patterns — reuse, do not fork blindly).
- Frontend Settings page: Demo section/tab gated on `is_demo`; confirm + progress UI.
- English + Hebrew locale keys for Demo Settings copy.

### Optional / out of scope unless requested

- Archaser admin console controls to manage demos from account 10013.
- Automated Nest/unit tests for refresh and clone helpers.
- Grafana metrics specific to demo reset jobs.
- Re-anonymize-in-place tool for an existing demo without full re-clone.

### No change needed

- Billing connector sync scheduling and Mongo import cache (demo excludes live connectors).
- Real customer account 10149 schema itself (read-only source).
- Global search / unrelated Settings tabs beyond adding Demo visibility.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/demo-account-clone-reset/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/demo-account-clone-reset/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Demo flag + Settings Demo shell | `issues/01-demo-flag-settings-shell.md` | — | 13, 20, 21, 26 |
| 2 | Shared timeline refresh + reset API/job | `issues/02-timeline-refresh-reset-api.md` | 01 | 14–19, 22–24, 29, 30, 34 |
| 3 | Settings Reset UI with progress | `issues/03-settings-reset-ui.md` | 02 | 13–19, 26, 34 |
| 4 | Ops clone script (anonymize, scale, provision) | `issues/04-ops-clone-script.md` | 02 | 1–12, 27, 28, 31–33, 35 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
