# Breach tooltip enrichment

Enrich the tooltip under the customer invoice grid's **Contains breaches / violations** column so every active breach explains itself. A breach caused by MEP (Maximum Exposure Period) on another invoice names that invoice and shows a frozen snapshot of why it caused the breach. The other breaches show their own relevant values (dates, days, limits).

**PRD:** none. The source of truth is the grilling decision log below (grill-me session, Oct 8 2026).

Vertical slices live under `issues/`. Implement in dependency order; start a **fresh session per issue**.

## Decision log

| # | Topic | Decision | Rationale / plan impact |
|---|-------|----------|-------------------------|
| D1 | Where | Only the **Contains breaches / violations** column on the customer invoice grid | Per-flag warning-icon columns and the report Terms Breach Reason text stay unchanged |
| D2 | MEP cause details | Cause invoice number, its due date, its outstanding at the time, and days past MEP when the flagged invoice was created | Only the cause invoice number is stored today, so new stored fields are needed |
| D3 | Snapshot vs live | Snapshot frozen when the MEP flag is computed | The tooltip still explains the breach after the cause invoice is paid |
| D4 | Already-flagged invoices | Fill the new fields the next time terms flags are recomputed | No separate one-time backfill job |
| D5 | Other breaches | Every active breach gets its relevant details | Uses invoice / customer / policy data that already exists |
| D6 | Layout | One section per breach: bold title, label/value rows, thin divider between sections, ~320px wide, right-to-left aware | New tooltip styling approved by the user |
| D7 | Cause invoice | Plain text, not clickable | The tooltip stays non-interactive |
| D8 | Outstanding currency | Invoice (customer) currency | Matches the grid amount column |

## Agreed detail rules (not separately grilled)

- **Reporting breach:** target reporting date, plus days late. If reported, days late = actual reporting date − target. If not yet reported, days late = today − target.
- **Payment term:** credit days (due date − invoice date) against the customer's max payment term.
- **Outdated DCL (Declared Credit Limit):** credit score input date and score validity period.
- **Invoice after policy end:** invoice date and policy end date.
- **Excluded from policy:** exclusion reason when present.
- **MEP with only a cause number stored** (not yet recomputed): show the cause number row only. **MEP with nothing stored:** title only, as today.
- Tooltips follow `frontend-tooltips.mdc` (`placement="bottom"`, arrow, delays, right-to-left text direction). All new copy ships in English and Hebrew.
