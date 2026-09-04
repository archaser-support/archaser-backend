# 01 — Process doc and rules

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1, 8, 11, 12, 13, 20, 21, 22, 26, 28, 29, 36, 41, 43, 48, 49
**PRD:** `.cursor/plans/clickup-git-workflow.prd.md`

## What to build

Publish the human-readable source of truth for the ClickUp ↔ Git workflow and point project rules at it. Cover full path, short path, branch naming, primary-repo selection, multi-repo same-name branches, one PR per task per repo, oversized-PR split rule, ClickUp durable summary policy (not full PRD mirror), status ladder through `move to staging`, human-owned `done`, and `.scratch/` remaining ignored optional workspace.

This slice is documentation and rules only — no new orchestrator skill yet.

## Acceptance criteria

- [x] Process doc exists and matches the PRD decision log (full path, short path, interrupt/park, status map, primary repo, branch name format)
- [x] `.cursorrules` (and frontend mirror if required by project convention) points to the process and does not contradict it
- [x] ClickUp workspace/list/assignee IDs remain centralized — not duplicated as a second hard-coded source inside the new doc beyond “read from rules”
- [x] Doc states slices are commit-able under `.cursor/plans/<feature-slug>/issues/` and `.scratch/` stays gitignored

## How to test

1. Open the new process doc and `.cursorrules` workflow pointers.
2. Confirm a new teammate could follow full path and short path without reading the grill chat.
3. Confirm status names match existing ARchaser list statuses (including `techincal design` spelling as on the board).
4. Confirm the doc says `done` is human-after-deploy, not merge.
