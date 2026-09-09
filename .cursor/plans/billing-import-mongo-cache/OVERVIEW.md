# Billing import Mongo cache (6-month reference)

**PRD:** `.cursor/plans/billing-import-mongo-cache.prd.md`  
**ClickUp:** https://app.clickup.com/t/869evkavc

Durable Mongo reference of filtered billing-connector import rows (6-month TTL). Every successful sync run keeps its own backups. Manual Start (backfill or incremental) lists **cache days within TTL**, then runs on the selected day; the analyst picks entities to replay from Mongo or skips to full ERP. `clear_before_import` stays independent of cache.

**Active slice:** all slices `01`–`05` done (historical day picker shipped in `05`).

Vertical slices live under `issues/`.
