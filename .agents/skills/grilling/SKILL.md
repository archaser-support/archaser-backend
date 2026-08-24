---
name: grilling
description: Grill the user relentlessly about a plan or design. Use when the user wants to stress-test a plan before building, or uses any 'grill' trigger phrases.
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

**Question format (same as Plan mode):** use the **`AskQuestion` tool** — one decision per turn, recommended option first with `(Recommended)`, wait for the answer before the next question. Never batch multiple decisions in one turn.

**Language — keep it simple:** write every question so a non-expert teammate could answer it in one read. Prefer everyday words over jargon, short sentences, one idea per question. When a topic is abstract, add a concrete example (fake record, UI path, or before/after). Prefer outcome wording in options (`Skip — keep the old row`) over mechanism wording (`No-op on unique conflict`). Full rules live in `/grill-me`.

If a fact can be found by exploring the codebase, look it up rather than asking me. The decisions, though, are mine — put each one to me and wait for my answer.

Do not enact the plan until I confirm we have reached a shared understanding.
