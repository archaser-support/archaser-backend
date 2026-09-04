---
name: start-work
description: Orchestrate ClickUp ↔ Git work — full path (grill → PRD → slices → planning push), short path for tiny fixes, mid-task interrupt/park, coding status, ready-PR (merge staging, open review PRs, pending internal), and post-merge move to staging. Never auto-sets done.
disable-model-invocation: true
---

# Start work

Orchestrator for the **ClickUp ↔ Git** workflow. Process contract: `docs/agents/clickup-git-workflow.md`. **ClickUp workspace / list / assignee / MCP:** read from **ClickUp Integration** in `.cursorrules` — do **not** hardcode those IDs here.

**Do not invent a second tracker.** Call existing skills for their jobs:

| Job | Skill |
|-----|--------|
| Grill | `/grill-me` (or `/grilling`) |
| PRD + durable ClickUp light sync | `/to-prd` |
| Commit-able vertical slices | `/to-issues` |

This skill owns: ClickUp intake (create only on explicit ask), status ladder, primary-repo branch from `staging`, planning commit/push, short path, interrupt/park, ready-PR phase, and post-merge status.

**Never** set ClickUp status to `done` automatically — humans set `done` after deploy or final acceptance.

## Which path?

| Situation | Path |
|-----------|------|
| Non-trivial feature/bug; scope needs decisions | **Full path** (default) |
| Tiny, obvious fix (typo, one-liner, disposable) | **Short path** |
| New bug/requirement while another branch has WIP | **Interrupt / park**, then full or short for the new task |
| Implementation done; ready for review | **Ready-PR phase** |
| PR(s) already merged to `staging` | **Post-merge** → `move to staging` |

If short-path scope becomes unclear or grows, **upgrade to the full path** (grill → PRD → slices) before continuing.

---

## Full path (through planning push)

Default when invoked for non-trivial work:

1. Ensure ClickUp task
2. Grill until shared understanding
3. Branch from latest `staging` (primary repo only)
4. `/to-prd` then `/to-issues` on that branch
5. Commit + push planning under `.cursor/plans/`
6. Durable summary + branch link + status `selected for development`
7. **Stop** — tell the user implementation can use fresh sessions per slice

Later: coding → Ready-PR → Post-merge (see below). Do not force full implementation in the planning chat.

### Preconditions (full path)

- Clean enough git state in the **primary** repo to create a branch from `staging` (or the user has confirmed how to handle local WIP).
- A ClickUp task URL/id **or** an explicit ask to create one.

### Phase 1 — Ensure ClickUp task

**Completion:** A ClickUp task id/URL is known and status is `requirement definition` (full path).

1. If the user already gave a task URL/id → use it. Fetch the task if useful.
2. If no task exists → **create only when the user explicitly asks**. Use MCP from `.cursorrules` (discover tools first). Include title, short description, and **How to test** unless they opt out. Default list/assignee from `.cursorrules`.
3. Set status to `requirement definition` for full-path intake (existing ARchaser name only).
4. Do **not** create tasks for every observation or mid-thought — wait for an explicit ask.

### Phase 2 — Grill

**Completion:** User confirms shared understanding (decision log locked); no open decision branches remaining (or discovery gates explicitly deferred).

1. Run `/grill-me` (read and follow that skill) against the task’s scope.
2. Resume an in-progress grill in this chat if one already started.
3. Do **not** create the feature branch until grill is done.
4. When grill completes and PRD writing is about to start, move ClickUp to `techincal design` (board spelling — do not “fix” it).

### Phase 3 — Branch (primary repo only)

**Completion:** Feature branch exists locally (and is ready to receive planning commits) in the **primary** repo only, named correctly, based on latest `staging`.

#### Primary repo

| Work shape | Primary repo |
|------------|--------------|
| Mixed or backend-heavy | `archaser-backend` (**default**) |
| Frontend-only | `archaser-frontend` |
| Tests-only | `tests` |

Ask only if the work shape is ambiguous; otherwise pick from the table.

#### Branch naming

```
{type}/CU-{taskId}-{short-slug}
```

- `{type}` — e.g. `feat`, `fix`, `chore`
- `{taskId}` — ClickUp task id
- `{short-slug}` — short kebab-case topic

Same name will be used in every repo **when** that repo is later touched. **Do not** create the branch in sibling repos until files there change.

#### Git steps (primary repo)

1. Fetch / update so `staging` is current.
2. Create and check out `{type}/CU-{taskId}-{short-slug}` from latest `staging` (not from an unrelated feature branch).
3. Leave sibling repos alone for now.

### Phase 4 — PRD and slices

**Completion:** `.cursor/plans/<feature-slug>.prd.md` exists with `clickup_task_url` set; slices published under `.cursor/plans/<feature-slug>/issues/` (and `OVERVIEW.md` when 2+ slices).

1. Follow `/to-prd` with the session’s ClickUp task so durable light sync can run (summary + How to test + branch link when known). Status ladder for `selected for development` stays with this orchestrator after push — `/to-prd` must not invent statuses unless the user asks.
2. Follow `/to-issues` to publish commit-able slices (no ClickUp MCP from that skill).
3. Keep planning files only under `.cursor/plans/` — never treat `.scratch/` as the shippable home.

### Phase 5 — Commit and push planning

**Completion:** Planning files under `.cursor/plans/` for this feature are committed on the feature branch and pushed to origin.

1. Stage only the planning paths for this feature (PRD, `OVERVIEW.md`, `issues/*` as applicable).
2. Commit with a clear message (planning for the ClickUp task / feature slug).
3. Push the branch (`-u` if first push).
4. Resolve the remote branch URL for ClickUp linking.

Do **not** open a PR at this phase (no draft planning-only PR by default).

### Phase 6 — ClickUp sync and status

**Completion:** ClickUp has durable summary + How to test + branch link; status is `selected for development`.

1. Ensure `/to-prd` light sync ran (or re-apply per **ClickUp durable summary policy** in the process doc) including the **branch URL** now that push succeeded.
2. Set status to `selected for development`.
3. Statuses used in this phase’s ladder only: `requirement definition` → `techincal design` → `selected for development`. Do **not** set `done`.

### Phase 7 — Stop (after planning push)

**Completion:** Chat ends the planning-push run; user knows next steps.

1. Summarize: task URL, branch name, primary repo, PRD path, slices overview/path, ClickUp status.
2. Tell the user to implement in **fresh sessions per slice** (or continue coding on the same branch later) — do **not** force full implementation in this chat.
3. When coding starts → set `in progress` (see **Coding status**). When ready for review → **Ready-PR phase**. Do not open the ready PR here unless the user explicitly asks.

---

## Short path

Allowed **only** for tiny, obvious fixes (e.g. typo, one-liner). Skips grill, PRD, and slices.

**Completion:** Fix is on a named feature branch from `staging`, ready for (or past) the Ready-PR phase; ClickUp statuses follow the short ladder.

1. **Ensure ClickUp task** — URL/id known, or create **only on explicit ask** (with How to test unless opted out). May start at `selected for development` (skip early design statuses).
2. **Branch** from latest `staging` in the primary repo: `{type}/CU-{taskId}-{short-slug}`. Same naming and primary-repo rules as full path. Sibling repos only when touched.
3. **Fix** on that branch. Set status to `in progress` when coding starts.
4. If scope grows or becomes unclear → **stop short path** and **upgrade to full path** (grill → PRD → slices) before more code.
5. When ready → run **Ready-PR phase** (merge `staging`, open ready-for-review PR(s), `pending internal`).
6. After merge → **Post-merge** (`move to staging`). Never auto-`done`.

Do **not** invent a parallel tracker or skip ClickUp / branch / ready-PR rules on the short path.

---

## Interrupt / park (mid-task discovery)

When a new bug or requirement appears while another feature branch has WIP:

**Completion:** Current WIP is parked; new concern has its own ClickUp task (on ask) and a **new** branch from fresh `staging`; nothing from the new concern was committed onto the parked branch.

1. **Park** current WIP — guide the user to `git stash` or a WIP commit on the **current** feature branch. Do not discard their work.
2. **Refuse mixing** — do **not** commit the new concern onto the parked feature branch. Do not “just fix it quickly” on the old branch.
3. **ClickUp** — create or use a **new** task **only when the user asks** to create one (or they already supplied a different task). Include How to test unless opted out.
4. **Branch** — fetch latest `staging`, then create `{type}/CU-{newTaskId}-{short-slug}` from **fresh `staging`**, **not** from the parked feature branch.
5. Continue on **full path** or **short path** as appropriate for the new task.
6. When returning to parked work later: restore stash / continue WIP commit on the **original** branch.

---

## Coding status

When implementation (not just planning) starts on the feature branch for this ClickUp task:

1. Set ClickUp status to `in progress`.
2. Keep coding on the **same** branch created for the task.
3. Sibling repos: create the **same branch name** from latest `staging` only when first changing files there.

---

## Ready-PR phase

Run when the user asks to open the PR / mark work ready for review (full or short path).

**Completion:** Latest `staging` merged into the feature branch in each touched repo; a **ready-for-review** (not draft-by-default) PR exists per touched repo; ClickUp has PR link(s) and status `pending internal`.

### Guards

- Do **not** open a ready PR for **planning-only** commits by default. If the branch only has planning under `.cursor/plans/` and no product/code change, stop and say so unless the user explicitly overrides.
- Default git sync is **merge** of `staging` into the feature branch — **not** rebase, **not** force-push.

### Steps (each touched repo)

1. Confirm which repos were actually changed for this task (same branch name in each).
2. Fetch; merge latest `staging` into the feature branch. Resolve conflicts with the user if needed. No rebase/force-push unless they explicitly request it.
3. Push the updated branch.
4. Open a **ready-for-review** PR targeting `staging` (use `gh pr create` or equivalent). PR body must include:
   - **How to test** (concrete steps)
   - Link to the **ClickUp task**
5. One PR per ClickUp task per repo. If the change set is too large to review, advise a **new** ClickUp task + branch rather than stacking many PRs under one task by default.

### ClickUp after PRs open

1. Link **all** PR URLs on the same ClickUp task (multi-repo: every repo’s PR).
2. Set status to `pending internal`.
3. Do **not** set `done`.

---

## Post-merge

When the PR(s) for this task have merged to `staging`:

1. Set ClickUp status to `move to staging`.
2. **Never** set `done` automatically — a human moves to `done` after deploy or final acceptance.

---

## Resume

If invoked mid-flow (task exists, grill done, branch exists, coding done, etc.): detect the last completed phase from git + ClickUp + `.cursor/plans/` + open PRs and continue from the next incomplete phase. Do not redo grill or recreate the branch without cause. Prefer the path that matches current intent (full, short, interrupt, ready-PR, post-merge).

---

## Hard rules (checklist)

- [ ] ClickUp create only on explicit ask
- [ ] Full path: branch only after grill; from latest `staging`; primary repo only first
- [ ] Short path: skip grill/PRD/slices only for tiny obvious fixes; still ClickUp + named branch + ready PR rules; upgrade when scope grows
- [ ] Interrupt: park WIP; new task on ask; new branch from fresh `staging`; refuse mixing into parked branch
- [ ] Branch name `{type}/CU-{taskId}-{short-slug}`; same name in every touched repo
- [ ] Sibling repos not branched until touched
- [ ] Full path: PRD + slices via `/to-prd` / `/to-issues` under `.cursor/plans/`
- [ ] Planning committed and pushed; no default planning-only PR
- [ ] Coding → `in progress`; Ready PR → merge `staging` then open ready-for-review PR(s) → `pending internal`; merge → `move to staging`
- [ ] Multi-repo: link all PRs on the ClickUp task
- [ ] Durable ClickUp summary — not full PRD mirror
- [ ] Status names exact (including `techincal design`); never auto-`done`
