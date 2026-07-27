import { DatabaseService } from "../database/database.service";
export declare class PortalService {
    private readonly db;
    constructor(db: DatabaseService);
    private findCustomerByUuid;
    handleSuffix(customerUUID: string, suffix: string, body: Record<string, unknown>): Promise<{
        customer_uuid: string;
        customer_number: string | null;
    } | {
        invoices: {
            account_id: number;
            id: number;
            created_at: Date;
            modified_at: Date;
            status: import(".prisma/client").$Enums.invoice_status;
            created_by: string | null;
            modified_by: string | null;
            promise_to_pay: number | null;
            customer_id: number | null;
            collection_period_id: number | null;
            customer_number: number | null;
            generic_text1: string | null;
            generic_text2: string | null;
            generic_number1: number | null;
            generic_number2: number | null;
            generic_date1: Date | null;
            generic_date2: Date | null;
            amount: number | null;
            policy_id: number | null;
            invoice_number: string | null;
            due_date: Date | null;
            oldest_overdue_invoice_date: Date | null;
            total_paid: number | null;
            last_payment_date: Date | null;
            zero_limit_alert: boolean;
            invoice_date: Date;
            outstanding_debt: number | null;
            first_activity_date: Date | null;
            customer_total_paid: number | null;
            customer_amount: number | null;
            customer_outstanding_debt: number | null;
            customer_currency: string | null;
            credit_for_invoice_id: number | null;
            net_amount: number | null;
            credit_for_invoice_number: string | null;
            customer_net_amount: number | null;
            due_notification_state: import("@prisma/client/runtime/library").JsonValue | null;
            payment_term: number | null;
            target_reporting_date: Date | null;
            actual_reporting_date: Date | null;
            reporting_comment: string | null;
            reporting_captured_at: Date | null;
            target_mep_date: Date | null;
            reported_status: import(".prisma/client").$Enums.invoice_reported_status | null;
            reporting_breach: boolean;
            ctv_payment_term: boolean;
            ctv_customer_overdue_mep: boolean;
            ctv_customer_excluded_from_policy: boolean;
            ctv_outdated_dcl: boolean;
            ctv_invoice_after_policy_end: boolean;
            in_capacity_gap: boolean;
            limit_assessed_amount: import("@prisma/client/runtime/library").Decimal | null;
            limit_assessed_at: Date | null;
            limit_assessed_currency: string | null;
            capacity_gap_amount: import("@prisma/client/runtime/library").Decimal | null;
            capacity_gap_amount_limit: import("@prisma/client/runtime/library").Decimal | null;
            capacity_gap_amount_date: Date | null;
        }[];
        totalRecords: number;
    } | {
        disputes: {
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            dispute_resolution: import(".prisma/client").$Enums.dispute_resolution | null;
            customer_id: number;
            owner_id: string | null;
            dispute_reason_id: number | null;
            dispute_status: import(".prisma/client").$Enums.dispute_status | null;
            customer_comment: string | null;
            customer_collection_period_id: number | null;
            resolution_comment: string | null;
            invoices_in_dispute: string | null;
            contact_first_name: string | null;
            contact_last_name: string | null;
            contact_email: string | null;
            contact_mobile: string | null;
            closed_at: Date | null;
        }[];
        totalRecords: number;
    } | {
        ok: boolean;
    } | {
        bank_details: null;
        banks?: undefined;
        topUps?: undefined;
    } | {
        banks: never[];
        bank_details?: undefined;
        topUps?: undefined;
    } | {
        topUps: never[];
        bank_details?: undefined;
        banks?: undefined;
    }>;
    private resolveCustomerDisplayName;
    private resolveCustomerFirstCurrency;
    private buildMinimalCollectionPeriod;
    private resolveOpenCollectionPeriod;
    private portalData;
    private invoicesFor;
    private disputesFor;
    private createDispute;
    createPublicDispute(body: Record<string, unknown>): Promise<{
        ok: boolean;
    }>;
    updatePromiseToPay(body: Record<string, unknown>): Promise<{
        ok: boolean;
    }>;
}
