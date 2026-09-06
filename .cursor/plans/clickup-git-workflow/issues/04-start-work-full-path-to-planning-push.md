# 04 — `/start-work` full path through planning push

**Status:** done
**Priority:** high
**Blocked by:** [01-process-doc-and-rules](01-process-doc-and-rules.md), [02-commit-able-slice-paths](02-commit-able-slice-paths.md), [03-durable-clickup-summary-after-prd](03-durable-clickup-summary-after-prd.md)
**User stories:** 1, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18, 19, 29, 30, 31, 32, 40, 43, 50
**PRD:** `.cursor/plans/clickup-git-workflow.prd.md`

## What to build

Add the orchestrator skill (working name `/start-work`) for the **full path** through planning push: ensure/create ClickUp task on explicit ask → drive/resume grill → after grill create `{type}/CU-{taskId}-{short-slug}` from latest `staging` in the primary repo only → run `/to-prd` and `/to-issues` on that branch → commit/push planning → durable ClickUp summary + branch link → set statuses through `requirement definition` → `techincal design` → `selected for development`. Stop after planning push so implementation can use fresh sessions. Do not invent a second tracker; call existing skills.

## Acceptance criteria

- [ ] Skill exists and is invocable; description covers full-path phases through planning push
- [ ] Branch naming and primary-repo rules match the process doc
- [ ] Sibling repos are not branched until touched
- [ ] Planning files are committed and pushed under `.cursor/plans/`
- [ ] ClickUp status ladder for this phase is applied with existing status names only
- [ ] Skill reads ClickUp config from centralized rules (no duplicate ID source of truth)
- [ ] Orchestrator stops after planning push (does not force full implementation in the same chat)

## How to test

1. Create or pick a disposable ClickUp task; run `/start-work` full path in a clean git state.
2. After grill, confirm branch name format and that it was created from `staging` in the primary repo only.
3. Confirm PRD + slices exist under `.cursor/plans/`, are pushed, and ClickUp has summary + branch link.
4. Confirm statuses moved at least to `selected for development` and the skill stopped without opening a PR.
