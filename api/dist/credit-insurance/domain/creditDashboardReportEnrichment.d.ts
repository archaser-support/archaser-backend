import type { Prisma } from "@prisma/client";
import { type LimitWarningRow } from "./creditInsuranceDashboardService";
export declare const CREDIT_DASHBOARD_ENRICHED_CUSTOMER_FIELDS: Set<string>;
export declare function isCreditDashboardEnrichedCustomerField(field: string): boolean;
export declare function reportConfigNeedsCreditDashboardEnrichment(fields: Array<{
    table?: string;
    field?: string;
}> | undefined): boolean;
export declare function formatLimitWarningSummary(row: Pick<LimitWarningRow, "nearLimit" | "nearLimitUtilizationPct" | "scoreExpiring" | "scoreExpiresInDays" | "limitExpiring" | "limitExpiresInDays">, accountLanguage?: string | null): string;
export interface CreditDashboardEnrichmentOptions {
    accountId: number;
    policyId?: number;
    accountLanguage?: string | null;
    requestedFields: string[];
    limitWarningByCustomerId?: Map<number, LimitWarningRow>;
}
export declare function enrichCreditDashboardCustomerRows(rows: any[], options: CreditDashboardEnrichmentOptions): Promise<any[]>;
export interface TopUpExpiringReportExecutionOptions {
    accountId: number;
    page: number;
    limit: number;
    search?: string;
    sortField?: string;
    sortDirection?: "ASC" | "DESC";
    policyId?: number;
    customerId?: number;
    withinDays?: number;
    businessUnitFilter?: Prisma.CustomerWhereInput;
}
export declare function fetchTopUpExpiringReportAsCustomerRows(options: TopUpExpiringReportExecutionOptions): Promise<{
    total: number;
    rows: any[];
}>;
export declare function isCreditDashboardEnrichedSortField(field: string | undefined): boolean;
export declare function sortCreditDashboardEnrichedRows(rows: any[], sortField: string, sortDirection?: "asc" | "desc" | "ASC" | "DESC"): any[];
