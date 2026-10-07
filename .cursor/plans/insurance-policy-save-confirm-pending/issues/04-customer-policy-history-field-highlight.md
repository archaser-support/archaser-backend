# 04 — Highlight changed fields in customer Policy history

**Status:** done
**Priority:** normal
**Blocked by:** —
**User stories:** 26, 27, 28, 22
**PRD:** `.cursor/plans/insurance-policy-save-confirm-pending.prd.md`

## What to build

On the customer Policies tab, in **inactive** Policy history accordion rows, compare each version to the immediately previous version and apply a soft theme background (existing palette, low opacity) on fields that differ. Do **not** color the live/active Policies form. Works for versions created by policy push and by manual customer edits. EN/HE only if any new visible label/chip is added (prefer no new copy if highlight alone is enough).

## Acceptance criteria

- [x] Each inactive history row highlights fields that differ from the previous version
- [x] Live/active form fields are not highlighted
- [x] Soft theme token styling only (no new global theme blocks unless explicitly approved)
- [x] Works for at least two consecutive history versions with a known field diff

## How to test

1. Open a customer with at least two inactive Customer Policy history rows where max payment term (or another field) differs between consecutive versions.
2. Expand history → expect the changed field(s) highlighted on the newer inactive row vs previous.
3. Confirm the active Policies form fields are not highlighted.
