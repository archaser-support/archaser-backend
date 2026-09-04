# Archaser — Agent instructions

## Agent skills

### Issue tracker

**ClickUp** is the human ticket (status, durable summary, How to test, branch/PR links). **`/to-issues` vertical slices** are commit-able markdown under `.cursor/plans/<feature-slug>/issues/`. PRDs stay at `.cursor/plans/<feature-slug>.prd.md`. `.scratch/` remains gitignored optional workspace. See `docs/agents/clickup-git-workflow.md` and `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles map to `**Status:**` on `.cursor/plans/` issue files (and to ClickUp statuses for human tickets). See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context** — `CONTEXT.md` and `docs/adr/` at the repo root when they exist. See `docs/agents/domain.md`.

### ClickUp ↔ Git workflow

Full path, short path, interrupt/park, ready-PR, post-merge, branch naming, primary repo, and status ladder: `docs/agents/clickup-git-workflow.md`. Orchestrator: `/start-work` (`.agents/skills/start-work/SKILL.md`) — planning push through ready PR / `move to staging` (never auto-`done`). Discoverable via `/ask-matt`.
