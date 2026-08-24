---
name: to-issues
description: Break a plan, spec, or PRD into independently-grabbable issues as local markdown files under `.scratch/` using tracer-bullet vertical slices. Does not create ClickUp tasks.
disable-model-invocation: true
---

# To Issues

Break a plan into independently-grabbable issues using vertical slices (tracer bullets).

Issues are published as **local markdown files** under `.scratch/<feature-slug>/`. Do **not** create ClickUp tasks or call the ClickUp MCP from this skill.

**Project config:** Read path conventions and status defaults from **Local issue tracker** in `.cursorrules` (and `docs/agents/issue-tracker.md`). Do not hardcode tracker IDs in this skill.

## File conventions (this skill)

Unless the user specifies otherwise:

- **Feature directory:** `.scratch/<feature-slug>/` — derive `<feature-slug>` from the plan/PRD filename (e.g. `policy-mep-reporting-cutoff-days.prd.md` → `policy-mep-reporting-cutoff-days`) or from an explicit slug the user provides.
- **Slice files:** `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` (zero-padded). `<slug>` is a short kebab-case title fragment.
- **Parent overview (2+ slices):** `.scratch/<feature-slug>/OVERVIEW.md` — what the feature delivers, link to the repo plan when one exists, note that vertical slices live under `issues/`.
- **Single slice:** one file under `issues/` only — no `OVERVIEW.md`.
- **How to test:** Every slice file must include a short **How to test** section.
- **PRD / plan link:** Every slice file must include a **PRD** (or plan) line near the top pointing to the source file in the repo (see **Issue body template**).
- **No approval quiz:** Draft slices from the plan and **publish directly** to markdown files. Do not ask the user to approve granularity, dependencies, or parent structure before writing files. Briefly summarize the breakdown in chat after publish.

### Slice file header

Each slice file starts with metadata lines (no YAML frontmatter required):

```markdown
# <NN> — <Title>

**Status:** ready-for-agent
**Priority:** high
**Time estimate:** 480 minutes
**Blocked by:** [01-foundation](01-foundation.md) *(omit when none)*
**User stories:** 1, 3 *(omit when N/A)*
**PRD:** `.cursor/plans/<feature-slug>.prd.md`
```

Use `—` for **Blocked by** when there are no hard blockers. Prefer `.prd.md` when both exist; otherwise the `.plan.md` path.

## Process

### 1. Gather context

Work from whatever is already in the conversation context.

If the source is a repo plan or PRD (`.cursor/plans/*.plan.md` or `.cursor/plans/*.prd.md`), read it in full. Note the path for sync in step 6.

If the user passes an existing issue file path or slice number, read that file and any siblings under the same `.scratch/<feature-slug>/issues/` directory.

### 2. Pre-flight — avoid duplicate breakdowns

Before drafting slices, check for an existing breakdown of the same feature:

- List `.scratch/<feature-slug>/issues/*.md` when the feature slug is known or inferable.
- Read the plan's `## Issues (vertical slices)` section when a matching plan exists.

If matching slice files or a populated summary table already exist, **stop publishing** and return in chat what you found (paths and titles). Do not blindly duplicate. Do **not** ask the user what to do — they can re-run `/to-issues` with explicit instructions if they want updates or missing slices only.

### 3. Explore the codebase (optional)

If you have not already explored the codebase, do so to understand the current state of the code. Issue titles and descriptions should use the project's domain glossary vocabulary, and respect ADRs in the area you're touching.

Look for opportunities to prefactor the code to make the implementation easier. "Make the change easy, then make the easy change."

### 4. Draft vertical slices

Break the plan into **tracer bullet** issues. Each issue is a thin vertical slice that cuts through ALL integration layers end-to-end, NOT a horizontal slice of one layer.

<vertical-slice-rules>

- Each slice delivers a narrow but COMPLETE path through every layer (schema, API, UI, tests)
- A completed slice is demoable or verifiable on its own
- Any prefactoring should be done first

</vertical-slice-rules>

### 5. Finalize breakdown (no approval gate)

Draft the vertical slices and **publish immediately** — do **not** use `AskQuestion` or chat prompts for tracker choices (parent title, merge/split, duplicates, etc.).

Apply defaults unless the **user already specified** an override in the same conversation (e.g. an explicit feature slug, “single slice only”, or a requested priority):

| Decision | Default |
|----------|---------|
| Feature slug | From plan/PRD filename |
| Parent overview (2+ slices) | Plan/PRD title as `OVERVIEW.md` heading |
| Status | `ready-for-agent` (see `docs/agents/triage-labels.md`) |
| Priority | Foundation / prefactor slices → `high`; follow-on slices → `normal` |
| Time estimate | Omit unless the PRD or plan already states estimates |
| Related links | Infer soft links from the PRD/plan; note in overview or slice — do not ask |

Before publishing, you may show a **short numbered breakdown** in chat (title, blocked-by, user stories) as part of the publish summary — not as a gate waiting for approval.

### 6. Publish the issues to markdown files

#### Resolve or create the parent overview

| Breakdown size | Parent behavior |
|----------------|-----------------|
| **1 slice** | No `OVERVIEW.md` — create one standalone slice file. |
| **2+ slices** | **Required:** `OVERVIEW.md` + one file per slice under `issues/`. |

**Parent source (2+ slices):**

1. **Existing `OVERVIEW.md`** under `.scratch/<feature-slug>/` → leave it unless this session is intentionally replacing the breakdown; do not rewrite unrelated content.
2. **Repo plan or in-chat spec only** → create `OVERVIEW.md` with:
   - Feature title (from plan heading or PRD)
   - Short overview: what the feature delivers
   - **PRD** / plan link (repo-relative path) when one exists
   - Note that vertical slices live in `issues/`

#### Create slice files

For each slice, write `.scratch/<feature-slug>/issues/<NN>-<slug>.md` using the slice header template and issue body template below.

Create the feature directory and `issues/` subdirectory as needed. Write `OVERVIEW.md` first when the breakdown has 2+ slices, then all slice files in dependency order (blockers first) so **Blocked by** can reference real filenames.

#### Dependency relationships

Record every **hard** blocker in the slice's **Blocked by** header, using markdown links to the blocking slice file(s):

```markdown
**Blocked by:** [01-foundation](01-foundation.md)
```

For multiple blockers, comma-separate the links.

**Soft ordering** (e.g. "validate after #3" but can start in parallel) does not go in **Blocked by**. Note it in acceptance criteria, **How to test**, or the plan sync table only.

#### Non-blocking links (optional)

Add a **Related** line in `OVERVIEW.md` or in a slice file when useful — prior art plans, related bugs, design references. These are context only, not sequencing constraints.

#### Publish order

1. Create `OVERVIEW.md` when breakdown has **2+ slices** and no suitable overview exists.
2. Create all slice files under `issues/`.
3. Sync the summary table into the repo plan under `## Issues (vertical slices)` (create the section if missing). Use **Waiting on** column for hard blockers; note soft ordering in italics. Example:

```markdown
## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under `.scratch/<feature-slug>/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.scratch/<feature-slug>/OVERVIEW.md` *(omit for single-slice breakdowns)*

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | … | `issues/01-….md` | — | … |

**Status:** `ready-for-agent` on all slices unless the user specified otherwise.
```

4. Return the same summary table in chat (include overview path when 2+ slices).

Do not delete or rewrite unrelated content in an existing plan file — only add or update the `## Issues (vertical slices)` section.

Do **not** call ClickUp MCP from this skill. ClickUp remains for ad-hoc human workflow outside `/to-issues` (see `.cursorrules`).

<issue-template>
**PRD:** `.cursor/plans/<feature-slug>.prd.md` *(or `.cursor/plans/<feature-slug>.plan.md` when no PRD)*

## What to build

A concise description of this vertical slice. Describe the end-to-end behavior, not layer-by-layer implementation.

Avoid specific file paths or code snippets in the body — they go stale fast. Exception: the **PRD** line in the header (required). Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it here and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## How to test

Concrete steps: where to go in the app, what to do, and what to expect.

</issue-template>
