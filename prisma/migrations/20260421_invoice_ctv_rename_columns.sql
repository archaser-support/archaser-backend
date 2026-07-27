-- Rename Invoice "created_terms_violation_*" columns to ctv_* (shorter prefix).
-- Run manually or via your migration process; aligns with Prisma schema ctv_* fields.

ALTER TABLE "Invoice" RENAME COLUMN "created_terms_violation_payment_term" TO "ctv_payment_term";
ALTER TABLE "Invoice" RENAME COLUMN "created_terms_violation_customer_overdue_mep" TO "ctv_customer_overdue_mep";
ALTER TABLE "Invoice" RENAME COLUMN "created_terms_violation_customer_excluded_from_policy" TO "ctv_customer_excluded_from_policy";
ALTER TABLE "Invoice" RENAME COLUMN "created_terms_violation_outdated_dcl" TO "ctv_outdated_dcl";
ALTER TABLE "Invoice" RENAME COLUMN "created_terms_violation_invoice_after_policy_end" TO "ctv_invoice_after_policy_end";
