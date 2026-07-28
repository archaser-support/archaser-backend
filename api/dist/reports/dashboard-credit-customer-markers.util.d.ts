import { ReportFilterDto } from "./dto/execute-report.dto";
type PrismaWhere = Record<string, unknown>;
export declare const CREDIT_DASHBOARD_CUSTOMER_SCOPE_FILTER_FIELD = "__credit_dashboard_customer_scope";
export declare const CREDIT_DASHBOARD_CUSTOMER_MEMBERSHIP_FILTER_FIELD = "__credit_dashboard_customer_membership";
export type PreparedDashboardCreditCustomerMarkers = {
    filters: ReportFilterDto[];
    primaryWhereExtras?: PrismaWhere;
    policyId?: number;
    withinDays?: number;
    membershipType?: "capacity" | "policy_risk" | "limit_warning" | "zero_limit_warning" | "no_policy_exposure" | "top_up" | "top_up_expiring" | null;
};
export declare function parseCreditDashboardCustomerScopeValue(value: unknown): number | undefined;
export declare function parseCreditDashboardCustomerMembershipValue(value: unknown): {
    type: "capacity" | "policy_risk" | "limit_warning" | "zero_limit_warning" | "no_policy_exposure" | "top_up" | "top_up_expiring" | null;
    includeNoPolicyExposure: boolean;
    withinDays: number | null;
};
export declare function prepareDashboardCreditCustomerMarkers(filters: ReportFilterDto[], options: {
    accountId: number;
}): Promise<PreparedDashboardCreditCustomerMarkers>;
export {};
