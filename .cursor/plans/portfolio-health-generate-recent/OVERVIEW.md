# Portfolio Health — generate recent

Add **Generate recent** on Credit Portfolio Health: rebuild whole-account as-of snapshots for the **pending** `CreditAsOfRewriteQueue` window only, without replacing full-range **Generate**. Queue stays pending for nightly drain.

**PRD:** `.cursor/plans/portfolio-health-generate-recent.prd.md`

**Related:** `.cursor/plans/portfolio-health-generate-snapshots.prd.md`, `.cursor/plans/as-of-daily-snapshot-rewrite.prd.md`

Vertical slices live in `issues/`. Implement in dependency order; start a **fresh session per issue**.

| # | Title | File | Waiting on |
|---|-------|------|------------|
| 1 | Generate recent happy path | `issues/01-generate-recent-core.md` | — |
| 2 | Guards, large-range confirm, copy | `issues/02-generate-recent-guards-copy.md` | 01 |

**Status:** `ready-for-agent` on all slices.
