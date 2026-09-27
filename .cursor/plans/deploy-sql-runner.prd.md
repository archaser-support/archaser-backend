---
name: deploy-sql-runner
overview: On staging and production deploy, apply new dated SQL files in filename order before the new app starts, and record which files already ran.
source: grill-me session
clickup_task_url: null
isProject: false
---

# Deploy SQL runner

## Problem Statement

Schema and data changes ship as flat SQL files. A push to the staging branch or to master deploys the app and regenerates the Prisma client, and it does not run those files. Someone applies each script by hand in DBeaver. If that step is skipped, the new app starts against a database that is missing the change.

The files are not in Prisma Migrate layout, so the standard Prisma deploy command would ignore them. Staging and production are separate databases on one host. Each deploy must change only the database for that environment.

## Solution

The deploy runs a single SQL apply step after that environment’s database connection is loaded and before the new containers start. The current app keeps serving during the step.

The step records every SQL file that exists on the day the runner is turned on, and it does not execute those files. After that, it runs only new files, in filename order, each inside one transaction. It stores the filename and a checksum. A later edit to a file that already ran fails the deploy. A failed file is rolled back, is not recorded, and stops the deploy so the new app does not start. The next deploy retries that file from the start.

New files must be named with a calendar date and a description (`YYYYMMDD_description.sql`). Same-day order is alphabetical, so a sequence such as `_01_` and `_02_` is used when order matters. Drops and renames wait for a later release, after the running app no longer reads the old column. The runner itself does not block those statements. The author keeps them out of the release that the old app still depends on.

## User Stories

1. As an engineer merging a schema change, I want the new SQL file to run on staging when the staging branch deploys, so that I do not paste it into DBeaver.
2. As an engineer promoting that change, I want the same file to run on production when master deploys, so that production is not a second manual step.
3. As an engineer, I want only files added after the baseline to run, so that historical scripts that already ran by hand are not executed again.
4. As an engineer, I want each applied file remembered by name and checksum, so that the next deploy skips it.
5. As an engineer who edits a file that already ran, I want the deploy to fail, so that I add a new file instead of changing history.
6. As an engineer, I want files to run in filename order, so that a column exists before a later file uses it.
7. As an engineer shipping two files on the same day, I want `_01_` and `_02_` in the name to control order, so that alphabetical order matches the intended sequence.
8. As an engineer who names a file without a `YYYYMMDD_` prefix, I want the deploy to fail before any SQL runs, so that a badly named file cannot jump the queue.
9. As an engineer, I want each new file committed or rolled back as a whole, so that a failure halfway through does not leave a half-applied change.
10. As an engineer, I want a failed file omitted from the applied list, so that the next deploy retries it from the start.
11. As an engineer, I want later files in the same deploy skipped after a failure, so that they do not run against a database the failed file did not finish changing.
12. As an engineer, I want the new app to stay on the previous build when SQL fails, so that the process does not boot against a missing column.
13. As an engineer, I want the current app to keep serving while SQL runs, so that an additive change does not take the site down.
14. As an engineer adding a nullable column, I want that change to be safe while the old app is still up, so that requests keep succeeding during the deploy.
15. As an engineer dropping or renaming a column, I want to ship that SQL only after a release whose code no longer uses the column, so that the still-running app does not error.
16. As an engineer, I want a statement that cannot get its lock within 30 seconds to roll back and stop the deploy, so that a busy table does not freeze the site until the job times out.
17. As an engineer running a long data fix, I want the statement to keep running once it has the lock, so that a large update is not cut off at 30 seconds.
18. As an engineer, I want drops, data fixes, and other SQL to be allowed in a new file, so that one folder covers the changes we already write by hand.
19. As an engineer, I want `CREATE INDEX CONCURRENTLY` and `VACUUM` rejected, so that a file is not split across an outer transaction the runner opened.
20. As an engineer, I want new files to omit their own `BEGIN` and `COMMIT`, so that the runner’s transaction is the only one.
21. As an engineer turning the runner on, I want the first release to record today’s files and run nothing, so that enabling the runner does not replay history.
22. As an engineer, I want that first release to fail if it also adds a new SQL file, so that the new file is not marked applied without running.
23. As an engineer, I want staging and production to baseline separately, so that each database gets its own applied list.
24. As an engineer, I want the apply step to use only that deploy’s database, so that a staging deploy cannot change production.
25. As an ops engineer, I want a checksum stored for every baselined file, so that editing an old script later still fails the deploy.
26. As an ops engineer, I want one-off scripts outside the migrations folder left alone, so that historical repair scripts do not run on deploy.
27. As an ops engineer, I want the Prisma client still generated on deploy, so that the app matches the schema after SQL succeeds.
28. As an ops engineer, I want the deploy to fail when the applied list is missing and the release is not the baseline release, so that a fresh database is not treated as already migrated by accident after the runner is on.
29. As an engineer, I want the database authoring rules updated for new files, so that the next change follows the runner instead of a hand-run DBeaver script.

## Implementation Decisions

- One apply module owns “which files run” and “what gets recorded.” The deploy script calls that module and, on failure, exits before recreating containers. The current containers stay up.
- The module reads the database connection already chosen for that environment (staging or production). It does not choose the other environment’s database.
- Pending work is the set of dated SQL files in the migrations folder that are not yet recorded for this database, sorted by filename.
- The applied record stores filename, checksum, and the time it was applied. The row is inserted only after the file’s transaction commits.
- On every deploy, checksums of already recorded files are compared to the files in the release. A mismatch fails the deploy before any new file runs.
- A new file whose name is not `YYYYMMDD_description.sql` fails the deploy before any new file runs. Same-day order is the alphabetical order of the full filename.
- The module opens one transaction per new file, sets a lock wait of 30 seconds, and does not set a statement timeout. It commits only when the whole file succeeds. It does not wrap a second transaction around files that already contain `BEGIN` or `COMMIT`, because new files must not contain those statements.
- Statements that cannot run inside a transaction (`CREATE INDEX CONCURRENTLY`, `VACUUM`) are not supported. The author uses a normal `CREATE INDEX` instead.
- The runner does not classify SQL. Drops and data fixes run when they are in a new file. Shipping a drop or rename while the current app still uses that column is an authoring rule, not a filter in the runner.
- The first release that adds the runner commits a baseline list of every SQL file already in the tree, plus the checksum of each file at that commit. That deploy inserts those rows and executes nothing. If that same release contains a SQL file that is not on the list, the deploy fails.
- After the applied list exists, only files absent from the list are executed. A failed file is not inserted, so a later deploy retries it. Files that committed earlier in the same deploy stay applied.
- One-off scripts that live outside the migrations folder are not inputs to the module.
- Database authoring guidance for new files changes to: dated filename, no `BEGIN` or `COMMIT`, no `CREATE INDEX CONCURRENTLY` or `VACUUM`, and drops or renames in a later release. The runner replaces hand execution in DBeaver for those new files.
- No user-facing copy, so no English or Hebrew string changes.
- No Prisma Migrate history table and no reshaping of existing files into Prisma Migrate folders.

### Decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | How SQL gets applied | Deploy runs new SQL files in filename order and records which ones already ran |
| D2 | Files already applied by hand | Mark every current file as applied on staging and production |
| D3 | A SQL file fails | Stop the deploy before the new app starts, and do not run later files |
| D4 | Staging and production | Both apply pending SQL automatically on push |
| D5 | Drops and data fixes | Any SQL in a new file runs; the author makes it safe |
| D6 | File edited after it ran | Fail the deploy; put the change in a new file |
| D7 | Turning the runner on | First release only records today’s files; a new SQL file in that release fails the deploy |
| D8 | Transaction | The runner wraps each new file in one transaction; new files omit `BEGIN` and `COMMIT` |
| D9 | SQL that cannot run in a transaction | Not allowed |
| D10 | App during SQL | Current app stays up; a drop or rename ships in a later release |
| D11 | Lock wait | Give up after 30 seconds, roll back, and stop the deploy |
| D12 | Statement duration | No cap once the lock is held |
| D13 | New file names | `YYYYMMDD_description.sql` only; same-day order is alphabetical |

## Testing Decisions

Good tests assert observable outcomes of the apply module: which statements landed, which filenames were recorded, and whether the run failed. They do not assert private control flow inside the deploy shell.

**Seam:** one apply module, called by the deploy script. That is the only test seam. The shell script is a thin caller (load the environment, call the module, exit on failure before recreating containers).

When tests are added, prior art is the package-level `describe` / `it` tests under the backend packages. Exercise the module against Postgres, not the SSH deploy job.

Cases that define the seam:

- A folder that matches the baseline list records those files and executes none of them.
- A dated file absent from the list runs, commits, and is recorded with a checksum.
- A second run skips that file.
- A changed checksum on a recorded file fails the run and executes nothing new.
- A file whose name lacks a `YYYYMMDD_` prefix fails the run and executes nothing new.
- Two dated files run in filename order. If the second fails, the first stays applied, the second is not recorded, and the database does not keep the second file’s statements.
- The session’s lock wait is 30 seconds, and there is no statement timeout.
- The enabling inputs fail when a SQL file is present that is not on the baseline list.

Tests are not part of this PRD’s implementation unless explicitly requested.

## Out of Scope

- Adopting Prisma Migrate or replaying history through `prisma migrate deploy`.
- Running one-off scripts that live outside the migrations folder.
- A manual production approval gate. Production applies SQL on push to master.
- Stopping the app before SQL runs.
- A statement timeout after the lock is acquired.
- `CREATE INDEX CONCURRENTLY`, `VACUUM`, or a per-file opt-out from the transaction.
- The runner refusing `DROP` or `UPDATE`. Release sequencing for drops and renames stays with the author.
- English or Hebrew copy, and any frontend change.
- ClickUp tasks and vertical-slice files. Slice breakdown is a separate `/to-issues` pass.

## Further Notes

**Blocking gate.** Before the baseline release, confirm that staging and production already contain every change described by today’s SQL files. If one environment is missing a change, apply that file by hand on the lagging database, then baseline. Marking the file applied without running it would skip that change forever.

**Enabling release contents.** The release that turns the runner on contains the apply module, the baseline list, and the authoring-rule update. It contains no new SQL file. The next release is the first one allowed to add a dated file.

**Deploy order.** Generate the Prisma client as today. Run the apply module before recreating containers. On failure, leave the previous containers in place.

**Drift after baseline.** Staging and production keep separate applied lists. A file recorded on staging still runs on production until production’s list contains it.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/deploy-sql-runner/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/deploy-sql-runner/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Baseline on deploy | `issues/01-baseline-on-deploy.md` | — | 3, 21, 22, 23, 24, 25, 26, 27, 28, 29 |
| 2 | Apply new SQL files | `issues/02-apply-new-sql-files.md` | 1 | 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20 |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
