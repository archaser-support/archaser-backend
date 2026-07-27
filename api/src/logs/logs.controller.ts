import {
    Body,
    Controller,
    ForbiddenException,
    Get,
    Post,
    Query,
    Req,
    UseGuards,
} from "@nestjs/common";
import {
    ApiBearerAuth,
    ApiOperation,
    ApiTags,
    ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { AccessScopeService } from "../auth/access-scope.service";
import { CurrentUser } from "../auth/current-user.decorator";
import { DualAuthGuard, DualAuthRequest } from "../auth/dual-auth.guard";
import { SoftDualAuthGuard } from "../auth/soft-dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";

@ApiTags("logs")
@Controller("api/logs")
export class LogsController {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    @Get()
    @UseGuards(DualAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({ summary: "Account system logs (Nest-native)" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async list(
        @CurrentUser() user: JwtPayload,
        @Query() query: Record<string, string | undefined>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const allowed = await this.accessScope.hasPermission(
            accountId,
            role,
            "view_system_logs"
        );
        if (!allowed) {
            throw new ForbiddenException({
                error: "Forbidden - view_system_logs permission required",
            });
        }

        if (query.operation === "sources") {
            const grouped = await this.db.log.groupBy({
                by: ["source"],
                where: { account_id: accountId },
            });
            return {
                sources: grouped
                    .map((g) => g.source)
                    .filter((s) => s && s.trim() !== ""),
            };
        }

        const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
        const limit = Math.min(
            200,
            Math.max(1, parseInt(query.limit || "25", 10) || 25)
        );
        const where: Record<string, unknown> = { account_id: accountId };
        if (query.source) where.source = query.source;
        if (query.level) where.level = String(query.level).toUpperCase();
        if (query.search) {
            where.message = {
                contains: query.search,
                mode: "insensitive",
            };
        }

        const [logs, totalRecords] = await Promise.all([
            this.db.log.findMany({
                where,
                orderBy: { timestamp: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.log.count({ where }),
        ]);

        return serializeBigInt({
            logs,
            totalRecords,
            page,
            limit,
            accountId,
        });
    }

    @Post("create")
    @UseGuards(SoftDualAuthGuard)
    @ApiOperation({
        summary: "Create a client/system log entry (Nest-native)",
    })
    async create(
        @Body() body: Record<string, unknown>,
        @Req() req: DualAuthRequest
    ) {
        const user = req.user;
        const message =
            typeof body.message === "string" ? body.message : "";
        const source =
            typeof body.source === "string" ? body.source : "";
        if (!message || !source) {
            return {
                error: "Validation failed",
                errors: ["message and source are required"],
            };
        }
        const isLoginEvent =
            source === "Login" ||
            source === "Middleware-Auth" ||
            (body.details &&
                typeof body.details === "object" &&
                [
                    "login_attempt",
                    "authentication_failed",
                    "form_validation_failed",
                ].includes(
                    String(
                        (body.details as Record<string, unknown>).action || ""
                    )
                ));
        if (!user && !isLoginEvent) {
            return { error: "Unauthorized" };
        }

        const levelRaw = String(body.level || "INFO").toUpperCase();
        const level = [
            "DEBUG",
            "INFO",
            "WARNING",
            "ERROR",
            "CRITICAL",
        ].includes(levelRaw)
            ? (levelRaw as
                  | "DEBUG"
                  | "INFO"
                  | "WARNING"
                  | "ERROR"
                  | "CRITICAL")
            : "INFO";

        await this.db.log.create({
            data: {
                level,
                message: message.slice(0, 10000),
                source: source.slice(0, 255),
                details:
                    body.details && typeof body.details === "object"
                        ? (body.details as object)
                        : undefined,
                account_id: user?.account_id ?? null,
                user_id: user?.sub ?? null,
            },
        });
        return { success: true };
    }
}
