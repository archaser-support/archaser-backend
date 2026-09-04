# ClickUp ↔ Git work workflow

Human-readable source of truth for how requirements and bugs move from ClickUp through planning, Git branches, and pull requests to `staging`. Skills and agents must follow this document; if older wording conflicts, update those rules/skills to match.

**PRD:** `.cursor/plans/clickup-git-workflow.prd.md`  
**ClickUp workspace / list / assignee IDs:** read from **ClickUp Integration** in `.cursorrules` — do not hardcode a second copy here.

## Roles of each surface

| Surface | Role |
|---------|------|
| **ClickUp** | Human ticket: status ladder, durable summary, How to test, branch/PR links |
| **`.cursor/plans/`** | Working design during build: PRD + commit-able vertical slices |
| **`.scratch/`** | Optional **gitignored** local workspace only — never the shippable slice home |

## Intake

Every piece of work starts as a **ClickUp task** (created in the ClickUp UI or by the agent **only when the developer explicitly asks**). Do not grill or short-path code without a task.

When creating a task, always include a short **How to test** section unless the developer opts out. Use the default list, assignee, and MCP settings from `.cursorrules`.

## Full path

1. ClickUp task exists (status: `requirement definition`).
2. Grill (`/grill-me`) until scope and decisions are locked.
3. Create the unique feature branch from latest **`staging`** (status moves to `techincal design` while grilling completes and the PRD is written — board spelling is intentional).
4. Write the PRD at `.cursor/plans/<feature-slug>.prd.md`.
5. Publish vertical slices at `.cursor/plans/<feature-slug>/issues/<NN>-<slug>.md` (plus `OVERVIEW.md` when there are 2+ slices).
6. Commit and push planning files immediately on that branch.
7. Update ClickUp with the **durable summary** (see below), branch link, and set status to `selected for development`.
8. Implement on the **same** branch (status: `in progress` when coding starts).
9. Merge latest `staging` into the feature branch (merge, not rebase/force-push by default).
10. Open a **ready-for-review** PR per affected repo (status: `pending internal`). Do **not** open a draft PR for planning-only commits by default.
11. When the PR merges to `staging`, set ClickUp to `move to staging`.
12. A **human** moves the task to `done` after deploy or final acceptance — **not** on merge.

## Short path

Allowed only for **tiny, obvious** fixes (e.g. typo, one-liner).

1. ClickUp task (may start at `selected for development`).
2. Branch from latest `staging` using the branch naming rule.
3. Fix → merge `staging` if needed → ready-for-review PR.
4. Status: `in progress` → `pending internal` → `move to staging` (then human `done`).

If scope becomes unclear or grows, **upgrade to the full path** (grill → PRD → slices).

## Interrupt / park (mid-task discovery)

When a new bug or requirement appears while another branch is in progress:

1. Park current WIP (stash or WIP commit) — do **not** mix the new concern into the parked branch.
2. Create or use a **new** ClickUp task (only create when asked).
3. Create a **new** branch from fresh `staging` (not from the parked feature branch).
4. Continue on full or short path as appropriate.

## Branch naming

```
{type}/CU-{taskId}-{short-slug}
```

Examples: `fix/CU-abc123-login-typo`, `feat/CU-xyz789-portfolio-health`.

Use the **same branch name** in every repo you touch for that ClickUp task.

## Primary repo

| Work shape | Primary repo (branch first; PRD + slices live here) |
|------------|------------------------------------------------------|
| Mixed or backend-heavy | `archaser-backend` (**default**) |
| Frontend-only | `archaser-frontend` |
| Tests-only | `tests` |

Create the branch immediately only in the primary repo. Create the same-named branch in a sibling repo **only when you first change files there**, still from latest `staging`.

## Pull requests

- **One PR per ClickUp task per repo**, containing all slices for that task in that repo.
- Link every repo’s PR on the same ClickUp task.
- PR description should include **How to test** and a link to the ClickUp task.
- **Oversized PR split rule:** if the change set is too large to review, create a **new ClickUp task** (and branch) rather than stacking many PRs under one task by default.

## ClickUp durable summary policy

After the PRD exists, update the ClickUp task with a **short durable summary** — not a full PRD mirror:

- Problem
- Decided behavior
- Out-of-scope highlights
- **How to test**
- Branch URL when pushed; PR URL(s) when opened

The repo PRD remains the working design doc during build. ClickUp remains the durable human ticket if plan files are later deleted.

## Status ladder (existing ARchaser list names only)

Do not invent or rename board statuses. Use these exact names (including the board spelling `techincal design`):

| When | Status |
|------|--------|
| Full-path create / pre-grill | `requirement definition` |
| Grill done / writing PRD | `techincal design` |
| PRD + slices pushed | `selected for development` |
| Coding started | `in progress` |
| Ready PR opened | `pending internal` |
| Merged to `staging` | `move to staging` |
| Deploy / final acceptance | `done` (**human only** — not automatic on merge) |

Short path may start at `selected for development`, then `in progress` → `pending internal` → `move to staging`.

## Planning file locations

| Artifact | Path |
|----------|------|
| PRD | `.cursor/plans/<feature-slug>.prd.md` |
| Vertical slices | `.cursor/plans/<feature-slug>/issues/<NN>-<slug>.md` |
| Overview (2+ slices) | `.cursor/plans/<feature-slug>/OVERVIEW.md` |

`.scratch/` stays **gitignored** for optional local notes. Do not treat it as the commit-able slice home.

Commit and push planning files as soon as they are written so teammates can see the plan on the branch.

## Skills

- **`/start-work`:** orchestrator for the full ClickUp ↔ Git ladder — full path through planning push, **short path** (tiny fixes), **interrupt/park**, **coding** (`in progress`), **ready-PR** (merge latest `staging` into the feature branch, open ready-for-review PR per touched repo with How to test + ClickUp link, set `pending internal`, link all PRs), and **post-merge** `move to staging`. Skill: `.agents/skills/start-work/SKILL.md`. On a bare or incomplete `/start-work`, the agent **asks** (one question at a time) for missing path, ClickUp create vs existing URL, and other intake gaps — it does not guess or create a ClickUp task unprompted. Does not force implementation into one chat; does not open a planning-only PR by default; never auto-sets `done`. Discoverable via **`/ask-matt`** on the idea → ship flow.
- **`/grill-me`:** relentless interview until shared understanding.
- **`/to-prd`:** writes `.cursor/plans/<feature-slug>.prd.md`. When `clickup_task_url` is set (or the session/orchestrator already provides a task), it applies the **durable light sync** above (summary + How to test + branch link when known) — never a full PRD mirror, and never creates ClickUp tasks by itself.
- **`/to-issues`:** publishes commit-able slices under `.cursor/plans/<feature-slug>/issues/` only; does not call ClickUp MCP.
