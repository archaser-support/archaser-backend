# 02 — Roles catalog and strip `import_*` / drop `has_file_import`

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** [01-schema-admin-demo-toggle](01-schema-admin-demo-toggle.md)
**User stories:** 10, 11, 14, 15, 16
**PRD:** `.cursor/plans/demo-account-toggle.prd.md`

## What to build

Replace `has_file_import` gating in the permissions catalog and account-product helpers with: show `import_*` **only** when staging **and** `is_demo === true`. Outside staging, never show `import_*`.

On role matrix save: if outside staging **or** staging Demo OFF, strip `import_*` from persisted grants (same “preserve other hidden grants” patterns as today’s product flags where still relevant).

Finish removing every `has_file_import` usage (API permissions, FE `accountProducts`, AppShell/login/home/customer list defaults, types). Drop the column if not already dropped in slice 01.

No hard API environment check that rejects import endpoints — catalog + strip only.

## Acceptance criteria

- [ ] Roles UI/catalog: `import_*` visible only on staging with Demo ON
- [ ] Role save outside staging or Demo OFF strips `import_*`
- [ ] No remaining `has_file_import` in schema or application code
- [ ] Demo ON after OFF shows import keys in catalog but empty grants until re-checked

## How to test

1. Staging Demo OFF: Roles matrix has no import permissions; saving roles does not reintroduce them.
2. Staging Demo ON: import permissions appear; assign one, save, reload — grant sticks.
3. Production/local: import permissions never appear; saving roles strips any leftover `import_*` in DB if present.
4. Grep/schema: `has_file_import` gone.
