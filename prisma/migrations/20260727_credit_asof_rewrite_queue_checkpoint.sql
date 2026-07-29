BEGIN;

-- Additive checkpoint for overnight as-of rewrite drain resume
-- (PRD: overnight-asof-rewrite-drain-reliability).
-- NULL = start at from_date; otherwise last completed snapshot day.
-- Idempotent when the create migration already included the column, or when
-- the shared DB already has it from a prior deploy.
ALTER TABLE "CreditAsOfRewriteQueue"
    ADD COLUMN IF NOT EXISTS checkpoint_date DATE;

COMMIT;
