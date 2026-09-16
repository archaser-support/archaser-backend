# 02 — Guards, large-range confirm, and copy

**Status:** done
**Priority:** normal
**Blocked by:** [01-generate-recent-core](01-generate-recent-core.md)
**User stories:** 7, 8, 9, 19, 24, 34, 35
**PRD:** `.cursor/plans/portfolio-health-generate-recent.prd.md`

## What to build

Finish analyst-facing safety and copy around Generate recent so empty/in-flight queue states and long pending windows are clear.

Deliver:

1. **Disabled states** — When status pending rewrite is null (no row, or only `processing` / `done`), Generate recent stays disabled with a short reason (tooltip or helper). Late start with no pending still returns a clear API error.
2. **Large-range confirm** — If pending day count exceeds the same ~90-day threshold used by full Generate, show the existing confirm pattern before starting recent; still allow the run (including windows longer than 366 days).
3. **Ignore reporting breach tooltip** — Extend helper copy so analysts know Generate recent can treat reporting-late as off for this run, but nightly drain may rewrite the same days later with reporting-late counted (queue left pending).
4. **i18n** — English and Hebrew for disabled reason, large-range confirm, and updated Ignore / Generate recent helpers.

No new styles; reuse existing confirm dialog and tooltip patterns.

## Acceptance criteria

- [x] Generate recent disabled with a short reason when there is no `pending` rewrite window (including when the row is `processing` or `done`).
- [x] Starting recent with no pending still fails clearly on the API.
- [x] Pending window above ~90 days shows the same style of confirmation as full Generate before start; confirming still starts the full pending window.
- [x] Ignore reporting breach tooltip (or adjacent helper) mentions that nightly may overwrite Ignore results while the queue stays pending.
- [x] All new/changed user-facing strings exist in English and Hebrew.

## How to test

1. Open Portfolio Health with **no** pending rewrite row — Generate recent is disabled; reason is visible on hover/helper.
2. While nightly drain (or a test) holds the queue in **`processing`**, Generate recent stays disabled.
3. Create a pending rewrite whose from/to spans more than ~90 days. Click Generate recent — confirm dialog appears; cancel leaves no job; confirm starts the job for the full pending window.
4. With Ignore reporting breach on, read the tooltip — it notes nightly may rewrite later with reporting-late counted.
5. Switch locale to Hebrew — button, disabled reason, confirm, and tooltip strings are present (not English-only gaps).
