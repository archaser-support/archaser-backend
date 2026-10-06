# Lift child top-ups onto pool shells (account 10149)

One-off datafix. Linked children still have `CustomerTopUp` rows; shells often do not. Shared extra cover uses **only the top shell**. Copy missing child top-ups (including cancelled history) onto the top shell, cancel matching child rows, then enqueue as-of snapshot rewrite so group cover recalculates.

**Script (to add):** `scripts/datafixes/lift-child-topups-to-shell-10149.ts`

```bash
npx tsx scripts/datafixes/lift-child-topups-to-shell-10149.ts          # dry-run
npx tsx scripts/datafixes/lift-child-topups-to-shell-10149.ts --apply
```

Same env cascade as `create-shell-customers-from-group-list.ts` (`dotenv` / `PrismaClient`). No `.env` file edits.

**Not this script:** connect-time remirror of top-ups (PRD grill 2026-10-06 D1t–D8t — copy root → child on link; cancel live on unlink). That product path lives on `.cursor/plans/parent-customer-credit-pool.prd.md`. This script only lifts missing child rows **onto** empty shells for account 10149.

## Decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1–D8 | Connect remirror (copy shell → child, unlink, UI) | **Product PRD** (D1t–D8t on parent-customer-credit-pool). **Out of scope** for this datafix | User switched this delivery to a lift script (D9). |
| D9 | What to build | One-off datafix only | Shells were created without top-ups; shared limit ignores child rows. |
| D10 | Account | **10149** | Same as the shell-from-list script. |
| D11 | Several children | **Union:** copy every child top-up the top shell is missing | Skip rows the shell already has (D12). |
| D12 | “Already has” | Same **policy + start + end + type + amount + currency** (any `cancelled_at`) | No unique key on `CustomerTopUp`. |
| D13 | “Active” (first pass) | **Revised by D15** | User then asked to copy **historical** rows too. |
| D14 | Concurrent overlap | Copy anyway; snapshot rewrite recalculates shared cover | Bypass `createTopUp` overlap checks in the datafix. |
| D15 | Which history | Copy **all** child top-ups, **including cancelled** | Needed for as-of days, not only today’s window. |
| D16 | Snapshots after copy | Enqueue as-of rewrite for affected groups, **earliest copied `start_date` → today**, async | CPT/CDP days still ignore cover until rewritten. |
| D17 | Target customer | Always the **top** shell (pool root) | `resolveTopUpOwnerCustomerId` / shared limit. |
| D18 | Child rows | After a successful copy, **cancel** child source rows | Shell becomes the store of record. |
| D19 | Which child rows to cancel | Cancel **every matching child top-up in the group** (copied or already on the shell) | Matching = D12. Already-cancelled matches stay cancelled (`cancelled_at` set if still live). |

## Algorithm

1. Load account **10149** customers with `parent_customer_id` set. Resolve each child’s **top root** (`resolveCustomerCreditPoolRoot`). Skip if root === child.
2. Per top root, load all `CustomerTopUp` on the root and on every descendant.
3. For each descendant row, if the root has **no** D12 match → **would copy** (dry-run) or `customerTopUp.create` on the root with the same fields (`insurance_policy_id`, type/value/currency, start/end, notes, premium, `cancelled_at`, audit ids). New `id`. Do **not** change the child row yet.
4. After inserts for that root: for every descendant top-up that **D12-matches** any root row (old or new), if `cancelled_at` is null → set `cancelled_at = now` (D19).
5. `--apply`: after all roots, `startCreditAsOfBackfillJob` for account 10149 from **min copied `start_date`** (across roots that had inserts) through **today UTC**. Do not wait for the job to finish. If nothing was copied, skip enqueue.
6. Dry-run: print per root (ids/numbers), copy candidates, skip-already-has, would-cancel child ids, proposed as-of `from`. No writes.

Copy `cancelled_at` through as-is so cancelled history is **not** revived on the shell.

## Codebase scan

**Required**

- `scripts/datafixes/lift-child-topups-to-shell-10149.ts` (new)
- `resolveCustomerCreditPoolRoot` / `listDescendantCustomerIds` in `parentCustomerCreditInheritance.ts` (read-only)
- `startCreditAsOfBackfillJob` (same pattern as `rewrite-at-risk-snapshots-as-of.ts`)
- Prisma `CustomerTopUp`

**No change**

- Product connect/disconnect remirror
- `customers.service` `createTopUp` HTTP path
- Frontend Top-up UI
- Tests (not requested)

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/lift-child-topups-to-shell-10149/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Lift missing child top-ups onto top shells (account 10149) | `issues/01-lift-missing-topups-to-shell.md` | — | N/A |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.

## How to test

1. Dry-run on 10149: confirm which shells would gain rows, which child rows would be cancelled, and the as-of from-date.
2. `--apply` once: open a shell that had none — top-ups match what the children used to have; children show those rows cancelled; job appears in as-of / background jobs.
3. After the job: group effective limit / CPT top-up on the shell includes the lifted cover; linked children do not add a second copy.
4. Re-run dry-run: zero copies (already on shell); no new cancels.
