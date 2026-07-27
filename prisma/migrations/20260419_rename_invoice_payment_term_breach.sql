-- Rename legacy column payment_term_breach → created_terms_violation_payment_term (Invoice)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Invoice'
      AND column_name = 'payment_term_breach'
  ) THEN
    ALTER TABLE "Invoice" RENAME COLUMN "payment_term_breach" TO "created_terms_violation_payment_term";
  END IF;
END $$;
