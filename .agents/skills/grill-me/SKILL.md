---
name: grill-me
description: Interview relentlessly about a plan or design until shared understanding is reached. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
disable-model-invocation: true
---

Interview relentlessly about every aspect of the plan or design until shared
understanding is reached. Walk each branch of the decision tree, resolving
dependencies one decision at a time.

If a question can be answered by exploring the codebase, explore the codebase
instead of asking the user.

## Workflow

1. **Read** the plan (and any linked prior plans).
2. **Scan the codebase** for assumptions the plan makes — trace schema → API →
   services → UI → tests.
3. **Identify decision branches** — scope, data model, idempotency, rollout,
   observability, product semantics, phase ordering.
4. **Present decisions in the chat** (below) — one question, then wait. Do not
   open the plan-mode question card. Do not call `AskQuestion`.
5. **After each answer**, append to the **Decision log** table and surface the
   next **dependent** decision only after its parent is locked.
6. **Repeat** until no open branches remain or discovery-only gates are
   explicitly deferred to a spike.
7. End with **plan edits** — what sections to add/change based on locked
   decisions.

## Present questions in the chat

Ask in the chat. Do **not** use the `AskQuestion` tool and do **not** switch to plan mode.

### Language — keep it simple

Write every question so a non-expert teammate could answer it in one read.

- Prefer everyday words over jargon (`retry later` not `idempotent re-ingress`).
- One idea per question — if you need two concepts, split into two decisions.
- Short sentences. Avoid nested clauses.
- **Acronyms:** when you use an acronym, always write the full name with it
  (e.g. `ERP (Enterprise Resource Planning)`, `API (Application Programming Interface)`,
  `MVP (Minimum Viable Product)`, `KPI (Key Performance Indicator)`). Do this on
  every mention in questions and options — do not assume the reader knows it.
- When a topic is abstract or easy to misread, **add a concrete example** (a fake
  record, a UI path, or a before/after) so the choice is obvious.
- If you catch yourself writing a long setup paragraph, stop and either simplify
  the question or lead with an example, then ask.

**Too complex (bad):**
> When the connector re-pulls a payment whose composite unique key already exists,
> should we treat the row as immutable and skip, or upsert mutable fiscal fields?

**Simple + example (good):**
> Same payment comes back from the ERP (Enterprise Resource Planning) a second
> time (account A, reference INV-9). We already stored it yesterday. What should
> we do?
>
> Example: yesterday we saved amount $100; today the ERP (Enterprise Resource
> Planning) sends $120 for INV-9.

### One question at a time

- **One question per turn.** Write it in the chat, then wait for the answer. Do not batch multiple decisions in one turn.
- **Heading:** `### D{n} — {Topic title}`
- **Body:**

```text
D{n} — {Topic title}

{1–2 short sentences: what the plan says or assumes, in plain language}

Codebase gap: {concrete finding from repo scan, or "none found" if plan is accurate}

{Optional — when the topic is abstract:}
Example: {one concrete scenario that makes the choice clear}

{Single clear question ending with ?}
```

- **Options:** 2–4 concrete choices in plain language, each label prefixed with a
  number (`1. …`, `2. …`, …). Put **(Recommended)** on the preferred option (and
  list it first). Also name the recommended number in the prompt
  (`Recommendation: 1`). Prefer outcome wording (`Skip — keep the old row`) over
  mechanism wording (`No-op on unique conflict`). Expand any acronym with its
  full name. Binaries must still be numbered (`1. Yes — …` / `2. No — …`).
- **Dependencies:** ask parent decisions before children; skip options that
  became invalid after a prior answer.
- **Do not** ask the user to choose things already answerable from the codebase.

- Options as a numbered list (`1.`, `2.`, `3.`) with the recommended option marked **(Recommended)**, then a line `**Recommendation:** {n} — …`.

## After answers — Decision log

Publish a table in the same format as implementation plans:

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | … | {user's choice, or synthesized if they picked Other} | … |

- Number decisions **D1, D2, …** across rounds (do not restart at D1 each round).
- If the user chose **Other** or added nuance in free text, capture the exact
  rule in the Decision column (e.g. "Skip if exists — amount/date immutable").
- Call out **plan sections to add/change** in a short checklist after the log.

## Discovery-only items — outcome gates

For decisions that depend on a spike or external API (not user preference), do
**not** use a question card. Use a **gate table** instead:

| Gate | If Yes | If No |
|------|--------|-------|
| … | … | … |

Label these as **blocking** or **informational** and which plan phase they
block.

## Dependency rules

- Resolve **parent decisions before children** (e.g. MVP (Minimum Viable Product)
  scope before per-entity idempotency details).
- When a child option becomes invalid after a parent answer, drop it and only
  ask the remaining branches.
- State explicitly when a decision **blocks** implementation (e.g. "blocks
  Phase 4b").

## Recommendations

For every option set, the **(Recommended)** option must reflect the
best answer given the codebase scan — not a neutral list. Briefly justify
recommendations in the Decision log Rationale column after the user answers.

## Example (abbreviated)

**Chat question:**

```text
D3 — Same payment twice

The plan imports every payment. The DB (database) already blocks duplicates on
account + customer + reference.

Example: we saved INV-9 for $100 yesterday. Today the ERP (Enterprise Resource
Planning) sends INV-9 again for $120.

What should we do with the second pull?
```

**Options:** Skip — keep the old row (Recommended) | Update amount/date to the new values | Fail with a validation error

**Decision log after answer:**

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D3 | Same payment twice | Skip — keep the old row | Immutable payments; count as entity_stats.skipped |
