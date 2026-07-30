export declare const CUSTOMER_POLICY_BACKED_REPORT_FIELDS: Set<string>;
export declare function isCustomerPolicyBackedReportField(field: string): boolean;
type CustomerPolicyRow = Record<string, unknown> & {
    InsurancePolicy?: Record<string, unknown> | null;
    is_active?: boolean;
    insurance_policy_id?: number | null;
};
export declare function getCustomerPolicyRow(row: unknown, invoiceRow?: unknown, scopedPolicyId?: number): CustomerPolicyRow | null;
export declare function extractCustomerPolicyReportField(row: unknown, field: string, invoiceRow?: unknown, scopedPolicyId?: number): unknown;
export declare function mergeActiveCustomerPolicySelect(select: Record<string, unknown>, fields: string[]): void;
export {};
