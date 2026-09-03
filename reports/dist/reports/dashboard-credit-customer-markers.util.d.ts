import { ReportFilterDto } from "./dto/execute-report.dto";
type PrismaWhere = Record<string, unknown>;
export declare const CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD = "__credit_dashboard_customer_scope";
export declare const CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD = "__credit_dashboard_customer_membership";
export type PreparedDashboardCreditCustomerMarkers = {
    filters: ReportFilterDto[];
    primaryWhereExtras?: PrismaWhere;
    policyId?: number;
    /** From top_up_expiring membership value; default 30 when type matches. */
    withinDays?: number;
    /** From utilization_bin membership value (YYYY-MM-DD). */
    asOfDate?: string;
    /** From utilization_bin membership value. */
    utilizationBin?: string;
    membershipType?: "capacity" | "policy_risk" | "limit_warning" | "zero_limit_warning" | "no_policy_exposure" | "top_up" | "top_up_expiring" | "utilization_bin" | null;
};
export declare function parseCreditDashboardCustomerScopeValue(value: unknown): number | undefined;
export declare function parseCreditDashboardCustomerMembershipValue(value: unknown): {
    type: "capacity" | "policy_risk" | "limit_warning" | "zero_limit_warning" | "no_policy_exposure" | "top_up" | "top_up_expiring" | "utilization_bin" | null;
    includeNoPolicyExposure: boolean;
    withinDays: number | null;
    utilizationBin: string | null;
    asOfDate: string | null;
};
/**
 * Strip credit dashboard customer scope / membership markers and expand into
 * Prisma where extras (KPI cohort parity with get*Report).
 */
export declare function prepareDashboardCreditCustomerMarkers(filters: ReportFilterDto[], options: {
    accountId: number;
}): Promise<PreparedDashboardCreditCustomerMarkers>;
export {};
