import {
    Body,
    Controller,
    Get,
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
import { BillingConnectorApiService } from "./billing-connector.service";

@ApiTags("billing-connector")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/accounts/:accountId/billing-connector")
export class BillingConnectorController {
    constructor(private readonly service: BillingConnectorApiService) {}

    @Get()
    @ApiOperation({ summary: "Get billing connector config" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async get(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        return this.service.getConfig(user, accountId);
    }

    @Put()
    @ApiOperation({ summary: "Upsert billing connector config" })
    async put(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.upsertConfig(user, accountId, body ?? {});
    }

    @Post("test")
    @ApiOperation({ summary: "Test billing connector connection" })
    async test(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.testConnection(user, accountId, body ?? {});
    }

    @Post("sync")
    @ApiOperation({
        summary: "Run preview, backfill, or incremental sync (awaits completion)",
    })
    async sync(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Query("mode") mode?: string,
        @Query("importType") importType?: string,
        @Body() body?: Record<string, unknown>
    ) {
        const bodyImportType =
            typeof body?.importType === "string" ? body.importType : undefined;
        return this.service.runSync(
            user,
            accountId,
            mode,
            importType ?? bodyImportType
        );
    }

    @Post("sync/cancel")
    @ApiOperation({ summary: "Cancel the in-process running sync" })
    async cancel(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        return this.service.cancelSync(user, accountId);
    }

    @Get("sync-runs")
    @ApiOperation({ summary: "List recent billing connector sync runs" })
    async syncRuns(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Query("limit") limit?: string
    ) {
        return this.service.listSyncRuns(user, accountId, limit);
    }

    @Post("backfill/reset")
    @ApiOperation({ summary: "Reset billing connector backfill" })
    async backfillReset(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.resetBackfill(user, accountId, body ?? {});
    }

    @Get("entity-sets")
    @ApiOperation({ summary: "Get cached Priority entity-set catalog" })
    async getEntitySets(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        return this.service.getEntitySets(user, accountId);
    }

    @Post("entity-sets")
    @ApiOperation({ summary: "Refresh Priority entity-set catalog from $metadata" })
    async refreshEntitySets(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number
    ) {
        return this.service.refreshEntitySets(user, accountId);
    }

    @Get("mappings/:importType")
    @ApiOperation({ summary: "Get field mappings for an import type" })
    async getMappings(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("importType") importType: string
    ) {
        return this.service.getMapping(user, accountId, importType);
    }

    @Put("mappings/:importType")
    @ApiOperation({ summary: "Save field mappings for an import type" })
    async putMappings(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("importType") importType: string,
        @Body() body: Record<string, unknown>
    ) {
        return this.service.putMapping(user, accountId, importType, body ?? {});
    }

    @Get("discover-fields/:importType")
    @ApiOperation({ summary: "Get cached discovered ERP fields" })
    async getDiscover(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("importType") importType: string
    ) {
        return this.service.getDiscoveredFields(user, accountId, importType);
    }

    @Post("discover-fields/:importType")
    @ApiOperation({ summary: "Discover ERP fields from Priority" })
    async postDiscover(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Param("importType") importType: string
    ) {
        return this.service.discoverFields(user, accountId, importType);
    }
}
