# 03 — Durable ClickUp summary after PRD

**Status:** done
**Priority:** normal
**Blocked by:** [01-process-doc-and-rules](01-process-doc-and-rules.md)
**User stories:** 15, 26, 27, 28, 45, 49
**PRD:** `.cursor/plans/clickup-git-workflow.prd.md`

## What to build

Extend `/to-prd` (and any thin helper instructions it needs) so that when a PRD is tied to an existing ClickUp task, the agent updates ClickUp with a short durable summary and How to test, links the branch when known, and does **not** paste the full PRD body. Keep `clickup_task_url` in PRD frontmatter as the link field. Align wording with the process doc from slice 01.

## Acceptance criteria

- [ ] `/to-prd` instructs durable light sync when `clickup_task_url` is set (or when the orchestrator/session provides a task)
- [ ] Sync content is summary + How to test + links — not full PRD mirror
- [ ] Skill still does not create ClickUp tasks by itself (creation stays orchestrator / explicit ask)
- [ ] Behavior matches the process doc’s ClickUp content policy

## How to test

1. Point a sample PRD at an existing disposable ClickUp task URL.
2. Run `/to-prd` (or the updated sync step) and open the ClickUp task.
3. Expect a short summary and How to test present; expect the full PRD body is not dumped into the description.
4. Expect branch link present when a branch URL was available in context.
