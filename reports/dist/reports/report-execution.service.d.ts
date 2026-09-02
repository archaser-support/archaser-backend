import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/jwt-payload";
import { DatabaseService } from "../database/database.service";
import { ExecuteReportDto } from "./dto/execute-report.dto";
import { FormulaWarningSummary } from "./report-formula/types";
type ExecuteReportResult = {
    data: Record<string, unknown>[];
    totalRecords: number;
    formulaWarnings?: FormulaWarningSummary[];
};
export declare class ReportExecutionService {
    private readonly db;
    private readonly access;
    private readonly logger;
    constructor(db: DatabaseService, access: AccessScopeService);
    execute(user: JwtPayload, reportId: number, body: ExecuteReportDto): Promise<ExecuteReportResult>;
    private assertExecutePermission;
    private buildScopeWhere;
    private buildSearchWhere;
    /**
     * Build a Prisma `select` that supports:
     * - scalar columns on the primary table
     * - dotted relation fields stored as `Country.name` on the primary table
     * - common Customer virtual fields (name, category, parent_customer_name)
     */
    private buildSelect;
    private applyCustomerPolicyNumberSelect;
    private applyInvoicePolicyNumberSelect;
    /** Ensure FKs / Customer.id needed for __link_* metadata are selected. */
    private enrichSelectForLinks;
    /** Expand known virtual fields into includes; returns true if handled. */
    private applyVirtualSelect;
    private applyCustomerNameSelect;
    /** Remap report filter aliases to real Prisma columns before query build. */
    private normalizeFilters;
    private buildOrderBy;
    private parseSortField;
    private formatRow;
    private extractFieldValue;
    private applyAuditUserSelect;
    private getAuditUserRelationName;
    private extractAuditUserName;
    private getNestedValue;
    private extractCustomerPolicyNumber;
    private extractInvoicePolicyNumber;
    /**
     * Activity report aliases that are not Activity columns.
     * Returns `undefined` when the field is a normal scalar.
     */
    private extractActivityVirtualField;
    /**
     * Dispute report aliases that are not CustomerDispute columns.
     * Returns `undefined` when the field is a normal scalar.
     */
    private extractDisputeVirtualField;
    private extractCustomerName;
    private extractParentCustomerName;
    private formatValue;
    private formatNumber;
    private looksLikeDateField;
}
export {};
