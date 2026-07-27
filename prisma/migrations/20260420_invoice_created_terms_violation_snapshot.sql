-- Invoice: “created in terms violation” snapshot fields (set at import / refresh)
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS created_terms_violation_customer_overdue_mep BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS created_terms_violation_customer_excluded_from_policy BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS created_terms_violation_outdated_dcl BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS created_terms_violation_invoice_after_policy_end BOOLEAN NOT NULL DEFAULT false;
