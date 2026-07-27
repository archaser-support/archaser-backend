-- Contact.erp_contact_id: optional ERP primary key for connector idempotency.
-- Apply: psql "$DATABASE_URL" -f prisma/migrations/20260623_contact_erp_contact_id.sql

BEGIN;

ALTER TABLE "Contact"
  ADD COLUMN IF NOT EXISTS "erp_contact_id" VARCHAR(255);

CREATE UNIQUE INDEX IF NOT EXISTS "Contact_company_id_erp_contact_id_key"
  ON "Contact" ("company_id", "erp_contact_id")
  WHERE "erp_contact_id" IS NOT NULL;

COMMIT;
