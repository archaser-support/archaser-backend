-- Rename MEP/Reporting substitute day-of-month columns to substitute extra days.
-- Preserves existing numeric values (meaning changes to calendar extra days on next target refresh).
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260906_rename_mep_reporting_substitute_extra_days.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'mep_substitute_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'mep_substitute_extra_days'
  ) THEN
    ALTER TABLE "InsurancePolicy" RENAME COLUMN "mep_substitute_day_of_month" TO "mep_substitute_extra_days";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'reporting_substitute_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'InsurancePolicy'
      AND column_name = 'reporting_substitute_extra_days'
  ) THEN
    ALTER TABLE "InsurancePolicy" RENAME COLUMN "reporting_substitute_day_of_month" TO "reporting_substitute_extra_days";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'mep_substitute_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'mep_substitute_extra_days'
  ) THEN
    ALTER TABLE "CustomerPolicy" RENAME COLUMN "mep_substitute_day_of_month" TO "mep_substitute_extra_days";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'reporting_substitute_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicy'
      AND column_name = 'reporting_substitute_extra_days'
  ) THEN
    ALTER TABLE "CustomerPolicy" RENAME COLUMN "reporting_substitute_day_of_month" TO "reporting_substitute_extra_days";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'mep_substitute_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'mep_substitute_extra_days'
  ) THEN
    ALTER TABLE "CustomerPolicyTrend" RENAME COLUMN "mep_substitute_day_of_month" TO "mep_substitute_extra_days";
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'reporting_substitute_day_of_month'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CustomerPolicyTrend'
      AND column_name = 'reporting_substitute_extra_days'
  ) THEN
    ALTER TABLE "CustomerPolicyTrend" RENAME COLUMN "reporting_substitute_day_of_month" TO "reporting_substitute_extra_days";
  END IF;
END $$;

COMMIT;
