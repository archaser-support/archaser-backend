---
name: billing-integration-ext-ctp
overview: Account Billing Integration tab — account-matched extension label, sync-history row colors, and post-sync Portfolio Health Generate start from the pending rewrite window.
source: grill-me session via /start-work
clickup_task_url: https://app.clickup.com/t/869f5pd8b
isProject: false
---

# Billing Integration — Extension label, sync row colors, post-sync CTP

## Problem Statement

On Account → Billing settings → Integration, admins must manually pick an Extension key even when the only meaningful attachment is an account-specific registry entry (`account_{id}`). That is easy to get wrong and adds noise. Sync History does not visually distinguish failed or running runs, so operators scan status text. After a successful billing sync (including incremental), Customer×Policy Trend (CTP) snapshots are still generated manually, so credit views lag until someone remembers to run generation.

## Solution

Remove the Extension key picker. If a registered extension exists for `account_{accountId}`, show a read-only label and persist that key on Save when unset; otherwise show that no account extension exists and clear non-matching stored keys on Save. Tint Sync History rows: failed red, running blue. After a successful incremental or backfill billing sync, automatically catch up CTP for missing days since the last successful snapshot day (capped), without failing the sync if CTP fails.

## User Stories

1. As an account admin, I want the Integration tab to show whether this account has a matching billing extension, so that I do not pick the wrong registry key.
2. As an account admin, I want the Extension key Autocomplete removed, so that the UI only reflects account-bound extensions.
3. As an account admin, when a matching `account_{id}` extension exists and none is stored, I want Save to attach that key, so that sync uses the correct plugin without a manual pick.
4. As an account admin, when no matching account extension exists, I want a clear “no account extension” label, so that I know the account runs the standard path.
5. As an account admin, when a leftover non-account key (for example sample no-op) is stored, I want Save to clear it, so that stored state matches the account-id rule.
6. As an account admin, I want the extension settings panel to still appear when the account-matched key is attached, so that I can configure extension-specific options.
7. As an operator, I want failed Sync History rows tinted red, so that failures stand out while scrolling.
8. As an operator, I want the running Sync History row tinted blue, so that I can see an in-progress sync at a glance.
9. As an operator, I want successful, partial, and timeout rows to keep normal zebra striping, so that only actionable statuses are highlighted.
10. As an operator, after a successful incremental sync, I want Portfolio Health Generate to start for the pending rewrite window without a separate manual step, so that credit trends and Portfolio Health stay current.
11. As an operator, after a successful backfill sync, I want the same Generate start for all days in that import window (min imported entity date → today), so that full backfills rebuild history.
12. As an operator, I do not want preview syncs to trigger Generate start, so that dry runs stay light.
13. As an operator, I do not want Generate start after failed or partial billing syncs, so that we do not rebuild on incomplete invoice data.
14. As a credit analyst, I want Generate to cover every day in the pending as-of rewrite window from this import, so that import-touched days are rebuilt (not only a tip gap).
15. As a platform owner, I want Generate to run asynchronously (same job as the Portfolio Health page), so that billing sync can finish SUCCESS quickly.
16. As an operator, if Generate fails to start, I want the billing sync to remain SUCCESS, so that billing status stays truthful.
17. As an operator, if Generate fails to start, I want a log and a light non-blocking warning when easy, so that I know credit refresh needs attention.
18. As a Hebrew-speaking admin, I want new Integration labels in Hebrew as well as English, so that the tab stays bilingual.
19. As a developer, I want post-sync catch-up to call `startCreditAsOfBackfillJob` for the pending rewrite window (not inline tip CTP), so that we reuse the Generate path.
20. As a developer, I want Sync History coloring to use theme error/info tokens, so that colors stay consistent with the design system.

## Implementation Decisions

- Primary repo for planning and the CTP hook is the backend; frontend changes use the same branch name when first touched.
- Extension attachment rule: only keys of the form `account_{accountId}` that exist in the billing extension registry are valid for this UI flow.
- Remove the Extension key Autocomplete from the Billing Schedule / Integration UI; replace with a read-only label (matched extension name/key, or “no account extension”).
- On account Save of billing connector config: if a matching registry key exists and stored key is empty/unset, write that key; if stored key is not the matching account key (including other registry keys), clear it (and clear extension config when key clears, consistent with current validation).
- Keep showing the existing extension settings panel when the matched key is attached.
- Sync History grid: whole-row background tint for run-level `FAILED` (error palette) and `RUNNING` (info palette); do not tint `SUCCESS`, `PARTIAL`, or `TIMEOUT`; reuse theme tokens — approved styling scope is row tint via existing palette only (no new global theme blocks unless required and re-approved).
- Post-sync CTP hook runs only after accepted in-process sync finalizes as `SUCCESS` for modes `incremental` and `backfill` (not `preview`, not `FAILED`/`PARTIAL`).
- Post-sync catch-up starts Portfolio Health Generate (`startCreditAsOfBackfillJob`, async) for the pending `CreditAsOfRewriteQueue` window already enqueued from import entity dates (min invoice/payment date → today). That covers full backfill history, not a tip-only CTP fill.
- Skip Generate start when there is no pending rewrite window (nothing imported that enqueued rewrite).
- If Generate is already running, leave it in place (conflict is soft); do not flip billing sync status.
- Generate start errors must not flip billing sync status; log structured error; add a light non-blocking warning in Sync History or Integration UI only if a small reuse path exists.
- **i18n:** any new or changed user-facing strings ship with matching English and Hebrew locale keys in the same change.
- No schema migration expected for extension_key column; behavior change is resolve/save/UI and post-sync hook.
- Prefer hooking after successful finalize of the accepted in-process sync lifecycle so scheduled and manual incremental/backfill share one place.

## Testing Decisions

- Prefer highest existing seams: billing connector PUT behavior for extension_key resolution; Sync History grid presentation; post-sync lifecycle after SUCCESS finalize.
- Good tests assert external behavior (stored key after Save rules; row presentation by status; Generate queued after SUCCESS without changing sync status on start failure) — not private helpers.
- Prior art: billing-connector extension resolve/attachment validation tests; credit-insurance `syncCustomerPolicyTrendSnapshotForAccount` / as-of backfill day loops; frontend Sync History row mapping.
- Automated tests are optional unless explicitly requested; How to test on slices covers manual verification.
- Proposed primary seam for post-sync: “after successful accepted sync finalize, Portfolio Health Generate is queued for the pending rewrite window without changing sync SUCCESS.”

## Out of Scope

- Renaming or restructuring the billing extension registry beyond account-id matching for this UI.
- Keeping a manual picker for `sample_noop` or other non-account keys.
- Coloring PARTIAL/TIMEOUT rows.
- Running Generate after preview, FAILED, or PARTIAL syncs.
- Inline (blocking) Portfolio Health Generate inside the sync process — Generate must stay async.
- Tip-only ≤30-day CTP fill (replaced by Generate start for the pending rewrite window).
- Changing nightly CTP cron behavior for all accounts.
- New automated test suites unless the user asks.

## Further Notes

- ClickUp: https://app.clickup.com/t/869f5pd8b
- Branch (backend primary): `feat/billing-integration-ext-ctp-CU-869f5pd8b`
- Grill locked decisions: extension label + clear orphans on Save; FAILED/RUNNING row tints; SUCCESS-only incremental/backfill Generate start from pending rewrite window; sync stays SUCCESS if Generate fails to start.
- Frontend sibling branch is created only when frontend files are first changed.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/billing-integration-ext-ctp/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/billing-integration-ext-ctp/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Account-matched extension label | `issues/01-account-matched-extension-label.md` | — | 1–6, 18 |
| 2 | Sync History failed/running row colors | `issues/02-sync-history-row-colors.md` | — | 7–9, 20 |
| 3 | Post-sync Portfolio Health Generate start | `issues/03-post-sync-ctp-catch-up.md` | — | 10–17, 19 |

**Status:** `ready-for-agent` on all slices.
