---
name: credit-insurance-policy-general-ui
overview: Restyle the credit insurance policy detail/edit form to match the customer General section layout, field typography, and edit-action placement.
source: grill-me session
clickup_task_url: null
isProject: false
---

# Credit Insurance Policy General UI

## Problem Statement

The credit insurance policy detail and edit page looks and behaves differently from the General section on the customer details page. Edit actions sit in the page header instead of the form card, readonly fields use different typography, subsection headers use a different color and style, and the main policy form is not wrapped in the same card-and-grid layout users already know from customer maintenance.

This inconsistency makes the policy settings workflow feel like a separate product surface and increases cognitive load for administrators who move between customer records and policy configuration.

## Solution

Restyle only the main policy fields block on the policy detail page so it mirrors the customer General section: a card with an icon and title, Edit / Cancel / Save in the card header, a responsive three-column grid, uppercase black subsection headers for Payment term, MEP, and Reporting, and shared readonly field presentation.

Extract the policy form into a dedicated presentation component that follows the same structural pattern as the customer General information component. Simplify the page header so it shows the policy number without redundant “edit” wording. Leave the Countries and Named policies grids unchanged.

No API, schema, permission, or business-rule changes are required.

## User Stories

1. As a policy administrator, I want the policy detail form to use the same card layout as customer General, so that settings pages feel consistent across the product.
2. As a policy administrator, I want Edit, Cancel, and Save on the policy form card header, so that I edit in the same place I read the fields.
3. As a policy administrator, I want the page header to show the policy number without redundant edit wording, so that the page title stays clear after actions move into the card.
4. As a policy administrator, I want readonly policy fields to use the same label and value typography as customer General, so that view mode is visually familiar.
5. As a policy administrator, I want edit-mode inputs to keep the same field height and spacing as customer General credit-insurance fields, so that forms feel aligned when switching contexts.
6. As a policy administrator, I want Payment term, MEP, and Reporting subsection headers to match General section styling, so that grouped fields are scannable in the same way.
7. As a policy administrator, I want the policy form grid to collapse to one column on mobile and expand to three columns on desktop, so that the layout matches customer General responsiveness.
8. As a policy administrator viewing a Primary policy, I want all existing Primary-only fields to remain visible in the restyled form, so that no configuration is lost.
9. As a policy administrator viewing a TopUp policy, I want TopUp-specific fields such as parent policy to remain visible, so that top-up maintenance is unchanged functionally.
10. As a policy administrator viewing a Primary policy, I want Primary-only fields such as dates, currency, and DCL settings to remain hidden on TopUp policies, so that existing policy-type rules still apply.
11. As a policy administrator, I want to start editing from the card header and cancel without saving, so that the edit workflow matches customer General.
12. As a policy administrator, I want to save policy changes from the card header, so that the save affordance stays with the form being edited.
13. As a policy administrator, I want validation errors to continue appearing on the affected inputs after save attempt, so that correction behavior is unchanged.
14. As a policy administrator, I want lifecycle banners such as expired policy or parent inactive to remain above the form card, so that warnings stay prominent.
15. As a policy administrator, I want breadcrumbs and navigation back to settings to remain unchanged, so that page wayfinding is not disrupted.
16. As a policy administrator, I want the Countries grid section to remain as it is today, so that country-cap maintenance is not part of this visual refactor.
17. As a policy administrator, I want the Named policies grid section to remain as it is today, so that named-limit maintenance is not part of this visual refactor.
18. As a policy administrator, I want country and named-policy modals to continue working after the form extraction, so that secondary workflows are unaffected.
19. As a policy administrator, I want policy export actions on the Countries and Named grids to keep working, so that operational tooling is unchanged.
20. As a Hebrew-speaking policy administrator, I want the restyled form to respect right-to-left direction on labels, values, and edit actions, so that Hebrew layout remains correct.
21. As an English-speaking policy administrator, I want left-to-right layout on the restyled form, so that English layout remains correct.
22. As a policy administrator without edit permission, I want the form to remain read-only with no edit actions shown, so that permission behavior is preserved.
23. As a policy administrator, I want month-end cutoff fields to remain grouped under their existing Payment term, MEP, and Reporting sections, so that related cutoff rules stay together.
24. As a policy administrator, I want cost calculation method and premium-rate fields to remain available for Primary policies in edit mode, so that pricing configuration is not regressed.
25. As a policy administrator, I want status, insurer, policy number, and policy kind fields to remain editable where they are editable today, so that core identity fields are unchanged functionally.
26. As a policy administrator, I want date pickers on policy start and end dates to keep session-aware formatting, so that locale-specific date display is preserved.
27. As a policy administrator, I want currency selection to continue using the existing currency control, so that currency entry behavior is unchanged.
28. As a policy administrator, I want parent-policy selection for TopUp policies to continue using the existing eligible-parent options, so that top-up linking rules are preserved.
29. As a policy administrator, I want auto-activate-on-term-start and related policy lifecycle controls to remain in the form where they exist today, so that lifecycle settings are not moved or removed silently.
30. As a developer maintaining settings UI, I want the policy form isolated in its own component, so that the large policy detail page is easier to navigate and change safely.
31. As a developer maintaining customer UI, I want the shared readonly field presentation reused rather than duplicated, so that future typography fixes stay in one place.
32. As a developer maintaining theme styling, I want existing edit-action button grouping classes reused, so that no new global styles are introduced.
33. As a QA reviewer, I want a focused manual checklist for Primary, TopUp, view, edit, save, cancel, and Hebrew layouts, so that visual parity can be verified without new automation scope.
34. As a product owner, I want this change limited to presentation, so that policy APIs and downstream credit-insurance calculations are not put at risk.
35. As a policy administrator returning from the settings list, I want the simplified page title to still identify the open policy immediately, so that context is obvious at a glance.

## Implementation Decisions

- Scope is limited to the main policy fields block on the policy detail page. Countries and Named policies sections are explicitly excluded.
- Introduce a dedicated policy general-information presentation component that owns the card shell, responsive grid, subsection headers, and edit/view field rendering for master policy fields.
- The policy detail page remains the orchestration layer for data loading, edit state, validation, save and cancel mutations, lifecycle banners, breadcrumbs, page header, and the Countries and Named grids.
- Move Edit, Cancel, and Save from the page header into the new card header, using the same edit-action button grouping pattern already used on customer General.
- Simplify the page header title to the policy number only and remove redundant edit-oriented title wording. Keep the existing description and breadcrumbs unless they become clearly redundant after implementation review.
- Wrap the policy form in the same card treatment as customer General: zero elevation, theme border radius, no extra shadow, icon plus section title in the header, padded card content.
- Use the existing shared readonly field component exported from the customer General module for all view-mode policy values. Remove the local readonly field helper after migration.
- Keep the current edit controls for each field type, including text inputs, selects, date pickers, currency selector, and parent-policy selector. Align spacing and minimum control height with the customer General credit-insurance field styling rather than introducing a new field abstraction.
- Restyle the existing Payment term, MEP, and Reporting subsection headers to the uppercase black General-section header pattern. Do not regroup fields into new sections beyond those three existing blocks.
- Preserve all current Primary versus TopUp conditional visibility, validation rules, disabled states, and month-end cutoff interdependencies.
- Preserve existing notification banners for expired policies, inactive parent policies, and policies eligible for activation. Banner placement stays above the form card.
- Reuse existing translation keys in the settings and common namespaces. No translation file changes are expected unless a missing label is discovered during implementation.
- Reuse existing theme tokens and layout classes already approved for customer General and edit-action groups. Do not add new global theme blocks or feature-specific CSS hooks.
- Import shared readonly presentation from the customer General module for now. Extracting it into a neutral shared module is optional follow-up only if the cross-feature dependency becomes awkward during implementation.
- No database schema changes, no API contract changes, no permission changes, and no changes to insurance policy services or synchronization behavior.

## Testing Decisions

- Good tests for this feature assert externally observable UI behavior and regression safety, not internal component structure or style object shapes.
- The highest practical seam is manual verification on the policy detail page because this is a presentation-only refactor with no server contract changes. Automated coverage should not duplicate layout/CSS assertions unless a stable behavioral seam already exists.
- Manual test matrix should cover:
  - View mode on a Primary policy with all major field groups visible.
  - View mode on a TopUp policy with parent policy shown and Primary-only fields hidden.
  - Enter edit mode from the card header, modify a field, save successfully, and confirm readonly presentation updates.
  - Enter edit mode, change a field, cancel, and confirm values revert.
  - Trigger a validation failure and confirm field-level errors still appear on the correct inputs.
  - Hebrew session with right-to-left layout on labels, values, and edit actions.
  - Confirm Countries and Named grids still render and their add/edit/delete flows still work.
  - Confirm lifecycle banners still appear for expired, inactive-parent, and eligible-for-activation scenarios when applicable.
- Regression seam: existing insurance policy API and service unit tests should continue to pass unchanged because persistence and validation logic are out of scope.
- Prior art for policy behavior tests lives in the credit-insurance service and API unit suites around policy create, update, lifecycle, and top-up rules. Those suites remain the safety net for save behavior; this feature does not add parallel API tests unless a bug is found during implementation.
- Prior art for customer detail presentation tests lives in small shared UX helper tests rather than full component render suites. No new component snapshot suite is required unless implementation introduces new conditional presentation helpers worth testing in isolation.
- Optional follow-up only: a focused component test for Primary versus TopUp field visibility inside the extracted presentation component if the extraction makes that logic easier to test without brittle CSS assertions.

## Out of Scope

- Restyling or re-card-wrapping the Countries grid section.
- Restyling or re-card-wrapping the Named policies grid section.
- Changing policy create modal layout in settings.
- Changing the credit insurance policies list page layout.
- Adding new policy fields or changing validation rules.
- Changing API payloads, permissions, or persistence behavior.
- Reworking section grouping beyond restyling the existing Payment term, MEP, and Reporting headers.
- New global styles, theme overrides, or translation additions unless a gap is discovered during implementation.
- Customer credit-insurance tab or customer policy accordion changes.
- Automated visual regression or screenshot testing.
- Extracting a new shared form-field framework for settings pages.

## Further Notes

This PRD comes from a grill-me session with the following locked decisions:

| Topic | Decision |
|-------|----------|
| Scope | Policy fields block only |
| Edit actions | Card header, not page header |
| Readonly fields | Reuse customer General readonly presentation |
| Subsection headers | Restyle existing Payment term / MEP / Reporting headers only |
| Structure | Extract dedicated policy general-information component |
| Page header | Policy number title only |

Recommended implementation order:

1. Extract the presentation component with card shell and header actions.
2. Migrate view-mode fields to the shared readonly presentation.
3. Apply General-section grid and subsection header styling.
4. Simplify the page header and remove duplicate edit actions.
5. Manual QA on Primary, TopUp, English, and Hebrew flows.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under `.scratch/credit-insurance-policy-general-ui/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.scratch/credit-insurance-policy-general-ui/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Extract policy general card and move edit actions | `issues/01-extract-policy-general-card.md` | — | 1, 2, 3, 8–13, 15, 22, 25–30, 35 |
| 2 | General-section visual parity for policy form | `issues/02-general-section-visual-parity.md` | #1 | 4–7, 14, 16–21, 23–24, 31–33 |

**Status:** `ready-for-agent` on all slices.
