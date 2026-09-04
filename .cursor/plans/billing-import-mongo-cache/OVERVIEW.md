# Billing import Mongo cache (6-month reference)

Short overview: durable Mongo reference of filtered billing-connector import rows (6-month TTL), same-day replace per entity/mode/scope, and manual Start option to re-import from cache instead of the ERP.

**PRD:** `.cursor/plans/billing-import-mongo-cache.prd.md`

Vertical slices live under `issues/`.
