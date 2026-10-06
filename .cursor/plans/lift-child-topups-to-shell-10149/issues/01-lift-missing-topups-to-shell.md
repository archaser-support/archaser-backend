# 01 — Lift missing child top-ups onto top shells (account 10149)

**Status:** done
**Priority:** high
**Blocked by:** —
**PRD:** `.cursor/plans/lift-child-topups-to-shell-10149.plan.md`

**Related:** `.cursor/plans/parent-customer-credit-pool.prd.md`, `.cursor/plans/staging-shell-customers-from-list.plan.md`

## What to build

One-off datafix for credit account **10149**. Linked children still hold `CustomerTopUp` rows; many top shells do not. Shared extra cover uses **only the top shell**, so those child rows do not raise the group limit today.

Scan every linked child, resolve the **top** shell, and copy every child top-up the shell is missing — including cancelled history. “Already has” means the same insurance policy, start date, end date, type, amount, and currency (cancelled or not). Copy fields as-is (including `cancelled_at`) so cancelled history is not revived on the shell. After copies for a shell, **cancel every matching live child top-up in that group** (rows just copied and rows the shell already had).

Default is dry-run (print copies, skips, would-cancel, proposed as-of from-date). `--apply` writes, then enqueues an as-of snapshot rewrite for the account from the earliest copied start date through today UTC (skip enqueue if nothing was copied). Do not wait for the job. Do **not** change connect/disconnect product remirror.

## Acceptance criteria

- [x] Dry-run against 10149 prints per-root copy candidates, already-has skips, would-cancel child rows, and proposed as-of from-date, with no database writes
- [x] `--apply` inserts missing rows on the **top** shell only (union of all descendants; new ids)
- [x] Matching child top-ups in the group are cancelled after a successful apply (D12 match); already-cancelled matches stay cancelled
- [x] Concurrent overlapping windows are still copied (no createTopUp overlap reject)
- [x] After copies, as-of rewrite is enqueued from min copied `start_date` → today; skipped when there were no inserts
- [x] Re-run dry-run after apply reports nothing left to copy
- [x] Product parent-link remirror and customer Top-up UI/API are unchanged

## How to test

1. Dry-run: `npx tsx scripts/datafixes/lift-child-topups-to-shell-10149.ts` — confirm which shells would gain rows and which child rows would be cancelled.
2. `--apply` once. Open a shell that had none: top-ups match what the children used to have. Open a linked child: those matching rows are cancelled. Background jobs show an as-of rewrite from the earliest copied start date.
3. After the job drains: group effective limit / CPT top-up on the shell includes the lifted cover; children do not add a second copy to the shared limit.
4. Dry-run again: zero copies, no new cancels.
