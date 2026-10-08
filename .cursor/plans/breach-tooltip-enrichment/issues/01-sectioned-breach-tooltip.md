# 01 — Sectioned breach tooltip with per-breach details

**Status:** done
**Priority:** high
**Blocked by:** —
**PRD:** `.cursor/plans/breach-tooltip-enrichment/OVERVIEW.md` (decision log; no PRD)

## What to build

Replace the plain bullet list in the **Contains breaches / violations** tooltip on the customer invoice grid with one section per active breach (decision D6). Each section has a bold title, label/value rows below it, and a thin divider before the next section. The tooltip is about 320px wide and right-to-left aware.

Fill each section with details from data that already exists (D5; rules in the overview):

- **Reporting breach:** target reporting date and days late (reported late, or not yet reported).
- **Payment term:** credit days vs max payment term (e.g. "90 (max 60)").
- **Customer overdue (MEP) at creation:** "Caused by: <invoice number>" from the cause number already stored. Slice 02 adds the remaining MEP rows.
- **Excluded from policy:** exclusion reason when present.
- **Outdated DCL:** credit score input date and validity period.
- **Invoice after policy end:** invoice date and policy end date.

Make sure the grid rows carry every input the sections need. Add missing fields to the customer invoice view's row data. A cause whose inputs are missing shows its title only and never prints an empty or "null" row.

This slice also builds the reusable per-cause detail builder that slice 02 extends.

## Acceptance criteria

- [x] Tooltip shows one titled section per active breach, with dividers between sections and the approved layout (D6)
- [x] Each breach type shows the detail rows listed above; rows with missing inputs are hidden
- [x] The MEP section shows the stored cause invoice number as plain text (D7)
- [x] Dates and amounts use the same formatting as the grid; Hebrew renders right to left
- [x] Tooltip follows `frontend-tooltips.mdc` (`placement="bottom"`, arrow, delays)
- [x] All new labels exist in both English and Hebrew `customers.json` under `credit_insurance_violations`
- [x] Per-flag warning-icon columns and the report Terms Breach Reason text are unchanged (D1)

## How to test

1. On a credit-insurance account, open a customer with open invoices that have several breach types (e.g. reporting breach + payment term).
2. On the customer page invoice grid, hover the warning icon in the **Contains breaches / violations** column.
3. Expect one section per breach with its details, e.g. "Payment term violation — Credit days: 90 (max 60)" and "Reporting breach — Target reporting date: … · Days late: …".
4. Hover an MEP-flagged invoice. Expect "Caused by: <invoice number>".
5. Switch the UI to Hebrew and repeat. Expect translated labels and right-to-left layout.
