---
name: ask-matt
description: Ask which skill or flow fits your situation. A router over the user-invoked skills in this repo.
disable-model-invocation: true
---

# Ask Matt

You don't remember every skill, so ask.

A **flow** is a path through the skills. Most paths run along one **main flow**, and **on-ramps** merge onto it. Everything else is standalone.

## The main flow: idea → ship

The route most work travels. You have an idea and want it built.

**Archaser (ClickUp ↔ Git):** prefer **`/start-work`** as the on-ramp. It binds ClickUp status, branch naming from `staging`, and the grill → PRD → slices skills (full path), plus short path for tiny fixes, interrupt/park, ready-PR, and post-merge `move to staging`. Process: `docs/agents/clickup-git-workflow.md`. Skill: `.agents/skills/start-work/SKILL.md`.

1. **`/grill-with-docs`** — sharpen the idea by interview. Start here when you **have a codebase**: it's stateful, retaining what it learns in `CONTEXT.md` and ADRs. (No codebase? Use `/grill-me` — see Standalone.) Under Archaser ClickUp work, grilling is usually driven by **`/start-work`** (which calls `/grill-me`) rather than starting grill in isolation.
2. **Branch — can you settle every question in conversation?** If a question needs a runnable answer (state, business logic, a UI you have to see), detour through a prototype, bridged by **`/handoff`** in both directions (see Crossing sessions):
   - **`/handoff`** out, then open a fresh session against that file,
   - **`/prototype`** to answer the question with throwaway code,
   - **`/handoff`** back what you learned, and reference it from the original idea thread.
3. **Branch — is this a multi-session build?**
   - **Yes (Archaser)** → **`/start-work`** (full path through planning push: ClickUp → grill → branch → `/to-prd` → `/to-issues` → push plans). Then implement per slice (fresh sessions) and re-invoke **`/start-work`** for ready-PR / post-merge when shipping.
   - **Yes (generic Matt flow)** → **`/to-prd`** (turn the thread into a PRD) → **`/to-issues`** (split the PRD into independently-grabbable issues). Then run **`/implement-next <feature-slug>`** in a fresh orchestrator chat — it claims each unblocked slice, spawns a **fresh agent per issue**, verifies acceptance (runs **existing** automated checks only; does **not** add tests unless you ask), flips `Status` to `done`, and chains until blocked.
   - **No** → implement right here, in the same context window (no `/implement-next` needed). Tiny Archaser fixes: **`/start-work`** short path (ClickUp + branch + fix + ready PR; skip grill/PRD/slices).

### Context hygiene

Keep steps 1–3 in **one unbroken context window** — don't compact or clear until after `/to-issues` (or until `/start-work` finishes planning push on Archaser) — so the grilling, PRD, and issues all build on the same thinking. Then start a **new** chat for `/implement-next` or per-slice implementation so the orchestrator stays thin while each slice agent is fresh.

The limit on this is the **[smart zone](https://www.aihero.dev/ai-coding-dictionary/smart-zone)**: the window (~120k tokens on state-of-the-art models) within which the model still reasons sharply. If a session approaches it before `/to-issues`, don't push on degraded — `/handoff` and continue in a fresh thread.

## On-ramps

A starting situation that generates work, then merges onto the main flow.

- **Archaser ClickUp / branch / PR work** → **`/start-work`**. Use for a new requirement or bug (full or short path), mid-task interrupt (park WIP, new task on ask, new branch from `staging`), coding status, opening ready-for-review PRs, or post-merge `move to staging`. Discovers the rest of the idea → ship ladder so you do not skip ClickUp or git rules.
- **Bugs and requests piling up** → **`/triage`**. It moves issues through triage roles and produces agent-ready issues, which **`/implement-next <feature-slug>`** later picks up.

  Triage is only for issues **you didn't create** — bug reports, incoming feature requests, anything that arrives raw. Issues that `/to-issues` produced are already agent-ready, so **don't triage them**.

## Codebase health

Not feature work — upkeep.

- **`/improve-codebase-architecture`** — run whenever you have a spare moment to keep the codebase good for agents to operate in. It surfaces deepening opportunities; picking one _generates an idea_ you can take into the main flow at `/grill-with-docs`.

## Crossing sessions

- **`/handoff`** — when a thread is full or you need to branch off (e.g. into a `/prototype` session), this compacts the conversation into a markdown file. You don't continue in place — you **open a new session and reference that file** to carry the context across. It's the bridge between context windows, in either direction. Use it when you want a **fresh session** but need the **current conversation preserved**.
- **`/compact`** (built-in) — stay in the **same conversation**, letting the earlier turns be summarized. Use it at **intentional breaks between phases**, when you don't mind losing the verbatim history. Don't compact mid-phase — the agent can lose its way. `/handoff` forks; `/compact` continues.

## Standalone

Off the main flow entirely.

- **`/grill-me`** — the same relentless interview as `/grill-with-docs`, but for when you have **no codebase**. Stateless: it saves nothing locally, builds no `CONTEXT.md`. Reach for it to sharpen any plan or design that doesn't live in a repo.
- **`/teach`** — learn a concept over multiple sessions, using the current directory as a stateful workspace.
- **`/writing-great-skills`** — reference for writing and editing skills well.

## Precondition

**`/setup-matt-pocock-skills`** — run before your first engineering flow to configure the issue tracker, triage labels, and doc layout the other skills assume. Custom issue trackers also work.
