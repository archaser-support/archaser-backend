-- Scheduled activation: cron promotes Inactive Primary policies when term starts.
ALTER TABLE "InsurancePolicy"
ADD COLUMN IF NOT EXISTS "auto_activate_on_term_start" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "InsurancePolicy"."auto_activate_on_term_start" IS
'When true, daily cron sets status Active once start_date is reached and the policy is still Inactive within term.';
