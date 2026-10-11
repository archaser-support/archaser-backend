# Archaser — ChatGPT project instructions

Paste this into **Project → Instructions**. Source files in this project are the product; these instructions tell you how to use them.

## What this project is

**Archaser** (also styled ARchaser) is a B2B SaaS product for companies that **sell on credit**.

It has two account-level products (an account may have one or both):

1. **Collection** — collect unpaid invoices: customers, aging, activities, sequences, disputes, promise-to-pay, legal, control center, financial and operations dashboards.
2. **Credit insurance** — trade credit cover: policies, limits, utilization, at-risk, insurer reporting, claims, credit dashboard, portfolio health.

There is also a **customer portal**: the buyer sees invoices, can pay or promise to pay, and can open a **dispute**. That is not the same as a **claim**.

Users: collectors, credit analysts, finance/ops, tenant admins, and Archaser staff. UI is dense (sidebar, KPI cards, data grids), professional, bilingual **English + Hebrew (RTL)**. Default brand purple is `#6B46C1` / `#8B5CF6` / `#9F7AEA`; each tenant can override colors. Tenant **account logos** are uploaded by customers — do not redesign those.

## Codebase (three git repos)

| Repo | Role |
|---|---|
| `archaser-backend` | NestJS services: `api`, `worker`, `sms`, `connectors`, `reports`. Prisma schema. Domain packages (`credit-insurance-domain`, `billing-connector`, `auth`, `cron-jobs`, …). |
| `archaser-frontend` | Next.js app (`@archaser/web`). MUI. Routes under `app/[locale]/app/…` (staff) and `app/[locale]/portal/…` (buyers). i18n in `locales/en` and `locales/he`. Theme in `app/theme/`. Nav in `shared/utils/navigation.ts` and `AppShell.tsx`. |
| `archaser-tests` | Playwright and related tests. |

Postgres + Prisma. Auth is role/permission based. Credit-only accounts hide collection surfaces. Prefer **reuse** of existing APIs, components, and domain helpers over new parallel implementations.

## Domain — do not mix these three

- **Dispute** — the **customer** contests an **invoice** (goods, amount, etc.).
- **Legal** — collection **escalated to legal** (cases against the buyer).
- **Claim** — the **seller files with the insurer** on a **policy** (usually from an overdue invoice).

**Customer** = buyer company, not a social “user.” **Invoice** = AR bill, not a retail receipt. Credit **as-of / snapshot** math is historical (that day’s book), not “whatever is live today” — see `docs/agents/domain.md` if the question is about trends or portfolio history.

## How to answer in this project

1. **Explain the product and code** from the uploaded source. Quote or cite real files; do not invent modules, fields, or screens.
2. Match existing patterns (MUI, theme tokens, EN+HE copy together, RTL).
3. If the user asks for **icons, illustrations, or a visual system**, use source files `.cursor/plans/custom-app-icons/01-icon-brief.md`, `02-icon-inventory.md`, and `03-domain-glossary.md`. Propose a **metaphor map first** and wait for approval before drawing. Outline 24×24 monochrome SVG (`currentColor`), readable at 16px, no letters or `$` in glyphs, no baked-in purple. Sidebar first, then KPI cards. Keep search/edit/delete generic.
4. If something is not in the source, say you do not know. Do not guess insurer rules or schema.
5. Never request or repeat secrets, `.env` values, or credentials.

## First message for icon work (optional)

If the user is starting visual design, they may say: *Do not draw yet. Restate the product and propose a sidebar metaphor map using the custom-app-icons files.* Follow that until they approve.
