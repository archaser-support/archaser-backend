import {
    Body,
    Controller,
    Delete,
    Get,
    NotFoundException,
    Post,
    Put,
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
import { DualAuthGuard } from "../auth/dual-auth.guard";
import { JwtPayload } from "../auth/auth.service";
import { DatabaseService } from "../database/database.service";

const TOOLTIP_PREFIX = "tooltip_seen_";

@ApiTags("user-preferences")
@ApiBearerAuth()
@UseGuards(DualAuthGuard)
@Controller("api/user-preferences")
export class UserPreferencesController {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    private async resolveUserId(user: JwtPayload): Promise<string> {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveUserId(userInfo);
    }

    @Get("tooltips")
    @ApiOperation({ summary: "Get guided tooltip preferences" })
    @ApiUnauthorizedResponse({ description: "Missing Bearer or session cookie" })
    async getTooltips(@CurrentUser() user: JwtPayload) {
        const userId = await this.resolveUserId(user);
        const dbUser = await this.db.user.findUnique({
            where: { id: userId },
            select: { guided_tooltips_enabled: true },
        });
        if (!dbUser) {
            throw new NotFoundException({ error: "User not found" });
        }
        const preferences = await this.db.userPreferences.findMany({
            where: {
                userId,
                preferenceKey: { startsWith: TOOLTIP_PREFIX },
            },
        });
        const seenTooltips = preferences.map((pref) => {
            const tooltipId = pref.preferenceKey.replace(TOOLTIP_PREFIX, "");
            const raw = pref.preferenceValue;
            let metadata: Record<string, unknown>;
            if (
                raw &&
                typeof raw === "object" &&
                !Array.isArray(raw) &&
                "tier" in raw &&
                "order" in raw &&
                "seenAt" in raw
            ) {
                metadata = raw as Record<string, unknown>;
            } else {
                metadata = {
                    tier: 1,
                    order: 0,
                    seenAt: pref.created_at.toISOString(),
                };
            }
            return { tooltipId, metadata };
        });
        return {
            enabled: dbUser.guided_tooltips_enabled ?? true,
            seenTooltips,
        };
    }

    @Post("tooltips")
    @ApiOperation({ summary: "Mark a tooltip as seen" })
    async markSeen(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        const userId = await this.resolveUserId(user);
        if (
            !body.tooltipId ||
            body.tier === undefined ||
            body.order === undefined
        ) {
            return {
                error: "tooltipId, tier, and order are required",
            };
        }
        const preferenceKey = `${TOOLTIP_PREFIX}${body.tooltipId}`;
        const metadata = {
            tier: body.tier ?? null,
            order: body.order ?? null,
            seenAt: new Date().toISOString(),
            page: body.page ?? null,
        };
        await this.db.userPreferences.upsert({
            where: {
                userId_preferenceKey: { userId, preferenceKey },
            },
            create: {
                userId,
                preferenceKey,
                preferenceValue: metadata as object,
            },
            update: {
                preferenceValue: metadata as object,
                modified_at: new Date(),
            },
        });
        return { success: true };
    }

    @Put("tooltips")
    @ApiOperation({ summary: "Toggle guided tooltips enabled" })
    async toggle(
        @CurrentUser() user: JwtPayload,
        @Body() body: Record<string, unknown>
    ) {
        const userId = await this.resolveUserId(user);
        if (typeof body.enabled !== "boolean") {
            return { error: "enabled boolean is required" };
        }
        await this.db.user.update({
            where: { id: userId },
            data: { guided_tooltips_enabled: body.enabled },
        });
        return { success: true, enabled: body.enabled };
    }

    @Delete("tooltips")
    @ApiOperation({ summary: "Reset all seen tooltip preferences" })
    async reset(@CurrentUser() user: JwtPayload) {
        const userId = await this.resolveUserId(user);
        await this.db.userPreferences.deleteMany({
            where: {
                userId,
                preferenceKey: { startsWith: TOOLTIP_PREFIX },
            },
        });
        return { success: true };
    }
}
