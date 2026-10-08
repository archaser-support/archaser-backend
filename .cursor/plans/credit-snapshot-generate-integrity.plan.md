---
name: credit-snapshot-generate-integrity
overview: Fix the gaps found in the deep analysis of Portfolio Health Generate, the as-of rewrite drain, and the nightly credit snapshot crons — credit-pool shell history, destructive pre-window deletes, swallowed errors, stuck jobs, live writers corrupting today's shell row, and an unreconciled dashboard vs CPT at-risk gap.
isProject: false
---

# Credit snapshot Generate & cron integrity

## Why

Customer `1000033` (account `10149`, credit-pool shell with children `21037`, `1000019`) showed no history on the **Open AR & risk drivers** chart after Generate. Root cause and a deep audit of every snapshot writer turned up the issues below. Evidence comes from code traces and live DB checks on account `10149` (2026-10-08).

Healthy today (after a full-year Generate): CPT and CDP have every day 2026-01-01 → today, no duplicate CPT rows, all 30 shells equal the sum of their leaves every day, linked children carry no gap / at-risk, every active linked customer has today's CPT row.

## Findings

| # | Issue | Severity | Evidence |
|---|-------|----------|----------|
| F1 | Shell CPT missing on inactive-policy days: inactive versions with zero own AR were skipped, and the pool overlay only UPDATEs existing rows | High | `customerPolicyTrendService.ts` upsert filter (~1602–1622); overlay `syncCreditPoolPolicyTrendsAfterParentChange.ts:316–355` |
| F2 | A fresh Generate / drain item deletes **all** CPT, CDP and InsurancePolicyTrend (IPT) before `from_date`. Generate never rebuilds IPT, so IPT history is lost permanently. A partial Generate (e.g. from Sep 8) wiped Jan–Sep history on 10149 | High | `creditSnapshotHistoryCleanup.ts:150–206`; callers `creditAsOfBackfillJob.ts:505–514`, `asOfRewriteQueue.ts:612–621`, `rewriteCustomerAsOfRange` `:466–475` |
| F3 | Live writers patch **today's** shell CPT with live customer totals (`total_due_amount + total_overdue_amount`) without recomputing gap / at-risk / health; no re-overlay afterwards. Breach rollup sums terms over **all** member CPT rows today | High | `rollupCreditPoolOpenArToRoot.ts:187–206` (`patchTodayRootCtpUsage`), `:337+`, called after overlay from `runCreditPoolParentChangeSideEffects.ts:50–97`; `rollupCreditPoolBreachToRoot.ts:113–146` |
| F4 | Single-customer rewrites never re-overlay the **parent shell**: overlay targets only written ids that are themselves shells. Hits child customer-policy saves, child-scoped drain items, and top-up rewrites | High | `customerPolicyTrendService.ts:1650–1673` (`writtenCustomerIds` filter); `asOfRewriteQueue.ts:637–649`; `api/src/customers/customer-policy.service.ts:753–761`; `api/src/customers/customers.service.ts:1606–1614` |
| F5 | Shell overlay and finalize prune errors are swallowed; Generate still ends `complete` with un-overlaid shell rows | High | empty catch `customerPolicyTrendService.ts:1671–1673`; `creditAsOfBackfillJob.ts:659–670, 686–696` |
| F6 | Exceptions during Generate setup (prepare, run context, ledger preload) are outside the fail handler → job stays `running` until stale reclaim | Medium | `creditAsOfBackfillJob.ts:499–580` vs fail path `:789–811` |
| F7 | Dashboard (CDP) at-risk ≠ Σ top-level CPT at-risk: 2026-10-08 diff **511,581** at-risk, **5,164** AR; no no-policy customers that day, so not the cohort difference. Suspect: shell pool at-risk = `min(AR, gap + terms)` (no overlap subtraction) vs customer / CDP formula `gap + terms − overlap` | Medium | `syncCreditPoolPolicyTrendsAfterParentChange.ts:290`; `docs` at-risk formula in `customerDashboardKpisService.ts:217–233` |
| F8 | Chart and overlay read every CPT row for a day: overlay `SUM`s all leaf rows, chart takes `MAX(...)` per day/policy. On a policy-change day (nightly cron activates pending policies **before** the tip) a leaf has an effective row **and** a run-off row → pool AR double counted, chart shows stale values. **Most likely cause of the Oct 8 spike**: shell usage 48.28M with gap 37.28M = usage − 11M effective limit, i.e. a coherent overlay over an inflated leaf sum | High | overlay SQL `syncCreditPoolPolicyTrendsAfterParentChange.ts:162–168`; run-off rows kept by `customerPolicyTrendService.ts:1613–1620`, `customerPolicyTrendBatchUpsert.ts:180–203`; cron order `handlers.ts:185–212`; chart `customerPolicyTrendService.ts:2085–2105` |
| F9 | Rewrite queue marks items `done` without clearing `last_error` (3 items on 10149 look failed but succeeded on retry) | Low | `asOfRewriteQueue.ts:657–661` |
| F10 | Mid-run, historical shell CPT stays un-overlaid until finalize (per-day overlay only for yesterday / today); a run failing on day 1 skips finalize entirely | Low | `creditAsOfBackfillJob.ts:625–632, 767–769`; finalize needs `lastCompletedDay` |
| F11 | Nightly CPT gap-fill (≤7 missed days) writes CPT only — no CDP for those days; CDP cron is today-only | High | `customerPolicyTrendService.ts:1718–1722`; `creditDashboardSnapshotService.ts:444`; `MAX_GAP_FILL_DAYS` `customerPolicyDailyCostDelta.ts:6` |
| F12 | Nightly tip / gap-fill (CPT, CDP, IPT) has no lease check, so it can write the same day as a running Generate or parent-history job (only the drain skips them) | High | `takeCustomerPolicyTrendSnapshots`, `takeCreditDashboardDailySnapshots`, `takeInsurancePolicyTrendSnapshots` vs drain guard `asOfRewriteQueue.ts:553–574` |
| F13 | Parent-history job swallows bulk overlay errors and writes no CDP history (documented) | Medium | `creditPoolParentHistoryJob.ts:3–7, 497–508` |
| F14 | CPT cron throws `todayError` before `drainError`, so a drain failure is masked when the tip also failed; stale comment says the drain is unscheduled | Low | `handlers.ts:272–285`; `asOfRewriteQueue.ts:14–17` |

**By design (no change):** IPT / country / named trends are forward-only daily rows from live config and live open AR (`insurance-policy-trend-daily-snapshots.prd.md` stories 21–22); Generate and the drain do not rebuild them; local IPT gaps on 10149 (only Sep 11+, missing Sep 21–22, 27–28) are missed cron nights. CDP (`0 2 * * *`) runs before CPT (`0 3 * * *`) but does not read CPT, so order does not matter. CPT cron runs for frozen accounts (accepted in the import-freeze PRD). Pool membership for past days uses today's parent tree (`syncCreditPoolPolicyTrendsAfterParentChange.ts:8–9`). Today's tip uses live CTV flags (`docs/agents/domain.md`).

## Decisions

| # | Topic | Proposed | Status |
|---|-------|----------|--------|
| D1 | Pre-window deletes on Generate / drain | Generate and drain **preserve** history before `from_date`. Deleting pre-window CPT/CDP stays only on invoice/payment clear flows (`purgeCreditSnapshotsAfterInvoiceOrPaymentClear`). IPT / country / named are **never** deleted by Generate or drain | **Approved** (2026-10-08) |
| D2 | Overlay failure in Generate | Fail the run (status `failed`, `lastError` set, checkpoint kept) so Retry re-runs finalize; do not report `complete` | **Approved** (2026-10-08) |
| D3 | Today's shell tip after live member changes | Replace the raw usage patch with a real recompute: re-overlay today for the pool root from leaf CPT | **Approved** (2026-10-08, implemented in slice 4) |
| D4 | Pool at-risk formula | Align shell pool at-risk with the customer formula (`gap + terms − overlap`, capped at AR) if F7 investigation confirms | **Approved** (2026-10-08): **net basis, capped at AR** — CDP at-risk moves to net AR (invoices minus credit notes) and never exceeds a customer's open AR, matching the shell overlay. F7 found overlap = 0; gap is gross-vs-net basis + AR cap (slice 7 Findings). Implemented by slice 7b |

## Fix slices (in order)

### 1. Shell stub rows on inactive days (F1) — done (uncommitted)
- `syncCustomerPolicyTrendSnapshotForAccount`: always upsert shell customers' effective rows even with zero own AR; reuse one `customerIdsWithChildren` lookup for the overlay.
- Verified on 10149: shell `1000033` has CPT 2026-01-01 → today and matches leaves daily.

### 2. Stop destructive pre-window deletes (F2) — done (uncommitted); `deleteCreditSnapshotHistoryBeforeDate` removed
- `prepareCreditSnapshotHistoryForRewriteWindow`: drop the `deleteCreditSnapshotHistoryBeforeDate` call (keep the inactive-CP prune). Pre-window deletes happen only on invoice/payment clear flows.
- `deleteCreditSnapshotHistoryBeforeDate`: stop deleting `InsurancePolicyTrend` (cannot be regenerated).
- `rewriteCustomerAsOfRange`: default to preserve (today it deletes unless `preserveHistoryBeforeFromDate`); audit callers.
- Confirm clear+reimport still removes stale pre-clear CPT/CDP via `purgeCreditSnapshotsAfterInvoiceOrPaymentClear`.

### 3. Count each leaf once per day (F8) — done (uncommitted); shared `customerPolicyTrendEffectiveRowOrderSql`; repro not run (no live policy activation)
- Overlay leaf SUM (`overlayPoolCapacityGapAndAtRiskOnTrends`): one row per leaf per day — the version effective on that day; exclude dated-unassign run-off rows (`snapshot_date >= policy_change_end_date`) when an effective row exists. Same rule for `rollupCreditPoolBreachToRoot` terms sum.
- Chart (`getCustomerRiskExposureAmountTrendByPolicy`) and `getCustomerPolicyTrendForCustomer`: same row choice instead of `MAX` across rows.
- Reuse `selectCustomerPoliciesEffectiveOnDate` semantics in SQL; do not invent a second rule.
- Repro first: on a pool, activate a pending customer-policy version for a leaf, run the CPT tip, confirm the leaf has two rows and the shell is inflated; then confirm the fix.

### 4. Correct today's shell tip from live writers (F3) — done (uncommitted); shared non-fatal `overlayCreditPoolRootTrendToday`. Live invoice paths have no synchronous leaf CPT tip, so the root's today row mirrors stored leaf CPT (live AR reaches CPT on the next tip / drain / rewrite)
- `rollupCreditPoolOpenArToShell` / `rollupCreditPoolOpenArAfterMemberChange`: remove `patchTodayRootCtpUsage`; after the live customer rollup, call `overlayPoolCapacityGapAndAtRiskOnTrends` for `rootId`, today only (requires leaf CPT for today to be current — run after the member's CPT tip refresh).
- `rollupCreditPoolBreachToRoot`: same treatment for its today CPT `updateMany`.
- Verify `total_due_amount` currency vs CPT limit currency while there.

### 5. Re-overlay parent shells on scoped rewrites (F4) — done (uncommitted); rewrite/drain widen scope with pool shells (`withCreditPoolShellIds`) and run one shared `overlayCreditPoolShellsForRange` after the day loop; parent-change sync and parent-history skip the now-redundant per-day/rewrite overlay
- In `syncCustomerPolicyTrendSnapshotForAccount`, resolve the credit-pool root(s) of written customers (`resolveCreditPoolMemberIds` / `resolveCustomerCreditPoolRoot` with a shared `CreditPoolMembershipCache`) and overlay those roots, not just written shells. This covers child customer-policy saves (`customer-policy.service.ts:753–761`) and top-up rewrites (`customers.service.ts:1606–1614`) without touching the API callers.
- Drain and `rewriteCustomerAsOfRange`: after the day loop, one range overlay for affected roots (mirror Generate's `overlayCreditPoolShellsForRange`), and pass `skipCreditPoolShellOverlay` per day to avoid N overlays.
- Ensure the root has a CPT row for every replayed day (slice 1 covers inactive days; add an explicit stub upsert if the root is outside `customerIds` scope).

### 6. Surface failures (F5, F6, F9, F13, F14) — done (uncommitted); Generate finalize/setup and drain/parent-history overlay failures now fail the run/item (Retry re-runs full-window finalize from the kept checkpoint); interactive rewrite/save and nightly tip overlays stay logged non-fatal
- Per-day overlay: replace empty catch with `console.error` + rethrow when called from Generate / drain (keep non-fatal only for interactive save paths, logged).
- Generate finalize and parent-history bulk overlay: overlay / prune failure → `failed` with `lastError` (D2).
- Wrap Generate setup (S1–S5) in the same fail handler → `failed`, not stuck `running`.
- Drain: `SET status = 'done', last_error = NULL` on success; fix the stale "drain unscheduled" comment.
- CPT cron handler: report all collected errors (tip, activation, drain, retry) in one thrown error instead of the first only.
- Coordinate with `snapshot-audit-cleanup-cron-observability.prd.md` (cron wrappers re-throw) — do not duplicate that work.

### 7. Reconcile CDP vs CPT at-risk (F7) — investigate first — done (uncommitted); diff is a gross-vs-net invoice basis mismatch on 2 shells plus one stale non-shell row, not overlap — no code change; D4 decided (net, capped) → slice 7b
- Diagnostic script (one reusable script under `scripts/diagnostics/`, delete after): per top-level customer on 2026-10-08, compare CPT at-risk vs the CDP per-customer allocation; list the top contributors to the 511k diff.
- If shells explain it → apply D4 in `overlayPoolCapacityGapAndAtRiskOnTrends` (needs per-invoice overlap on leaves; sum leaf `at_risk_exposure` may be the simplest correct pool value). If not → open a follow-up with findings.
- Findings (10149, 2026-10-08 = latest CDP day; read-only diagnostic, deleted): CDP at-risk 24,345,923.42 vs Σ top-level CPT 23,834,342.07 → **+511,581.35**; AR equal (113,781,752.93, the earlier 5,164 AR diff is gone). Recomputing CDP-style per customer (pool invoices remapped to the root, root waterfall, Σ max(gap_i, breach_i)) reproduces CDP to the cent.
  - **F8: 0** — no customer has more than one CPT row that day.
  - **Overlap: 0** on every shell → D4 as written (`gap + terms − overlap`) would change nothing.
  - **Shells +584,411.88**: `1000041` +435,427.99 (gross positive-invoice terms 12,570,671.13 > net leaf AR 12,135,243.14 → overlay caps at net AR, CDP does not cap); `1000042` +148,983.89 (overlay gap on net AR 52,814.70 vs CDP waterfall gap on gross invoices 201,798.59; diff = gross − net AR). Cause: overlay uses net leaf `total_receivables` (credit notes netted) and `min(AR, …)`; CDP at-risk skips negative invoices and is uncapped per customer.
  - **Non-shell `21020` −72,830.53**: CPT at-risk 116,116.96 vs CDP 43,286.43; CPT row has effective limit 350,000 and gap 0, but its at-risk carries a gap leg = 272,830.53 − 200,000 (old version limit; customer has 200k → 350k version history). Stale/inconsistent row from pre-fix data or a version-scoped waterfall — re-check after re-Generate.
  - Follow-up: basis decided (D4 approved: net AR, capped) → slice 7b.

### 7b. CDP at-risk on net AR, capped (D4) — done (uncommitted); credit notes netted oldest-first inside the as-of gap waterfall (`netOpenCreditNotesOldestFirst`) + `computeCustomerRiskExposure` capped at net AR; terms leg stays gross (= Terms Breach card / shell overlay). 10149 2026-10-08: CDP 23,752,280.62 = expected Σ top-level CPT, 0 shell mismatches
- `creditDashboardSnapshotService.ts` (and the shared at-risk helper it uses, see `customerDashboardKpisService.ts` ~217–233): net credit notes / negative invoices against the customer's open invoices before the gap waterfall and terms legs, and cap each customer's at-risk at its net open AR — same result as the shell overlay for pools.
- Netting rule must be explicit and shared (e.g. credit notes applied oldest-invoice-first); reuse an existing netting helper if one exists.
- Check the dashboard KPI read path computes at-risk the same way (live KPI vs snapshot parity).
- How to test: re-Generate 10149 → CDP at-risk for 2026-10-08 equals Σ top-level CPT at-risk (shells `1000041`, `1000042` no longer differ); a customer with credit notes shows at-risk ≤ open AR.
- Findings (read-only diagnostic, deleted): full netting (credit notes also reduce the terms leg) left 3 shells off the overlay (−436,572; `1000033`, `1000038` regressed) because the overlay and Terms Breach card use gross breached outstanding → netting kept to the gap leg. With the fix: `1000041` −435,427.99 (cap), `1000042` −148,983.89 (net gap); non-shells `21022` −9,186 and `20997` −44.92. Stored CPT for 2026-10-08 was rewritten at 03:13 UTC by deployed (pre-slice-3) code: 1,418 rows for 418 customers, shell `1000041` at-risk 60.68M (5× AR) — F8 in prod data, fixed by re-Generate after deploy.
- Residual: the persisted live waterfall (`syncInvoiceCapacityGapAmountsForCustomer`) still allocates on gross positives; the live KPI/dashboard gap leg uses the net Cap Gap card, so only the overlap term can differ slightly from the snapshot. Netting there changes stored per-invoice gaps — out of scope unless requested.

### 7c. Live at-risk overlap on net gaps — done (uncommitted); live at-risk fetchers share `loadLiveAtRiskInvoiceRows` (full-pool, root effective limit) + `allocateNetCapacityGapWaterfall` (also used by the as-of overlay). 10149 today: live summary 23,752,280.62 = as-of today = stored CDP (+2,500 vs old, customer 21262)
- Live path (`computeCustomerRiskExposure` with `capacityGapAmount` set): `overlap = Σ min(gap_i, breach_i)` uses stored gross `capacity_gap_amount`, so live at-risk can be slightly lower than the snapshot. Recompute per-invoice gaps in memory with the same net waterfall the snapshot uses (`netOpenCreditNotesOldestFirst` + as-of waterfall) and use them only for the overlap. Stored `capacity_gap_amount` stays gross (reports, notification rules, invoice grid, sticky top-up gap depend on it).
- How to test: customer with credit notes and terms-breached invoices → live dashboard at-risk equals today's CDP / CPT at-risk.
- Perf: `loadLiveAtRiskInvoiceRows` 10149 (median of 5, ~80 ms/round trip) — whole account 658 → 427 ms, customer `21262` 395 → 163–243 ms, customer `1000033` 403 → 240 ms (membership, then invoices ∥ root policies ∥ root-scoped top-ups; customer KPIs load scope rows once for primary + secondary).

### 8. Nightly cron parity and lease (F10, F11, F12) — done (uncommitted); shared `loadAccountSnapshotLeaseBlockers` (drain + per-account skip in CPT/CDP/IPT cron loops; stale `running` Generate no longer blocks), gap-fill writes CDP from one ledger preload; F10 no change
- CPT gap-fill: for each gap day also call `takeCreditDashboardDailySnapshotsForAccount` with the same as-of lines (as the drain does), so CDP has no hollow days.
- Tip writers (CPT tip + gap-fill, CDP cron, IPT cron): skip an account while Generate or parent-history is `running`/`paused` with a fresh heartbeat — reuse the drain's blocking query (`asOfRewriteQueue.ts:553–574`), extracted to one shared helper.
- Generate finalize range overlay already covers F10 once slice 6 makes failures visible; no extra change.

### 9. Ops after deploy — ready-for-human (run after slices 1–8 ship)
- Run a full-history Generate (Jan 1 → today, or earliest invoice date) for every credit-insurance account that has shell customers:
  `SELECT DISTINCT account_id FROM "Customer" WHERE id IN (SELECT parent_customer_id FROM "Customer" WHERE parent_customer_id IS NOT NULL)`.
- Never run a partial-range Generate before slice 2 ships (it deletes earlier history).

## Codebase scan

**Required**
- `packages/credit-insurance-domain/src/credit-insurance/domain/customerPolicyTrendService.ts` — slices 1 (done), 3 (chart row choice), 5, 6, 8 (gap-fill CDP, lease skip).
- `.../creditSnapshotHistoryCleanup.ts` — slice 2.
- `.../creditAsOfBackfillJob.ts` — slices 2, 6 (setup fail handler, finalize failure status).
- `.../asOfRewriteQueue.ts` — slices 2, 5, 6, 8 (range overlay, `last_error` clear, `rewriteCustomerAsOfRange` default, shared lease helper).
- `.../syncCreditPoolPolicyTrendsAfterParentChange.ts` — slices 3, 7 (leaf dedupe, pool at-risk formula).
- `.../rollupCreditPoolOpenArToRoot.ts`, `.../rollupCreditPoolBreachToRoot.ts` — slices 3, 4.
- `.../syncCustomerInsuranceFields.ts`, `.../runCreditPoolParentChangeSideEffects.ts` — slice 4 call sites (ordering: CPT tip before root overlay).
- `.../creditPoolParentHistoryJob.ts` — slice 6 (overlay failure status); re-check for double overlay after slice 5.
- `.../creditDashboardSnapshotService.ts`, `.../insurancePolicyTrendService.ts` — slice 8 (lease skip only; IPT math unchanged).
- `packages/cron-jobs/src/handlers.ts` — slice 6 (report all CPT cron errors).

**Optional / out of scope**
- IPT as-of math / automatic backfill of missed nights — forward-only live by PRD.
- `api/src/customers/customer-policy.service.ts`, `customers.service.ts` — no change if slice 5 resolves roots inside the domain writer.
- Cron wrapper re-throw for other jobs — owned by `snapshot-audit-cleanup-cron-observability.prd.md`.
- `Compute Customer Overdue Metrics` schedule not seeded in repo migrations — ops DB owns it.

**No change needed**
- `creditAsOfBackfillRunContext.ts` — loads active + inactive versions correctly.
- `customerPolicyAsOfVersion.ts` — effective-on-D selection is correct; reused by slice 6.
- `customerPolicyTrendBatchUpsert.ts` — upsert/prune mechanics fine.
- Frontend `CustomerDashboardCreditCharts.tsx`, `customerDashboardKpisQuery.ts` — chart renders whatever the API returns.
- Prisma schema / migrations — no schema change; i18n — no user-facing copy change.

## Testing strategy

Proposed test units (write only when explicitly requested, per repo rules):

| Requirement | Test unit | Seam |
|-------------|-----------|------|
| Shell gets CPT on inactive-version days with zero own AR | Generate over a pool whose root has only inactive versions before the active start → root CPT exists every day and equals Σ leaves | `syncCustomerPolicyTrendSnapshotForAccount` + overlay |
| Generate preserves history before `from_date` (D1) | Seed CPT/CDP/IPT Jan–Sep, run Generate from Sep 8 → Jan–Sep rows still present | `prepareCreditSnapshotHistoryForRewriteWindow` |
| Clear flow still purges | Invoice clear → pre-clear CPT/CDP gone | `purgeCreditSnapshotsAfterInvoiceOrPaymentClear` |
| Scoped child rewrite re-overlays parent | Drain item with `customer_ids=[child]` → parent CPT equals new Σ leaves | `drainAsOfRewriteQueue` |
| Live member change keeps tip consistent | Member invoice change → root today usage, gap, at-risk all from overlay | `rollupCreditPoolOpenArAfterMemberChange` |
| Overlay failure fails Generate | Inject overlay throw → status `failed`, `lastError` set | `runCreditAsOfBackfillJob` |
| Setup failure not stuck | Throw in run-context build → `failed` | `runCreditAsOfBackfillJob` |
| One row per day in chart / overlay | Leaf with effective + run-off row same day → counted once, chart shows effective values | chart query, overlay SQL |
| Drain success clears error | Retry succeeds → `last_error IS NULL` | `drainAsOfRewriteQueue` |
| Policy-change day does not inflate pool | Activate pending version on a leaf, run tip → shell AR equals Σ leaves counted once | `takeCustomerPolicyTrendSnapshots` + overlay |
| Gap-fill writes CDP | Skip 2 nights, run CPT cron → CPT and CDP exist for both days | `takeCustomerPolicyTrendSnapshots` |
| Tip skips while Generate runs | Generate `running` with fresh heartbeat → tip writers skip that account | shared lease helper |

Existing suites to keep green: `tests/backend/api/credit-asof-backfill-job.test.ts`, `as-of-rewrite-queue.test.ts`, `parent-customer-credit-aggregated-data.test.ts`, `as-of-open-ar.test.ts`. Static: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`.

## How to test

1. Account 10149 → customer `1000033` → Dashboard → **Open AR & risk drivers**: history from Jan 4 (first child invoice), today's point equals the sum of children's open AR.
2. Portfolio Health → Generate with a start date in September → afterwards, chart history before September is still there (after slice 2).
3. Edit an invoice on child `21037` → parent `1000033` today's point updates to the new pool total; capacity gap and at-risk consistent with it (after slice 3).
4. Credit dashboard at-risk for today equals the sum of top-level customers' at-risk (after slice 7).

## Out of scope unless requested
- IPT / country / named automatic backfill of missed nights.
- As-of pool membership (historical parent links).
- Recomputing `outdated_dcl` / score flags as-of each day.
