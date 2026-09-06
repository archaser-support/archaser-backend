# 02 — Commit-able slice paths

**Status:** done
**Priority:** high
**Blocked by:** [01-process-doc-and-rules](01-process-doc-and-rules.md)
**User stories:** 16, 17, 18, 48
**PRD:** `.cursor/plans/clickup-git-workflow.prd.md`

## What to build

Change `/to-issues` (and related local-tracker wording in rules) so vertical slices publish under `.cursor/plans/<feature-slug>/issues/` (with `OVERVIEW.md` for 2+ slices), remain git-trackable, and keep `.scratch/` as an optional ignored workspace only. Update pre-flight duplicate detection and plan sync text to the new paths. Mirror skill/rules updates wherever frontend copies shared skill pointers if the project keeps them in sync.

## Acceptance criteria

- [x] `/to-issues` writes new breakdowns under `.cursor/plans/<feature-slug>/` by default
- [x] Pre-flight checks the new location (and does not only look under `.scratch/`)
- [x] Plan `## Issues (vertical slices)` sync references the new paths
- [x] `.scratch/` remains gitignored; no requirement to commit ignored scratch files
- [x] Process/rules from slice 01 stay consistent with the new default path

## How to test

1. Run `/to-issues` against a tiny throwaway plan slug (or dry-read the skill and confirm path constants).
2. Confirm slice files appear under `.cursor/plans/<slug>/issues/` and show up in `git status` (not ignored).
3. Confirm `.scratch/` is still ignored.
4. Confirm re-running `/to-issues` for the same slug detects the existing breakdown in the new location.
