export declare function calculateDaysOverdue(dueDate: Date | string | null | undefined, now?: Date): number | null;
export declare function calculateDaysUntilDue(dueDate: Date | string | null | undefined, now?: Date): number | null;
export declare function calculateDaysLeft(endDate: Date | string | null | undefined, now?: Date): number | null;
export declare function extractTermsBreachReasonCodes(row: {
    reporting_breach?: boolean | null;
    ctv_payment_term?: boolean | null;
    ctv_customer_overdue_mep?: boolean | null;
    ctv_outdated_dcl?: boolean | null;
    ctv_invoice_after_policy_end?: boolean | null;
}): string;
export declare function formatTermsBreachReasonForDisplay(codesJoined: string | null | undefined, locale?: string): string;
export declare function isPrismaScalarField(reportTable: string, field: string): boolean;
export declare function isPrismaListRelation(reportTable: string, relationField: string): boolean;
export declare function applyComputedFieldSelect(primaryTable: string, field: string, select: Record<string, unknown>): boolean;
export declare function extractComputedFieldValue(primaryTable: string, field: string, row: Record<string, unknown>): unknown;
export declare function isComputedReportField(primaryTable: string, field: string): boolean;
