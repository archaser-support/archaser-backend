# 03 — Account page Hide Portfolio Health switch

**Status:** done
**Priority:** normal
**Blocked by:** [01-permission-catalog-and-api](01-permission-catalog-and-api.md)
**User stories:** 12, 16, 17, 18, 20
**PRD:** `.cursor/plans/view-portfolio-dashboard-permission.prd.md`

## Deliverable

On Admin → Accounts → General → Products, add switch **Hide Portfolio Health** bound to `hide_portfolio_health`. Show only when Credit Insurance is on. Persist via existing account update path. EN+HE locale strings. After save, session/account products used by nav and Roles must reflect the new value (re-fetch or existing account update flow—reuse current product-toggle behavior).

## How to test

1. Open an account with Credit Insurance on: see **Hide Portfolio Health** under Products (EN and HE).
2. Credit Insurance off: switch not shown.
3. Turn hide on and save: Portfolio Health nav disappears; Roles catalog omits the permission; Credit Dashboard still available if permitted.
4. Turn hide off and save: nav and Roles key return; prior role grants still effective without re-checking boxes.
