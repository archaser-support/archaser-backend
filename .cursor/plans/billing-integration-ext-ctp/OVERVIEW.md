# Billing Integration — Extension label, sync row colors, post-sync CTP

Short overview: Account Billing Integration tab drops the Extension key picker in favor of an account-id matched label, tints Sync History failed/running rows, and runs a capped CTP catch-up after successful incremental/backfill syncs.

**PRD:** `.cursor/plans/billing-integration-ext-ctp.prd.md`

**ClickUp:** [Billing settings Integration tab — Extension label + sync history row colors](https://app.clickup.com/t/869f5pd8b)

**Branch (backend primary):** `feat/billing-integration-ext-ctp-CU-869f5pd8b`

Vertical slices live under `issues/`. Implement in fresh sessions per slice; create the same branch name in the frontend repo when first touching UI files.
