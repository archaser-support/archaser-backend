import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    ParseIntPipe,
    Post,
    Put,
    Query,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { ExecuteReportDto } from "./dto/execute-report.dto";
import { ReportExecutionService } from "./report-execution.service";
import { ReportsService } from "./reports.service";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/reports")
export class ReportsController {
    constructor(
        private readonly reports: ReportsService,
        private readonly execution: ReportExecutionService
    ) {}

    @Get()
    @ApiOperation({ summary: "List reports / default view" })
    @ApiUnauthorizedResponse({ description: "Missing auth" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: Record<string, string | undefined>
    ) {
        return this.reports.list(user, query);
    }

    @Post()
    @ApiOperation({ summary: "Create report" })
    async create(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.reports.create(user, body);
    }

    @Get("metadata")
    @ApiOperation({ summary: "Report builder metadata" })
    async metadata(@CurrentUser() user: JwtPayload) {
        return this.reports.metadata(user);
    }

    @Get("user-default")
    @ApiOperation({ summary: "Get user default view for context" })
    async getUserDefault(
        @CurrentUser() user: JwtPayload,
        @Query("context") context: string
    ) {
        return this.reports.getUserDefault(user, context);
    }

    @Post("user-default")
    @ApiOperation({ summary: "Set user default view" })
    async setUserDefault(
        @CurrentUser() user: JwtPayload,
        @Body() body: { context: string; reportId: number }
    ) {
        return this.reports.setUserDefault(
            user,
            body.context,
            Number(body.reportId)
        );
    }

    @Delete("user-default")
    @ApiOperation({ summary: "Clear user default view" })
    async clearUserDefault(
        @CurrentUser() user: JwtPayload,
        @Query("context") context: string
    ) {
        return this.reports.clearUserDefault(user, context);
    }

    @Post("sync-system")
    @ApiOperation({ summary: "Sync system reports (admin)" })
    async syncSystem(@CurrentUser() user: JwtPayload) {
        return this.reports.syncSystem(user);
    }
}

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/reports")
export class ReportsByIdController {
    constructor(
        private readonly reports: ReportsService,
        private readonly execution: ReportExecutionService
    ) {}

    @Get(":id")
    @ApiOperation({ summary: "Get report by id" })
    async byId(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.reports.getById(user, id);
    }

    @Put(":id")
    @ApiOperation({ summary: "Update report" })
    async update(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.reports.update(user, id, body);
    }

    @Delete(":id")
    @ApiOperation({ summary: "Delete report" })
    async remove(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.reports.remove(user, id);
    }

    @Post(":id/execute")
    @HttpCode(200)
    @ApiOperation({ summary: "Execute report (grid data)" })
    async execute(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: ExecuteReportDto
    ) {
        return this.execution.execute(user, id, body || {});
    }

    @Post(":id/export")
    @HttpCode(200)
    @ApiOperation({ summary: "Export report rows" })
    async export(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        const result = await this.execution.execute(user, id, {
            page: 1,
            limit: 5000,
            filters: body.filters as ExecuteReportDto["filters"],
            search: body.search as string,
            sortField: body.sortField as string,
            sortDirection: body.sortDirection as "asc" | "desc",
            replaceConfigFilters: body.replaceConfigFilters as boolean,
        });
        return {
            format: String(body.format || "csv"),
            rows: result.data,
            totalRecords: result.totalRecords,
            reportId: id,
        };
    }

    @Get(":id/share")
    @ApiOperation({ summary: "List report shares" })
    async listShares(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.reports.listShares(user, id);
    }

    @Post(":id/share")
    @ApiOperation({ summary: "Share report" })
    async share(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.reports.upsertShare(user, id, body);
    }

    @Get(":id/schedule")
    @ApiOperation({ summary: "List report schedules" })
    async listSchedules(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        return this.reports.listSchedules(user, id);
    }

    @Post(":id/schedule")
    @ApiOperation({ summary: "Create/update report schedule" })
    async schedule(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.reports.upsertSchedule(user, id, body);
    }
}
