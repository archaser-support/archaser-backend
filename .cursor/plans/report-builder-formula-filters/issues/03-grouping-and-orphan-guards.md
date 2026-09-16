# 03 — Grouping conflict and orphan formula filter guards

**Status:** done
**Priority:** normal
**Blocked by:** [01-yes-no-formula-filter-e2e](01-yes-no-formula-filter-e2e.md)
**User stories:** 22–27, 40
**PRD:** `.cursor/plans/report-builder-formula-filters.prd.md`

## What to build

Hard guards so formula filters cannot silently misbehave. **Grouping + any formula filter** cannot be saved or executed — clear error telling the user to remove one. A filter that points at a **deleted / unknown** formula id cannot be saved or executed — clear error (do not silently skip like unmapped computed fields). Enforce on builder save and on server execute/export (including viewer overrides). Soft note: slice 02 can proceed in parallel after 01; this slice does not depend on number operators. EN+HE for error strings.

## Acceptance criteria

- [x] Saving a report with grouping and at least one formula filter fails with a clear message.
- [x] Executing (or exporting) with grouping and a formula filter fails with a clear message (including session overrides).
- [x] Saving with a filter whose formula id is not on the report fails with a clear message.
- [x] Executing/exporting with an orphan formula filter fails with a clear message (not a silent no-op).
- [x] Valid ungrouped formula filters from slices 01–02 still save and run.
- [x] Matching English and Hebrew locale keys are added/updated together for these errors.

## How to test

1. Save a working Yes/No (or number) formula filter on an ungrouped report; confirm it still runs.
2. Turn on grouping while the formula filter remains; attempt save — expect a clear error; fix by removing grouping or the formula filter.
3. With grouping on, try a viewer session formula filter override and run — expect a clear execute error.
4. Delete the formula (or point a filter at a fake `formula:…` id) and attempt save/run — expect a clear orphan error, not an unfiltered report.
5. Spot-check Hebrew for both error messages.
