# Demo account clone, anonymization, and date-shift reset

Provision anonymized, scaled **demo** accounts from a real source (starting with 10149), mark them with `is_demo`, and let demo account admins **reset** timelines via a background job that rebuilds AR and credit derived data.

**PRD:** `.cursor/plans/demo-account-clone-reset.prd.md`  
**ClickUp:** https://app.clickup.com/t/869ezzh4e  

Vertical slices live in `issues/`. Implement in dependency order; prefer a **fresh session per slice**.
