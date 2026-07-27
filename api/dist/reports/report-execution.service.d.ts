import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";
import { ExecuteReportDto } from "./dto/execute-report.dto";
export declare class ReportExecutionService {
    private readonly db;
    private readonly access;
    constructor(db: DatabaseService, access: AccessScopeService);
    execute(user: JwtPayload, reportId: number, body: ExecuteReportDto): Promise<{
        data: Record<string, unknown>[];
        totalRecords: number;
    }>;
    private assertExecutePermission;
    private buildScopeWhere;
    private buildSearchWhere;
    private buildSelect;
    private enrichSelectForLinks;
    private applyVirtualSelect;
    private applyCustomerNameSelect;
    private normalizeFilters;
    private buildOrderBy;
    private parseSortField;
    private formatRow;
    private extractFieldValue;
    private extractActivityVirtualField;
    private extractDisputeVirtualField;
    private extractCustomerName;
    private extractParentCustomerName;
    private formatValue;
    private looksLikeDateField;
}
