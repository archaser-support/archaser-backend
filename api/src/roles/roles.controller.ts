import {
    Body,
    Controller,
    Get,
    Param,
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
import { RolesService } from "./roles.service";

@ApiTags("roles")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/roles")
export class RolesController {
    constructor(private readonly roles: RolesService) {}

    @Get()
    @ApiOperation({ summary: "List roles with permission counts" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query("accountId") accountId?: string
    ) {
        return this.roles.listRoles(user, accountId);
    }

    @Get(":role")
    @ApiOperation({ summary: "Get role details with permissions" })
    async getRole(
        @CurrentUser() user: JwtPayload,
        @Param("role") role: string,
        @Query("accountId") accountId?: string
    ) {
        return this.roles.getRole(user, role, accountId);
    }

    @Put(":role")
    @ApiOperation({ summary: "Update role permissions" })
    async updateRole(
        @CurrentUser() user: JwtPayload,
        @Param("role") role: string,
        @Body() body: { permissions?: string[]; accountId?: number },
        @Query("accountId") accountId?: string
    ) {
        return this.roles.updateRole(user, role, body, accountId);
    }
}
