# 01 — Yes/No formula filter from builder to export

**Status:** done
**Priority:** high
**Blocked by:** —
**User stories:** 1–4, 9–18, 20–21, 28–33, 35, 38, 40
**PRD:** `.cursor/plans/report-builder-formula-filters.prd.md`

## What to build

End-to-end path: filter an ungrouped report by a **Yes/No** formula so only matching rows appear in the viewer (and exports/schedules that use the same execute path), with **correct page totals**.

Editors and viewers can pick any formula defined on the report (including hidden columns) using the stable `formula:<id>` identity and the formula label in the UI. For Yes/No formulas, offer equals / not equals / is empty / is not empty and a Yes/No value control (locale labels; stored as 1/0). Blank formula cells do not match equals Yes or equals No.

When any formula filter is present: apply database filters in SQL as today, load the matching rows, evaluate formulas, apply formula filters in memory, then paginate and set totals from that filtered set. Existing non-formula filters must keep working. Do not implement number greater/less operators, grouping conflict UI, or orphan-formula errors in this slice (those follow). Translation keys for new filter copy ship EN+HE together (implement with translation permission).

## Acceptance criteria

- [x] Every formula on the report appears in builder and viewer filter field lists (label shown; id stored).
- [x] Yes/No formulas expose equals, not equals, is empty, is not empty and a Yes/No value control (not a raw 1/0-only UX).
- [x] Saved filter “formula equals Yes” returns only rows with raw `1`; equals No only raw `0`; blank rows excluded from both.
- [x] `totalRecords` and page contents reflect the post-formula filtered set (not “filter the current DB page”).
- [x] CSV/Excel (and PDF/scheduled via the same execute path) honor the formula filter.
- [x] Viewer session filter overrides can set a formula filter the same way as other filters.
- [x] Non-formula filters still apply as Prisma WHERE before formula evaluation.
- [x] Matching English and Hebrew locale keys are added/updated together for new filter copy in this slice.

## How to test

1. After comparisons Yes/No works: open Report Builder on an Invoice report with a Yes/No formula such as invoice date = due date.
2. Add a filter on that formula equals Yes, save, run the report.
3. Confirm only Yes rows show; a row with a missing date (blank formula) does not appear under equals Yes or equals No.
4. Change page size / page and confirm the total count matches the filtered set.
5. Export CSV/Excel and confirm the same narrowed rows.
6. In the viewer, change the session filter to equals No (or clear it) and confirm results update without editing the saved report.
7. Spot-check Hebrew locale for Yes/No filter value labels and any new error/hint strings added here.
