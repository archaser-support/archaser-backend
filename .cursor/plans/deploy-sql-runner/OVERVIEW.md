# Deploy SQL runner

On staging and production deploy, record SQL files that already ran by hand, then apply only new dated files before the new app starts. Each environment uses its own database and its own applied list.

**PRD:** `.cursor/plans/deploy-sql-runner.prd.md`

Vertical slices live in `issues/`. Implement in dependency order. Start a fresh session per issue.

**Blocking gate (before slice 01 on a shared database):** staging and production must already contain every change in today’s migration files. Apply any missing file by hand on the lagging database, then baseline.
