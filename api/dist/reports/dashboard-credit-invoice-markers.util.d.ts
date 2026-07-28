import { ReportFilterDto } from "./dto/execute-report.dto";
type PrismaWhere = Record<string, unknown>;
export declare const CREDIT_DASHBOARD_INVOICE_MEMBERSHIP_FILTER_FIELD = "__credit_dashboard_invoice_membership";
export type PreparedDashboardCreditInvoiceMarkers = {
    filters: ReportFilterDto[];
    primaryWhereExtras?: PrismaWhere;
};
export declare function parseCreditDashboardInvoiceMembershipValue(value: unknown): {
    type: "terms" | "reporting" | "reported" | null;
    termsBreachReason: string | null;
    termsOverdueOnly: boolean;
};
export declare function prepareDashboardCreditInvoiceMarkers(filters: ReportFilterDto[], options: {
    accountId: number;
}): Promise<PreparedDashboardCreditInvoiceMarkers>;
export {};
