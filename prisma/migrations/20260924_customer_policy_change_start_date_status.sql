-- CustomerPolicy.policy_change_start_date + status (active | pending | inactive)
--
-- Backfill:
--   status = active when is_active, else inactive
--   policy_change_start_date = UTC calendar day of created_at
--
-- Deploy applies this file in one transaction (omit BEGIN/COMMIT).

DO $$ BEGIN
    CREATE TYPE "customer_policy_status" AS ENUM ('active', 'pending', 'inactive');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Rename if an earlier apply used policy_change_date or policy_effective_change_date
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'CustomerPolicy'
          AND column_name = 'policy_change_date'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'CustomerPolicy'
          AND column_name = 'policy_change_start_date'
    ) THEN
        ALTER TABLE "CustomerPolicy"
            RENAME COLUMN policy_change_date TO policy_change_start_date;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'CustomerPolicy'
          AND column_name = 'policy_effective_change_date'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'CustomerPolicy'
          AND column_name = 'policy_change_start_date'
    ) THEN
        ALTER TABLE "CustomerPolicy"
            RENAME COLUMN policy_effective_change_date TO policy_change_start_date;
    END IF;
END $$;

ALTER TABLE "CustomerPolicy"
    ADD COLUMN IF NOT EXISTS policy_change_start_date DATE,
    ADD COLUMN IF NOT EXISTS status "customer_policy_status";

UPDATE "CustomerPolicy"
SET
    status = CASE
        WHEN is_active THEN 'active'::"customer_policy_status"
        ELSE 'inactive'::"customer_policy_status"
    END
WHERE status IS NULL;

UPDATE "CustomerPolicy"
SET policy_change_start_date = (created_at AT TIME ZONE 'UTC')::date
WHERE policy_change_start_date IS NULL;

ALTER TABLE "CustomerPolicy"
    ALTER COLUMN status SET DEFAULT 'inactive'::"customer_policy_status",
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN policy_change_start_date SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_policy_customer_status
    ON "CustomerPolicy" (customer_id, status);

-- At most one pending row per customer (active uniqueness already via is_active).
CREATE UNIQUE INDEX IF NOT EXISTS unique_customer_policy_one_pending
    ON "CustomerPolicy" (customer_id)
    WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS unique_customer_policy_one_status_active
    ON "CustomerPolicy" (customer_id)
    WHERE status = 'active';
