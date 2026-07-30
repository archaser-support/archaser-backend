# Credit Insurance Jul 30 `ca50cdd37` — Split Repo Port — PRD

Status: ready-for-agent

## Problem Statement

Monolith `credit-insurance` commit `ca50cdd37` (2026-07-30) updates Portfolio
Health series KPIs, CPT effective-limit defaults, and sticky capacity-gap KPI
math. Split repos cannot cherry-pick: Nest owns the domain under
`backend/api/src/credit-insurance/domain/`, while the monolith still uses
`server/services/creditInsurance/`.

## Solution

Manual Nest port of the **product delta only** from `ca50cdd37`. Skip the
celebration golden-report script, SQL grant tweak, and golden-loop
`expected-results.xlsx` update.

Deliver as **one backend PR to `master`** with a short plan in this folder.
No frontend PR (UI already calls Nest Portfolio Health / CPT APIs).

## In scope

1. Exclude zero-AR days from `computePortfolioHealthSeriesMetrics`.
2. Portfolio Health utilization SQL/mapping:
   `COALESCE(effective_approved_limit, approved_limit, …)`.
3. CPT snapshot write: default `effectiveApprovedLimit` to base approved when
   the account has no top-up (stop nulling); fall back to approved when resolve
   returns null.
4. `resolveCustomerCapacityGapForKpi` = sticky invoice-gap sum only (no
   AR−limit cap / retained decay).
5. Unit tests for all three behaviors.

## Out of scope

- Celebration report script; SQL grant script; golden xlsx / harness refresh
- Frontend code or dual-copy of these services
- One-shot capacity recompute / backfill job
- Re-port of Jul 28+ dated-backfill / range cost / AR replay

## Ownership

- Nest domain: `creditPortfolioHealthService`, `customerKpiSnapshot`,
  `customerPolicyTrendService` (+ `api/test`).
- Stored capacity numbers correct on the **next normal gap sync** (no special
  backfill). Dashboards may lag until then.

## Testing

- Extend `credit-portfolio-health-service.test.ts` (zero-AR + util COALESCE
  regression).
- Add `customer-kpi-snapshot.test.ts` for sticky capacity behavior.
- CPT effective-limit default regression against Nest source (behavior lock).

## Manual smoke (merge gate)

- Unit tests green.
- Portfolio Health: period average ignores zero-AR days; utilization works when
  historical CPT rows have null `effective_approved_limit` but approved limit
  set.
- Optional: after a normal gap sync, confirm one customer capacity matches sticky
  gap sum.

## Grill decision log

| # | Topic | Decision |
| --- | --- | --- |
| D1 | Commit window | Only `ca50cdd37` |
| D2 | Method | Manual Nest port |
| D3 | Payload | Product + unit tests only |
| D4 | Ownership | Backend Nest only |
| D5 | Packaging | One BE PR to `master` + this plan |
| D6 | Tests | All three behaviors |
| D7 | Stored capacity | No special backfill |
| D8 | Verification | Unit tests + short PH smoke |

## Source

- Monolith SHA: `ca50cdd37d63fbc0ec180f47621d7bb725166d2d`
