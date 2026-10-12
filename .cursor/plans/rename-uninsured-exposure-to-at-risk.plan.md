---
name: Rename uninsured exposure wording
overview: "CU-869f9hz44 — replace leftover product wording \"uninsured exposure\" with \"at-risk exposure\" (or \"uninsured amount\" where the phrase wrongly describes limit excess). Do not rename DB/API fields."
todos:
  - id: comments-code
    content: Fix code comments that say Uninsured exposure (at-risk KPI vs limit excess)
    status: completed
  - id: plans-docs
    content: Update .cursor/plans phrasing where it means the at-risk KPI
    status: completed
  - id: verify-search
    content: Re-grep for uninsured exposure; leave uninsured_amount / uninsured_gap alone
    status: completed
isProject: false
---

# Rename remaining "uninsured exposure" → "at-risk exposure"

**ClickUp:** [Rename remaining "uninsured exposure" to "at-risk exposure"](https://app.clickup.com/t/869f9hz44) — `in progress`.

## Decisions (locked)

- **At-risk KPI leftovers:** phrase `uninsured exposure` → `at-risk exposure` in comments/docs that mean Cap Gap + Terms Breach − overlap / portfolio at-risk.
- **Limit-excess leftovers:** when the same English phrase incorrectly describes `uninsured_amount` (open AR beyond approved limit), use **uninsured amount** / **limit excess** — do **not** call it at-risk exposure.
- **Do not rename:** Prisma columns, API keys, report field names, locale keys `uninsured_amount*` / `uninsured_gap`, or identifiers like `uninsuredGap` / `uninsuredAmount` (would break APIs; optional follow-up).
- **User-facing locales:** already use at-risk exposure for the KPI; no EN/HE copy change required unless a leftover label string is found (none currently for the exact phrase).
- **Historical migrations / SQL:** leave as-is.

## Codebase scan

**Required**
- [`fe/types/creditInsurance.ts`](fe/types/creditInsurance.ts) — comment on `uninsuredAmount`
- [`be/.../customerDashboardKpisService.ts`](packages/credit-insurance-domain/src/credit-insurance/domain/customerDashboardKpisService.ts) — same comment
- [`be/.../syncCustomerPolicyGapAmounts.ts`](packages/credit-insurance-domain/src/credit-insurance/domain/syncCustomerPolicyGapAmounts.ts) — "Uninsured exposure" comments → uninsured amount
- Selected `.cursor/plans/*.prd.md` / `*.plan.md` that still say `uninsured exposure` meaning at-risk (or clarify to uninsured amount when meaning gap)

**Out of scope**
- Renaming `uninsured_amount` columns / report metadata / locale keys to `at_risk_*`
- Rewording "Uninsured gap" / "Uninsured Amount" UI labels (different concept)
- FE risk-exposure snapshot / locale leftovers branches

## How to test

1. Case-insensitive search for `uninsured exposure` — only intentional historical migration notes remain (or none).
2. Customer / credit dashboard still shows **At Risk Exposure** (EN/HE).
3. Spot-check updated plan docs.
