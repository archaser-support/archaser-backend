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
import { PermissionsService } from "./permissions.service";

@ApiTags("permissions")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/permissions")
export class PermissionsController {
    constructor(private readonly permissionsService: PermissionsService) {}

    @Get("me")
    @ApiOperation({
        summary: "Effective permissions for the authenticated user",
    })
    @ApiUnauthorizedResponse({
        description: "Missing Bearer or session cookie",
    })
    async me(@CurrentUser() user: JwtPayload) {
        return this.permissionsService.getMyPermissions(user);
    }

    @Get()
    @ApiOperation({ summary: "Permissions matrix catalog" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query("accountId") accountId?: string
    ) {
        return this.permissionsService.getPermissionsMatrix(user, accountId);
    }

    @Get(":role")
    @ApiOperation({ summary: "Permissions for a specific role" })
    async getRole(
        @CurrentUser() user: JwtPayload,
        @Param("role") role: string,
        @Query("accountId") accountId?: string
    ) {
        return this.permissionsService.getPermissionsForRole(
            user,
            role,
            accountId
        );
    }

    @Put(":role")
    @ApiOperation({ summary: "Update permissions for a specific role" })
    async putRole(
        @CurrentUser() user: JwtPayload,
        @Param("role") role: string,
        @Body() body: { permissions?: string[]; accountId?: number },
        @Query("accountId") accountId?: string
    ) {
        return this.permissionsService.putPermissionsForRole(
            user,
            role,
            body,
            accountId
        );
    }
}
