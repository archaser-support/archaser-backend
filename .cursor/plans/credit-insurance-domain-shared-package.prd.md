---
name: credit-insurance-domain-shared-package
overview: Consolidate the duplicated credit-insurance domain into one shared workspace package and replace the filesystem-path module loader with typed imports.
source: grill-me session
clickup_task_url: null
isProject: false
---

# Credit-insurance domain — shared workspace package

## Problem Statement

The credit-insurance domain logic exists as two byte-identical copies, in
`api/src/credit-insurance/domain/` and `reports/src/credit-insurance/domain/`,
kept in sync entirely by hand. There is no sync script and no check that the
copies match. When a developer fixes a calculation in one copy and forgets the
other, the interactive dashboard and the generated reports silently disagree
about the same customer's numbers, and nothing fails until someone notices two
screens showing different figures.

Two workspace packages consume the same domain a third way. `packages/cron-jobs`
and `packages/billing-connector` do not import the domain — they call `require()`
on a hardcoded relative path into the api service's compiled output
(`../../../api/dist/credit-insurance`), declaring their own untyped shapes at
each call site. That target folder is gitignored, so two packages depend at
runtime on an uncommitted build artifact of a service they cannot legally
import. Renaming or moving a domain file does not break the build; it breaks a
cron job in production.

The duplication also carries dead weight. Roughly 32 files in the reports copy
cannot be reached from any reports entry point, yet they still compile and still
have to be hand-synced.

## Solution

Extract the domain code that more than one process needs into a single shared
workspace package, alongside the existing `@archaser/database` and
`@archaser/auth`. Every consumer — the api service, the reports service, the
worker via cron-jobs, and connectors via billing-connector — imports the same
package through normal typed imports.

Deleting the string-based loader converts 11 untyped runtime `require` calls into
real imports, so a missing or renamed module fails the type check instead of
failing a production cron run. The unreachable copies in the reports tree are
deleted rather than packaged.

## User Stories

1. As a backend developer, I want one home for credit-insurance domain logic, so that fixing a calculation once fixes it everywhere.
2. As a backend developer, I want the build to fail when I rename a domain module that a cron job depends on, so that I do not discover the mistake in production.
3. As a backend developer, I want typed imports instead of `require()` on a string path, so that my editor can find call sites and rename symbols safely.
4. As a backend developer, I want to stop hand-mirroring every edit into a second tree, so that I stop shipping half-applied fixes.
5. As a backend developer, I want the reports service to stop compiling ~32 files it can never call, so that its build reflects what it actually uses.
6. As a backend developer, I want a clear error when the database client was never bound, so that I can tell setup mistakes from query bugs.
7. As a developer running the stack locally, I want `npm run dev:all` to build workspace packages for me, so that I do not run stale compiled code after editing a package.
8. As a developer reviewing a pull request, I want domain changes to show only source edits, so that ~20,000 lines of compiled output do not bury the real diff.
9. As a finance user reading the credit dashboard, I want the numbers to match the generated report for the same customer and date, so that I can trust either surface.
10. As a finance user, I want an insurance-fields fix to reach both the dashboard and my exported report in the same release, so that I am not told to "check the other screen".
11. As an operator deploying the backend, I want the shared package built before the services that depend on it, so that a deploy cannot start a service against missing modules.
12. As an operator, I want the runtime path override removed, so that no environment can silently load domain code from an unexpected location.
13. As an on-call engineer, I want a cron job that references a missing domain module to fail at build time, so that I am not paged for an avoidable runtime crash.
14. As a reviewer of this migration, I want proof that compiled output is unchanged, so that I can approve a 20,000-line move without reading every line.
15. As a future maintainer, I want api-only logic to stay in the api service, so that the shared package holds only genuinely shared code.
16. As a future maintainer, I want the package to have no dependencies on other Archaser packages, so that it stays a leaf and cannot create a dependency cycle.
17. As a developer adding a new consumer of the domain, I want a documented package to import, so that I do not copy the folder a third time.

## Implementation Decisions

Decisions D1 through D6 come from a grilling session; each is stated with the
codebase finding that drove it.

### D1 — Delete the unreachable copies before sharing

The ~32 files in the reports tree that no reports entry point can reach are
deleted, not moved into the package. The 57 files present in both trees are
currently byte-identical, so this is the cheapest possible moment to
consolidate: there is no semantic reconciliation work, only a move.

### D2 — Gitignore the new package's compiled output, and fix the dev gap first

The deploy script already rebuilds all nine workspace packages on the host in
dependency order before containers start, so committed compiled output is not
required to deploy. It is required only because the dev startup script compiles
`api` and `reports` but never `packages/*`, and no tsconfig defines path
mappings — so local imports resolve through the `node_modules` symlink to the
package's compiled entry point.

Therefore the dev startup script gains a package build step, and the new
package's compiled output is gitignored. Adding the build step is a
**prerequisite**, not a cleanup task: gitignoring first would break local dev.

Whether to apply this repo-wide to the existing packages is deliberately out of
scope.

### D3 — The package replaces the filesystem-path loader

`packages/cron-jobs/src/creditDomain.ts` and
`packages/billing-connector/src/credit/arPostIngestHost.ts` are deleted, along
with the `CREDIT_INSURANCE_DOMAIN_ROOT` override, and their call sites become
typed imports of the shared package.

This is safe because the shared domain files contain zero `@archaser/` imports,
making the new package a true leaf. Only the api-only files import
`billing-connector` and `cron-jobs`, and those stay in the api service, so no
dependency cycle is created.

### D4 — Keep the bind pattern, add an unbound guard

The domain reads a module-level Prisma client that each service overwrites at
startup via `bindCreditInsurancePrisma`. There are 143 query call sites across
33 files and 8 bind call sites in production code, so threading a client
explicitly through every function would be a rewrite rather than a move.

The pattern is preserved. The only change is that reading the client before it
is bound raises a named error telling the caller to bind first, instead of
surfacing as an undefined-property crash on the first query.

### D5 — Package contains the union of all consumers' needs

The 11 dynamically-loaded modules are additional entry points whose dependency
closure is 45 files. Unioned with the reports closure of 25 files, the package
holds 50 files (about 20,000 lines).

The remaining 17 files (about 4,800 lines) stay in the api service because only
it uses them: as-of backfill, post-import overdue metrics, portfolio health,
registration-fee percent, parent-policy top-up, and similar. This supersedes the
initial 25-file estimate, which was made before the dynamic entry points were
found.

### D6 — Merge bar is a full type check plus compiled-output equivalence

Because the overlapping files are byte-identical, comparing compiled output
before and after the move is a strong and cheap proof that behavior did not
change. A full workspace type check is the second gate, and it is the mechanism
that makes D3's benefit real — it is what turns the previously untyped dynamic
requires into build-time errors.

### Package shape and deploy ordering

The package follows the conventions of the existing packages: a private
workspace package with a single entry point exporting the domain's public
surface, its own type declarations, and a `build` script. It is added to the
deploy script's ordered build list before `api`, `cron-jobs`, and `reports`.

### Sequencing

The file move is provably safe under D6. The two parts that can break a working
environment are D2, which changes the dev loop for everyone, and D3, which
removes a runtime escape hatch that a deployed environment may be relying on.
Recommended split: land D1 and the extraction first, then D2 and D3 as a
separate change so the risky pieces are isolated and independently revertible.

## Testing Decisions

A good test here asserts externally observable behavior — the values a consumer
receives and the rows written — never the internal call sequence. Because this
is a move rather than a behavior change, the primary evidence is mechanical
equivalence rather than new assertions.

### Seams

The seam is the exported function surface of the domain modules, which already
exists and is already used by the current tests: the dashboard and summary entry
points, the insurance-field sync functions, and the other dynamic entry points.
The migration reuses this seam and introduces no new ones. It reduces the seam
count: the package boundary becomes a single typed seam in place of 11 untyped
runtime `require` seams.

### Gates

1. **Compiled-output equivalence.** Build before and after; the emitted output
   for the moved modules must be identical apart from module paths. This is the
   main proof that no logic changed.
2. **Full workspace type check.** Must pass across every workspace, including
   the migrated cron-jobs and billing-connector call sites.
3. **Existing tests.** The 8 api tests that exercise this domain must pass
   unchanged. They are the prior art for domain-level testing and are the
   closest thing to a behavioral net.
4. **Reachability evidence for deletions.** Every file deleted under D1 must be
   shown unreachable from both static imports and the enumerated dynamic
   require strings — the second check is what the initial analysis missed.

### Coverage risk to state plainly

The automated net is weakest exactly where the code moves: the reports service
has no test directory at all, and `packages/cron-jobs` has two tests unrelated
to this domain. Adding tests for the reports service and the cron entry points
was considered and deliberately deferred, so the type check and output
comparison are carrying the safety burden. The dynamic entry points should be
exercised manually at least once before the D3 change ships.

## Out of Scope

- Any change to how credit-insurance numbers are calculated. This is a move.
- Applying the gitignore-plus-build-step treatment to the existing packages.
  Only the new package is covered.
- Adding test coverage for the reports service or cron entry points, which the
  merge bar deliberately excludes.
- Moving the 17 api-only files into the package.
- Consolidating the duplicated `domain-db` binding modules beyond what the
  package requires.
- Replacing the committed compiled output of the existing packages.
- Any frontend change. Consumers reach this logic only through existing APIs.

## Issues (vertical slices)

Tracer-bullet breakdown published as local markdown under
`.scratch/credit-insurance-domain-shared-package/`. **Hard blockers** are
recorded in each slice's **Blocked by** header. Implement in dependency order;
start a **fresh session per issue**.

**Overview:** `.scratch/credit-insurance-domain-shared-package/OVERVIEW.md`

| # | Title | File | Waiting on | User stories |
|---|-------|------|------------|--------------|
| 1 | Build workspace packages on dev startup | `issues/01-dev-startup-builds-packages.md` | — | 7, 8 |
| 2 | Delete the unreachable domain copies from the reports service | `issues/02-delete-unreachable-reports-copies.md` | — | 5, 15 |
| 3 | Create the shared package and migrate the reports service onto it | `issues/03-create-package-migrate-reports.md` | 1, 2 | 1, 4, 6, 9, 10, 11, 16, 17 |
| 4 | Replace the filesystem-path loader with typed imports | `issues/04-replace-path-loader-with-typed-imports.md` | 3 | 2, 3, 12, 13 |
| 5 | Migrate the api service and delete the last duplicate | `issues/05-migrate-api-delete-duplicate.md` | 4 | 1, 4, 9, 10, 15 |

Slices 1 and 2 are prefactors and can run in parallel. Slice 4 must land before
slice 5: `cron-jobs` and `billing-connector` resolve the domain out of the api
service's compiled output, so deleting the api copy first would break the
worker. The environment-variable gate in *Further Notes* blocks slice 4 only.

**Status:** `ready-for-agent` on all slices.

## Further Notes

### Blocking gates before the loader deletion

One gate is resolved and one is not.

**Resolved:** no code outside the backend repo references the loader path, the
override variable, or the loader helpers. The separate tests repository contains
no such references, and the variable appears nowhere in the backend repo except
the two loader files — no compose file or checked-in env file sets it.

**Open, and blocking D3 only:** whether `CREDIT_INSURANCE_DOMAIN_ROOT` is set in
a deployed staging or production environment file. If it is set and the loader is
deleted without unsetting it, the worker keeps resolving domain code from the old
path and silently runs stale logic. This needs someone with server access to
confirm; it cannot be answered from the repository.

### Why this window matters

The two trees are byte-identical today. That state is maintained by hand, and it
already nearly broke during a routine cleanup pass when five dead-code removals
had to be mirrored manually into both trees. Every day without consolidation is
a chance for drift, and drift converts this pure move into a reconciliation
exercise where someone must decide which copy is correct.

### Observation for a later change

Only three files in the reports service import from its domain folder, yet the
folder carries the full domain surface. Once the package exists, the reports
service's dependency on the domain is small and explicit enough that its real
needs could be narrowed further.
