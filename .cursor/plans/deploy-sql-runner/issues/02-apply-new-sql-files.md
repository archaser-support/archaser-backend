# 02 — Apply new SQL files

**Status:** done
**Priority:** normal
**Blocked by:** [01-baseline-on-deploy](01-baseline-on-deploy.md)
**User stories:** 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20
**PRD:** `.cursor/plans/deploy-sql-runner.prd.md`

## What to build

After the applied list exists, deploy runs only migration files that are not yet recorded, in filename order, before the new app starts. The current app stays up during the step.

Each new file must be named `YYYYMMDD_description.sql`. Any other new name fails the deploy before any new file runs. Two files on the same day run in alphabetical filename order, so `_01_` and `_02_` control sequence.

The apply step opens one transaction per file, sets a lock wait of 30 seconds, and does not set a statement timeout. It commits and records the filename and checksum only when the whole file succeeds. New files must not contain `BEGIN`, `COMMIT`, `CREATE INDEX CONCURRENTLY`, or `VACUUM`.

A failed file is rolled back, is not recorded, and stops the deploy. Later files in that deploy do not run. The new app does not start. The next deploy retries the failed file from the start. Files that already committed stay applied.

A checksum change on a file that already ran fails the deploy before any new file runs. The same pending file runs on production when master deploys, even if staging already recorded it.

Any SQL in a well-named new file is allowed, including drops and data fixes. A drop or rename still waits for a later release whose running app no longer uses that column. The runner does not block those statements.

## Acceptance criteria

- [ ] A dated file that is not yet recorded runs, commits, and is stored with its checksum
- [ ] A second deploy skips that file
- [ ] An edited file that was already recorded fails the deploy and runs nothing new
- [ ] A new file whose name lacks a `YYYYMMDD_` prefix fails the deploy and runs nothing new
- [ ] Two dated files run in filename order
- [ ] If the second file fails, the first stays applied, the second is not recorded, its statements are gone, and later files do not run
- [ ] The new app is not started after a SQL failure; the previous app keeps serving
- [ ] Lock wait is 30 seconds, and a statement that already holds its lock is not cut off by a statement timeout
- [ ] A file recorded only on staging still runs on production

## How to test

1. Use a database that already has the baseline applied list from slice 01.
2. Add `YYYYMMDD_01_example.sql` that creates a scratch table, and deploy.
3. Expect the table to exist and one new applied row. Deploy again and expect the file to be skipped.
4. Edit that file in place and deploy. Expect failure, no new SQL, and the previous app still running.
5. Add a file named `add_widget.sql`. Expect failure before any new SQL.
6. Add two dated files, the second with a bad statement. Expect the first file’s change to remain, the second file absent from the applied list, and the deploy stopped before the new app starts.
7. Record a new file on the staging database only, then run the apply step against the production database. Expect that file to run there.
