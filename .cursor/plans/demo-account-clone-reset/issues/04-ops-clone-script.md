# 04 — Ops clone script (anonymize, scale, provision)

**Status:** ready-for-agent
**Priority:** normal
**Blocked by:** [02-timeline-refresh-reset-api](02-timeline-refresh-reset-api.md)
**User stories:** 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 27, 28, 31, 32, 33, 35
**PRD:** `.cursor/plans/demo-account-clone-reset.prd.md`

## What to build

Ship an ops-only clone that creates a **new** Account from a source account id (default **10149**), copies almost all business data except secrets and live connectors (include credit insurance and reports), anonymizes identifying values with realistic fakes, replaces business IDs, applies one account-wide money scale factor, creates fixed demo users (no real user clone), maps ownership/audit user FKs to those users, copies attachment **metadata only**, bootstraps role permissions for the new account, sets `is_demo`, and ends by calling the shared timeline refresh so the demo is current on day one.

Script must be parameterized (source id, scale factor, naming) and must never print or commit real secrets. Soft ordering: can be built in parallel after slice 02’s refresh API exists; Settings UI (03) is not required to verify the script.

## Acceptance criteria

- [ ] Running the script against source 10149 (or a smaller fixture account in non-prod) creates a new `is_demo` account
- [ ] Sampled customers/invoices show fake names and fake business IDs; source identifying strings are absent
- [ ] Sampled invoice + payment amounts reflect the global scale factor and remain proportional
- [ ] No billing connector / email password / SSO secrets present on the destination
- [ ] Attachment metadata may exist; binaries are not copied
- [ ] Fixed demo users can log in; real source users were not cloned
- [ ] Clone finishes with dates near current and derived rollups/credit data coherent via shared refresh
- [ ] Multiple demos can be created (no single-demo hard lock)

## How to test

1. In a safe environment, run the clone script with source account 10149 (or a trimmed copy) and a chosen scale factor.
2. Log in with a fixed demo admin user on the new account id.
3. Spot-check customers, invoices, activities, and (if present) credit-insurance screens for anonymized identity and scaled but coherent money.
4. Confirm Settings → Demo is visible and that a subsequent Reset still works (integration with slices 02–03).
5. Confirm destination has no billing connector credentials / SMTP password from source.
