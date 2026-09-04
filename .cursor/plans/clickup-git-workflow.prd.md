---
name: clickup-git-workflow
overview: Standardize how requirements and bugs move from ClickUp through grilling, PRD, commit-able slices, GitHub branches, and PRs to staging.
source: grill-me session (ClickUp + Git work process)
clickup_task_url: null
isProject: false
---

# ClickUp and Git work workflow

## Problem Statement

Work arrives in two ways: an existing ClickUp task, or something a developer notices while already coding another task. Today those paths are inconsistent. Planning artifacts (PRDs and vertical slices) can land on the wrong branch, slices under `.scratch/` never reach GitHub because that folder is gitignored, ClickUp tasks can lose meaning when a PRD file is deleted, and there is no single agent entry point that ties ClickUp status, branch naming, and the existing grill → PRD → slices skills together. Developers need one repeatable process so every shippable change has a ClickUp home, a unique GitHub branch, durable acceptance text on the ticket, and a clean pull request to `staging`.

## Solution

Introduce a documented ClickUp ↔ Git workflow and an orchestrator skill that runs it. Every piece of work starts as a ClickUp task. Non-trivial work is grilled, then a unique branch is created from latest `staging` before the PRD and slices are written. Planning files are committed and pushed immediately under `.cursor/plans/`. ClickUp stays light but durable (summary, How to test, links). Tiny obvious fixes may take a short path that skips grill, PRD, and slices. When the developer is ready, they merge latest `staging` into the feature branch and open a ready-for-review pull request per affected repo. Agent-driven status updates stop at `move to staging` after merge; humans move the task to `done` after deploy or final acceptance.

**Primary seam (confirm):** one orchestrator skill (proposed name `/start-work`) that coordinates ClickUp create/update, git branch setup, and calls into existing `/grill-me`, `/to-prd`, and `/to-issues` behaviors — plus a short human process doc. Prefer extending those skills over inventing parallel trackers.

## User Stories

1. As a developer, I want every requirement or bug to start as a ClickUp task, so that work is visible to the team before design or coding starts.
2. As a developer, I want to create a ClickUp task from Cursor when I notice a bug mid-feature, so that I do not lose the finding or mix it into the wrong branch.
3. As a developer, I want the agent to create that ClickUp task only when I ask, so that the agent does not spam tickets for every observation.
4. As a developer, I want to create ClickUp tasks by hand in the ClickUp UI when I am not in Cursor, so that intake still works offline from the agent.
5. As a developer, I want to run a grilling session against the ClickUp task, so that scope and decisions are locked before branching and writing a PRD.
6. As a developer, I want the unique GitHub branch created only after grilling and before writing the PRD, so that we do not leave empty branches during open-ended design.
7. As a developer, I want that branch created from the latest `staging`, so that planning and code start from current integration.
8. As a developer, I want the branch name to follow `{type}/CU-{taskId}-{short-slug}`, so that ClickUp and humans can link the branch to the task.
9. As a developer, I want the same branch name used in every repo I touch, so that a multi-repo change stays identifiable as one ClickUp task.
10. As a developer, I want the branch created immediately only in the primary repo, so that unused repos do not get empty branches.
11. As a developer, I want frontend-only work to use `archaser-frontend` as the primary repo, so that PRD and slices live next to the code that changes.
12. As a developer, I want backend-default primary for mixed or backend-heavy work, so that shared skills and plans stay in the usual home.
13. As a developer, I want tests-only work to use the `tests` repo as primary, so that harness-only tasks do not force a fake backend branch.
14. As a developer, I want sibling repo branches created only when I first change files there, still from latest `staging`, so that lazy multi-repo setup stays correct.
15. As a developer, I want `/to-prd` to write the PRD onto the new branch under `.cursor/plans/`, so that the design artifact ships with the change.
16. As a developer, I want vertical slices committed under `.cursor/plans/<feature-slug>/issues/`, so that slices are on GitHub despite `.scratch/` being gitignored.
17. As a developer, I want `/to-issues` updated to write those commit-able slice paths, so that agents do not publish only to an ignored folder.
18. As a developer, I want planning files committed and pushed as soon as they are written, so that later sessions and teammates can see the plan on the branch.
19. As a developer, I want coding commits to continue on the same branch after planning is pushed, so that one branch still maps to one ClickUp task.
20. As a developer, I want all slices for one ClickUp task to land in one pull request per repo, so that review and merge stay simple.
21. As a developer, I want a rule to split into a new ClickUp task when a PR becomes too large, so that “one PR per task” does not force unreviewable diffs.
22. As a developer, I want a short path for tiny obvious fixes (ClickUp + branch + fix + PR), so that process overhead does not exceed the fix.
23. As a developer, I want unclear or growing short-path work to upgrade to the full grill → PRD → slices path, so that hard problems still get designed.
24. As a developer, I want to park current WIP with a stash or WIP commit before starting a newly found task, so that I do not lose in-progress work.
25. As a developer, I want the new task’s branch created from fresh `staging`, not from the parked feature branch, so that unrelated concerns stay isolated.
26. As a product owner or teammate, I want ClickUp to hold a short durable summary and How to test after the PRD exists, so that the ticket still makes sense if the PRD file is deleted later.
27. As a teammate, I want ClickUp to link the branch early and the PR when opened, so that navigation does not depend on a fragile file-path link alone.
28. As a teammate, I do not want the full PRD pasted into ClickUp, so that we avoid two drifting sources of truth.
29. As a developer, I want ClickUp status updated on a fixed ladder using existing ARchaser statuses only, so that the board reflects real progress.
30. As a developer, I want new full-path tasks to start in `requirement definition`, so that design work is visible before development.
31. As a developer, I want status `techincal design` while grilling completes and the PRD is written, so that design-in-progress is distinct from coding.
32. As a developer, I want status `selected for development` when PRD and slices are pushed on the branch, so that ready-to-build work is clear.
33. As a developer, I want status `in progress` when coding starts, so that active implementation is visible.
34. As a developer, I want status `pending internal` when the ready-for-review PR is opened, so that review is visible on the board.
35. As a developer, I want status `move to staging` when the PR merges to `staging`, so that the agent/dev pipeline has a clear end state.
36. As a QA or release owner, I want `done` set only after deploy or final acceptance by a human, so that merge to staging is not mistaken for fully finished.
37. As a developer on a short-path fix, I want to skip early design statuses and jump from `selected for development` through `in progress`, `pending internal`, and `move to staging`, so that tiny fixes still update the board honestly.
38. As a developer, I want the pull request opened only when work is ready for review, so that draft planning-only PRs do not clutter the queue.
39. As a developer, I want to merge latest `staging` into the feature branch before opening or refreshing the ready PR, so that conflicts are handled without default rebases or force-pushes.
40. As a developer, I want one orchestrator skill that walks this ladder and calls existing skills, so that I do not remember every manual step.
41. As a developer, I want a short human-readable process doc next to the skill, so that the team can follow the same rules without Cursor.
42. As a developer, I want ask-matt / skill routing to mention the new orchestrator on the main idea → ship flow, so that the process is discoverable.
43. As a developer, I want ClickUp project config (workspace, list, assignees) to stay centralized in existing rules, so that skills do not hardcode duplicate IDs.
44. As a developer, I want the PR description to include How to test and a link to the ClickUp task, so that reviewers can verify without hunting.
45. As a developer, I want the durable ClickUp summary written when the PRD is ready, so that the ticket is useful even before code lands.
46. As an agent, I want to refuse mixing a newly found bug into the current feature branch, so that branch ↔ task uniqueness is preserved.
47. As a developer, I want frontend and backend (and tests when needed) PRs all linked on the same ClickUp task, so that multi-repo delivery is trackable as one unit of work.
48. As a developer, I want local `.scratch/` to remain available as an optional ignored workspace, so that temporary notes do not pollute git.
49. As a teammate reviewing history months later, I want the ClickUp task to still explain what shipped and how to verify it, so that deleted plan files do not erase institutional memory.
50. As a developer, I want the orchestrator to stop after planning push or after PR creation according to the skill’s defined phases, so that implementation can still use fresh sessions per slice when desired.

## Implementation Decisions

- **Packaging:** Ship a new orchestrator skill (working name `/start-work` or `/work-from-clickup`) plus a short process document under the repo’s agent docs. Update `.cursorrules` ClickUp / workflow pointers to match. Do not replace `/grill-me`, `/to-prd`, or `/to-issues` — orchestrate and extend them.
- **Intake:** Always require a ClickUp task before grilling or short-path coding. Agent may create the task on explicit request (title, short description, How to test, correct initial status). Humans may create tasks in ClickUp directly.
- **Full path order:** ClickUp task → grill → create branch from latest `staging` → PRD → slices → commit/push planning → durable ClickUp summary + links → implement on same branch → merge `staging` into branch → open ready PR(s) → update ClickUp → on merge set `move to staging`.
- **Short path:** Allowed only for tiny obvious fixes. Steps: ClickUp → branch from `staging` → fix → merge `staging` if needed → ready PR → same later statuses. If scope becomes unclear or grows, upgrade to the full path.
- **Branch naming:** `{type}/CU-{taskId}-{short-slug}` in every touched repo.
- **Primary repo:** Default `archaser-backend`. Frontend-only → `archaser-frontend`. Tests-only → `tests`. PRD and commit-able slices always live in the primary repo for that task.
- **Multi-repo:** Same branch name when a second repo is first touched; one PR per affected repo; all PR links on the ClickUp task.
- **PR granularity:** One PR per ClickUp task per repo containing all slices. If the change set is too large to review, create a new ClickUp task (and branch) rather than stacking many PRs under one task by default.
- **Planning location:** PRD at `.cursor/plans/<feature-slug>.prd.md`. Slices at `.cursor/plans/<feature-slug>/issues/<NN>-<slug>.md` (and overview when 2+ slices). Update `/to-issues` accordingly. Keep `.scratch/` gitignored as optional local workspace only.
- **ClickUp content policy:** After PRD, update ClickUp with a short durable summary (problem, decided behavior, out of scope highlights, How to test). Link branch URL when pushed; replace/add PR URL(s) when opened. Do not mirror the full PRD body into ClickUp. Repo PRD remains the working design doc during build; ClickUp remains the durable human ticket.
- **Status map (existing ARchaser statuses only):**
  - Full path create / pre-grill: `requirement definition`
  - Grill done / writing PRD: `techincal design` (existing spelling on the board)
  - PRD + slices pushed: `selected for development`
  - Coding started: `in progress`
  - Ready PR opened: `pending internal`
  - Merged to `staging`: `move to staging`
  - `done`: human only after deploy or final acceptance (not automatic on merge)
  - Short path may start at `selected for development` and then follow `in progress` → `pending internal` → `move to staging`
- **PR timing:** Do not open a draft PR for planning-only commits by default. Open when ready for review. ClickUp carries the branch link in the meantime.
- **Git sync:** Before ready PR, merge latest `staging` into the feature branch. Default is merge, not rebase/force-push.
- **Mid-task discovery:** Park current branch (stash or WIP commit) → create/use new ClickUp task → new branch from fresh `staging` → continue full or short path. Never commit the new concern onto the parked branch.
- **Config centralization:** Continue to read ClickUp workspace/list/assignee defaults from existing project rules; skills must not duplicate those IDs as a second source of truth.
- **Orchestrator phases:** Minimum viable orchestrator covers intake through planning push and status/summary sync. Opening the ready PR and post-merge status update should be supported as explicit later phases or companion commands, without forcing all implementation into one chat if the team still uses fresh sessions per slice.
- **ask-matt / routing:** Document the orchestrator as the on-ramp that binds ClickUp + git to the existing grill → PRD → issues main flow.

## Testing Decisions

- Prefer behavior-level checks of the workflow, not internal skill prose snapshots.
- Highest useful seam: run the orchestrator (or its documented checklist) against a throwaway ClickUp task and verify observable outcomes — task fields/status, branch name, files present under `.cursor/plans/`, git history on the branch, and PR linkage — without asserting on private helper structure.
- Manual How to test for the process itself: create a sample requirement, walk full path to a draft planning push, confirm ClickUp summary and statuses; create a tiny typo-style task and walk short path; simulate mid-feature discovery and confirm parking + new branch from `staging`.
- Do not add automated unit tests unless explicitly requested later. If tests are requested, prefer thin integration checks around path helpers (e.g. slice output directory resolution) rather than mocking the whole ClickUp MCP.
- Prior art: existing skill docs (`to-prd`, `to-issues`, `grill-me`) and `.cursorrules` ClickUp conventions; no dedicated workflow test suite exists today.

## Out of Scope

- Automatically setting ClickUp to `done` on merge or deploy
- Changing or renaming ClickUp board statuses (including fixing the existing `techincal design` spelling)
- Requiring rebase workflows or force-push as the default update strategy
- Merging the three Git repos into a monorepo
- Replacing local vertical-slice practice with ClickUp subtasks for every slice
- Auto-creating ClickUp tasks without an explicit developer request
- Full PRD body mirroring into ClickUp
- Mandatory draft PRs at planning push time
- One pull request per slice or stacked-PR machinery as the default
- ClickUp GitHub integration admin setup beyond branch-name conventions
- Automatic deletion or archival policy for old PRD files (durability is handled via ClickUp summary)
- Expanding `/implement-next` in this PRD (may consume the new slice paths later, but is not required to ship the workflow)

## Further Notes

- Grilling decision log D1–D18 is the authority for this PRD; if skill text conflicts with older “ClickUp is ad-hoc only” wording, update those skills/rules to the new split: ClickUp = human ticket + status + durable summary; `.cursor/plans/` = PRD + commit-able slices; `.scratch/` = optional ignored workspace.
- Best-practice watch-outs called out during grilling: keep the short path real; split oversized PRs into new ClickUp tasks; do not half-migrate `/to-issues` while D9 still expects slices on GitHub.
- Suggested follow-up after this PRD: run `/to-issues` to publish vertical slices for skill, docs, `/to-issues` path migration, and rules updates.

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/clickup-git-workflow/` (per this PRD — not `.scratch/`). **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/clickup-git-workflow/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Process doc and rules | `issues/01-process-doc-and-rules.md` | — | 1, 8, 11–13, 20–22, 26, 28–29, 36, 41, 43, 48–49 |
| 2 | Commit-able slice paths | `issues/02-commit-able-slice-paths.md` | 01 | 16–18, 48 |
| 3 | Durable ClickUp summary after PRD | `issues/03-durable-clickup-summary-after-prd.md` | 01 | 15, 26–28, 45, 49 |
| 4 | `/start-work` full path through planning push | `issues/04-start-work-full-path-to-planning-push.md` | 01, 02, 03 | 1, 3, 5–14, 18–19, 29–32, 40, 43, 50 |
| 5 | Short path, interrupt, ready PR, and discovery | `issues/05-short-path-interrupt-and-ready-pr.md` | 04 | 2, 22–25, 33–39, 42, 44, 46–47 |

**Status:** `ready-for-agent` on all slices.
