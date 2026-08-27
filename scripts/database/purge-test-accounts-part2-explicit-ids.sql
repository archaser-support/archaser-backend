-- PART 2 ONLY: hard-delete 37 test accounts (explicit IDs, reviewed 2026-07-22)
-- Run from FILE (Execute Script), do NOT paste into editor (truncation risk).
-- If prior attempt failed: ROLLBACK; first, then run this whole file.
-- NEVER includes account 10013.

BEGIN;

CREATE TEMP TABLE target_accounts (
    id integer PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO target_accounts (id) VALUES
(10065),(10066),(10067),(10069),(10071),(10073),(10075),(10076),(10078),(10079),
(10084),(10085),(10088),(10089),(10092),(10107),(10108),(10116),
(10119),(10120),(10121),(10122),(10123),
(10129),(10130),(10131),(10132),(10133),
(10134),(10135),(10136),
(10137),(10138),(10139),(10140),
(10144),
(999987),(999988),(999989),(999990),(999991);

DO $del$
BEGIN
    IF EXISTS (SELECT 1 FROM target_accounts WHERE id = 10013) THEN
        RAISE EXCEPTION 'Refusing to delete account 10013';
    END IF;
END $del$;

-- Snapshots / queues (skip if table missing)
DO $del$
BEGIN
    IF to_regclass('public."DashboardCache"') IS NOT NULL THEN
        DELETE FROM "DashboardCache" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."CreditDashboardDailySnapshot"') IS NOT NULL THEN
        DELETE FROM "CreditDashboardDailySnapshot" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."CustomerPolicyTrend"') IS NOT NULL THEN
        DELETE FROM "CustomerPolicyTrend" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."NamedPolicyTrend"') IS NOT NULL THEN
        DELETE FROM "NamedPolicyTrend" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."InsurancePolicyCountryTrend"') IS NOT NULL THEN
        DELETE FROM "InsurancePolicyCountryTrend" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."InsurancePolicyTrend"') IS NOT NULL THEN
        DELETE FROM "InsurancePolicyTrend" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."CreditAsOfRewriteQueue"') IS NOT NULL THEN
        DELETE FROM "CreditAsOfRewriteQueue" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."CreditAsOfBackfillJob"') IS NOT NULL THEN
        DELETE FROM "CreditAsOfBackfillJob" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

-- Activities
DO $del$
BEGIN
    IF to_regclass('public."ActivityAttachment"') IS NOT NULL THEN
        DELETE FROM "ActivityAttachment" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."ActivityContact"') IS NOT NULL THEN
        DELETE FROM "ActivityContact"
        WHERE activity_id IN (
            SELECT id FROM "Activity" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CommunicationLearningData"') IS NOT NULL THEN
        DELETE FROM "CommunicationLearningData"
        WHERE activity_id IN (
            SELECT id FROM "Activity" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."Activity"') IS NOT NULL THEN
        DELETE FROM "Activity" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

-- Invoices / payments
DO $del$
BEGIN
    IF to_regclass('public."DisputeInvoice"') IS NOT NULL THEN
        DELETE FROM "DisputeInvoice"
        WHERE invoice_id IN (
            SELECT id FROM "Invoice" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."InvoicePayment"') IS NOT NULL THEN
        DELETE FROM "InvoicePayment" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."Invoice"') IS NOT NULL THEN
        UPDATE "Invoice" SET credit_for_invoice_id = NULL
         WHERE account_id IN (SELECT id FROM target_accounts);
        DELETE FROM "Invoice" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

-- Customer-scoped
DO $del$
BEGIN
    IF to_regclass('public."CustomerCheckpoint"') IS NOT NULL THEN
        DELETE FROM "CustomerCheckpoint" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."CustomerBanks"') IS NOT NULL THEN
        DELETE FROM "CustomerBanks" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."CustomerDispute"') IS NOT NULL THEN
        DELETE FROM "CustomerDispute"
        WHERE customer_id IN (
            SELECT id FROM "Customer" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CustomerCollectionPeriod"') IS NOT NULL THEN
        DELETE FROM "CustomerCollectionPeriod"
        WHERE customer_id IN (
            SELECT id FROM "Customer" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CustomerAggregatedData"') IS NOT NULL THEN
        DELETE FROM "CustomerAggregatedData"
        WHERE customer_id IN (
            SELECT id FROM "Customer" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CustomerTopUp"') IS NOT NULL THEN
        DELETE FROM "CustomerTopUp"
        WHERE customer_id IN (
            SELECT id FROM "Customer" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CustomerPolicy"') IS NOT NULL THEN
        DELETE FROM "CustomerPolicy"
        WHERE customer_id IN (
            SELECT id FROM "Customer" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."CommunicationChannelPreference"') IS NOT NULL THEN
        DELETE FROM "CommunicationChannelPreference"
        WHERE customer_id IN (
            SELECT id FROM "Customer" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."Contact"') IS NOT NULL THEN
        DELETE FROM "Contact"
        WHERE customer_id IN (
            SELECT id FROM "Customer" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."Customer"') IS NOT NULL THEN
        UPDATE "Customer" SET parent_customer_id = NULL
         WHERE account_id IN (SELECT id FROM target_accounts);
        DELETE FROM "Customer" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

-- Notifications (optional tables)
DO $del$
BEGIN
    IF to_regclass('public."NotificationDeliveryLog"') IS NOT NULL THEN
        DELETE FROM "NotificationDeliveryLog" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."Notification"') IS NOT NULL THEN
        DELETE FROM "Notification" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."NotificationRuleUserOverride"') IS NOT NULL THEN
        DELETE FROM "NotificationRuleUserOverride"
        WHERE rule_id IN (
            SELECT r.id FROM "NotificationRule" r
            JOIN "NotificationRuleSet" s ON s.id = r.rule_set_id
            WHERE s.account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."NotificationRuleRoleDefault"') IS NOT NULL THEN
        DELETE FROM "NotificationRuleRoleDefault"
        WHERE rule_id IN (
            SELECT r.id FROM "NotificationRule" r
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
        DELETE FROM "NotificationRuleSet" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

-- Import / templates / misc account rows
DO $del$
BEGIN
    IF to_regclass('public."ImportRecord"') IS NOT NULL THEN
        DELETE FROM "ImportRecord"
        WHERE import_job_id IN (
            SELECT id FROM "ImportJob" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."ImportJob"') IS NOT NULL THEN
        DELETE FROM "ImportJob" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."Log"') IS NOT NULL THEN
        DELETE FROM "Log" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."InternalEmailTemplate"') IS NOT NULL THEN
        DELETE FROM "InternalEmailTemplate" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."DisputeReason"') IS NOT NULL THEN
        DELETE FROM "DisputeReason" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."ActivitiesSequence"') IS NOT NULL THEN
        DELETE FROM "ActivitiesSequence" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."ActivityTemplateLanguage"') IS NOT NULL THEN
        DELETE FROM "ActivityTemplateLanguage"
        WHERE template_id IN (
            SELECT id FROM "ActivitiesTemplate"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."ActivitiesTemplate"') IS NOT NULL THEN
        DELETE FROM "ActivitiesTemplate" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."SequenceContainer"') IS NOT NULL THEN
        DELETE FROM "SequenceContainer" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."BusinessUnitBankAccounts"') IS NOT NULL THEN
        DELETE FROM "BusinessUnitBankAccounts" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."AccountBankAccounts"') IS NOT NULL THEN
        DELETE FROM "AccountBankAccounts" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."AccountSMSProviderPreferences"') IS NOT NULL THEN
        DELETE FROM "AccountSMSProviderPreferences" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

-- Insurance / billing connector
DO $del$
BEGIN
    IF to_regclass('public."NamedPolicy"') IS NOT NULL THEN
        DELETE FROM "NamedPolicy"
        WHERE insurance_policy_id IN (
            SELECT id FROM "InsurancePolicy"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."InsurancePolicyCountry"') IS NOT NULL THEN
        DELETE FROM "InsurancePolicyCountry"
        WHERE insurance_policy_id IN (
            SELECT id FROM "InsurancePolicy"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."InsurancePolicy"') IS NOT NULL THEN
        UPDATE "InsurancePolicy" SET parent_insurance_policy_id = NULL
         WHERE account_id IN (SELECT id FROM target_accounts);
        DELETE FROM "InsurancePolicy" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."ConnectorSyncState"') IS NOT NULL THEN
        DELETE FROM "ConnectorSyncState"
        WHERE connector_id IN (
            SELECT id FROM "BillingConnector"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."ConnectorFieldMapping"') IS NOT NULL THEN
        DELETE FROM "ConnectorFieldMapping"
        WHERE connector_id IN (
            SELECT id FROM "BillingConnector"
            WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."BillingConnector"') IS NOT NULL THEN
        DELETE FROM "BillingConnector" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

-- Reports / roles / business units
DO $del$
BEGIN
    IF to_regclass('public."ReportExecution"') IS NOT NULL THEN
        DELETE FROM "ReportExecution"
        WHERE report_id IN (
            SELECT id FROM "Report" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."ReportSchedule"') IS NOT NULL THEN
        DELETE FROM "ReportSchedule"
        WHERE report_id IN (
            SELECT id FROM "Report" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."ReportShare"') IS NOT NULL THEN
        DELETE FROM "ReportShare"
        WHERE report_id IN (
            SELECT id FROM "Report" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."UserDefaultReport"') IS NOT NULL THEN
        DELETE FROM "UserDefaultReport"
        WHERE report_id IN (
            SELECT id FROM "Report" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."Report"') IS NOT NULL THEN
        DELETE FROM "Report" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."RolePermission"') IS NOT NULL THEN
        DELETE FROM "RolePermission" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."BusinessUnit"') IS NOT NULL THEN
        -- User.business_unit_id -> BusinessUnit is NoAction; clear refs before BU delete
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
        DELETE FROM "BusinessUnit" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

-- Users then accounts
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
    IF to_regclass('public."Session"') IS NOT NULL THEN
        DELETE FROM "Session"
        WHERE "userId" IN (
            SELECT id FROM "User" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."UserPreferences"') IS NOT NULL THEN
        DELETE FROM "UserPreferences"
        WHERE "userId" IN (
            SELECT id FROM "User" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."UserImportMappings"') IS NOT NULL THEN
        DELETE FROM "UserImportMappings"
        WHERE user_id IN (
            SELECT id FROM "User" WHERE account_id IN (SELECT id FROM target_accounts)
        );
    END IF;
    IF to_regclass('public."User"') IS NOT NULL THEN
        DELETE FROM "User" WHERE account_id IN (SELECT id FROM target_accounts);
    END IF;
    IF to_regclass('public."Account"') IS NOT NULL THEN
        DELETE FROM "Account" WHERE id IN (SELECT id FROM target_accounts);
    END IF;
END $del$;

SELECT id AS deleted_account_id FROM target_accounts ORDER BY id;

COMMIT;
