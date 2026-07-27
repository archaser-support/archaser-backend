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
    timezone?: string;
    includeInvoiceCreditInsuranceViolationFields?: boolean;
    businessUnitId?: number | null;
    selectedUserId?: string | null;
}
