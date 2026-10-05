-- Invoice: user flag to skip MEP overdue_block only (live and as-of).
-- Aging, AR, and capacity-gap allocation still include the invoice.
-- Apply: npx prisma db execute --file prisma/migrations/20261005_invoice_mep_ignored.sql

ALTER TABLE "Invoice"
ADD COLUMN IF NOT EXISTS "mep_ignored" BOOLEAN NOT NULL DEFAULT false;
