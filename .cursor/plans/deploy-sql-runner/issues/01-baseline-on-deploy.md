# 01 — Baseline on deploy

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 3, 21, 22, 23, 24, 25, 26, 27, 28, 29
**PRD:** `.cursor/plans/deploy-sql-runner.prd.md`

## What to build

The deploy for staging and for production runs one apply step after that environment’s database connection is loaded and before containers are recreated. The step uses only that environment’s database.

On the enabling release, the step writes an applied row for every SQL file already in the migrations folder: filename, checksum of that file, and the time it was recorded. It executes none of those files. One-off scripts outside the migrations folder are ignored.

If that release also contains a SQL file that is not on the committed baseline list, the step fails and the deploy exits before recreating containers. The previous app keeps running.

Authoring guidance for later files is updated in the same release: dated names, no `BEGIN` or `COMMIT`, no `CREATE INDEX CONCURRENTLY` or `VACUUM`, and drops or renames only after the running app no longer uses the old column. This release itself adds no new SQL file.

Prisma client generation stays as it is today, and it still runs when the apply step succeeds.

## Acceptance criteria

- [ ] A deploy against a database with no applied list inserts one row per baselined file and runs no migration SQL
- [ ] Each row stores the filename and a checksum of the file contents at baseline
- [ ] Staging and production each get their own applied list from their own database connection
- [ ] A SQL file in the enabling release that is not on the baseline list fails the deploy before containers are recreated
- [ ] Scripts outside the migrations folder are not recorded and are not executed
- [ ] After a successful apply step, Prisma client generation still runs
- [ ] Authoring guidance matches the runner rules for files added after this release

## How to test

1. Point the apply step at a scratch database that already matches today’s schema (or at staging only after the parity gate is confirmed).
2. Run the deploy apply step with the baseline list and the current migration files.
3. Expect one applied row per baselined file, with checksums, and no schema change from this run (a historical drop or rename script must not execute).
4. Add a SQL file that is not on the baseline list and run the step again against a database that has no applied list.
5. Expect a failure, no applied rows for that extra file, and no container recreate.
6. Confirm a one-off script outside the migrations folder is absent from the applied list.
