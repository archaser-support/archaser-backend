import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    Query,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiParam,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { OPERATION_TYPES } from "../domain/route-catalog.constants";
import { OperationsListQuery, OperationsService } from "./operations.service";

@ApiTags("operations")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/operations")
export class OperationsDomainController {
    constructor(private readonly operations: OperationsService) {}

    @Get(":operationType")
    @ApiParam({
        name: "operationType",
        enum: OPERATION_TYPES,
    })
    @ApiOperation({
        summary: "Operations list (Nest-native)",
    })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @Param("operationType") operationType: string,
        @CurrentUser() user: JwtPayload,
        @Query() query: OperationsListQuery
    ) {
        return this.operations.list(operationType, user, query);
    }

    @Delete("notifications/:id")
    @ApiOperation({ summary: "Delete a notification" })
    async deleteNotification(
        @Param("id") id: string,
        @CurrentUser() user: JwtPayload
    ) {
        return this.operations.deleteNotification(user, id);
    }

    @Delete("notifications")
    @ApiOperation({ summary: "Bulk notification delete / cleanup" })
    async deleteNotificationsBulk(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.operations.deleteNotificationsBulk(user, body);
    }

    @Put("notifications/:id")
    @ApiOperation({ summary: "Mark notification read / update" })
    async updateNotification(
        @Param("id") id: string,
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.operations.updateNotification(user, id, body);
    }

    @Get("disputes/stats")
    @ApiOperation({ summary: "Dispute statistics" })
    async disputeStats(@CurrentUser() user: JwtPayload) {
        return this.operations.getDisputeStats(user);
    }

    @Get(":operationType/:id")
    @ApiParam({ name: "operationType", enum: OPERATION_TYPES })
    @ApiOperation({ summary: "Operations detail by id (Nest-native)" })
    async byId(
        @Param("operationType") operationType: string,
        @Param("id") id: string,
        @CurrentUser() user: JwtPayload
    ) {
        return this.operations.getById(operationType, user, id);
    }

    @Put(":operationType/:id")
    @ApiParam({ name: "operationType", enum: OPERATION_TYPES })
    @ApiOperation({ summary: "Operations update (Nest-native)" })
    async update(
        @Param("operationType") operationType: string,
        @Param("id") id: string,
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        return this.operations.update(operationType, user, id, body);
    }

    @Post(":operationType")
    @ApiParam({ name: "operationType", enum: OPERATION_TYPES })
    @ApiOperation({ summary: "Operations create (Nest-native stub)" })
    async create(
        @Param("operationType") operationType: string,
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        void user;
        void body;
        return { ok: true, operationType };
    }
}
