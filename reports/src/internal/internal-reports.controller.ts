import {
    Body,
    Controller,
    HttpCode,
    NotFoundException,
    Param,
    ParseIntPipe,
    Post,
    UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { InternalSecretGuard } from "../auth/internal-secret.guard";
import { JwtPayload } from "../auth/jwt-payload";
import { DatabaseService } from "../database/database.service";
import { ExecuteReportDto } from "../reports/dto/execute-report.dto";
import { ReportExecutionService } from "../reports/report-execution.service";
import {
    buildReportExport,
    type ReportExportFormat,
} from "../reports/report-export.util";

const SCHEDULER_EXECUTION_ROLES = [
    "System_Administrator",
    "Account_Manager",
    "CFO",
    "Collection_Manager",
    "Data_Analyst",
] as const;

type InternalExecuteBody = ExecuteReportDto & {
    triggeredBy?: string;
    scheduleId?: number;
};

@ApiTags("internal-reports")
@UseGuards(InternalSecretGuard)
@Controller("internal/reports")
export class InternalReportsController {
    constructor(
        private readonly db: DatabaseService,
        private readonly execution: ReportExecutionService
    ) {}

    @Post(":id/execute")
    @HttpCode(200)
    @ApiOperation({
        summary: "Service-to-service report execute (x-internal-service-secret)",
    })
    async execute(
        @Param("id", ParseIntPipe) id: number,
        @Body() body: InternalExecuteBody
    ) {
        const report = await this.db.report.findUnique({
            where: { id },
            select: { id: true, account_id: true },
        });
        if (!report) {
            throw new NotFoundException(`Report ${id} not found`);
        }

        const user = await this.resolveExecutionUser(report.account_id);
        const { triggeredBy: _triggeredBy, scheduleId: _scheduleId, ...executeBody } =
            body;

        return this.execution.execute(user, id, executeBody || {});
    }

    @Post(":id/export")
    @HttpCode(200)
    @ApiOperation({
        summary:
            "Service-to-service report export (x-internal-service-secret)",
    })
    async export(
        @Param("id", ParseIntPipe) id: number,
        @Body()
        body: ExecuteReportDto & {
            format?: ReportExportFormat;
            executeResult?: { data?: Record<string, unknown>[] };
        }
    ) {
        const report = await this.db.report.findUnique({
            where: { id },
            select: { id: true, account_id: true, name: true },
        });
        if (!report) {
            throw new NotFoundException(`Report ${id} not found`);
        }

        const format = body.format || "csv";
        let rows = body.executeResult?.data;

        if (!rows) {
            const user = await this.resolveExecutionUser(report.account_id);
            const { executeResult: _ignored, format: _fmt, ...executeBody } =
                body;
            const result = await this.execution.execute(
                user,
                id,
                executeBody || {}
            );
            rows = result.data;
        }

        return buildReportExport(rows ?? [], report.name, format);
    }

    private async resolveExecutionUser(accountId: number): Promise<JwtPayload> {
        for (const role of SCHEDULER_EXECUTION_ROLES) {
            const activeUser = await this.db.user.findFirst({
                where: {
                    account_id: accountId,
                    status: "Active",
                    freeze: false,
                    role,
                },
                orderBy: { created_at: "asc" },
                select: {
                    id: true,
                    username: true,
                    email: true,
                    name: true,
                    account_id: true,
                    role: true,
                    language: true,
                    time_zone: true,
                    locale: true,
                    currency: true,
                    sidebar_collapsed: true,
                },
            });

            if (activeUser?.account_id) {
                return {
                    sub: activeUser.id,
                    username: activeUser.username,
                    email: activeUser.email,
                    account_id: activeUser.account_id,
                    role: activeUser.role,
                    name: activeUser.name,
                    language: activeUser.language,
                    timezone: activeUser.time_zone,
                    locale: activeUser.locale,
                    currency: activeUser.currency,
                    sidebar_collapsed: activeUser.sidebar_collapsed,
                };
            }
        }

        throw new NotFoundException(
            `No active report executor user for account ${accountId}`
        );
    }
}
