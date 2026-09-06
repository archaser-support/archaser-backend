-- Rename MEP/Reporting/Payment Term cutoff and Payment Term substitute day-of-month columns.
-- Preserves existing numeric values (meaning and math unchanged).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260906_rename_mep_reporting_cutoff_day_fields.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'mep_cutoff_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'mep_cutoff_day'
  ) THEN
    ALTER TABLE "InsurancePolicy" RENAME COLUMN "mep_cutoff_day_of_month" TO "mep_cutoff_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'reporting_cutoff_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'reporting_cutoff_day'
  ) THEN
    ALTER TABLE "InsurancePolicy" RENAME COLUMN "reporting_cutoff_day_of_month" TO "reporting_cutoff_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'payment_term_cutoff_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'payment_term_cutoff_day'
  ) THEN
    ALTER TABLE "InsurancePolicy" RENAME COLUMN "payment_term_cutoff_day_of_month" TO "payment_term_cutoff_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'payment_term_substitute_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'payment_term_substitute_day'
  ) THEN
    ALTER TABLE "InsurancePolicy" RENAME COLUMN "payment_term_substitute_day_of_month" TO "payment_term_substitute_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'mep_cutoff_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'mep_cutoff_day'
  ) THEN
    ALTER TABLE "CustomerPolicy" RENAME COLUMN "mep_cutoff_day_of_month" TO "mep_cutoff_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'reporting_cutoff_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'reporting_cutoff_day'
  ) THEN
    ALTER TABLE "CustomerPolicy" RENAME COLUMN "reporting_cutoff_day_of_month" TO "reporting_cutoff_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'payment_term_cutoff_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'payment_term_cutoff_day'
  ) THEN
    ALTER TABLE "CustomerPolicy" RENAME COLUMN "payment_term_cutoff_day_of_month" TO "payment_term_cutoff_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'payment_term_substitute_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'payment_term_substitute_day'
  ) THEN
    ALTER TABLE "CustomerPolicy" RENAME COLUMN "payment_term_substitute_day_of_month" TO "payment_term_substitute_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'mep_cutoff_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'mep_cutoff_day'
  ) THEN
    ALTER TABLE "CustomerPolicyTrend" RENAME COLUMN "mep_cutoff_day_of_month" TO "mep_cutoff_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'reporting_cutoff_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'reporting_cutoff_day'
  ) THEN
    ALTER TABLE "CustomerPolicyTrend" RENAME COLUMN "reporting_cutoff_day_of_month" TO "reporting_cutoff_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'payment_term_cutoff_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'payment_term_cutoff_day'
  ) THEN
    ALTER TABLE "CustomerPolicyTrend" RENAME COLUMN "payment_term_cutoff_day_of_month" TO "payment_term_cutoff_day";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'payment_term_substitute_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'payment_term_substitute_day'
  ) THEN
    ALTER TABLE "CustomerPolicyTrend" RENAME COLUMN "payment_term_substitute_day_of_month" TO "payment_term_substitute_day";
  END IF;
END $$;

COMMIT;
