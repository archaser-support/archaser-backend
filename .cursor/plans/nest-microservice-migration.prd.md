---
name: nest-microservice-migration
overview: Split Archaser into Nest microservices in a backend monorepo (api, worker, sms, connectors, reports) with nginx/Next path splits, shared @archaser/auth, JWT/DualAuth, merged OpenAPI, BullMQ worker, and Amplify UI on a parallel track.
source: grill-me session (.cursor/plans/nest_microservice_migration_a9cacddc.plan.md)
clickup_task_url: null
isProject: false
---

# Nest microservice migration

## Problem Statement

Archaser today runs as one Next.js application on EC2: the App Router UI, Pages API routes, in-process cron jobs, and Prisma access share a single deployable. That coupling makes it hard to scale background work separately from HTTP traffic, to deploy the UI without shipping API and test code, and to evolve the backend toward clear service boundaries.

Operators and developers need a path to replace the Next.js backend with Nest.js, host the frontend on Amplify, run Nest services on EC2, observe each service in Grafana without multiplying Grafana installs, and keep Vitest/Playwright out of production deploy artifacts — without a big-bang rewrite that breaks Account-scoped collections work (Customers, Invoices, Activities, Collection periods, Portal, Credit insurance, Billing connectors, Reports, SMS).

## Solution

Migrate in stages, strangling the current monolith first, then peeling services:

1. **Nest modular monolith first** — Done: Nest API owns HTTP backend behavior. Next is UI (+ auth bridge as needed).
2. **EC2 before Amplify (historical)** — Nest on EC2 first. Amplify UI now runs as a **parallel track** and does not block peels.
3. **JWT / DualAuth** — Nest validates tokens; Amplify/cross-origin prefers Bearer. Shared `@archaser/auth` across Nest apps.
4. **Shared Postgres for a long time** — Nest processes share one database via `@archaser/database`.
5. **Path-split public routes** — Browser keeps relative `/api/...`; nginx/Next send `/api/sms`, `/api/entities/accounts`, `/api/reports` to their Nest apps. Service-to-service uses private `/internal/...` + shared secret (not a browser gateway proxy).
6. **Worker track** — Redis + BullMQ worker in the backend workspace; deepen handlers independently of SMS peel.
7. **Peels in backend monorepo** — SMS → connectors (all `/api/entities/accounts/*`) → reports; each is its own Nest app in the same repo, run in parallel.
8. **Repos** — Separate FE and BE git repos; Nest services are npm workspaces under backend (not one git repo per peel).
9. **One Grafana** — Per-service dashboards/folders.
10. **Contracts** — Per-app OpenAPI merged for the web client; golden HTTP contract tests gate each path flip.

Living roadmap (stages, decision log D1–D52, resume pointer): `.cursor/plans/nest_microservice_migration_a9cacddc.plan.md`.

## User Stories

1. As an **Account user**, I want to log in the same way I do today (password and SSO when enabled), so that the migration does not block daily collections work.

2. As an **Account user**, I want my session to work when the UI is on Amplify and the API is on EC2, so that I can use the product across separate hosts.

3. As an **Account user**, I want Customers, Invoices, Payments, Contacts, Activities, Collection periods, and Disputes to keep working after the API moves to Nest, so that core AR workflows are uninterrupted.

4. As an **Account user**, I want the Customer Portal flows I rely on to keep working after the backend move, so that debtors and agents are not blocked.

5. As an **Account user**, I want Credit insurance screens and KPIs to keep working against Nest, so that policy and capacity-gap work continues.

6. As an **Account user**, I want Reports I create and run to keep working during and after the migration, so that operational reporting is not lost.

7. As an **Account user**, I want SMS sending and delivery callbacks to keep working when SMS later becomes its own service, so that collection outreach is reliable.

8. As an **Account admin**, I want Billing connector sync and mappings to keep working when connectors are peeled later, so that ERP imports continue.

9. As an **Account admin**, I want to enable, disable, and “run now” for platform jobs from the UI, so that I can control automation without SSH.

10. As an **Account admin**, I want recurring jobs (collection automation, notifications, connector sync, snapshots) to keep firing on schedule after the worker peel, so that overnight automation does not stop.

11. As an **archaser_admin**, I want Nest to own authentication (including Google and Microsoft SSO parity), so that login is not split between Amplify and EC2.

12. As an **archaser_admin**, I want a single API base URL for the browser, so that CORS and client config stay simple when microservices appear.

13. As a **developer**, I want to introduce Nest beside Next in the current repo first, so that we can strangler-migrate without inventing multi-repo CI on day one.

14. As a **developer**, I want OpenAPI generated from Nest and a typed client in the web app, so that UI and API stay in sync without sharing Prisma.

15. As a **developer**, I want the web app to stop importing server/Prisma code, so that Amplify can host UI-only Next safely.

16. As a **developer**, I want `@archaser/database` as the single Prisma schema package, so that api, worker, and later services share one schema and migrations.

17. As a **developer**, I want separate git repos for web, api, and e2e after the Nest API is stable, so that deploy artifacts and ownership are clear.

18. As a **developer**, I want each peeled microservice in its own git repo, so that each Nest service can be deployed and versioned alone.

19. As a **developer**, I want Vitest unit/integration tests to live with the service they exercise, so that API and worker changes are tested close to the code.

20. As a **developer**, I want Playwright and cross-system e2e in `archaser-e2e`, so that tests are never deployed with Amplify or Nest production builds.

21. As a **developer**, I want Stage 0 to deliver a Nest skeleton, JWT spike, OpenAPI, and database package path, so that later stages have a foundation.

22. As a **developer**, I want Stage 1A to move Pages API and server domains onto Nest on EC2 while UI stays on EC2 Next, so that risk is limited to the API cutover.

23. As a **developer**, I want Stage 1B to put UI on Amplify SSR with JWT + OpenAPI client, so that frontend deploy is decoupled from the API.

24. As a **developer**, I want Stage 2 to extract `archaser-worker` with Redis + BullMQ, so that HTTP traffic and background jobs scale independently.

25. As a **developer**, I want the worker to own BullMQ repeatable schedules synced from CronJob config, so that the API remains request-oriented.

26. As a **developer**, I want Redis to run in Docker on the app EC2 for Stage 2, so that we can ship the worker without waiting on ElastiCache.

27. As a **developer**, I want peel order SMS → Billing connectors → Reports after the worker, so that side domains leave the monolith before core AR.

28. As an **operator**, I want Nest API and later services to run on EC2 under the existing PM2/Apache style of ops, so that production hosting stays familiar.

29. As an **operator**, I want one Grafana with folders/dashboards per service, so that I can see api vs worker metrics without multiple Grafana installs.

30. As an **operator**, I want Prometheus metrics from each Nest service, so that scrape jobs and alerts can be labeled per service.

31. As an **operator**, I want in-process cron disabled on the API after the worker cutover, so that jobs do not double-run.

32. As an **operator**, I want realtime notification/control-center streams to stay on the main API gateway for now, so that we do not peel websockets early.

33. As an **operator**, I want Postgres connection pools planned for API + worker, so that shared-DB multi-process deploy does not exhaust connections.

34. As a **QA engineer**, I want e2e against staging Amplify + Nest URLs, so that critical Account user journeys are verified after each stage.

35. As a **QA engineer**, I want contract tests from OpenAPI, so that breaking API changes fail CI before UI drifts.

36. As a **product owner**, I want a living roadmap with locked decisions and a clear “next stage,” so that work can pause and resume without re-deciding architecture.

37. As a **product owner**, I want core Customer / Invoice / Activity / Collection period logic to stay in the main API for this PRD’s horizon, so that we avoid a premature distributed core.

38. As a **security reviewer**, I want JWT validation on Nest for every protected Account-scoped route, so that Amplify cannot bypass auth by talking to internal services.

39. As a **security reviewer**, I want peeled services reachable from the gateway (and not required as public browser origins), so that attack surface stays small.

40. As a **platform engineer**, I want private npm publishing for `@archaser/database`, so that multi-repo Nest apps can install a versioned schema client.

41. As a **platform engineer**, I want discovery gates called out for SSO parity, Amplify SSR without DB, connection budget, Redis durability, and package registry, so that blockers are visible before a stage starts.

42. As an **Account user**, I want failed API cutovers to be reversible at the reverse-proxy layer during Stage 1A, so that traffic can fall back to Next APIs if needed.

43. As a **developer**, I want Mongo operational logging and Loki integration to keep working from the API (and later services as needed), so that existing log analysis is not abandoned mid-migration.

44. As a **developer**, I want import jobs and entity CRUD dispatch behavior preserved at the HTTP contract level, so that the UI does not need a parallel redesign beyond auth and base URL.

45. As an **archaser_admin**, I want system health and cron admin capabilities to remain available through the gateway after jobs move to the worker, so that operations tooling still works from the product UI.

## Implementation Decisions

- **Migration shape (D1, D22):** Nest modular monolith first (done); peel microservices as Nest apps **inside the backend repo**, run in parallel (not new git repos per peel — D19 superseded).
- **Auth (D2, D3, D29, D33, D35, D52):** Nest DualAuth (Bearer JWT + session cookie bridge as needed). Shared `@archaser/auth` (DualAuth, internal-secret guard, AccessScope, S2S HTTP client). Extract package during SMS soak before connectors (D40); SMS may copy auth first (D39).
- **Cutover (D4, D21):** Strangler done; FE/BE already split. Amplify and peels are **parallel tracks** (D38).
- **Amplify (D10, D38):** Next.js SSR on Amplify; no Prisma/business logic in Next; does not block peels.
- **Data (D5, D20, D42):** Shared Postgres. `@archaser/database` workspace package (private npm only if publishing outside backend). Pool defaults: api 10, worker 5, peels 3–5 each.
- **Routing (D24–D28, D30, D44, D50):** nginx/Next **path-split** public routes to each Nest app; UI keeps relative `/api/...`. `/api/sms/*` → sms; `/api/entities/accounts/*` → connectors (all nested accounts); `/api/reports/*` → reports. `/internal/...` never on nginx. Remove browser `GatewayPeelController` proxies.
- **Contracts (D18, D31):** Per-app OpenAPI + CI merge → one FE client.
- **Repos (D16, D17, D22):** Separate FE and BE git repos; all Nest services live in the backend npm workspace.
- **Worker / queue (D6, D11–D15, D41):** Redis + BullMQ; worker deepen is an **independent** track (does not block SMS).
- **Peel order (D9, D23):** SMS → connectors → reports, with real ownership now. Peel playbook: SoT spike → implement → contract tests → reversible flip → soak → delete from main API (D36–D37, D45–D49).
- **SMS bar (D45–D46, D48):** No SMS path flip until live Twilio send + webhook signatures match live production behavior; recover from prod/git/`server` when Nest is stub.
- **S2S (D32–D34, D43):** api/worker call peels via `*_SERVICE_URL` + `INTERNAL_SERVICE_SECRET` on `/internal/...`.
- **Observability (D7):** One Grafana; per-service metrics folders.
- **Resume artifact:** Update `.cursor/plans/nest_microservice_migration_a9cacddc.plan.md` Status / Next action when a stage completes.

## Testing Decisions

- **Primary seam:** Nest HTTP as published in OpenAPI (merged across services) — status codes, response shapes, auth rejection.
- **Peel parity gate (D49):** Golden HTTP contract tests vs live main-API (or live) responses + authz cases; path flip only when green. Operational soak with reversible proxy before deleting main-API modules (D36–D37).
- **Stage 0–1A:** Done — Nest unit/HTTP coverage under `api/test`.
- **Stage 1B / Amplify lane:** Playwright in e2e against staging Amplify + Nest URLs.
- **Worker track:** Job consumer tests at enqueue → observable outcome; do not require e2e to inspect Redis.
- **Deploy guarantee:** Production Amplify and Nest deploy pipelines must not ship e2e/unit test trees or Playwright browsers.

## Out of Scope

- Database-per-service or immediate distributed transactions across core AR entities.
- Separate Grafana installation per microservice.
- Peeling core Customer / Invoice / Activity / Collection period into their own services in this PRD.
- New git repo per peeled Nest service (backend monorepo workspace instead — D22).
- Moving Redis to ElastiCache (informational follow-up after worker harden).
- Rewriting product UX unrelated to auth and removal of server imports from the UI.
- Creating ClickUp tasks or `.scratch/` issue slices (use `/to-issues` separately).
- Blocking peels on Amplify (they run in parallel — D38).

## Further Notes

- Companion living plan with decision log D1–D52: `.cursor/plans/nest_microservice_migration_a9cacddc.plan.md`.
- Blocking gates: Twilio recovery spike before SMS flip; per-peel live SoT; Postgres connection budget for all Nest pools; Amplify SSR without server DB (lane B).
- Informational: Docker Redis durability; private npm only if publishing `@archaser/database` outside the backend workspace.
- Domain vocabulary: Account (tenant), Customer, Invoice, Payment, Contact, Collection period, Activity, Dispute, Credit insurance, Billing connector, Reports, SMS, CronJob / worker automation.
- Promote durable decisions into `docs/adr/` after stages ship if the team wants lasting records.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under `.scratch/nest-microservice-migration/`. **Hard blockers** are recorded in each slice's **Blocked by** header. Implement in dependency order; start a **fresh session per issue**.

**Overview:** `.scratch/nest-microservice-migration/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Nest foundation in current repo | `issues/01-nest-foundation.md` | — | 13, 14, 16, 21, 35, 36, 41 |
| 2 | Nest owns auth (JWT + SSO parity) | `issues/02-nest-auth-ownership.md` | 1 | 1, 2, 11, 38, 41 |
| 3 | EC2 strangler + core AR APIs on Nest | `issues/03-ec2-strangler-core-ar.md` | 2 | 3, 22, 28, 29, 30, 42, 44 |
| 4 | Portal and credit insurance APIs on Nest | `issues/04-portal-credit-insurance-nest.md` | 3 | 4, 5 |
| 5 | Remaining monolith APIs on Nest | `issues/05-remaining-monolith-apis.md` | 4 | 6, 7, 8, 9, 12, 22, 32, 37, 43, 45 |
| 6 | Amplify UI + web/api/e2e repo extract | `issues/06-amplify-and-repo-extract.md` | 5 | 2, 15, 17, 19, 20, 23, 34, 35, 40, 41 |
| 7 | Worker peel (Redis + BullMQ) | `issues/07-worker-peel.md` | 6 | 9, 10, 24, 25, 26, 31, 33, 45 |
| 8 | Peel SMS service | `issues/08-peel-sms.md` | 7 | 7, 18, 27, 39 |
| 9 | Peel Billing connectors service | `issues/09-peel-billing-connectors.md` | 8 | 8, 18, 27, 39 |
| 10 | Peel Reports execution service | `issues/10-peel-reports-execution.md` | 9 | 6, 18, 27, 37, 39 |
| 11 | Nest domain: Customers (replace jiti) | `issues/11-nest-domain-customers.md` | — | 3, 42, 44 |
| 12 | Nest domain: Invoices (replace jiti) | `issues/12-nest-domain-invoices.md` | — *(prefer after 11)* | 3, 42, 44 |
| 13 | Nest domain: Contacts + collection periods | `issues/13-nest-domain-contacts-collection-period.md` | — | 3, 42, 44 |
| 14 | Nest domain: Account admin entities | `issues/14-nest-domain-account-admin-entities.md` | — | 3, 12, 42 |
| 15 | Nest domain: Operations (disputes+) | `issues/15-nest-domain-operations.md` | — | 3, 42, 44 |
| 16 | Nest domain: Imports | `issues/16-nest-domain-imports.md` | — | 3, 22, 42 |
| 17 | Nest domain: Portal + credit insurance | `issues/17-nest-domain-portal-credit-insurance.md` | — | 4, 5 |
| 18 | Nest domain: System, reports, catch-all leftovers | `issues/18-nest-domain-system-reports-catchall.md` | — | 6, 9, 12, 32, 37, 43, 45 |
| 19 | Retire jiti strangler for product HTTP | `issues/19-retire-jiti-strangler.md` | 11–18 | 34, 35, 40, 41 |

**Status:** slices 01–19 done · **Next:** Lane A — SMS Twilio spike + peel playbook; Lane B — Amplify (parallel). See living plan D22–D52.
