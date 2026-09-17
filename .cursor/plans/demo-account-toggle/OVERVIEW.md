# Demo account toggle (staging `is_demo`)

Staging-only **Demo account** flag on `Account`: unlocks customer Email/SMS/WhatsApp and file-import permissions when ON; mutes customer outreach and strips/hides import when OFF. Removes `has_file_import`.

**PRD:** `.cursor/plans/demo-account-toggle.prd.md`  
**ClickUp:** [869f38m5t](https://app.clickup.com/t/869f38m5t)  
**Branch:** `feat/demo-account-toggle-CU-869f38m5t`

Vertical slices live in `issues/`. Implement in dependency order; prefer a **fresh session per slice**.
