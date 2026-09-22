# 03 — Aggregates use VAT basis + background refresh

**Status:** done
**Priority:** high
**Blocked by:** [01-account-vat-setting-basis-helper](01-account-vat-setting-basis-helper.md), [02-invoice-vat-fields-import-ui-reports](02-invoice-vat-fields-import-ui-reports.md)
**User stories:** 3, 4, 4a–4c, 7, 8, 9, 11, 13, 16
**PRD:** `.cursor/plans/account-vat-include-exclude.prd.md`

## What to build

Route collection and credit-insurance open-AR consumers (customer due/overdue rollups, Total AR / open receivable, capacity gap, and related policy metrics that sum open outstanding) through the shared basis helper. Keep payment matching and credit-note net on the with-VAT ledger.

On VAT switch change: confirmation dialog → save setting → enqueue **background** account-wide refresh with portfolio-health-style progress (done/total). Live reads apply the new setting immediately; denormalized fields update as the job runs. Mid-job flip **supersedes** the old job. On failure: keep setting, show error, allow Retry. English and Hebrew for confirm + progress/failure copy.

## Acceptance criteria

- [x] Include mode totals match pre-feature with-VAT outstanding sums
- [x] Exclude mode scales lines that have without-VAT and with-VAT; missing VAT fields stay unscaled
- [x] Payments still settle invoices on with-VAT outstanding math
- [x] Toggle change requires confirm; Cancel does not save; Confirm enqueues job (not sync HTTP for all customers)
- [x] Progress UI shows done/total (and ETA when available); live customer AR reflects new setting while job runs
- [x] Flip mid-job supersedes; failure keeps setting and supports Retry
- [x] Matching English and Hebrew locale keys for confirm / progress / failure
- [x] Customer dashboards and reports that already use denormalized fields show the new basis after the job (without new field names)

## How to test

1. On an account with known open invoices (VAT triad filled), note Total Due / Overdue / Total AR / capacity gap under **include**.
2. Flip to **exclude** — confirm dialog appears; Cancel leaves include; Confirm starts progress bar.
3. While job runs, open a customer header — live Total AR should already use exclude basis; list rollups may still catch up.
4. When job completes, list KPIs match the exclude basis; lines missing without-VAT stay at full outstanding.
5. Flip again mid-job (if possible) — old job superseded; progress restarts for the latest setting.
6. Force or simulate failure — failed state + Retry; setting not rolled back.
7. Apply a payment — invoice paid/outstanding still follow with-VAT amounts.
8. Spot-check Hebrew confirm/progress strings.