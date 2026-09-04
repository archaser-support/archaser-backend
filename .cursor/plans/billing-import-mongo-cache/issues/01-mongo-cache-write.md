# 01 — Mongo cache write + same-day replace

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 5, 10, 11, 13, 14, 15, 16, 17, 20, 21, 23, 25, 27, 28
**PRD:** `.cursor/plans/billing-import-mongo-cache.prd.md`

## What to build

Add a new Mongo import-cache collection and helpers so every successful backfill or incremental entity (manual or scheduled, extension or legacy) saves the mapped rows that entered import. Same account + entity + sync mode + account-timezone calendar day + customer scope replaces the prior backup. Preview never writes. TTL expires documents after 6 months. If a single document would exceed Mongo’s size limit, use chunked documents under the same logical key.

## Acceptance criteria

- [ ] Successful Customer/Contact/Invoice/Payment entity completion writes or replaces a cache document for the logical key.
- [ ] Failed entity completion does not publish/replace a backup for that entity.
- [ ] Preview runs do not write this collection.
- [ ] Scheduled and manual backfill/incremental both write through the same helper.
- [ ] Customer-scoped runs use a distinct `customer_scope` from full-account `"all"`.
- [ ] Calendar day uses account timezone with `Asia/Jerusalem` fallback.
- [ ] Documents carry metadata (`row_count`, `execution_id`, timestamps) and TTL ~180 days.
- [ ] Large payloads that would exceed 16MB use chunked replace under the same key (or a documented spike outcome landed in code).

## How to test

1. Run a manual incremental for one entity until it completes successfully.
2. Inspect Mongo for a document keyed by account, entity, `INCREMENTAL`, today’s account-local date, and `customer_scope=all`.
3. Run the same mode/entity again the same day — confirm one logical backup remains (latest rows).
4. Run a customer-scoped backfill for the same entity — confirm a separate document, not an overwrite of the full-account slot.
5. Confirm a preview run does not create/update this collection.
6. Confirm scheduled incremental also writes after entity success.
