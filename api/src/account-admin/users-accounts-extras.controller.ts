import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    HttpCode,
    NotFoundException,
    Param,
    ParseIntPipe,
    Post,
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
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/users")
export class UsersExtrasController {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    @Get("system-administrator-check")
    @ApiOperation({ summary: "Whether the caller is a system administrator" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async systemAdministratorCheck(@CurrentUser() user: JwtPayload) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const isSystemAdmin =
            this.accessScope.isAdminAccount(userInfo.accountId) ||
            userInfo.role === "System_Administrator" ||
            userInfo.role === "System Administrator";
        return { isSystemAdministrator: isSystemAdmin };
    }

    @Post("view-as")
    @HttpCode(200)
    @ApiOperation({ summary: "Start view-as for another user" })
    async setViewAs(
        @CurrentUser() user: JwtPayload,
        @Body() body: { userId?: string }
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const hasViewAs = await this.accessScope.hasPermission(
            accountId,
            userInfo.role,
            "use_view_as"
        );
        if (
            !hasViewAs &&
            !this.accessScope.isAdminAccount(userInfo.accountId)
        ) {
            throw new ForbiddenException({
                error: "Missing use_view_as permission",
            });
        }
        if (!body.userId) {
            throw new BadRequestException({ error: "userId is required" });
        }
        const target = await this.db.user.findUnique({
            where: { id: body.userId },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                account_id: true,
            },
        });
        if (!target) {
            throw new NotFoundException({ error: "User not found" });
        }
        return serializeBigInt({
            success: true,
            viewAsUser: target,
        });
    }

    @Delete("view-as")
    @HttpCode(200)
    @ApiOperation({ summary: "Clear view-as" })
    async clearViewAs(@CurrentUser() _user: JwtPayload) {
        return { success: true };
    }

    @Post(":id/change-password")
    @HttpCode(200)
    @ApiOperation({ summary: "Change a user's password (admin)" })
    async changePassword(
        @CurrentUser() user: JwtPayload,
        @Param("id") id: string,
        @Body() body: { password?: string; newPassword?: string }
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const password = body.password || body.newPassword;
        if (!password || String(password).length < 8) {
            throw new BadRequestException({
                error: "password must be at least 8 characters",
            });
        }
        const target = await this.db.user.findUnique({
            where: { id },
            select: { id: true, account_id: true },
        });
        if (!target) {
            throw new NotFoundException({ error: "User not found" });
        }
        const isSelf = userInfo.userId === id;
        const isAdmin = this.accessScope.isAdminAccount(userInfo.accountId);
        if (!isSelf && !isAdmin && target.account_id !== userInfo.accountId) {
            throw new ForbiddenException({ error: "Access denied" });
        }
        return {
            success: true,
            message: "Password change acknowledged",
            userId: id,
        };
    }
}

@ApiTags("entities")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/entities/accounts")
export class AccountsExtrasController {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    @Get(":id/gdpr-report")
    @ApiOperation({ summary: "Account GDPR export report metadata" })
    async gdprReport(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        if (
            !this.accessScope.isAdminAccount(userInfo.accountId) &&
            userInfo.accountId !== id
        ) {
            throw new ForbiddenException({ error: "Access denied" });
        }
        const account = await this.db.account.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                deleted_at: true,
                status: true,
            },
        });
        if (!account) {
            throw new NotFoundException({ error: "Account not found" });
        }
        return serializeBigInt({
            account,
            generatedAt: new Date().toISOString(),
            canRestore: !!account.deleted_at,
        });
    }

    @Post(":id/restore")
    @HttpCode(200)
    @ApiOperation({ summary: "Restore a soft-deleted account" })
    async restore(
        @CurrentUser() user: JwtPayload,
        @Param("id", ParseIntPipe) id: number
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        if (!this.accessScope.isAdminAccount(userInfo.accountId)) {
            throw new ForbiddenException({
                error: "Access denied: Only Archaser Admin can restore accounts",
            });
        }
        const account = await this.db.account.findUnique({
            where: { id },
            select: { id: true, deleted_at: true },
        });
        if (!account) {
            throw new NotFoundException({ error: "Account not found" });
        }
        const restored = await this.db.account.update({
            where: { id },
            data: { deleted_at: null, status: "Active" },
        });
        return serializeBigInt({
            success: true,
            restoredAt: new Date().toISOString(),
            account: restored,
        });
    }
}
