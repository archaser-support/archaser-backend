---
name: claims-tracking
overview: Track credit-insurance claims end-to-end — Issue Claim from invoices, Claims nav grid, status lifecycle, Primary-policy excess remaining by policy year, policy-summary history, and report-builder Claim object.
source: grill-me session via /start-work
clickup_task_url: https://app.clickup.com/t/869f2vqu4
isProject: false
---

# Claims tracking

## Problem Statement

Credit teams need to issue and track insurer claims against overdue invoices, see remaining Aggregate/SDL excess by policy year after approved or paid losses, review recent claim history on the Primary policy summary, and report on claims. Today Archaser stores commercial terms (NQL, insured %, Aggregate/SDL excess) on Primary policies but has no Claim entity, no Issue Claim action, no Claims page, and no excess application when a claim is recognized.

## Solution

Add a credit-insurance Claims capability for accounts with the credit product: an **Issue Claim** action on the invoices list that validates eligibility and creates a Draft claim (one claim per invoice), a top-level **Claims** nav page (like Disputes) with a grid of all claims plus manual create for historical backfill, a full status lifecycle through Paid/Rejected/Canceled, automatic excess deduction (SDL first, then Aggregate) on first entry to Approved or Paid with reverse when leaving those statuses, remaining excess (“access amount”) per Primary policy year in settings/summary, a three policy-year claims view on Portfolio Health policy summary, and a Claim object in the report builder.

## User Stories

1. As a credit analyst, I want an Issue Claim action on the invoices list, so that I can start a claim from an eligible invoice without leaving my invoice workflow.
2. As a credit analyst, I want Issue Claim blocked when the invoice fails eligibility, so that I do not submit invalid claims by mistake.
3. As a credit analyst, I want eligibility to require open amount above policy NQL (when NQL is set), overdue status, reporting breach true, and no existing claim for that invoice, so that gates match insurer readiness rules.
4. As a credit analyst, I want a successful Issue Claim to create a Draft claim linked to that invoice and the account’s Primary InsurancePolicy, so that tracking starts immediately.
5. As a credit analyst, I want at most one claim per invoice from Issue Claim, so that duplicates are prevented.
6. As a credit analyst, I want a Claims page in the main navigation (similar to Disputes), so that I can manage all claims in one place.
7. As a credit analyst, I want the Claims nav item and page visible only when the account has the credit insurance product, so that non-credit accounts stay uncluttered.
8. As a credit analyst, I want a grid of all claims on the Claims page, so that I can filter and scan status and amounts.
9. As a credit analyst, I want to manually create a claim on the Claims page (optionally without an invoice), so that I can backfill up to three years of historical claims.
10. As a credit analyst, I want claim statuses Draft, Submitted, Under Inquiry, Approved, Paid, Rejected, and Canceled, so that the lifecycle matches insurer handling.
11. As a credit analyst, I want moving to Submitted to require submission date and insurer submission reference number, so that filed claims are traceable.
12. As a credit analyst, I want Under Inquiry available as an optional status, so that document requests from the insurer can be reflected.
13. As a credit analyst, I want recognized loss to default to open invoice balance times insured percentage, so that indemnity math starts from commercial terms.
14. As a credit analyst, I want to override recognized loss before Approve/Paid, so that negotiated amounts can be recorded.
15. As a credit analyst, when a claim first becomes Approved or Paid, I want remaining SDL excess for the claim’s policy year reduced first, then Aggregate, so that yearly and overall excess stay correct.
16. As a credit analyst, when a claim leaves Approved and Paid (for example Rejected or Canceled), I want the prior excess deduction reversed, so that remaining excess is restored.
17. As a credit analyst, I want policy year for a claim to be the Primary policy anniversary slice that contains the invoice date (or claim loss date when no invoice), so that year assignment matches the policy period, not the calendar year.
18. As a credit admin, I want to see remaining Aggregate/SDL excess (“access amount”) per policy year on Primary policy settings/summary surfaces, so that I know how much excess is left.
19. As a credit analyst, I want the last three Primary policy years of claims visible in the Portfolio Health policy summary, so that recent claim history sits with the policy.
20. As a credit analyst, I want a Claim object in the report builder, so that I can build custom claim reports.
21. As a Hebrew-speaking user, I want Claims nav, grid, statuses, actions, and validation messages in English and Hebrew, so that the feature is bilingual.
22. As a credit analyst, I want claims always owned by the account’s Primary InsurancePolicy, so that excess and commercial terms have a single source of truth (TopUp ignored for claims).
23. As a platform owner, I want TopUp policies unchanged for commercial excess fields, so that Primary-only commercial terms stay consistent.
24. As a credit analyst, I want clear errors when Issue Claim fails eligibility, so that I know which check failed.
25. As a credit analyst, I want Draft claims editable (status, amounts, references) until they progress, so that I can correct data before submission.
26. As a credit analyst, I want invoice-linked claims to show customer and invoice context on the Claims grid, so that I can navigate back to the source.
27. As a developer, I want excess application and eligibility as domain rules reused by API and UI, so that gates and money math stay consistent.
28. As a credit admin, I want null Aggregate/SDL commercial settings to mean no excess bucket to draw from for that type, so that deduction skips unset buckets.
29. As a credit analyst, I want Aggregate excess of zero to mean no aggregate pot (consistent with commercial-terms “none”), so that deduction does not invent capacity.
30. As an implementer, I want create/list/get/update claim APIs with account scoping and credit-product guards, so that UI and reports share one contract.

## Implementation Decisions

- Primary repo: **backend** for schema, domain, API, report metadata, and planning; frontend uses the same branch name when first touched.
- **Claim entity** (account-scoped) linked to Primary `InsurancePolicy`; optional unique link to one `Invoice`; optional customer via invoice or manual entry; status enum covering Draft → Submitted → Under Inquiry → Approved → Paid → Rejected → Canceled (exact allowed transitions may be documented in domain; Submitted requires submission date + insurer reference).
- **Issue Claim** from invoices list: server-side eligibility — open amount **>** Primary NQL when NQL is set; invoice overdue; `reporting_breach` true; no existing claim for that invoice; creates Draft with default recognized loss = open × Primary `insured_percentage` (when insured % set; otherwise define safe default in domain — prefer requiring insured % or treating missing insured % as 100% only if product agrees; default recommendation in code: if insured % null, treat as 100% for draft default and surface clearly in UI).
- **Claims page**: top-level nav item patterned after Disputes; `show` gated on `accountProducts.has_credit_insurance === true` (same pattern as Credit Dashboard / Portfolio Health); grid of all account claims; manual create for backfill.
- **Excess deduction**: on first transition into `{Approved, Paid}`, deduct recognized loss from remaining SDL for that policy year, then Aggregate remaining; store applied amounts on the claim (or ledger rows) so reverse is exact when leaving `{Approved, Paid}`; do not double-deduct when moving Approved → Paid.
- **Policy year**: anniversary windows from Primary `InsurancePolicy.start_date` (year 1 = start through start+1y−1d, etc.) clipped by `end_date` as needed; claim year from invoice date when linked, else a required loss/invoice-equivalent date on manual claims.
- **Remaining excess (“access amount”) per year**: derived = configured Aggregate/SDL commercial terms minus sums of applied deductions for Approved/Paid claims in that year (with reverse support); expose on Primary policy settings and/or summary — not a separate free-form editable annual field unless needed to seed history (manual claims drive history).
- **Policy summary**: Portfolio Health Primary policy summary shows claims / remaining excess for the current policy year and prior two anniversary years.
- **Report builder**: add Claim as a reportable object with core fields (status, dates, references, amounts, policy year, links to invoice/customer/policy).
- Reuse existing commercial-term fields on Primary; do not invent TopUp excess.
- **i18n:** all new user-facing strings ship EN+HE together.
- Styling: reuse existing nav, grid, dialog, and settings patterns; no new global theme without approval.
- Prefer `npx prisma db push` for local/dev schema apply per project rules (no `migrate dev` / force-reset from agents).

## Testing Decisions

- Prefer highest existing seams: invoices list actions, Claims page (like Disputes), insurance-policy / Portfolio Health policy summary, report builder metadata.
- Primary seams:
  1. Issue Claim eligibility and Draft creation (API + invoices UI).
  2. Status transition to Approved/Paid applies SDL-then-Aggregate deduction for the correct policy year; leaving those statuses reverses.
  3. Claims nav/grid visible only with credit product; manual create without invoice works for backfill.
  4. Policy summary shows three policy-year claim/excess window; report builder lists Claim.
- Good tests assert external behavior (status, remaining excess, eligibility errors, nav visibility) — not private helpers.
- Prior art: Disputes page/nav; Primary commercial terms API/UI; reporting_breach and overdue invoice fields; Portfolio Health policy summary commercial bullets.
- Automated tests optional unless explicitly requested; each slice How to test covers manual verification including Hebrew locale spot-check where UI copy is added.

## Out of Scope

- CSV/Excel import of historical claims (manual create covers backfill in v1).
- Multi-invoice claims / claim baskets.
- Claims owned by TopUp policies or user-picked non-Primary policies.
- Soft-warn Issue Claim (v1 is hard gate).
- Live NCB / minimum-premium engines.
- Changing commercial-terms field storage shape beyond reading Aggregate/SDL/NQL/insured %.
- Collection disputes integration (separate product area).
- Auto-filing to the insurer / external insurer APIs.
- New automated test suites unless the user asks.

## Further Notes

- ClickUp: https://app.clickup.com/t/869f2vqu4
- Branch (primary repo): `feat/claims-tracking-CU-869f2vqu4`
- Grill decision log: full v1; remaining excess per policy year; SDL then Aggregate; deduct on Approved/Paid with reverse; open×insured% editable; Claims nav like Disputes + credit product only; manual+Issue Claim history; one claim per invoice; hard eligibility; anniversary policy years; Primary-only ownership.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/claims-tracking/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/claims-tracking/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Claim schema, domain, and API | `issues/01-claim-schema-domain-api.md` | — | 4–5, 10–18, 22–23, 27–30 |
| 2 | Issue Claim from invoices (eligibility) | `issues/02-issue-claim-from-invoices.md` | 01 | 1–5, 13–14, 24 |
| 3 | Claims nav page, grid, and lifecycle UI | `issues/03-claims-nav-grid-lifecycle-ui.md` | 01 | 6–12, 21, 25–26 |
| 4 | Remaining excess per year + policy summary history | `issues/04-excess-remaining-policy-summary.md` | 01 | 18–19 |
| 5 | Report builder Claim object | `issues/05-report-builder-claim-object.md` | 01 | 20 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
