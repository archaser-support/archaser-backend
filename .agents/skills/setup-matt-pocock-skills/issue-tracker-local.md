# Issue tracker: Local Markdown (Archaser)

Archaser publishes **commit-able** vertical slices under `.cursor/plans/`, not under `.scratch/`. ClickUp is the human ticket. See `docs/agents/issue-tracker.md` and `docs/agents/clickup-git-workflow.md`.

## Conventions

- PRD: `.cursor/plans/<feature-slug>.prd.md`
- Feature slice root: `.cursor/plans/<feature-slug>/`
- Implementation issues: `.cursor/plans/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Overview (2+ slices): `.cursor/plans/<feature-slug>/OVERVIEW.md`
- Triage state is a `Status:` line near the top of each issue file (see `docs/agents/triage-labels.md`)
- `.scratch/` remains optional **gitignored** workspace only — do not publish shippable slices there by default

## When a skill says "publish to the issue tracker" (`/to-issues`)

Create files under `.cursor/plans/<feature-slug>/` (creating directories as needed).

## When a skill says "fetch the relevant ticket"

For slices: read the file at the referenced `.cursor/plans/...` path. For human work tracking: use ClickUp (IDs from `.cursorrules`).
