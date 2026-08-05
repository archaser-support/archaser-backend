---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable issues as local markdown files under `.scratch/` using tracer-bullet vertical slices.
disable-model-invocation: true
---

# To Issues

Break a plan into independently-grabbable issues using vertical slices (tracer bullets).

**Issue tracker:** Local markdown under `.scratch/` — see `docs/agents/issue-tracker.md` (and `.cursorrules` → **Local issue tracker**). Do **not** create ClickUp tasks from this skill.

## Process

### 1. Gather context

Work from whatever is already in the conversation context. If the user passes an issue reference (path under `.scratch/`, or feature slug), fetch it by reading the file(s) and any sibling issues in that feature directory.

If the source is a repo plan (`.cursor/plans/*.plan.md` or `*.prd.md`), read it in full. Derive `<feature-slug>` from the plan/PRD filename (e.g. `plugin-configurator-rebrand.plan.md` → `plugin-configurator-rebrand`).

### 2. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Issue titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 3. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>

- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Any prefactoring should be done first

</vertical-slice-rules>

### 4. Pre-flight — avoid duplicate breakdowns

If `.scratch/<feature-slug>/issues/` already has markdown files for this feature, **stop publishing** and return in chat what you found (paths and titles). Do not blindly duplicate. The user can re-run `/to-issues` with explicit instructions if they want updates or missing slices only.

### 5. Present breakdown and publish

Treat the drafted breakdown as **automatically approved** — do not ask the user to confirm granularity, dependencies, or merges/splits. Proceed straight to publishing unless the user explicitly asked to review first (e.g. "draft issues but don't publish").

While publishing, briefly list the slices in chat for the user's record. For each slice, show:

- **Title**: short descriptive name
- **Path**: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- **Blocked by**: which other slices (if any) must complete first
- **User stories covered**: which user stories this addresses (if the source material has them)

#### Publish to `.scratch/`

1. Ensure `.scratch/<feature-slug>/` exists. If a PRD already lives at `.cursor/plans/<feature-slug>.prd.md` (or `*_prd.plan.md` / `*.plan.md`), link it from each issue's **Parent** section (repo-relative path). Plans stay in `.cursor/plans/`; issues live only under `.scratch/`.
2. Create `.scratch/<feature-slug>/issues/` if needed.
3. Write each slice as `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, in dependency order (blockers first) so **Blocked by** can reference real paths.
4. Set triage state with a `Status:` line near the top using the AFK-ready label from `docs/agents/triage-labels.md` (`ready-for-agent`).
5. Include a short **How to test** section (same expectation as ClickUp tasks in `.cursorrules`).
6. Sync a summary table into the source plan under `## Issues (vertical slices)` when a plan/PRD path exists:

```markdown
## Issues (vertical slices)

Tracer-bullet breakdown published under `.scratch/<feature-slug>/issues/`. Implement in dependency order; start a **fresh session per issue**.

| # | Title | Path | Blocked by | User stories |
|---|-------|------|------------|--------------|
| 1 | … | `.scratch/<feature-slug>/issues/01-….md` | — | … |
```

7. Return the same summary table in chat.

Do NOT close or modify any parent ClickUp task. Do **not** call ClickUp MCP from this skill.

<issue-template>
```markdown
Status: ready-for-agent

# <Title>

## Parent

PRD/plan: `.cursor/plans/<feature-slug>.prd.md` (or `.plan.md`) — omit if none

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

Avoid specific file paths or code snippets — they go stale fast. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it here and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## How to test

Concrete steps: where to go in the portal or gateway, what to do, and what to expect.

## Blocked by

- `.scratch/<feature-slug>/issues/<NN>-<slug>.md` (if any)

Or "None — can start immediately" if no blockers.
```
</issue-template>
