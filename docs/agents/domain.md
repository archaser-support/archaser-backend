# Domain notes for agents

## Credit insurance daily snapshots / trend jobs

**Rule:** Any job that writes or recomputes history for a `snapshotDate` (or as-of day D) must use **data as of that day**, never “today’s” live book.

Applies to:

- `CustomerPolicyTrend` writers (nightly, gap-fill, Generate / `CreditAsOfBackfillJob`, overnight as-of rewrite drain)
- `CreditDashboardDailySnapshot` writers for the same days
- Portfolio Health Generate and any other replay that stamps past calendar days

### What “as of that day” means

| Concern | Use on day D | Do **not** use |
| --- | --- | --- |
| Open AR | Invoice amount − payments with `payment_date` on/before D. **Paid leftover** uses shared `isWithinPaidTolerance` in **customer currency** (± account `invoice_paid_tolerance`) — same function Billing uses to stamp Paid. Document-currency float dust alone must not keep a line open. | Today’s `status === Paid` alone, or live `outstanding_debt` without as-of payments |
| Terms / at-risk | Dashboard as-of summary and CPT both run `overlayAsOfTermsFlagsForAccountLines` / `isCreatedInCustomerOverdueMep` before terms and at-risk. | Live `Invoice.ctv_*` alone on a historical `asOfDate` |
| Paid later | Invoice stays open on D if unpaid by D, even if Paid today | Skipping lines because live status is Paid and last payment was after D |
| **Today’s snapshot tip** (`D` = UTC today) | Follow the **live book**: `status === Paid` ⇒ closed on today’s CPT/as-of write (even if `payment_date` is still in the future) | Reopening live-Paid invoices on today via future-dated payments (makes the policy-risk chart tip disagree with live At Risk) |
| Limits / top-ups | Limits and top-ups effective on D (date-bounded) | Assuming today’s limit/top-up set for every past day without an as-of rule |
| Terms / breaches | Flags recomputed (or overlaid) for D | Stamping today’s CTV / reporting flags onto past days without replay |

### Known failure mode (do not reintroduce)

`liveClosed` (invoice `status === Paid` **today**) must not short-circuit as-of open AR on a **historical** day D when the payment ledger still shows a non-zero open amount on D. Payment **sums** are as-of D for snapshot AR; today’s Paid flag only closes history when that as-of residue is already within shared `isWithinPaidTolerance` (customer currency).

**Exception for D = UTC today:** `liveClosed` **does** close the line on today’s CPT tip (`wasAsOfInvoiceOpenAt`), so future-dated payments already applied live cannot inflate today’s policy-risk chart vs live At Risk.

**Created-in-MEP:** shared sweep `oldestOverdueDueAtEachInvoiceIssueDate` + `computeCustomerOverdueBlock` (CPT `overlayAsOfTermsFlagsOnLines` and live `resolveCreatedOverdueMepByInvoiceId`). O(C log C) per customer — do not reintroduce per-invoice sibling rescans. Replay may reuse snapshot-loaded siblings; `lastPaymentDate > issueDate` must still count a paid-later trigger as open (`wasAsOfInvoiceOpenAt`).

An invoice can be Paid today and still correctly appear open on an earlier snapshot day if it was unpaid by that day.

Primary seam: `packages/credit-insurance-domain` → `asOfOpenAr.ts` (`wasAsOfInvoiceOpenAt`, `computeAsOfOpenInvoiceLine`, `loadAsOfOpenInvoiceCandidates`) and ledger preload (`asOfOpenArLedgerPreload.ts`).

### After changing as-of math

Regenerate affected snapshot days (Portfolio Health **Generate**, or the account as-of backfill job) before trusting chart history.
