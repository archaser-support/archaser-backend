import {
    Controller,
    Get,
    Param,
    ParseIntPipe,
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
import {
    AccountAdminEntitiesService,
    AccountAdminListQuery,
} from "./account-admin-entities.service";

/**
 * Nested legacy path used by Settings / Agents / Customer forms:
 * GET /api/entities/accounts/:accountId/business-units
 */
@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/accounts/:accountId/business-units")
export class AccountsBusinessUnitsController {
    constructor(private readonly service: AccountAdminEntitiesService) {}

    @Get()
    @ApiOperation({
        summary: "List business units for an account (Nest-native)",
    })
    @ApiUnauthorizedResponse({
        description: "Missing Bearer or session cookie",
    })
    async list(
        @CurrentUser() user: JwtPayload,
        @Param("accountId", ParseIntPipe) accountId: number,
        @Query() query: AccountAdminListQuery
    ) {
        return this.service.listAccountBusinessUnits(user, accountId, query);
    }
}
