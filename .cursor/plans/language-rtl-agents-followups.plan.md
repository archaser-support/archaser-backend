# Language RTL + Agents Follow-ups (combined)

## Decision log

| # | Topic | Decision |
|---|-------|----------|
| D1 | Language change | Flip layout immediately via reload — no re-login |
| D2 | Whose language | Only own profile |
| D3 | Who triggers reload | Nest flags + frontend fallback |
| D4 | Agents tabs at 0 | Always show both tabs; empty state in Follow-ups |
| D5 | Follow-up membership | All open scheduled (past + future) |
| D6 | Date filter | Honor Today / This week / Next week / This month / All |
| D7 | Page / search | Nest honors page, limit, search |
| D8 | Tab badge | Always total open (`all`); filter only affects grid |
| D9 | Shipping | One combined plan/PR |

## Bug A — Language / RTL

1. Nest `account-admin-entities` user `update`: when caller updates **self**, return `sessionUpdateRequired` + `newLanguage` / `newLocale` / `newName` / `newTimezone` when those fields change.
2. Frontend `UserDetails`: if Nest flags **or** own language changed, `updateSession` then hard-navigate to matching `/he|en` path.
3. NextAuth JWT `update` callback: persist `language`, `locale`, `name`, `timezone`.

## Bug B — Agents Follow-ups

1. `AgentList`: always render tabs; remove force-switch-off when count is 0.
2. Nest `getAgentsFollowUp`: open periods with non-null `follow_up_time` (not due-only); honor `followUpDateRange`, `page`, `limit`, `search`, `businessUnitId`.

## Codebase scan

**Required:** `account-admin-entities.service.ts`, `system.service.ts`, `system.controller.ts`, `UserDetails.tsx`, `authOptions.ts`, `AgentList.tsx`, follow-up date-range helper + tests.

**Optional / out of scope:** MUI `theme.direction` live flip, `FollowUpList.tsx` orphan, translation changes.

**No change:** `SessionLanguageMonitor` auth skip (already correct for login bounce).

## Testing

- Unit: follow-up date-range helper; JWT update applies language (if extractable).
- Manual: own language English↔Hebrew flips `html[dir]`; Agents shows both tabs at 0; future follow-ups appear under All; Today filter narrows grid; badge stays total.
