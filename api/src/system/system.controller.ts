import {
    Body,
    Controller,
    Get,
    Param,
    Post,
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
import { SystemListQuery, SystemService } from "./system.service";

@ApiTags("system")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/system")
export class SystemController {
    constructor(private readonly system: SystemService) {}

    @Get("dashboard")
    @ApiOperation({ summary: "Financial dashboard KPIs (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async dashboard(
        @CurrentUser() user: JwtPayload,
        @Query() query: SystemListQuery
    ) {
        return this.system.getDashboard(user, query);
    }

    @Get("dashboard/chart-details")
    @ApiOperation({ summary: "Dashboard chart drilldown (Nest-native)" })
    async chartDetails(
        @CurrentUser() user: JwtPayload,
        @Query() query: SystemListQuery
    ) {
        return this.system.getChartDetails(user, query);
    }

    @Get("control-center")
    @ApiOperation({ summary: "Control center overview (Nest-native)" })
    async controlCenter(
        @CurrentUser() user: JwtPayload,
        @Query("operation") operation?: string
    ) {
        return this.system.getControlCenter(user, operation || "stats");
    }

    @Get("control-center/:operation")
    @ApiOperation({ summary: "Control center by operation (Nest-native)" })
    async controlCenterOp(
        @CurrentUser() user: JwtPayload,
        @Param("operation") operation: string
    ) {
        return this.system.getControlCenter(user, operation);
    }

    @Post("control-center")
    @ApiOperation({ summary: "Control center POST (Nest-native)" })
    async controlCenterPost(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>,
        @Query("operation") operation?: string
    ) {
        return this.system.postControlCenter(user, operation, body);
    }

    @Post("control-center/:operation")
    @ApiOperation({ summary: "Control center POST by operation" })
    async controlCenterPostOp(
        @CurrentUser() user: JwtPayload,
        @Param("operation") operation: string,
        @Body() body: Record<string, unknown>
    ) {
        return this.system.postControlCenter(user, operation, body);
    }

    @Get("operation-dashboard")
    @ApiOperation({ summary: "Operation dashboard KPIs (Nest-native)" })
    async operationDashboard(
        @CurrentUser() user: JwtPayload,
        @Query() query: SystemListQuery
    ) {
        return this.system.getOperationDashboard(user, query);
    }

    @Get("operation-dashboard/details")
    @ApiOperation({ summary: "Operation dashboard drilldown (Nest-native)" })
    async operationDashboardDetails(
        @CurrentUser() user: JwtPayload,
        @Query() query: SystemListQuery
    ) {
        return this.system.getOperationDashboardDetails(user, query);
    }

    @Get("agents")
    @ApiOperation({ summary: "Agents list (Nest-native)" })
    async agents(
        @CurrentUser() user: JwtPayload,
        @Query() query: SystemListQuery
    ) {
        return this.system.getAgents(user, query);
    }

    @Get("agents/stats")
    @ApiOperation({ summary: "Agents stats (Nest-native)" })
    async agentsStats(
        @CurrentUser() user: JwtPayload,
        @Query() query: SystemListQuery
    ) {
        return this.system.getAgentsStats(user, query);
    }

    @Get("agents/follow-up")
    @ApiOperation({ summary: "Agents follow-up list (Nest-native)" })
    async agentsFollowUp(@CurrentUser() user: JwtPayload) {
        return this.system.getAgentsFollowUp(user);
    }

    @Get("promise-to-pay")
    @ApiOperation({ summary: "Promise-to-pay list (Nest-native)" })
    async promiseToPay(
        @CurrentUser() user: JwtPayload,
        @Query() query: SystemListQuery
    ) {
        return this.system.getPromiseToPay(user, query);
    }

    @Get("promise-to-pay/stats")
    @ApiOperation({ summary: "Promise-to-pay stats (Nest-native)" })
    async promiseToPayStats(@CurrentUser() user: JwtPayload) {
        return this.system.getPromiseToPayStats(user);
    }

    @Post("promise-to-pay")
    @ApiOperation({ summary: "Promise-to-pay POST (Nest-native stub)" })
    async promiseToPayPost(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.system.postPromiseToPay(user, body);
    }

    @Get("admin/cron-jobs")
    @ApiOperation({ summary: "List cron jobs (Nest-native)" })
    async cronJobs(@CurrentUser() user: JwtPayload) {
        return this.system.getCronJobs(user);
    }

    @Post("admin/cron-jobs")
    @ApiOperation({ summary: "Trigger cron jobs (Nest stub ack)" })
    async cronJobsPost(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.system.postCronJobs(user, body);
    }

    @Get("cron")
    @ApiOperation({ summary: "Cron jobs alias (Nest-native)" })
    async cronAlias(@CurrentUser() user: JwtPayload) {
        return this.system.getCronJobs(user);
    }

    @Post("cron")
    @ApiOperation({ summary: "Cron trigger alias (Nest stub ack)" })
    async cronAliasPost(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.system.postCronJobs(user, body);
    }

    @Get("shared-stats/:operation")
    @ApiOperation({ summary: "Shared stats by operation (Nest-native)" })
    async sharedStats(
        @CurrentUser() user: JwtPayload,
        @Param("operation") operation: string
    ) {
        return this.system.getSharedStats(user, operation);
    }
}

@ApiTags("system")
@Controller("api/system/cache-invalidation")
export class SystemCacheInvalidationController {
    constructor(private readonly system: SystemService) {}

    /** Legacy cron path — no DualAuth (source must be cron-job). */
    @Post()
    @ApiOperation({ summary: "Cache invalidation ack (Nest-native)" })
    async invalidate(@Body() body: Record<string, unknown>) {
        return this.system.cacheInvalidation(body);
    }
}
