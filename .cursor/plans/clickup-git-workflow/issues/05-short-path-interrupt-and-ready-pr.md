# 05 — Short path, interrupt, ready PR, and discovery

**Status:** done
**Priority:** normal
**Blocked by:** [04-start-work-full-path-to-planning-push](04-start-work-full-path-to-planning-push.md)
**User stories:** 2, 22, 23, 24, 25, 33, 34, 35, 36, 37, 38, 39, 42, 44, 46, 47
**PRD:** `.cursor/plans/clickup-git-workflow.prd.md`

## What to build

Extend `/start-work` (and ask-matt / skill routing) with: **short path** for tiny obvious fixes; **mid-task interrupt** (park WIP, new ClickUp task on ask, new branch from fresh `staging`, refuse mixing into the old branch); **ready-PR phase** (merge latest `staging` into feature branch, open ready-for-review PR per touched repo with How to test + ClickUp link, set `pending internal`, link PRs on ClickUp); **post-merge** status `move to staging` (never auto-`done`); upgrade short path to full path when scope grows. Wire ask-matt (or equivalent router) so the orchestrator is discoverable on the idea → ship flow.

## Acceptance criteria

- [ ] Short path skips grill/PRD/slices but still uses ClickUp + named branch + ready PR rules
- [ ] Interrupt flow parks current work and branches from `staging`, not from the parked feature branch
- [ ] Ready PR is not opened for planning-only commits by default
- [ ] Before ready PR, merge `staging` into the feature branch (no rebase/force-push default)
- [ ] Multi-repo PRs use the same branch name and are linked on the ClickUp task
- [ ] Status updates: coding → `in progress`; PR open → `pending internal`; merge → `move to staging`; `done` remains human
- [ ] ask-matt (or router) mentions `/start-work`

## How to test

1. Short path: ask `/start-work` for a tiny disposable fix; confirm no PRD/slices requirement and statuses jump appropriately through PR open.
2. Interrupt: with dirty WIP on another branch, ask to log a new bug; confirm park guidance, new task/branch from `staging`, and no commits mixed onto the old branch.
3. Ready PR phase: on a branch with planning + a trivial commit, run the ready-PR phase; confirm `staging` was merged in, PR is ready-for-review (not draft-by-default), ClickUp linked, status `pending internal`.
4. Confirm ask-matt lists the orchestrator.
5. Confirm the skill never sets `done` automatically on merge.
