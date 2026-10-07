---
name: insurance-policy-save-confirm-pending
overview: Approval modal for Insurance Policy saves that push fields to customers, plus future-dated pending revisions on the policy (like Customer Policy pending).
source: grill-me session + DB incident (policy push overwrote max_payment_term)
clickup_task_url: https://app.clickup.com/t/869fdexrq
isProject: false
---

# Insurance Policy save confirm + future-dated pending revision

## Problem Statement

When a credit manager saves an Insurance Policy, shared term fields can version onto every active Customer Policy on that policy. A save that only meant to change cost percent once rewrote max payment term from 120 to 180 for hundreds of customers because the push compared each customer to the full policy, not only fields changed in that save.

Users need to see and approve what will change for customers before the save sticks. They also need to schedule policy setting changes for a future date—keeping today’s live policy unchanged until that day—similar to pending Customer Policy changes on the customer Policies tab.

## Solution

On Settings → Credit Insurance Policies, when the user saves and at least one **customer-push field** changed:

1. Show an **approval modal** listing each changed push field (old → new), how many customers would get a new version for that field, total unique customers affected, and how many would be **skipped** because they already have a pending Customer Policy.
2. Let them pick an **effective date** in the modal (default today; today or future only).
3. On confirm with **today**: update the live Insurance Policy and push **only the changed push fields** onto active Customer Policies (skip customers with their own pending Customer Policy).
4. On confirm with a **future date**: store a **full form snapshot** as a pending revision on the Insurance Policy row; leave live settings unchanged; show a banner with cancel; **lock the whole policy form** until cancel or activation.
5. On the effective day, a job applies the snapshot to the live policy, then runs the same changed-fields customer push (again skipping customers with pending Customer Policy).
6. In customer **Policy history** (inactive versions only), highlight fields that differ from the previous version using a soft theme background.

Non-push edits (for example insurer name only) save immediately with no modal and cannot be future-dated through this flow.

## User Stories

1. As a credit manager, I want to see which policy fields will update customers before I save, so that I do not overwrite customer terms by accident.
2. As a credit manager, I want each changed push field listed with old and new values, so that I understand the exact change.
3. As a credit manager, I want a count of customers affected per changed field, so that I know the blast radius.
4. As a credit manager, I want a total unique customer count, so that I see how many customers will get a new Customer Policy version.
5. As a credit manager, I want to see how many customers will be skipped because they have their own pending change, so that I am not surprised later.
6. As a credit manager, I want to confirm or cancel the save in a modal, so that I stay in control.
7. As a credit manager, I want the effective date defaulted to today in the modal, so that normal saves stay fast.
8. As a credit manager, I want to pick a future effective date, so that policy terms can go live on a planned day.
9. As a credit manager, I want future dating to keep the live policy screen on today’s values until that day, so that operations are not confused mid-period.
10. As a credit manager, I want the entire form change (push and non-push fields in that save) to wait until the effective date when I schedule ahead, so that the revision is consistent.
11. As a credit manager, I want only one pending Insurance Policy revision at a time, so that scheduling stays simple.
12. As a credit manager, I want a banner showing the pending effective date and a short summary, so that I know a change is scheduled.
13. As a credit manager, I want to cancel a pending revision, so that I can correct a mistake before it applies.
14. As a credit manager, I want the policy form locked while a pending revision exists, so that live and pending values cannot drift.
15. As a credit manager, I want insurer-name-only (and other non-push) saves to skip the modal, so that harmless edits stay quick.
16. As a credit manager, I want non-push-only edits to always apply immediately (no future schedule), so that the modal stays tied to customer impact.
17. As a credit manager, I want Country and Named tabs left unchanged by this feature, so that scope stays clear.
18. As a credit manager, I want past effective dates rejected in the modal, so that policy-level push does not rewrite customer history for past days.
19. As a credit manager, I want today’s confirm to push only fields that changed on the policy, so that untouched customer terms (for example payment term) stay as they were.
20. As a credit manager, I want customers who already have a pending Customer Policy skipped on push/activation, so that their scheduled edit is not discarded.
21. As a credit manager, I want the modal even when zero customers need a version, so that I still confirm the master policy change.
22. As a credit manager, I want Hebrew and English copy for the modal, banner, and errors, so that both locales work.
23. As an operations user, I want the pending revision to apply automatically on the effective date, so that I do not apply it by hand.
24. As an operations user, I want activation to update the live Insurance Policy from the stored snapshot, so that settings match what was approved.
25. As an operations user, I want activation to then push only changed push fields to customers, so that behavior matches today’s confirm path.
26. As a credit manager, I want customer Policy history to highlight fields that changed versus the previous version, so that I can audit what moved.
27. As a credit manager, I want the live Policies form fields not colored, so that editing the current row stays visually calm.
28. As a credit manager, I want every inactive history version compared to the version before it, so that both policy pushes and manual customer edits show diffs.
29. As a developer, I want pending data on the Insurance Policy row (no new table for MVP), so that one-pending is simple to enforce.
30. As a developer, I want a SQL migration on the feature branch for pending columns, so that CI/deploy can apply the schema.
31. As a developer, I want a preview API used by the modal, so that counts are server-truthful.
32. As a developer, I want confirm save to be atomic for today-apply (policy + customer versions or roll back), so that partial updates do not stick.
33. As a support user, I want ClickUp How to test steps, so that I can verify the feature after deploy.
34. As a credit manager, I want TopUp policy saves to follow the same rules when push fields change, so that behavior is consistent (usually few or no Customer Policy assignees).
35. As a credit manager, I want saving with no push-field changes and no pending lock to keep working as a normal save, so that status or notes edits stay simple.

## Implementation Decisions

- **Depends on:** Insurance Policy update already pushes **only fields that changed on the policy** onto active Customer Policies (not every divergent customer field). This feature builds the confirm UX and future dating on top of that rule.
- **Customer-push field set:** Same set already used for policy→customer push (MEP/reporting/payment-term cutoffs and substitutes, max allowed MEP, reporting days, max payment term, cost percent, registration fee percent).
- **Modal trigger:** Open only when at least one push field differs between live policy and the submitted form. Otherwise save immediately (no modal).
- **Modal contents:** For each changed push field: old value, new value, count of active assignees who would get a new version for that field; plus unique customers who would version; plus count skipped because `CustomerPolicy.status = pending`.
- **Effective date:** Chosen in the modal; default today; allow today or future only; reject past.
- **Today confirm:** Persist Insurance Policy update; version customers with overlay of **only** `fieldsToPush`; skip customers with pending Customer Policy; run the same post-save sync side effects as today’s push path where applicable.
- **Future confirm:** Do not mutate live policy columns from the form; store `pending_effective_date` + full form snapshot payload on `InsurancePolicy`; clear on cancel or successful activation.
- **Schema (MVP):** Columns on `InsurancePolicy` for pending effective date and pending payload (JSON). No new table. Commit SQL under `prisma/migrations/` on the feature branch (no top-level `BEGIN`/`COMMIT`).
- **One pending:** If pending already exists, reject new schedule/confirm of push-field changes until cancel; UI shows banner + cancel and locks the whole policy form (including non-push fields).
- **Activation:** Job (prefer same daily credit cron order family as customer pending activation, before CPT tip) finds due pending policies, applies snapshot to live row, clears pending columns, then changed-fields push to active customers; skip customers with pending Customer Policy; count failures without silently marking success if apply failed.
- **Customer pending conflict:** Skip only; do not cancel the customer’s pending row.
- **History highlight:** On customer Policies tab, for each inactive history row, soft theme background on fields that differ from the immediately previous version; do not color the live form.
- **Country / Named tabs:** Out of scope; no modal or pending for those entity saves.
- **Non-push-only future:** Out of scope; those fields always save immediately when the form is not locked.
- **i18n:** All new user-facing strings in English and Hebrew in the same change.
- **Styling:** Soft highlight using existing theme palette (for example warning/info at low opacity); no new global theme blocks without explicit approval if tokens are insufficient.
- **Primary repos:** Backend for schema/API/job; frontend for modal, banner, lock, history highlight (same branch name when frontend is touched).

## Testing Decisions

- Prefer testing **external behavior** through the highest practical seam: Insurance Policy save/preview HTTP API and, for UI, the policy settings save flow.
- Good tests assert outcomes: modal/preview payloads, pending columns set or cleared, live policy unchanged until activation, customer versions only for changed fields, skipped customers with pending Customer Policy, history highlight vs previous version.
- Do not require new automated tests unless the user explicitly asks; manual **How to test** on each slice is enough for delivery.
- Prior art: customer Policies pending create/cancel/activate; Insurance Policy update transaction that versions Customer Policies; policy push field helpers.

**Chosen seams**

1. **Primary:** Insurance Policy preview + confirm-save API (and cancel-pending) — covers counts, today apply, future pending, activation inputs.
2. **Secondary (manual):** Settings → Insurance Policy UI modal/banner/lock; customer Policies history highlight.

## Out of Scope

- Country and Named policy tab confirm / future dating
- Past effective dates / rewriting customer history from a past policy effective date
- Future dating for non-push-only edits
- Queue of multiple pending Insurance Policy revisions
- Coloring fields on the live (active) customer Policies form
- Listing skipped customer names in the modal (count only)
- New `InsurancePolicyVersion` table (MVP uses columns on `InsurancePolicy`)
- Changing invoice `target_mep_date` / `target_reporting_date` as part of policy push
- Reverting the Oct 2026 mass payment-term data incident (separate datafix if needed)

## Further Notes

### Decision log (grill)

| # | Decision |
|---|----------|
| D1 | Pending policy revision; settings keep today’s values until effective date |
| D2 | On activation: apply live policy, then push only changed fields |
| D3 | One pending only |
| D4 | Modal only when ≥1 customer-push field changed |
| D5 | Effective date inside approval modal |
| D6 | Entire revision waits when future-dated |
| D7 | Per-field old→new + per-field counts + unique total |
| D8 | History: every version vs previous |
| D9 | Do not color live form |
| D10 | Banner + cancel for pending |
| D11 | Skip customers with their own pending Customer Policy |
| D12 | Ship modal + future dating together |
| D13 | Country/Named out of scope |
| D14 | Today or future only |
| D15 | Non-push-only future not supported |
| D16 | Soft theme highlight in history |
| D17 | Show modal even if 0 customers would version |
| D18 | Show skipped count in modal |
| D19 | Full snapshot on `InsurancePolicy` row (no new table) |
| D20 | Lock whole form while pending exists |

### Incident context

On 2026-10-06, Primary policy `13-G-09154` was saved; 418 customers were versioned 120 → 180 on max payment term while cost percent also changed. Policy max payment term was already 180; the old push semantics overwrote divergent customer values. The changed-fields-only push fix addresses that class of bug; this PRD adds human confirmation and scheduled application.

## Issues (vertical slices)

Tracer-bullet breakdown under `.cursor/plans/insurance-policy-save-confirm-pending/`. **Hard blockers** are in each slice’s **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/insurance-policy-save-confirm-pending/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Preview API + today confirm modal | `issues/01-preview-and-today-confirm-modal.md` | — | 1–7, 16, 19, 21, 22, 31, 32, 35 |
| 2 | Future pending, banner, lock, cancel | `issues/02-future-pending-banner-lock-cancel.md` | 01 | 8–15, 17, 18, 22, 29, 30 |
| 3 | Activate due pending revisions | `issues/03-activate-pending-policy-revision.md` | 02 | 20, 23–25, 32 |
| 4 | Customer Policy history field highlight | `issues/04-customer-policy-history-field-highlight.md` | — | 26–28, 22 |

**Status:** `ready-for-agent` on all slices.
