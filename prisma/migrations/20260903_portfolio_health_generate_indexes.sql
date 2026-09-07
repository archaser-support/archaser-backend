BEGIN;

-- Portfolio Health Generate index audit (slice 04):
-- CustomerPolicyTrend: idx_customer_policy_trend_account_day (account_id, snapshot_date DESC)
--   already supports prior-day CPT reads — no new index.
-- Invoice range ledger: WHERE account_id = ? AND invoice_date <= ?
CREATE INDEX IF NOT EXISTS idx_invoice_account_invoice_date
ON "Invoice" (account_id, invoice_date);

-- InvoicePayment range ledger: WHERE account_id = ? AND payment_date < ? (+ join on invoice_id)
CREATE INDEX IF NOT EXISTS idx_invoice_payment_account_payment_date
ON "InvoicePayment" (account_id, payment_date);

CREATE INDEX IF NOT EXISTS idx_invoice_payment_invoice_id
ON "InvoicePayment" (invoice_id);

-- Durable worker: persist ignore-reporting-breach for Generate across processes
ALTER TABLE "CreditAsOfBackfillJob"
ADD COLUMN IF NOT EXISTS skip_reporting_breach BOOLEAN NOT NULL DEFAULT true;

COMMIT;
