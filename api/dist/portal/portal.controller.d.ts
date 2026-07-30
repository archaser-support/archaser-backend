import { PortalService } from "./portal.service";
export declare class PortalDomainController {
    private readonly portal;
    constructor(portal: PortalService);
    createDispute(body: Record<string, unknown>): Promise<{
        ok: boolean;
        disputeId: number;
        invoicesLinked: number;
    }>;
    updatePromise(body: Record<string, unknown>): Promise<{
        ok: boolean;
        promise_to_pay_date: Date;
        promise_to_pay_count: number;
    }>;
}
export declare class PortalCustomersDomainController {
    private readonly portal;
    constructor(portal: PortalService);
    publicPortalRoute(customerUUID: string, suffix: string, language?: string): Promise<{
        customer_uuid: string;
        customer_number: string | null;
    } | {
        invoices: {
            id: number;
            invoiceNumber: string;
            amount: number;
            customerAmount: number;
            dueDate: string;
            totalPaid: number;
            customerTotalPaid: number;
            outstandingDebt: number;
            customerOutstandingDebt: number;
            status: string;
            currency: string;
            customerCurrency: string;
        }[];
        totalRecords: number;
        logo: string | null;
        customerName: string;
        accountName: string | null;
        sub_domain: string | null;
    } | {
        disputes: {
            id: number;
            created_at: Date;
            modified_at: Date;
            created_by: string | null;
            modified_by: string | null;
            owner_id: string | null;
            dispute_resolution: import(".prisma/client").$Enums.dispute_resolution | null;
            customer_id: number;
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
        customer_id: number;
        invoices: {
            id: number;
            invoiceNumber: string;
            amount: number;
            customerAmount: number;
            dueDate: string;
            totalPaid: number;
            customerTotalPaid: number;
            outstandingDebt: number;
            customerOutstandingDebt: number;
            status: string;
            currency: string;
            customerCurrency: string;
        }[];
        reasons: {
            id: number;
            name: string;
            editable: boolean | null;
        }[];
        customerName: string;
        logo: string | null;
        sub_domain: string | null;
        hasDisputedInvoices: boolean;
        language: string;
    } | {
        bank_details: null;
        banks?: undefined;
        ok?: undefined;
    } | {
        banks: never[];
        bank_details?: undefined;
        ok?: undefined;
    } | {
        ok: boolean;
        bank_details?: undefined;
        banks?: undefined;
    }>;
}
