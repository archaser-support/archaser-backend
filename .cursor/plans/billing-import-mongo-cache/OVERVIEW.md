# Billing import Mongo cache (6-month reference)

Short overview: durable Mongo reference of filtered billing-connector import rows (6-month TTL). **Every successful sync run keeps its own backups** (no same-day overwrite). Manual Start lists **today’s runs** (time + per-entity counts); the analyst picks a run and which entities to replay from cache.

**PRD:** `.cursor/plans/billing-import-mongo-cache.prd.md`

**Active slice:** `issues/04-multi-run-cache-picker.md` (revises v1 same-day replace from slices 01–03).

Vertical slices live under `issues/`.
