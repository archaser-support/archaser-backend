# Archaser icon brief

Upload this file to the ChatGPT project (Knowledge). Pair it with screenshots.

## One paragraph

Archaser is a professional B2B app for companies that **sell on credit**. It helps them **collect unpaid invoices** and, when they have **trade credit insurance**, watch **policy limits, coverage, risk, and claims**. Day-to-day work is lists and dashboards, not marketing pages.

## Users

| Audience | What they do |
|---|---|
| Collectors | Chase overdue invoices, run sequences, handle promise-to-pay |
| Credit analysts | Limits, utilization, at-risk, reporting to the insurer, claims |
| Finance / ops | Receivables, due this week/month, import, reports |
| Admins | Accounts, settings, SMS, cron (internal) |
| Buyer (portal) | See invoices, pay or promise, open a dispute |

## Brand (default)

- Primary `#6B46C1`
- Primary light `#8B5CF6`
- Secondary `#9F7AEA`
- Tenants can **override** primary/secondary/chart colors. Icons must work as **one-color** glyphs on those tiles.

KPI cards already use **semantic accent tiles** (receivables, at-risk, overdue, capacity, terms, no-policy, reporting, health, etc.). The icon is a simple mark; **color comes from the tile**.

## Visual rules

- Outline, not filled blobs, not 3D, not illustration-in-icon
- 16 / 20 / 24 px in the real UI; design on a **24×24** grid
- Stroke 1.5–2px, rounded caps, square viewBox, optically centered
- **No text, letters, or currency signs** in the glyph (today Credit Dashboard uses a `$` — replace that)
- Same icon in LTR and RTL (Hebrew). Avoid “forward” chevrons unless you also define a mirrored set
- Dense Material UI layout — icons must stay quiet next to Hebrew and English labels

## Adjectives

Wanted: precise, insured, operational, calm.  
Not wanted: playful, luxury banking, crypto wallet, hunting/police “collections,” medical “claim.”

## Priority surfaces

1. App **sidebar** (see `02-icon-inventory.md`)
2. **KPI / metric cards** on financial, operations, and credit dashboards
3. Keep toolbar actions (search, filter, export) generic unless asked
4. Later: portal nav, empty states, favicon/app mark  
   Do **not** redesign uploaded **account logos**

## What success looks like

A **family** of icons: one stroke language, distinct silhouettes at 16px, each domain object readable without the label. ChatGPT should propose metaphors first, then draw.
