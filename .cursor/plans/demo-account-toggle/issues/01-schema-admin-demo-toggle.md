# 01 — Schema, staging policy, Demo admin toggle

**Status:** ready-for-agent
**Priority:** high
**Blocked by:** —
**User stories:** 1, 2, 3, 4, 12, 13, 16
**PRD:** `.cursor/plans/demo-account-toggle.prd.md`

## What to build

Add `Account.is_demo` (default false, no backfill to true). Introduce a small shared “is staging deploy?” + “does this account allow customer outreach / import catalog?” policy used by later slices. Persist `is_demo` on account update; only Archaser admin (account 10013) may change it, and only when the deploy is staging — outside staging ignore/reject Demo writes and keep current mail behavior.

On staging admin account General: remove the File Import switch; show **Demo account** only for Archaser admin. When Demo is saved OFF, immediately strip all `import_*` grants from that account’s roles (do not restore when turned ON again).

Drop `has_file_import` from the database schema in this slice or the next if migration pairing is cleaner — prefer dropping here once FE/BE stop reading it (coordinate with slice 02 for remaining references). If drop lands here, remove dead defaults from account payloads.

English and Hebrew strings for any new Demo label/help text.

## Acceptance criteria

- [ ] `is_demo` exists, defaults false, existing rows remain false
- [ ] Staging + Archaser admin can toggle Demo; others cannot; toggle hidden outside staging
- [ ] File Import admin switch removed
- [ ] Saving Demo OFF strips that account’s `import_*` role grants immediately; Demo ON does not restore them
- [ ] Outside staging, `is_demo` does not mute mail or change behavior yet (gate helpers return “allow outreach”)
- [ ] English and Hebrew locale keys for new UI copy

## How to test

1. On staging as Archaser admin: open Admin → Accounts → account → General — see Demo toggle (default off), no File Import switch.
2. As non-10013 admin on staging: Demo not editable/hidden.
3. On local/production build: Demo toggle not shown.
4. Turn Demo ON then OFF on staging: roles for that account lose any `import_*` grants without opening the roles screen.
5. Confirm DB: new accounts get `is_demo = false`.
