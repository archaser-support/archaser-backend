# 03 — Charts and branding

**Status:** done
**Priority:** normal
**Blocked by:** [01-data-bundle-skeleton-pdf](01-data-bundle-skeleton-pdf.md)
**User stories:** 3, 6, 9, 11, 13, 20
**PRD:** `.cursor/plans/portfolio-summary-poc.prd.md`

## What to build

Add static charts and ARchaser branding to the PDF. The charts are drawn from bundle data: monthly policy cost, daily health, monthly compliant/at-risk AR, daily utilization and top-up draw. Each chart sits next to its narrative section. Branding reuses the existing Portfolio Health design tokens (colors, fonts) and the ARchaser logo, in an RTL layout with a cover header (account, range, generation date).

## Acceptance criteria

- [x] Five charts render with Hebrew labels, RTL-aware axes and correct values from the bundle
- [x] Colors and fonts come from existing Portfolio Health design tokens, with no new product styles
- [x] No new npm dependencies (use existing chart tooling or plain SVG)
- [x] Charts and text don't overflow or split badly across PDF pages

## How to test

1. Generate the PDF for account 10149, Apr 1 – Sep 30, 2026.
2. Compare each chart with the matching dashboard chart for the same range. Expect the same shape and values.
3. Check page breaks, the Hebrew axis labels and the cover header visually.
