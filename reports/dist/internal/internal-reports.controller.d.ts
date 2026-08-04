import { DatabaseService } from "../database/database.service";
import { ExecuteReportDto } from "../reports/dto/execute-report.dto";
import { ReportExecutionService } from "../reports/report-execution.service";
import { type ReportExportFormat } from "../reports/report-export.util";
type InternalExecuteBody = ExecuteReportDto & {
    triggeredBy?: string;
    scheduleId?: number;
};
export declare class InternalReportsController {
    private readonly db;
    private readonly execution;
    constructor(db: DatabaseService, execution: ReportExecutionService);
    execute(id: number, body: InternalExecuteBody): Promise<{
        data: Record<string, unknown>[];
        totalRecords: number;
        formulaWarnings?: import("../reports/report-formula/types").FormulaWarningSummary[];
    }>;
    export(id: number, body: ExecuteReportDto & {
        format?: ReportExportFormat;
        executeResult?: {
            data?: Record<string, unknown>[];
        };
    }): Promise<import("../reports/report-export.util").ReportExportPayload>;
    private resolveExecutionUser;
}
export {};
