# Issue tracker (vertical slices)

Where `/to-issues` publishes work for agents. This is **not** a second product tracker — ClickUp remains the human ticket. Full process: `docs/agents/clickup-git-workflow.md`. Path defaults also live under **Local issue tracker** in `.cursorrules`.

## Surfaces

| Surface | Role |
|---------|------|
| **ClickUp** | Human ticket: status ladder, durable summary, How to test, branch/PR links |
| **`.cursor/plans/`** | PRD + **commit-able** vertical slices (git-trackable) |
| **`.scratch/`** | Optional **gitignored** local workspace only — never the default slice home |

## `/to-issues` conventions

| Key | Path |
|-----|------|
| Feature root | `.cursor/plans/<feature-slug>/` |
| Slice files | `.cursor/plans/<feature-slug>/issues/<NN>-<slug>.md` (from `01`) |
| Overview (2+ slices) | `.cursor/plans/<feature-slug>/OVERVIEW.md` |
| PRD | `.cursor/plans/<feature-slug>.prd.md` |
| Default status | `ready-for-agent` (see `docs/agents/triage-labels.md`) |

Every slice file must include a short **How to test** section.

Do **not** call ClickUp MCP from `/to-issues`. Durable ClickUp summary sync after a PRD is **`/to-prd`**’s job when `clickup_task_url` (or a session task) is set — see `docs/agents/clickup-git-workflow.md` and `.agents/skills/to-prd/SKILL.md`. Skill source of truth for slices: `.agents/skills/to-issues/SKILL.md` (frontend points at the backend skill; do not duplicate the skill body).

## Pre-flight / duplicates

Before publishing a new breakdown, check `.cursor/plans/<feature-slug>/issues/` (and the plan’s `## Issues (vertical slices)` section). Do not only look under `.scratch/`.
