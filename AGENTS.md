# Archaser — Agent instructions

## Agent skills

### Issue tracker

**`/to-issues` vertical slices** live as local markdown under `.scratch/<feature-slug>/`. PRDs/plans stay in `.cursor/plans/`. ClickUp is for ad-hoc human workflow only. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage roles map to `**Status:**` on `.scratch/` issue files (and to ClickUp statuses for ad-hoc ClickUp tasks). See `docs/agents/triage-labels.md`.

### Domain docs

**Single-context** — `CONTEXT.md` and `docs/adr/` at the repo root when they exist. See `docs/agents/domain.md`.
