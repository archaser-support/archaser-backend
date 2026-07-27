BEGIN;

ALTER TABLE "Account"
ADD COLUMN IF NOT EXISTS credit_limit_warning_threshold_pct SMALLINT,
ADD COLUMN IF NOT EXISTS credit_score_validity_warning_days SMALLINT,
ADD COLUMN IF NOT EXISTS reporting_date_warning_days SMALLINT;

COMMIT;
