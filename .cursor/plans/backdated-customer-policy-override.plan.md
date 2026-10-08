# Backdated customer policy change must override later-dated versions

**Status:** done — code + account 10149 repair applied (Oct 8)

### Implementation notes
- Dated unassign also **extended** already-ended/voided versions to the unassign day (could resurrect them); now it only shortens ends and voids versions starting on/after the day. `api/test/dated-customer-policy-unassign.test.ts` "allows unassign before later copy-on-write versions…" updated to expect voided ends (Aug 31 / Oct 6) instead of null.
- Linked pool children keep their own pre-link history (remirror only replaces live/pending rows), so the datafix repairs children too and remirrors roots only. 21204 is a child of 1000038.
- Dry-run (account 10149): 11 customers, 42 versions. `--fix` applied; re-run dry-run → 0 changes.
- **Run-off duplicate fix (`customerPolicyAsOfVersion.ts`):** `selectCustomerPoliciesForTrendWriteOnDate` wrote a run-off CPT row for every ended version, and since `4da119c` superseded versions carry end dates too — any interactive rewrite double-counted AR next to the successor (395 duplicate customer-days after the first repair rewrite; nightly Generate had been masking it). Run-off now only applies when the customer has no effective version on D, one row per customer + insurance policy (latest ended), and never for voided versions. Re-rewrite of the 11 customers → 0 duplicates; Sep 17 SDL util 10.92%.
- Out of scope, same class: `deactivateLivePolicies` in `parentCustomerCreditInheritance.ts` deactivates a child's live row without an end date when remirroring.
**Primary repo:** backend (no frontend changes)

## Problem

A Customer Policy change saved with a `policy_change_start_date` earlier than existing versions does not take effect from that date. The as-of picker (`isCustomerPolicyVersionEffectiveOnDate`) chooses, for day D, the version with the **latest start ≤ D**, so older-saved versions that start after the backdated date keep winning.

**Example — account 10149, customer 21252 (10776780):**

| Version | Type | Start | End (now) | Created |
|---|---|---|---|---|
| 3350 / 3473 / 3851 / 4232 | DCL 50,050 | Aug 31 – Sep 8 | Sep 7 … **Oct 4** | Aug 31 – Sep 8 |
| 4504 | Named 500,000 | **Jul 1** | **Aug 31** | **Sep 28** |
| 4730 | Named | Oct 4 | Oct 6 | Oct 4 |
| 5404 | Named (active) | Oct 6 | — | Oct 6 |

Intent (saved Sep 28): Named from Jul 1. Snapshots (`CustomerPolicyTrend`): Named until Aug 30, **DCL Aug 31 – Oct 3**, Named from Oct 4. Sep 17 SDL avg. utilization shows 95.5% instead of ~10.9%.

### Root causes

1. **Save path closes only the active row.** `CustomerPolicyService.applyFromPoliciesTabSave` (`create` / `switch` / `version`) supersedes `is_active = true` only; inactive versions starting on/after the new date are untouched.
2. **End-date backfill chains by start date, not save order.** `scripts/datafixes/backfill-customer-policy-end-dates.ts` (run Oct 7 ~13:55 UTC) set each inactive null-end row's end = next version by `policy_change_start_date`. That made 4504 end Aug 31 and 4232 end Oct 4.
3. Even before the backfill, the picker's "latest start ≤ D" rule would resolve Sep 17 to 4232.

### Scope of bad data (account 10149)

12 backdated versions on **11 customers** sit under 4–14 older-saved, later-dated versions: 21020, 21038, 21050, 21089, 21159, 21204, 21215, 21252, 21271, 21348, 1000018 (two backdated saves). All were Jul 1 changes saved Sep 27–30.

## Rule (target semantics)

**The most recently saved change wins from its start date onward.** When a version with start X is saved, every existing non-pending version for that customer is closed at X:

- start < X and (end null or end > X) → `policy_change_end_date = X`
- start ≥ X → `policy_change_end_date = policy_change_start_date` (zero-length / void; existing picker already treats `end = start` as never effective, e.g. 3473)

Equivalent repair formula per version V (non-pending, with policy):
`end(V) = max(start(V), min(start(W) for W saved after V, W non-pending))`, null when no later-saved version exists and V is active.

The picker in `customerPolicyAsOfVersion.ts` stays as-is — once end dates follow the rule, "latest start ≤ D among versions not yet ended" gives the right answer.

## Implementation

### 1. Shared close helper (domain)

`packages/credit-insurance-domain/src/credit-insurance/domain/customerPolicySupersede.ts`

- Add `closeCustomerPolicyVersionsFromDate({ tx, customerId, fromDate, modifiedBy })` — one `$executeRaw` applying the two bullets above to all `status <> 'pending'` rows for the customer, plus `is_active = false`, `status = 'inactive'`.
- Keep `customerPolicySupersedeUpdateData` for callers that only need the field bag (or route them through the helper).

### 2. Call sites

- `api/src/customers/customer-policy.service.ts` — `applyFromPoliciesTabSave`: replace the active-only supersede in `switch` and `version` with the helper; also call it in `create` (no active row but inactive history may exist after unassign). `freezeCustomerPolicyGapOnDeactivation` and `rewriteFromChangeDate(changeDate → today)` stay unchanged.
- `packages/.../datedCustomerPolicyUnassign.ts` — `endCustomerPolicyVersionsForUnassign`: versions with start ≥ unassign day currently get no end date; set end = start (same rule). Low risk, same class of bug.

### 3. Fix + reuse the end-date datafix

Extend `scripts/datafixes/backfill-customer-policy-end-dates.ts` (don't add a new script):

- Compute end with the save-order formula above (order by `created_at`, `id`), for **all** non-pending versions, not only null-end rows.
- Flags: `--account <id>` | `--customer <id>` (repeatable) | `--all`, `--dry-run` | `--fix`.
- Dry-run prints per customer: version id, type, start, old end → new end.
- After `--fix`: for each changed customer, `remirrorCreditPoolAfterPolicyMutation` (pool roots → children mirror end dates; 1000018 is likely a pool shell) then `rewriteCustomerAsOfRange` from the earliest changed day to today.

### 4. Data repair run (account 10149)

1. `--account 10149 --dry-run`; confirm the 11 customers above and that 21252 becomes: 3350/3473/3851/4232 void, 4504 end Oct 4, 4730 end Oct 6, 5404 open.
2. `--account 10149 --fix` (user approves before running).
3. Verify CPT for 21252: Named from Jul 1 through today; no DCL rows Aug 31 – Oct 3.

## Codebase scan

**Required**
- `packages/.../customerPolicySupersede.ts` — new shared close helper.
- `api/src/customers/customer-policy.service.ts` — `create` / `switch` / `version` paths use the helper.
- `scripts/datafixes/backfill-customer-policy-end-dates.ts` — save-order chaining, customer scope, remirror + rewrite.

**Optional / recommended**
- `packages/.../datedCustomerPolicyUnassign.ts` — void versions starting on/after a backdated unassign day.
- Unit tests for the helper and the repair formula (out of scope unless requested).

**No change needed**
- `packages/.../customerPolicyAsOfVersion.ts` — picker is correct once end dates follow the rule.
- `packages/.../insurancePolicyUpdate.ts` — policy push never starts before the active row it replaces; only active rows versioned.
- `api/src/import/import-policy.service.ts` — import always starts today; cannot backdate.
- `packages/.../activateDuePendingCustomerPolicies.ts` — pending rows block other saves (`assertNoPendingPolicyChange`), so no later-saved overlap.
- `packages/.../creditSnapshotHistoryCleanup.ts` — already deletes CPT rows where `snapshot_date ≥ end`, which removes CPT for voided versions on rewrite.
- `packages/.../parentCustomerCreditInheritance.ts` — mirrors `policy_change_end_date` to children; just needs remirror after repair.
- `api/src/credit-insurance/domain/creditPortfolioHealthService.ts` / frontend charts — read CPT; fixed by data.
- i18n — no user-facing copy.

## Risks / notes

- Voiding rows hides their history from as-of; that is the intended meaning of a backdated override. Rows are kept (not deleted) for audit.
- Prehistory: days before the earliest start still use the earliest version (for 21252: Named before Jul 1, unchanged).
- Rewrite of 11 customers from Jul 1 is in-request per customer; run off-hours or via the backfill queue if slow. Blocked while an admin backfill lease is running (`CREDIT_ASOF_BACKFILL_IN_PROGRESS`).

## Testing strategy

Mapped to business rules (tests only if requested):
- Backdated save at X with later-dated inactive versions → those versions end = start; previous active ends at X; as-of on any D ≥ X returns the new version.
- Non-backdated save → identical to today's behavior.
- Repair formula on the 21252 history → expected end dates listed in step 4.
- Backdated unassign at U → versions starting ≥ U are void.

## How to test

1. Run the datafix dry-run for account 10149; confirm 11 customers and the 21252 diff above.
2. After `--fix`, open **Credit portfolio health → Utilization**, range covering Sep 2026; hover Sep 17. **SDL avg. utilization ≈ 10.9%** (only אלאפנדי, 5,465.25 / 50,050); Named rises accordingly.
3. On a test customer with DCL history, save Named with a policy change start date before existing versions; reload the chart — the type switches on the chosen start date.
