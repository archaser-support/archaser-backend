# 02 — Portfolio Health Generate modal

**Status:** done  
**Priority:** normal  
**Blocked by:** [01-reporting-breach-start-date](01-reporting-breach-start-date.md)  
**User stories:** 17–27, 28  
**PRD:** `.cursor/plans/reporting-breach-start-generate-modal.prd.md`

## Scope

- Move Generate / Generate recent / Stop / Resume/Retry into an `AppDialog` (same patterns as other modals).
- Toolbar: one status-aware open button; remove ignore-reporting-breach switch and related state/locale/API wiring (flags already gone in slice 01).
- Keep progress bar, ETA, and last error on the page.
- Modal body: short help + page date range + pending rewrite window (or none).
- Inline large-range confirm (no stacked DeleteDialog).
- Stay open after start; free close while running; auto-open on running/paused/failed with dismiss memory until reopen or new attention transition.
- EN+HE for new button/modal copy.

## How to test

1. Open Portfolio Health. Confirm ignore switch is gone. Open Generate via the status-aware toolbar button.
2. Modal shows page range and pending rewrite window; Generate / Generate recent / Stop / Resume work as before; large ranges confirm inline inside the same modal.
3. Start Generate: modal stays open; progress/ETA/error remain on the page. Close the modal; job continues; reopen via toolbar to Stop.
4. Reload while a job is running: modal auto-opens. Dismiss it; it stays closed until you reopen or status transitions to a new attention state (e.g. failed).
5. Confirm EN + HE strings for the open button and modal content.
