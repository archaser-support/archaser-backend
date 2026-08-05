---
name: grilling
description: Interview the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, or uses any 'grill' trigger phrases.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one.

If a question can be answered by exploring the codebase, explore the codebase instead of asking.

## Question format (Plan Mode style)

**Always use the `AskQuestion` tool** for each grilling question — same interaction pattern as Plan Mode. Do **not** list A/B/C options in chat prose; the tool renders the choices.

### One question at a time

- Ask exactly **one** decision per turn.
- Wait for the user's answer before asking the next question.
- Never batch multiple decisions in one message.

### Structure each `AskQuestion` call

1. **Title** — short session label (e.g. `Grill: SF OAuth Reconnect`).
2. **Prompt** — 2–4 sentences of context, then the decision as a clear question.
3. **Options** — 2–4 concrete choices (minimum 2). Each option:
   - **id** — stable slug (e.g. `branch-callback-html`).
   - **label** — start with a number (`1. …`, `2. …`, …) then a full sentence the user can select; include trade-offs when helpful. Binaries must still be numbered (e.g. `1. Yes — …` / `2. No — …`).
4. **Recommendation** — put the recommended choice **first** in the options list and append ` (Recommended)` to its label. Also name the recommended number in the prompt (e.g. `Recommendation: 1`).
5. **Other** — the tool always offers "Other"; use it for custom input. Do not duplicate "Other" in your option list.

### When AskQuestion is unavailable (chat fallback)

Use the same rules in prose: numbered `1.` / `2.` / `3.` options, then a line `**Recommendation:** {n} — …`.

### After each answer

- Acknowledge the decision in one sentence.
- Record it mentally (or in a plan/ADR when using `/grill-with-docs`).
- Ask the next question only if another branch remains unresolved.

### When grilling a code fix or PR

Before the first question, briefly state what you reviewed (files, flows, gaps). Number questions in the prompt (e.g. "Question 3 of ~10") so progress is visible.

### When to stop

Stop when all material branches are resolved or the user says to stop. Summarize locked decisions in a short decision log (bullets, no new open questions).
