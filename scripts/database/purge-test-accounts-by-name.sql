-- =============================================================================
-- Permanent delete: accounts whose name contains Dummy / Test / Company
-- WARNING: '%Company%' matches real company names. Run PREVIEW first.
-- NEVER deletes account id 10013 (ARchaser admin).
-- Skips tables that do not exist yet (migration drift safe).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART 1 — PREVIEW (safe, read-only)
-- ---------------------------------------------------------------------------
SELECT
    a.id,
    a.name,
    a.status,
    a.deleted_at,
    a.created_at,
    (SELECT COUNT(*) FROM "Customer" c WHERE c.account_id = a.id) AS customer_count,
    (SELECT COUNT(*) FROM "User" u WHERE u.account_id = a.id) AS user_count,
    (SELECT COUNT(*) FROM "Invoice" i WHERE i.account_id = a.id) AS invoice_count
FROM "Account" a
WHERE a.id <> 10013
  AND (
        a.name ILIKE '%Dummy%'
     OR a.name ILIKE '%Test%'
     OR a.name ILIKE '%Company%'
  )
ORDER BY a.id;

-- ---------------------------------------------------------------------------
-- PART 2 — HARD DELETE (explicit account IDs — reviewed 2026-07-22).
-- Run ROLLBACK; first if a prior attempt failed in this session.
-- ---------------------------------------------------------------------------
BEGIN;

CREATE TEMP TABLE target_accounts (
    id integer PRIMARY KEY
) ON COMMIT DROP;

-- Explicit IDs from Part 1 preview (37 accounts). Does not re-run ILIKE.
INSERT INTO target_accounts (id) VALUES
(10065),(10066),(10067),(10069),(10071),(10073),(10075),(10076),(10078),(10079),
(10084),(10085),(10088),(10089),(10092),(10107),(10108),(10116),
(10119),(10120),(10121),(10122),(10123),
(10129),(10130),(10131),(10132),(10133),
(10134),(10135),(10136),
(10137),(10138),(10139),(10140),
(10144),
(999987),(999988),(999989),(999990),(999991);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM target_accounts WHERE id = 10013) THEN
        RAISE EXCEPTION 'Refusing to delete account 10013';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.safe_delete_account_rows(p_table text)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
    IF to_regclass(format('public.%I', p_table)) IS NOT NULL THEN
        EXECUTE format(
            'DELETE FROM %I WHERE account_id IN (SELECT id FROM target_accounts)',
            p_table
        );
    END IF;
END;
$$;

-- Plain SQL: SELECT is OK here (outside DO blocks)
SELECT pg_temp.safe_delete_account_rows('DashboardCache');
SELECT pg_temp.safe_delete_account_rows('CreditDashboardDailySnapshot');
SELECT pg_temp.safe_delete_account_rows('CustomerPolicyTrend');
SELECT pg_temp.safe_delete_account_rows('NamedPolicyTrend');
SELECT pg_temp.safe_delete_account_rows('InsurancePolicyCountryTrend');
SELECT pg_temp.safe_delete_account_rows('InsurancePolicyTrend');
SELECT pg_temp.safe_delete_account_rows('CreditAsOfRewriteQueue');
SELECT pg_temp.safe_delete_account_rows('CreditAsOfBackfillJob');

SELECT pg_temp.safe_delete_account_rows('ActivityAttachment');

DO $del$
BEGIN
    IF to_regclass('public."ActivityContact"') IS NOT NULL THEN
        DELETE FROM "ActivityContact"
        WHERE activity_id IN (
            SELECT id FROM "Activity"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CommunicationLearningData"') IS NOT NULL THEN
        DELETE FROM "CommunicationLearningData"
        WHERE activity_id IN (
            SELECT id FROM "Activity"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
END $del$;

SELECT pg_temp.safe_delete_account_rows('Activity');

DO $del$
BEGIN
    IF to_regclass('public."DisputeInvoice"') IS NOT NULL
       AND to_regclass('public."Invoice"') IS NOT NULL THEN
        DELETE FROM "DisputeInvoice"
        WHERE invoice_id IN (
            SELECT id FROM "Invoice"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
END $del$;

SELECT pg_temp.safe_delete_account_rows('InvoicePayment');

DO $del$
BEGIN
    IF to_regclass('public."Invoice"') IS NOT NULL THEN
        UPDATE "Invoice"
           SET credit_for_invoice_id = NULL
         WHERE account_id IN (SELECT id FROM target_accounts);
        DELETE FROM "Invoice"
         WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

SELECT pg_temp.safe_delete_account_rows('CustomerCheckpoint');
SELECT pg_temp.safe_delete_account_rows('CustomerBanks');

DO $del$
BEGIN
    IF to_regclass('public."CustomerDispute"') IS NOT NULL THEN
        DELETE FROM "CustomerDispute"
        WHERE customer_id IN (
            SELECT id FROM "Customer"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CustomerCollectionPeriod"') IS NOT NULL THEN
        DELETE FROM "CustomerCollectionPeriod"
        WHERE customer_id IN (
            SELECT id FROM "Customer"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CustomerAggregatedData"') IS NOT NULL THEN
        DELETE FROM "CustomerAggregatedData"
        WHERE customer_id IN (
            SELECT id FROM "Customer"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CustomerTopUp"') IS NOT NULL THEN
        DELETE FROM "CustomerTopUp"
        WHERE customer_id IN (
            SELECT id FROM "Customer"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CustomerPolicy"') IS NOT NULL THEN
        DELETE FROM "CustomerPolicy"
        WHERE customer_id IN (
            SELECT id FROM "Customer"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CommunicationChannelPreference"') IS NOT NULL THEN
        DELETE FROM "CommunicationChannelPreference"
        WHERE customer_id IN (
            SELECT id FROM "Customer"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."Contact"') IS NOT NULL THEN
        DELETE FROM "Contact"
        WHERE customer_id IN (
            SELECT id FROM "Customer"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
END $del$;

DO $del$
BEGIN
    IF to_regclass('public."Customer"') IS NOT NULL THEN
        UPDATE "Customer"
           SET parent_customer_id = NULL
         WHERE account_id IN (SELECT id FROM target_accounts);
        DELETE FROM "Customer"
         WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

DO $del$
BEGIN
    IF to_regclass('public."NotificationDeliveryLog"') IS NOT NULL THEN
        DELETE FROM "NotificationDeliveryLog"
        WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."Notification"') IS NOT NULL THEN
        DELETE FROM "Notification"
        WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."NotificationRuleUserOverride"') IS NOT NULL THEN
        DELETE FROM "NotificationRuleUserOverride"
        WHERE rule_id IN (
            SELECT r.id
            FROM "NotificationRule" r
            JOIN "NotificationRuleSet" s ON s.id = r.rule_set_id
            WHERE s.account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."NotificationRuleRoleDefault"') IS NOT NULL THEN
        DELETE FROM "NotificationRuleRoleDefault"
        WHERE rule_id IN (
            SELECT r.id
            FROM "NotificationRule" r
            JOIN "NotificationRuleSet" s ON s.id = r.rule_set_id
            WHERE s.account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."NotificationRule"') IS NOT NULL THEN
        DELETE FROM "NotificationRule"
        WHERE rule_set_id IN (
            SELECT id FROM "NotificationRuleSet"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."NotificationRuleSet"') IS NOT NULL THEN
        DELETE FROM "NotificationRuleSet"
        WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

DO $del$
BEGIN
    IF to_regclass('public."ImportRecord"') IS NOT NULL
       AND to_regclass('public."ImportJob"') IS NOT NULL THEN
        DELETE FROM "ImportRecord"
        WHERE import_job_id IN (
            SELECT id FROM "ImportJob"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
END $del$;

SELECT pg_temp.safe_delete_account_rows('ImportJob');
SELECT pg_temp.safe_delete_account_rows('Log');
SELECT pg_temp.safe_delete_account_rows('InternalEmailTemplate');
SELECT pg_temp.safe_delete_account_rows('DisputeReason');
SELECT pg_temp.safe_delete_account_rows('ActivitiesSequence');

DO $del$
BEGIN
    IF to_regclass('public."ActivityTemplateLanguage"') IS NOT NULL
       AND to_regclass('public."ActivitiesTemplate"') IS NOT NULL THEN
        DELETE FROM "ActivityTemplateLanguage"
        WHERE template_id IN (
            SELECT id FROM "ActivitiesTemplate"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
END $del$;

SELECT pg_temp.safe_delete_account_rows('ActivitiesTemplate');
SELECT pg_temp.safe_delete_account_rows('SequenceContainer');
SELECT pg_temp.safe_delete_account_rows('BusinessUnitBankAccounts');
SELECT pg_temp.safe_delete_account_rows('AccountBankAccounts');
SELECT pg_temp.safe_delete_account_rows('AccountSMSProviderPreferences');

DO $del$
BEGIN
    IF to_regclass('public."NamedPolicy"') IS NOT NULL
       AND to_regclass('public."InsurancePolicy"') IS NOT NULL THEN
        DELETE FROM "NamedPolicy"
        WHERE insurance_policy_id IN (
            SELECT id FROM "InsurancePolicy"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."InsurancePolicyCountry"') IS NOT NULL
       AND to_regclass('public."InsurancePolicy"') IS NOT NULL THEN
        DELETE FROM "InsurancePolicyCountry"
        WHERE insurance_policy_id IN (
            SELECT id FROM "InsurancePolicy"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."InsurancePolicy"') IS NOT NULL THEN
        UPDATE "InsurancePolicy"
           SET parent_insurance_policy_id = NULL
         WHERE account_id IN (SELECT id FROM target_accounts);
        DELETE FROM "InsurancePolicy"
         WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."ConnectorSyncState"') IS NOT NULL
       AND to_regclass('public."BillingConnector"') IS NOT NULL THEN
        DELETE FROM "ConnectorSyncState"
        WHERE connector_id IN (
            SELECT id FROM "BillingConnector"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."ConnectorFieldMapping"') IS NOT NULL
       AND to_regclass('public."BillingConnector"') IS NOT NULL THEN
        DELETE FROM "ConnectorFieldMapping"
        WHERE connector_id IN (
            SELECT id FROM "BillingConnector"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    -- PERFORM not SELECT inside DO blocks
    PERFORM pg_temp.safe_delete_account_rows('BillingConnector');
END $del$;

DO $del$
BEGIN
    IF to_regclass('public."ReportExecution"') IS NOT NULL
       AND to_regclass('public."Report"') IS NOT NULL THEN
        DELETE FROM "ReportExecution"
        WHERE report_id IN (
            SELECT id FROM "Report"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."ReportSchedule"') IS NOT NULL
       AND to_regclass('public."Report"') IS NOT NULL THEN
        DELETE FROM "ReportSchedule"
        WHERE report_id IN (
            SELECT id FROM "Report"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."ReportShare"') IS NOT NULL
       AND to_regclass('public."Report"') IS NOT NULL THEN
        DELETE FROM "ReportShare"
        WHERE report_id IN (
            SELECT id FROM "Report"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."UserDefaultReport"') IS NOT NULL
       AND to_regclass('public."Report"') IS NOT NULL THEN
        DELETE FROM "UserDefaultReport"
        WHERE report_id IN (
            SELECT id FROM "Report"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
END $del$;

SELECT pg_temp.safe_delete_account_rows('Report');
SELECT pg_temp.safe_delete_account_rows('RolePermission');

DO $del$
BEGIN
    IF to_regclass('public."BusinessUnit"') IS NOT NULL THEN
        IF to_regclass('public."User"') IS NOT NULL THEN
            UPDATE "User"
               SET business_unit_id = NULL
             WHERE business_unit_id IN (
                SELECT id FROM "BusinessUnit"
                WHERE account_id IN (SELECT id FROM target_accounts)
             );
        END IF;
        UPDATE "BusinessUnit" SET parent_id = NULL
         WHERE account_id IN (SELECT id FROM target_accounts);
        PERFORM pg_temp.safe_delete_account_rows('BusinessUnit');
    END IF;
END $del$;

DO $del$
BEGIN
    IF to_regclass('public."Account"') IS NOT NULL THEN
        UPDATE "Account"
           SET created_by = NULL, modified_by = NULL, deleted_by = NULL
         WHERE id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."User"') IS NOT NULL THEN
        UPDATE "User" SET business_unit_id = NULL
         WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."Session"') IS NOT NULL
       AND to_regclass('public."User"') IS NOT NULL THEN
        DELETE FROM "Session"
        WHERE "userId" IN (
            SELECT id FROM "User"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."UserPreferences"') IS NOT NULL
       AND to_regclass('public."User"') IS NOT NULL THEN
        DELETE FROM "UserPreferences"
        WHERE "userId" IN (
            SELECT id FROM "User"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."UserImportMappings"') IS NOT NULL
       AND to_regclass('public."User"') IS NOT NULL THEN
        DELETE FROM "UserImportMappings"
        WHERE user_id IN (
            SELECT id FROM "User"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
END $del$;

DELETE FROM "User"
 WHERE account_id IN (SELECT id FROM target_accounts);

DELETE FROM "Account"
 WHERE id IN (SELECT id FROM target_accounts);

SELECT id AS deleted_account_id FROM target_accounts ORDER BY id;

COMMIT;
-- On error: ROLLBACK;
