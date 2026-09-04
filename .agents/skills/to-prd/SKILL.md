---
name: to-prd
description: Turn the current conversation into a PRD file in .cursor/plans/ — no interview, no tracker issues. When the PRD is tied to an existing ClickUp task, also apply a short durable ClickUp summary (not a full PRD mirror). Use /to-issues to break the PRD into commit-able slices under .cursor/plans/<feature-slug>/.
disable-model-invocation: true
---

# To PRD

This skill takes the current conversation context and codebase understanding and produces a **PRD file in the repo**. Do NOT interview the user — just synthesize what you already know.

**Do NOT create ClickUp tasks, vertical-slice files, or any other tracker tasks.** Task creation stays with the orchestrator or an explicit user ask. Issue breakdown is **`/to-issues`** only (publishes under `.cursor/plans/<feature-slug>/`).

**ClickUp config** (workspace / list / assignee / MCP server name): read from **ClickUp Integration** in `.cursorrules`. Do not hardcode those IDs in this skill. Process contract: `docs/agents/clickup-git-workflow.md` (**ClickUp durable summary policy**).

## Process

1. Explore the repo to understand the current state of the codebase, if you haven't already. Use the project's domain glossary vocabulary throughout the PRD, and respect any ADRs in the area you're touching.

2. Sketch out the seams at which you're going to test the feature. Existing seams should be preferred to new ones. Use the highest seam possible. If new seams are needed, propose them at the highest point you can. The fewer seams across the codebase, the better - the ideal number is one.

   Check with the user that these seams match their expectations.

3. Write the PRD using the template below and **save it to the workspace** at:

   **`.cursor/plans/<feature-slug>.prd.md`**

   - Use a short kebab-case slug derived from the feature name (e.g. `customer-dashboard-no-policy-ux`).
   - If a PRD for the same feature already exists, **update that file** instead of creating a duplicate.
   - Include YAML frontmatter (see **PRD file format** below).
   - Return the repo-relative path in chat so the user can open it.

4. Validate the completed PRD before returning:

   - Add one H1 title immediately after the YAML frontmatter. Body sections start at H2.
   - Do not use raw HTML or angle-bracket placeholders in generated Markdown.
   - Run Markdown diagnostics on the PRD and fix every warning or error introduced by generation.

5. **Durable ClickUp light sync** (only when a task is already known — see below). Then **stop**.

   - Do **not** write slice files, call `gh issue create`, or create ClickUp tasks.
   - Tell the user to run **`/to-issues`** when they want vertical slices published under `.cursor/plans/<feature-slug>/issues/`.

## Durable ClickUp light sync

After the PRD file is written, if the PRD is tied to an **existing** ClickUp task, update that task with a **short durable summary** — not a full PRD mirror. Align with **ClickUp durable summary policy** in `docs/agents/clickup-git-workflow.md`.

### When to sync

Run the sync when **any** of these is true:

- Frontmatter `clickup_task_url` is a non-null ClickUp task URL, or
- The orchestrator / session already provided a ClickUp task URL or task id for this work

If neither is present, **skip ClickUp entirely** (write the PRD only). Do **not** create a task to populate `clickup_task_url`.

When the session provided a task but frontmatter still has `clickup_task_url: null`, set `clickup_task_url` to that task’s URL before finishing.

### What to write on the task

Update the ClickUp task description (prefer `markdown_description`) with a **short** durable body that includes:

- **Problem** — one short paragraph from the PRD Problem Statement
- **Decided behavior** — brief bullets from Solution / key Implementation Decisions (outcomes only)
- **Out of scope** — highlights only, not the full Out of Scope section
- **How to test** — concrete steps (where to go, what to do, what to expect), synthesized from Testing Decisions / seams / How to test already known in the session
- **Links** — branch URL when a branch URL (or pushed remote branch) is already known in context; PR URL(s) only if already opened and known

**Do not** paste the full PRD body, user-story list, or Implementation Decisions dump into ClickUp. The repo PRD remains the working design doc; ClickUp remains the durable human ticket if plan files are later deleted.

### How to sync (MCP)

Use the project’s ClickUp MCP from `.cursorrules` (discover tools before calling):

- Resolve the task id from `clickup_task_url` or the session-provided id
- Update the task description with the short durable summary + How to test
- Add or refresh the **branch** link on the task when a branch URL is known (do not invent a URL)
- Do **not** call create-task tools from this skill
- Do **not** advance the status ladder here (orchestrator / later phases own `selected for development` after planning push, etc.) unless the user explicitly asks in this session

If MCP is unavailable, leave the PRD on disk, report that ClickUp sync was skipped, and keep `clickup_task_url` set so a later pass can sync.

## PRD file format

Prepend YAML frontmatter, then the PRD body from the template:

```yaml
---
name: <feature-slug>
overview: <one-line summary>
source: <e.g. grill-me session, prototype handoff, in-chat spec>
clickup_task_url: null
isProject: false
---
```

Set `clickup_task_url` only when the PRD is explicitly tied to an **existing** ClickUp task (user-provided URL, or orchestrator/session task) — never create a task to populate this field. That field is the durable link from PRD → ClickUp for this skill’s light sync.

## PRD body template

Start the generated body with an H1 feature title, followed by these H2 sections:

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each user story should be in the format of:

1. As an [actor], I want a [feature], so that [benefit]

Example:

1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending

This list of user stories should be extremely extensive and cover all aspects of the feature.

## Implementation Decisions

A list of implementation decisions that were made. This can include:

- The modules that will be built/modified
- The interfaces of those modules that will be modified
- Technical clarifications from the developer
- Architectural decisions
- Schema changes
- API contracts
- Specific interactions

Do NOT include specific file paths or code snippets. They may end up being outdated very quickly.

Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline it within the relevant decision and note briefly that it came from a prototype. Trim to the decision-rich parts — not a working demo, just the important bits.

## Testing Decisions

A list of testing decisions that were made. Include:

- A description of what makes a good test (only test external behavior, not implementation details)
- Which modules will be tested
- Prior art for the tests (i.e. similar types of tests in the codebase)

## Out of Scope

A description of the things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.
