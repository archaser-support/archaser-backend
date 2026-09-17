---
name: demo-account-toggle
overview: Staging-only Demo account flag (is_demo) gates customer outreach and file-import permissions; remove has_file_import.
source: grill-me session + start-work CU-869f38m5t
clickup_task_url: https://app.clickup.com/t/869f38m5t
isProject: false
---

# Demo account toggle (staging `is_demo`)

## Problem Statement

On staging, teams need a per-account switch so demo tenants can receive real customer Email/SMS/WhatsApp and use file import, while other staging accounts stay quiet and do not expose import permissions. Today there is no `is_demo` field; file import is controlled by a separate **File Import** product flag (`has_file_import`) that does not mute outreach.

## Solution

Add `Account.is_demo` (default **false**). **Only on staging**:

- Demo **ON** — customer outreach sends normally; `import_*` permissions appear in the roles catalog.
- Demo **OFF** — customer-facing Email/SMS/WhatsApp are skipped (activity recorded as not sent with a clear reason); `import_*` hidden and stripped from roles.

**Outside staging** (production and local): ignore `is_demo`, hide the Demo toggle, keep customer mail working as today. Remove the File Import admin toggle and drop `has_file_import`. File-import permissions show in roles **only** when staging **and** Demo ON. Archaser admin (account `10013`) alone can flip Demo on staging.

## User Stories

1. As an Archaser admin on staging, I want a Demo account toggle on account General, so that I can unlock outreach and import for a demo tenant.
2. As an Archaser admin, I want Demo default OFF on new accounts, so that staging stays quiet until I opt in.
3. As an Archaser admin, I want the Demo toggle hidden outside staging, so that production cannot be muted by mistake.
4. As an Archaser admin, I want only account `10013` to change Demo, so that tenant admins cannot unlock staging mail/import themselves.
5. As a collection agent on a staging Demo ON account, I want customer emails and SMS to send, so that demos look real.
6. As a collection agent on a staging Demo OFF account, I want customer sends to be skipped with a toast and timeline row, so that I know the gate blocked delivery.
7. As a user resetting a password on a Demo OFF staging account, I want reset email to still arrive, so that I can log in.
8. As an admin creating a user on a Demo OFF account, I want the welcome email to still send, so that staff onboarding works.
9. As an agent receiving dispute-assignment or credit-rule mail on Demo OFF, I want those internal emails to still send, so that ops keep working.
10. As a role admin on staging Demo OFF, I want `import_*` permissions hidden, so that I cannot assign file import.
11. As a role admin on staging Demo ON, I want `import_*` visible again, so that I can grant import after unlock.
12. As an Archaser admin turning Demo OFF, I want existing `import_*` grants stripped immediately, so that import is gone without editing roles.
13. As an Archaser admin turning Demo ON again, I want grants not auto-restored, so that import stays intentional.
14. As a role admin outside staging, I want `import_*` hidden and stripped on role save, so that production roles cannot keep file import via the UI.
15. As an Archaser admin, I want the old File Import product switch removed, so that Demo is the only staging control for import visibility.
16. As a developer, I want `has_file_import` removed from the schema and code, so that there is one source of truth.
17. As a cron/worker operator on staging Demo OFF, I want scheduled customer activities to create not-sent rows instead of SMTP/SMS, so that workflows remain visible.
18. As a support engineer, I want Demo OFF skips to log a consistent reason, so that staging incidents are easy to explain.

## Implementation Decisions

- Add `Account.is_demo Boolean @default(false)`; do **not** backfill existing rows to true (leave false).
- Drop `Account.has_file_import` via migration and delete all reads/writes (API, FE account products, admin General, login/AppShell defaults).
- Shared staging detection: treat deploy as staging/preprod the same way existing email subject / domain helpers already do (`staging.` / `preprod.` / related). Local and production are **not** staging for this feature.
- Outside staging: never apply the outreach mute; never show Demo toggle; never show `import_*` in the roles catalog; on role save strip any leftover `import_*`.
- On staging: outreach mute when `is_demo === false`; roles catalog includes `import_*` only when `is_demo === true`.
- Account update (Archaser admin only for `is_demo`): when Demo is saved from true→false (or set false), strip `import_*` from all roles for that account immediately; do not restore on true.
- Role matrix save: if outside staging **or** staging with Demo OFF, drop `import_*` from the payload/persisted grants (preserve other hidden-product grant behavior patterns already used for credit flags where applicable).
- Customer outreach gate (single preferred seam): before SMTP/SMS/WhatsApp delivery for debtor/contact messages (activity workflow, manual send-email, dispute-resolution customer mail, similar contact channels). Staff/ops paths explicitly excluded: password reset, welcome/password-setup, internal email templates, credit notification rules, billing-connector ops alerts.
- Blocked delivery: create/update activity (and contact delivery rows as applicable) as not sent / failed with a stable reason such as Demo disabled; return a client-visible message suitable for a toast.
- Admin UI: remove File Import switch; add Demo switch next to other product flags, visible only when staging **and** Archaser admin.
- **i18n:** any new user-facing strings (toast, timeline reason labels if shown) ship English and Hebrew keys together.
- Primary implementation repo is backend; create the same branch name in frontend when FE files change.

## Testing Decisions

- Prefer behavior tests at the highest stable seams already used in the repo (permissions catalog filtering; account update side effects; email/SMS send helpers or activity send entry points) rather than UI snapshot tests.
- Good tests assert external behavior: catalog keys present/absent; grants stripped after Demo OFF; send skipped with reason while staff mail still invoked; non-staging ignores `is_demo`.
- Do not require new automated tests unless explicitly requested during implementation slices.
- Manual How to test lives on the ClickUp task and each vertical slice.

**Primary seams (preferred):**

1. Account environment + `is_demo` policy helper (staging? → apply demo rules).
2. Permissions catalog / role save filtering for `import_*`.
3. Customer outreach send entry (shared “may send to contact” check) used by API + worker paths.

## Out of Scope

- Changing production customer-mail behavior based on `is_demo`.
- Hard environment checks that reject import API calls (strip-on-save / catalog hide only).
- Restoring historical `import_*` grants when Demo turns ON.
- Muting staff welcome, password reset, internal templates, or credit/ops alerts.
- Replacing or redesigning the broader product-flag model (collection / credit insurance remain as today).
- One-time mass strip migration of all production `import_*` grants beyond strip-on-role-save / strip-on-Demo-OFF (optional later cleanup).

## Further Notes

ClickUp: [Demo account toggle (staging is_demo)](https://app.clickup.com/t/869f38m5t). Branch: `feat/demo-account-toggle-CU-869f38m5t`. Grill decision log D1–D16 locked in session (D6 superseded by D14/D15 for staff mail).

## Issues (vertical slices)

Tracer-bullet breakdown published as commit-able markdown under `.cursor/plans/demo-account-toggle/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.cursor/plans/demo-account-toggle/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Schema, staging policy, Demo admin toggle | `issues/01-schema-admin-demo-toggle.md` | — | 1–4, 12–13, 16 |
| 2 | Roles catalog / strip import / drop `has_file_import` | `issues/02-roles-import-gating.md` | 01 | 10–11, 14–16 |
| 3 | Customer outreach gate | `issues/03-customer-outreach-gate.md` | 01 | 5–9, 17–18 |

**Status:** `ready-for-agent` on all slices.
