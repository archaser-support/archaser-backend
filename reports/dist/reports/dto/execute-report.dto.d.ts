export declare class ReportFilterDto {
    table: string;
    field: string;
    operator: string;
    value?: unknown;
}
export declare class ExecuteReportDto {
    filters?: ReportFilterDto[];
    replaceConfigFilters?: boolean;
    page?: number;
    limit?: number;
    sortField?: string;
    sortDirection?: "asc" | "desc";
    search?: string;
    locale?: string;
    language?: string;
    /** Sent by useViewExecution / session; formatting only on Nest side for now. */
    timezone?: string;
    includeInvoiceCreditInsuranceViolationFields?: boolean;
    businessUnitId?: number | null;
    selectedUserId?: string | null;
}
