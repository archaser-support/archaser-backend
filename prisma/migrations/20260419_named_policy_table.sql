-- NamedPolicy: per-customer-number terms under InsurancePolicy.
-- Run after prisma/schema.prisma includes model NamedPolicy (npx prisma generate).
-- Apply with: psql "$DATABASE_URL" -f prisma/migrations/20260419_named_policy_table.sql

BEGIN;

CREATE TABLE IF NOT EXISTS "NamedPolicy" (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  modified_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  insurance_policy_id INTEGER NOT NULL,
  customer_number VARCHAR(255) NOT NULL,
  max_payment_term INTEGER,
  customer_mep INTEGER,
  reporting_days INTEGER,
  customer_max_limit DECIMAL(20, 4),
  created_by VARCHAR,
  modified_by VARCHAR,
  CONSTRAINT named_policy_insurance_policy_id_fkey
    FOREIGN KEY (insurance_policy_id)
    REFERENCES "InsurancePolicy" (id)
    ON DELETE CASCADE
    ON UPDATE NO ACTION,
  CONSTRAINT "NamedPolicyCreatedBy_fkey"
    FOREIGN KEY (created_by) REFERENCES "User"(id) ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "NamedPolicyModifiedBy_fkey"
    FOREIGN KEY (modified_by) REFERENCES "User"(id) ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_named_policy_policy_customer_number
  ON "NamedPolicy" (insurance_policy_id, customer_number);

CREATE INDEX IF NOT EXISTS idx_named_policy_insurance_policy_id
  ON "NamedPolicy" (insurance_policy_id);

CREATE INDEX IF NOT EXISTS idx_named_policy_created_by ON "NamedPolicy"(created_by);
CREATE INDEX IF NOT EXISTS idx_named_policy_modified_by ON "NamedPolicy"(modified_by);

COMMIT;
