---
name: dev-mode-performance
overview: Reduce Next.js development cold-start and hot-reload cost by splitting the authenticated app shell, segmenting i18n bundles, extracting shared auth config, collapsing duplicate providers, dynamically loading entity API handlers and cron jobs, and adding optional Turbopack dev tooling.
source: architecture review + grill-me sessions + in-chat implementation
clickup_task_url: null
isProject: false
---

# Development-Mode Performance (c1–c7)

## Problem Statement

Local development of the Archaser Next.js 15 hybrid app (App Router UI + Pages API) is slow. Every dev server start and many hot reloads pull in large, overlapping bundles:

- The authenticated **app shell** and root layouts load together with locale/auth-only routes.
- **i18n** preloads all application namespaces for every route group.
- **NextAuth `authOptions`** lives inside the Pages API auth route, so any import of auth config drags API compilation into unrelated modules.
- **SessionProvider** and **ThemeRegistry** are mounted twice in the provider tree.
- The **`/api/entities/[...path]`** catch-all is an ~12k-line monolith; Webpack compiles the entire entities surface for any entity request or any file that statically imports from it.
- **`cronManager`** statically imports every cron job at module load, bloating any code path that touches cron scheduling.
- Default Webpack dev has no project-specific compile adapters for heavy server packages or MUI import patterns.

Developers wait longer to start work, iterate slower on UI and API changes, and see noisy compile graphs that obscure real regressions.

## Solution

A phased **development-performance program** (candidates c1–c7) that shrinks what loads at dev time without changing production behavior:

1. **Split the authenticated app shell** — Server `app/[locale]/app/layout.tsx` composes i18n + client `AppShell`; mechanical split only.
2. **Segment i18n by route group** — Locale layout loads `common` + `auth`; app layout loads app namespaces; portal layout loads `portal` + `invoices`; active-locale-only preload.
3. **Extract `authOptions`** — Shared module consumed by Pages API and App Router; thin `[...nextauth]` adapter; no `server-only` guard (breaks Pages API bundle).
4. **Collapse duplicate providers** — Single `SessionProvider` + `ThemeRegistry` in locale `Provider.tsx`; root layout keeps Redux + error handlers only.
5. **Split entities catch-all** — Thin router + `entityDispatch` with dynamic `import()` per entity handler module; shared helpers in `entityShared`; revalidation helper extracted to a service.
6. **Lazy-load cron jobs** — Dynamic `import()` inside `executeJobWithLogging` switch; remove static top-level cron imports from `cronManager` (keep `EmailService` static where still needed).
7. **Compile adapters** — `dev:turbo` script, `serverExternalPackages`, MUI `modularizeImports`, dev `pagesBufferLength` tuning.

Together these reduce dev compile scope, provider duplication, and eager server module graphs while preserving existing API contracts and runtime behavior.

## User Stories

1. As a developer, I want `npm run dev` to start faster, so that I spend less time waiting before debugging.

2. As a developer, I want editing an app page to recompile only the app route group and its dependencies, so that hot reload stays responsive.

3. As a developer, I want auth and marketing/locale-only routes to avoid loading full app i18n namespaces, so that login and static flows stay lightweight.

4. As a developer, I want the portal route group to load only portal-related translations, so that customer portal work does not pull collection app copy.

5. As a developer, I want i18n to preload only the active locale, so that Hebrew and English bundles are not both fetched during dev navigation.

6. As a developer, I want `authOptions` imported from one shared module, so that session configuration is consistent across App Router and Pages API.

7. As a developer, I want the NextAuth API route to remain a thin adapter, so that auth route edits do not require touching business logic.

8. As a developer, I want shared auth config to work in Pages API without `server-only` runtime errors, so that API routes can import it safely.

9. As a developer, I want a single `SessionProvider` in the tree, so that session context is not duplicated and refocus bugs are avoided.

10. As a developer, I want a single `ThemeRegistry` for the main app chrome, so that MUI theme setup is not compiled and mounted twice.

11. As a developer, I want the root layout to keep only cross-cutting providers (Redux, error handlers), so that route groups own their presentation concerns.

12. As a developer, I want the auth layout to keep its static `ThemeProvider` unchanged, so that login styling is unaffected by app shell refactors.

13. As a developer, I want `/api/entities/customers` requests to load only the customers handler module, so that invoice or user handler edits do not recompile unrelated entity code.

14. As a developer, I want entity routing logic (`parsePath`, auth helpers, body parsing) centralized, so that handler modules stay focused and DRY.

15. As a developer, I want insurance policy handlers to remain in their existing dedicated modules, so that prior extractions are preserved.

16. As a developer, I want collection-period revalidation logic in a service, so that activities API and entity handlers share one implementation.

17. As a developer, I want cron manager startup to avoid importing every job file, so that touching cron scheduling does not compile all job implementations.

18. As a developer, I want each cron execution to load only the job being run, so that admin “run now” and scheduled runs stay isolated at compile time.

19. As a developer, I want `npm run dev:turbo` as an optional faster dev path, so that I can compare Turbopack vs Webpack on my machine.

20. As a developer, I want heavy server packages externalized in dev config, so that Prisma and similar deps are not over-bundled.

21. As a developer, I want MUI imports modularized, so that icon and component barrels do not inflate compile graphs.

22. As a developer, I want `npx tsc --noEmit` to pass after the refactor, so that type safety catches wiring mistakes before runtime.

23. As a QA engineer, I want entity API behavior unchanged for customers, accounts, and invoices, so that regression risk is limited to performance plumbing.

24. As a QA engineer, I want login, app navigation, and portal flows to work after provider collapse, so that session and theme regressions are caught early.

25. As a QA engineer, I want admin cron job listing and manual run to work, so that lazy loading does not break operations tooling.

26. As a collection manager using the app, I want no visible behavior change, so that this work is invisible to end users.

27. As an ARchaser admin, I want view-as and password-change user flows to keep working via entities API, so that admin tooling is not broken by handler splits.

28. As a developer maintaining disputes and customer activity endpoints, I want nested customer paths (log-call, send-email, stuck-activities) to route correctly, so that activity workflows remain intact.

29. As a developer, I want insurance nested routes (named-policies, countries, bulk-replace) to dispatch as before, so that credit insurance configuration is unaffected.

30. As a developer, I want bank-account and business-unit nested account paths parsed identically, so that settings screens keep working.

31. As a developer, I want rate limiting and error handling on the entities router unchanged, so that API middleware behavior is preserved.

32. As a developer on Windows, I want the split to use standard dynamic `import()` paths, so that dev works on the team’s primary OS.

33. As a tech lead, I want the entities router file to be a thin orchestrator, so that future entity additions follow a clear handler-per-entity pattern.

34. As a tech lead, I want scope limited to `entities/[...path]` (not system/operations catch-alls), so that the PR stays reviewable.

35. As a developer, I want one-off migration scripts kept out of production bundles, so that repo scripts are disposable after the split lands.

36. As a developer comparing dev modes, I want default `npm run dev` unchanged on Webpack, so that Turbopack experiments are opt-in.

37. As a developer editing `authOptions`, I want one file to update, so that session provider config does not drift across routes.

38. As a developer, I want AppShell to remain a client component with React Query and toast providers, so that existing client hooks continue to work.

39. As a developer, I want nested page-level `TranslationsProvider` instances left as-is for now, so that c2 does not expand into a page-by-page cleanup.

40. As a developer planning c8, I want Prisma/metrics singleton deferral documented as out of scope, so that follow-up work is explicit.

## Implementation Decisions

### c1 — App shell split

- **Mechanical split only** — No behavior change to providers inside the shell.
- Server `app/[locale]/app/layout.tsx` loads app i18n namespaces and renders client `AppShell`.
- `AppShell.tsx` holds client UI shell (navigation, layout chrome, React Query, toasts, etc.).

### c2 — i18n segmentation

- Locale layout (`app/[locale]/layout.tsx`): namespaces `common`, `auth` only.
- App layout: all application namespaces (~23).
- Portal layout: `portal`, `invoices`.
- `app/i18n.ts`: `preload: [locale]` — active locale only.
- Combined delivery with c1 in the layout split.
- **Explicit non-goal:** removing redundant page-level `TranslationsProvider` wrappers (follow-up).

### c3 — Auth extraction

- Move `authOptions` to `server/auth/authOptions.ts` (move only, no behavior change).
- `pages/api/auth/[...nextauth].ts` becomes a thin re-export/adapter.
- Update all import sites to `@/server/auth/authOptions`.
- **Do not** add `server-only` to `authOptions` — Pages API (`api-node` bundle) throws at runtime if guarded.

### c4 — Provider collapse

- Single `SessionProvider` + `ThemeRegistry` in `app/[locale]/Provider.tsx`.
- `app/layout.tsx`: Redux + global error handlers only.
- Remove duplicate `SessionProvider` from `AppShell.tsx`.
- Auth layout static `ThemeProvider` unchanged.

### c5 — Entities API split

- **Scope:** `pages/api/entities/[...path].ts` only (not `system/[...path]` or `operations/[...path]`).
- Thin router: path parsing, method switch, rate limit + error handler export.
- `entityDispatch.ts`: `handleGET` / `handlePOST` / `handlePUT` / `handleDELETE` with `switch (entityType)` and dynamic `import("./handlers/<entity>")`.
- Handler modules under `handlers/` export their `handle*` functions; shared code in `entityShared.ts` (`parsePath`, `parseRequestBody`, `parseFormDataWithLogo`, `validateUserAuth`, `DB_TO_ENUM_MAPPING`, `RequestValidationError`, `SortOrder`).
- Existing `insurancePolicyHandlers.ts` and `customerPolicyHandlers.ts` remain; dispatch imports them dynamically where needed.
- `revalidateStuckCollectionPeriodsForCustomer` extracted to `CollectionPeriodRevalidationService`; activities API re-exports from service.
- Cross-handler calls within entity domain (e.g. customer by-id delegating to stuck-activities or invoices-available-for-dispute) use direct imports between handler modules where no cycle exists.

### c6 — Cron lazy loading

- Remove static top-level imports of individual cron job modules from `cronManager.ts`.
- Dynamic `import()` per job inside `executeJobWithLogging` switch cases.
- Keep `EmailService` static import where still used for notifications (not part of lazy job graph).
- No separate registry file — inline switch keeps one seam.

### c7 — Compile adapters

- `package.json`: add `"dev:turbo": "next dev --turbo"`; keep `"dev"` on Webpack.
- `next.config.js`:
  - `serverExternalPackages` for heavy server deps (e.g. Prisma, bcrypt, formidable).
  - `modularizeImports` for MUI packages.
  - `pagesBufferLength: 8` in development for Pages API buffering.

### Prototype-derived dispatch shape (from implementation)

Entity dispatch follows method-first orchestration with entity-type switch and dynamic handler load:

```
handleGET/POST/PUT/DELETE(entityType) →
  switch (entityType) →
    await import("./handlers/<entity>") →
    return handle<Entity><METHOD>(...)
```

Special paths (customer activity POST, user view-as, insurance nested PUT) remain as pre-switch branches in `handlePOST` / `handlePUT` / `handleDELETE`.

## Testing Decisions

### What makes a good test

- Assert **external behavior** (HTTP status, JSON shape, routing to correct handler side effects) — not internal `import()` call order or file layout.
- Prefer the **highest seam** that gives confidence without brittle coupling to implementation.

### Primary test seam (recommended)

**Single seam: TypeScript compile + targeted API smoke**

1. **`npx tsc --noEmit`** — Gates the entire c1–c7 wiring (layouts, auth import paths, entity dispatch exports, cron manager imports, config types). This is the main automated gate for this program because most changes are compile-time graph reductions, not new business rules.

2. **Manual smoke checklist** (documented in PR / ClickUp slices) for runtime paths compile cannot prove:
   - Login + app page load + session refocus (c4)
   - Portal page load (c2)
   - Entities API: GET customers list, GET account, POST/PUT invoice or customer mutation (c5)
   - Admin cron jobs page + manual run of one job (c6)
   - Compare `npm run dev` vs `npm run dev:turbo` cold start subjectively (c7)

### Modules to test (when adding automated coverage)

- **Entity dispatch** — Optional future unit tests mocking dynamic imports are **not** required for initial merge; prior art is thin for this catch-all. Prefer one integration test per high-traffic entity if expanded later.
- **CollectionPeriodRevalidationService** — If unit tests existed for revalidation before extract, they should target the service (same behavior, new location).
- **authOptions** — No new tests unless session behavior changes; move-only.

### Prior art

- API route tests pattern: `tests/unit/notification-rule-sets.api.test.ts` (imports handler, mocks session, asserts status/body).
- Service unit tests under `tests/unit/` for extracted server services.
- Pre-commit static analysis: `npx tsc --noEmit`, `npm run lint`, `npm run test:unit` per project rules.

### Out of scope for automated tests in this PRD

- Benchmarking dev compile times in CI (environment-dependent).
- Visual regression for theme/provider collapse.
- Splitting `system/` or `operations/` API catch-alls.

## Out of Scope

- **c8** — Defer eager Prisma/metrics singleton initialization.
- **system/[...path]** and **operations/[...path]** god-router splits.
- Removing nested page-level `TranslationsProvider` duplicates.
- Production bundle / runtime performance optimizations beyond dev-oriented graph reduction.
- Changing entity API contracts, authorization rules, or business logic.
- Adding `server-only` to `authOptions`.
- Making Turbopack the default `dev` script (remains opt-in via `dev:turbo`).
- Translation file edits (none required for this program).
- New global styles or theme overrides.

## Further Notes

### Disposable tooling

One-off scripts used during the entities split (`split-entity-handlers`, `fix-entity-dispatch`, `fix-handler-exports`, `wire-entity-shared-imports`) may be deleted after merge or kept for reference; they are not part of runtime.

### Follow-up candidates

- **c8:** Lazy or on-first-use Prisma/metrics clients.
- **Page-level i18n cleanup:** Remove redundant `TranslationsProvider` where route layouts already supply namespaces.
- **Entity integration tests:** One test per entity handler for regression safety on future edits.
- **Dev compile metrics:** Optional local script to log cold-start time for `dev` vs `dev:turbo`.

### Rollout

Land c1–c4 as layout/auth/provider changes; c5–c7 can ship in the same PR as grilled (bundled) or as follow-up commits on the same branch. Verify smoke checklist before merge.

### Issue breakdown

Run **`/to-issues`** to publish vertical slices to ClickUp when ready for tracked delivery.

## Issues (vertical slices)

Tracer-bullet breakdown published to ClickUp default list (see `.cursorrules`). **Hard blockers** are wired as ClickUp **Relationships** (`Waiting on`) — read them from the task UI, not from description markdown. Implement in dependency order; start a **fresh session per issue**.

**Parent:** [Development-Mode Performance (c1–c7)](https://app.clickup.com/t/869dxy456)

| # | Title | ClickUp | Waiting on | User stories |
|---|-------|---------|------------|--------------|
| 1 | App shell split + route-group i18n segmentation (c1+c2) | [869dxy4ag](https://app.clickup.com/t/869dxy4ag) | — | 1–5, 38–39 |
| 2 | Extract shared authOptions module (c3) | [869dxy4bm](https://app.clickup.com/t/869dxy4bm) | — | 6–8, 22, 37 |
| 3 | Collapse duplicate SessionProvider + ThemeRegistry (c4) | [869dxy4d0](https://app.clickup.com/t/869dxy4d0) | 1 | 9–12, 24 |
| 4 | Split entities catch-all API with dynamic handlers (c5) | [869dxy4g7](https://app.clickup.com/t/869dxy4g7) | — | 13–16, 23, 27–34 |
| 5 | Lazy-load cron jobs in cronManager (c6) | [869dxy4j4](https://app.clickup.com/t/869dxy4j4) | — | 17–18, 25 |
| 6 | Dev compile adapters + optional Turbopack script (c7) | [869dxy4kt](https://app.clickup.com/t/869dxy4kt) | — | 19–21, 36 |

**Assignee / status:** Nilotpal Bose (`93674717`); Selected for Development
