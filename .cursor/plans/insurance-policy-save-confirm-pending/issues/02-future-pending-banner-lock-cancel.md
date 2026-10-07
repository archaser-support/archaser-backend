# 02 — Future pending revision, banner, lock, cancel

**Status:** done
**Priority:** high
**Blocked by:** [01-preview-and-today-confirm-modal](01-preview-and-today-confirm-modal.md)
**User stories:** 8, 9, 10, 11, 12, 13, 14, 15, 17, 18, 22, 29, 30
**PRD:** `.cursor/plans/insurance-policy-save-confirm-pending.prd.md`

## What to build

Extend the approval modal with an effective-date control (today or future only). On confirm with a **future** date: store a full form snapshot on the Insurance Policy (`pending_effective_date` + payload) via SQL migration + Prisma; do **not** change live policy columns. Show a pending banner with cancel; lock the entire policy form while pending exists; reject a second pending. Cancel clears pending columns and unlocks the form. EN + HE for banner, cancel, and validation.

## Acceptance criteria

- [x] SQL under `prisma/migrations/` adds pending columns (no top-level BEGIN/COMMIT); Prisma schema updated
- [x] Future confirm stores full snapshot; live policy fields unchanged until activation
- [x] Banner shows effective date; Cancel clears pending
- [x] Form fully locked while pending; second schedule blocked
- [x] Past dates rejected; default date is today
- [x] EN + HE for new copy

## How to test

1. Change a push field → Save → in modal pick a future date → Confirm.
2. Expect live settings still show old values; banner visible; form not editable.
3. Try Save again → blocked until cancel.
4. Cancel pending → form editable; pending columns cleared; no customer versions from the cancelled revision.
5. Pick a past date in the modal → expect validation error.
