---
name: implement-next
description: Orchestrate AFK implementation of `.scratch/<feature-slug>/issues/` slices in blocker order — claim, spawn a fresh agent per slice, run automated seam tests, flip Status, chain until blocked or done.
disable-model-invocation: true
argument-hint: "<feature-slug>"
---

# Implement Next

Drive vertical-slice issues under `.scratch/<feature-slug>/issues/` one at a time until the frontier is empty or a done gate fails.

**Tracker:** local markdown only — see `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`. Do **not** use ClickUp.

## Arguments

Require a **feature slug** (e.g. `ask-me-any-record`). Resolve issues at:

`.scratch/<feature-slug>/issues/<NN>-*.md`

If the user omitted the slug, stop and ask for it (do not invent a multi-feature queue).

## Locked behavior

| Rule | Behavior |
|------|----------|
| Chain | Keep going until no unblocked `ready-for-agent` issues remain (or stop on failure) |
| Isolation | **Fresh agent per slice** — this chat is the orchestrator; implementers are separate Task/subagents |
| Done gate | Automated seam tests green **and** `Status: done` |
| Tests | Automated only (Hub/unit, Apex if runnable locally). Skip live-org / Lightning UI steps; list them in the final report |
| Blockers | Trust each issue’s `## Blocked by` (not the PRD summary table) |
| Frontier order | One at a time; lowest `NN` first |
| Git | Do **not** commit or push unless the user explicitly asks in this chat |
| Repos | Implementers may edit **backend and portal** as the issue needs |
| Failure | Leave `Status: in-progress`, stop the chain, report |
| Resume | If any issue is `in-progress`, resume that issue (do not pick a different frontier item) |
| End | Stop and report only — no auto-commit, no auto-PR |

## Process

### 1. Load the queue

1. List `.scratch/<feature-slug>/issues/*.md`.
2. Read each file’s `Status:` line and `## Blocked by` section.
3. Build the set of paths whose Status is `done`.
4. An issue is **unblocked** when every Blocked-by path is `done` (or Blocked by is “None”).
5. **Frontier** = issues with `Status: ready-for-agent` that are unblocked.

Completion criterion: you can name every issue’s Status and whether it is blocked.

### 2. Choose the next slice

1. If **more than one** issue is `in-progress` → **stop** and ask the user which to keep; do not guess.
2. If **exactly one** is `in-progress` → that is the next slice (resume).
3. Else if frontier is empty:
   - If every issue is `done` → go to **End report** (success).
   - Else → go to **End report** (blocked / waiting); list what remains and why.
4. Else pick the frontier issue with the **lowest `NN`** prefix.

Completion criterion: exactly one issue path is selected, or you stopped for the user / ended.

### 3. Claim

Set the selected issue’s first line to:

```text
Status: in-progress
```

Do this **before** spawning the implementer.

### 4. Spawn a fresh implementer

Use the Task tool (`generalPurpose`) with a **new** agent. Do not implement the slice yourself in the orchestrator chat.

Give the implementer:

- Absolute or repo-relative path to the issue file
- Parent PRD/plan path from `## Parent` (read it if present)
- Instruction to satisfy **Acceptance criteria** and automated parts of **How to test**
- Permission to edit backend **and** portal when the slice needs both
- **Do not commit, push, or open a PR**
- Prefer TDD when adding behavior (`.cursor/skills/tdd/SKILL.md` if useful)
- Return a short result: what changed, suggested automated test commands, any blockers, leftover manual checks

Wait until the Task finishes before continuing.

Completion criterion: implementer returned; working tree may be dirty.

### 5. Done gate (orchestrator verifies)

1. Derive automated test commands from the issue’s How to test / PRD seams (unit/integration only).
2. **Run them yourself** in the shell — do not trust the implementer’s word alone.
3. If **red**:
   - Leave `Status: in-progress`
   - **Stop the chain**
   - Report: issue path, failing commands/output summary, that the user can re-run `/implement-next <slug>` to resume
   - End turn
4. If **green**:
   - Set `Status: done`
   - Optionally check off completed Acceptance criteria boxes in the issue file
   - Loop to **step 2** (next slice)

Completion criterion: Status is `done` and you are looping, or Status is `in-progress` and you stopped.

### 6. End report

When the chain stops (success, blocked, or failure), report in chat:

- Feature slug
- Per-issue Status summary (table)
- What this run completed
- Remaining manual / sandbox How to test steps (if any)
- Reminder: **no commits were made** — commit/PR when the user asks

Do not start unrelated features.

## Status vocabulary

See `docs/agents/triage-labels.md`:

| Status | Meaning for this skill |
|--------|-------------------------|
| `ready-for-agent` | Eligible for frontier when unblocked |
| `in-progress` | Claimed; resume target |
| `done` | Passed automated done gate; unblocks dependents |

Ignore `needs-triage` / `needs-info` / `ready-for-human` / `wontfix` for frontier selection unless the user explicitly overrides.

## Examples

```text
/implement-next ask-me-any-record
```

Resumes `in-progress` if present; else runs lowest unblocked `ready-for-agent` (typically `01`), then chains.

```text
/implement-next ask-me-rtl-text-direction
```

Same rules for another feature slug under `.scratch/`.
