---
name: credit-insurance-policy-commercial-terms
overview: Add optional commercial terms on Primary insurance policies (insured %, NQL, min premium, excesses, NCB tiers, product type) with a Commercial terms tab — persist and settings UI only.
source: grill-me session via /start-work
clickup_task_url: https://app.clickup.com/t/869f2tjgb
isProject: false
---

# Credit insurance policy — commercial terms

## Problem Statement

Credit analysts and admins need Idigital-style commercial policy terms (insured percentage, NQL, minimum premium, aggregate/SDL excess, no-claim bonus tiers, and whether sold products are tailor-made or commodity) on the insurance policy. Today `InsurancePolicy` only stores cover/limits and fee pricing (`cost_percent`, registration fee, annual credit assessment fee), so those commercial terms cannot be recorded in Archaser.

## Solution

Add optional commercial-term fields on Primary `InsurancePolicy` records. Expose them on the policy detail page as a second tab (**Commercial terms**) alongside the existing General content, and mirror the same fields in a Commercial section of the create/edit modal. Persist and edit only in this delivery — no claim, cost, or NCB calculation engines yet. TopUp policies hide and clear these fields (same pattern as Primary-only pricing fields).

## User Stories

1. As a credit admin, I want to record insured percentage on a Primary policy, so that cover share is documented on the policy.
2. As a credit admin, I want to record Non-Qualifying Loss Threshold (NQL) as a money amount in policy currency, so that the policy floor for qualifying loss is stored.
3. As a credit admin, I want to record minimum premium amount and period in years, so that “1.5M for 3 years” style terms are explicit.
4. As a credit admin, I want to record aggregate excess (including zero for “none”), so that the policy’s general excess is stored.
5. As a credit admin, I want to enter an annual SDL excess amount on the policy, so that the current-year figure is available before a calculation engine exists.
6. As a credit admin, I want to configure fixed no-claim bonus tiers (0% claims bonus %, claims-ratio threshold %, up-to-threshold bonus %), so that Idigital-style NCB rates are stored for later use.
7. As a credit admin, I want to mark whether the account’s products under this policy are tailor-made or commodity, so that stock/risk context sits on the policy.
8. As a credit admin, I want all of these commercial fields optional, so that existing Primary policies remain editable without filling every new field.
9. As a credit admin, I want a Commercial terms tab on the policy detail page, so that commercial data is separated from general cover/pricing/terms.
10. As a credit admin, I want the same commercial fields when creating or editing a Primary policy in the modal, so that I can set them at create time.
11. As a credit admin, I want TopUp policies to hide commercial fields and clear them on save, so that TopUp stays consistent with Primary-only pricing.
12. As a Hebrew-speaking admin, I want commercial field labels and tab titles in Hebrew and English, so that settings stay bilingual.
13. As a developer, I want commercial fields on `InsurancePolicy` only (not pushed to `CustomerPolicy`), so that master commercial terms stay at policy level.
14. As a credit admin, I want money commercial amounts interpreted in the policy’s currency, so that amounts align with existing policy money fields.
15. As a platform owner, I want no change to portfolio cost, claims, or daily snapshot engines in this delivery, so that risk of regression stays low.
16. As a credit admin, I want validation that rejects negative money/percent values and invalid NCB percents when values are provided, so that bad data is not saved.
17. As a credit admin, when I leave commercial fields empty, I want null stored, so that “not set” is distinct from zero where zero is meaningful (e.g. aggregate excess = 0).
18. As a credit admin, I want aggregate excess of 0 to be a valid saved value meaning “none”, so that Idigital’s “None (0)” case works.
19. As an implementer, I want create/get/update API parity for the new fields, so that UI and API stay aligned.
20. As a future implementer, I want SDL excess and NCB stored as editable settings now, so that a later calculation ticket can replace or compute without redesigning the form.

## Implementation Decisions

- Primary repo: backend for schema/API/planning; frontend uses the same branch name when first touched.
- Scope: **persist + Policy Settings UI only** — no live SDL/NCB/min-premium engines, no claims workflow, no portfolio cost changes.
- Policy kind: **Primary only** — hide commercial UI on TopUp; clear commercial fields when saving TopUp (mirror existing Primary-only fee fields).
- UI: **two tabs** on policy detail — existing General content + **Commercial terms**. Create/edit modal gets a matching Commercial section (not a full multi-tab refactor of General/Pricing/Cover/Terms).
- Product type: enum on **Primary `InsurancePolicy`** (`TailorMade` | `Commodity`), not on Account.
- SDL excess: **editable annual money** field on the policy; calculation by invoice year is out of scope.
- NCB: **fixed two-tier fields** — zero-claims bonus %, claims-ratio threshold % (e.g. 20), up-to-threshold bonus %; not a free-form tier table.
- Minimum premium: **amount + `minimum_premium_period_years`**.
- All new commercial fields **optional** on Primary.
- Money fields use **policy currency** (same convention as other policy money amounts).
- Do **not** sync commercial fields to `CustomerPolicy` or `InsurancePolicyTrend` in this delivery.
- Suggested schema (names may be adjusted for Prisma conventions): `insured_percentage`, `non_qualifying_loss_threshold`, `minimum_premium`, `minimum_premium_period_years`, `aggregate_excess`, `sdl_excess`, `ncb_zero_claims_bonus_percent`, `ncb_claims_ratio_threshold_percent`, `ncb_up_to_threshold_bonus_percent`, `product_type` (enum).
- Wire through insurance-policy entity create/get/update validation and serializers; Primary clear-on-TopUp alongside existing pricing clears.
- **i18n:** new tab title, section title, field labels, and validation messages ship in English and Hebrew together (ClickUp Hebrew names as reference: אחוז כיסוי ביטוחי, סף כיסוי לפוליסה, דמי ביטוח מינימום, סכום אקסס כללי, אקסס חיתום עצמי, הנחת העדר תביעות).
- Styling: reuse existing settings/tab/form patterns; no new global theme blocks unless explicitly approved.
- Prefer `npx prisma db push` for safe schema apply in local/dev per project rules (no `migrate dev` / force-reset from agents).

## Testing Decisions

- Prefer highest existing seams: insurance-policy create/get/update API and Settings → Credit Insurance → policy detail / create modal.
- Primary seam: “Primary policy commercial fields round-trip on API and Commercial tab; TopUp hides/clears them; empty stays null; aggregate excess 0 saves as 0.”
- Good tests assert external behavior (persisted values, Primary vs TopUp, optional empties) — not private form helpers.
- Prior art: annual credit assessment fee / registration fee percent policy settings work; Primary-only pricing clear on TopUp.
- Automated tests optional unless explicitly requested; slice How to test covers manual verification including Hebrew locale spot-check.

## Out of Scope

- Calculating SDL excess from invoice issue dates / per year.
- Calculating or applying No Claim Bonus against paid premium (0.123% part).
- Minimum-premium enforcement against actual premiums paid.
- Using insured % / NQL / excesses in claims, uncovered AR, or Portfolio Health KPIs.
- Pushing commercial fields to `CustomerPolicy`, country/named rows, or trend snapshots.
- Account-level product type.
- Configurable N-tier NCB JSON tables.
- Policy import/export mapping for the new fields (unless a tiny touch is required for create parity — default defer).
- Full General / Pricing / Cover / Terms tab refactor beyond adding Commercial terms.
- New automated test suites unless the user asks.

## Further Notes

- ClickUp: https://app.clickup.com/t/869f2tjgb
- Branch (primary repo): `feat/credit-insurance-policy-commercial-terms-CU-869f2tjgb`
- Idigital reference examples from the ticket (not defaults to hardcode): insured 85%; NQL 8,750; min premium 1,500,000 / 3 years; aggregate excess 0; SDL excess 20,002.5; NCB 22.5% at 0% claims and 15% up to 20% claims ratio.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/credit-insurance-policy-commercial-terms/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/credit-insurance-policy-commercial-terms/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Schema + API commercial terms (Primary only) | `issues/01-schema-api-commercial-terms.md` | — | 1–8, 11, 13–19 |
| 2 | Commercial terms tab + modal + i18n | `issues/02-commercial-terms-ui-tabs.md` | 01 | 9–12, 16–18 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
