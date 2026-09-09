# 04 — Formula editor help page

**Status:** done
**Priority:** normal
**Blocked by:** [03-number-compare-and-grouping](03-number-compare-and-grouping.md)
**User stories:** 36–38
**PRD:** `.cursor/plans/report-builder-formula-comparisons.prd.md`

## What to build

Add a **Help** control on the formula editor dialog that opens a help page (second dialog, reuse `AppDialog` and existing layout — no new theme styles).

Content is **short rules plus copy-paste examples** for the locked language: `= != < > <= >=`, calendar day vs datetime, typed `2026-03-01`, Yes/No vs 1/0, mixing compare with math, grouping as a number, dates and numbers only. English and Hebrew with other formula strings.

Do not add a standalone docs route or a first-time overlay. Translation file edits need explicit permission at implement time.

## Acceptance criteria

- [x] Formula editor shows a Help control; opening it shows rules and copy-paste examples without leaving the editor flow.
- [x] Examples include `[Invoice.invoice_date] = [Invoice.due_date]` and `2026-03-01`.
- [x] Help describes Yes/No display, 1/0 underneath, calendar day vs datetime, and parentheses for mixed math.
- [x] Closing help returns to the formula editor with the draft intact.
- [x] Hebrew locale shows help in Hebrew when translations are added.
- [x] No new global CSS or theme tokens.

## How to test

1. Open Add formula in Report Builder.
2. Use the Help control — a help dialog lists rules and examples you can copy.
3. Copy `[Invoice.invoice_date] = [Invoice.due_date]` into the expression, close help, confirm the draft is still there.
4. Spot-check that examples match shipped behavior from slices 01–03.
5. Switch to Hebrew and confirm help strings (after translation permission).
