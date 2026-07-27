-- Invoice: payment term terms violation when credit days (due − issue) exceed customer max payment term
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS created_terms_violation_payment_term BOOLEAN NOT NULL DEFAULT false;
