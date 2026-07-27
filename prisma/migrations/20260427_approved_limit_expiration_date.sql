-- Approved Limit Expiration Date
--
-- Adds:
--   Customer.approved_limit_expiration_date  - date on which the approved limit expires; the daily
--                                              Compute Customer Overdue Metrics cron resets
--                                              approved_limit to 0 the day after this date.
--   NamedPolicy.limit_expiration_date        - expiration date stored on the named policy row;
--                                              prefilled onto the customer when a Named match is applied.
--   Account.customer_limit_expiration_warning_days - number of days before expiration to start
--                                              showing a customer in the Limit Warnings dashboard card.
--
-- Run: psql "$DATABASE_URL" -f prisma/migrations/20260427_approved_limit_expiration_date.sql

BEGIN;

ALTER TABLE "Customer"
    ADD COLUMN IF NOT EXISTS approved_limit_expiration_date DATE;

ALTER TABLE "NamedPolicy"
    ADD COLUMN IF NOT EXISTS limit_expiration_date DATE;

ALTER TABLE "Account"
    ADD COLUMN IF NOT EXISTS customer_limit_expiration_warning_days SMALLINT;

COMMIT;
