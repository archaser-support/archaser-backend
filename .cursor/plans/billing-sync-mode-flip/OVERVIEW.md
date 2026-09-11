# Billing connector sync mode flip

Promotes connectors to Incremental after full-account backfill (enabled entities only), repairs stuck accounts on config load and sync end, demotes when a new entity is enabled, and shows sync mode in progress + schedule UI.

**PRD:** `.cursor/plans/billing-sync-mode-flip.prd.md`

Vertical slices live under `issues/`.

**Related:** `.cursor/plans/billing-connector-sync-schedule.prd.md`, original ERP billing connector plan (mode flip rules).
