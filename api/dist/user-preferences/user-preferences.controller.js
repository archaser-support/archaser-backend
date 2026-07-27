"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserPreferencesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const access_scope_service_1 = require("../auth/access-scope.service");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const database_service_1 = require("../database/database.service");
const TOOLTIP_PREFIX = "tooltip_seen_";
let UserPreferencesController = class UserPreferencesController {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async resolveUserId(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveUserId(userInfo);
    }
    async getTooltips(user) {
        const userId = await this.resolveUserId(user);
        const dbUser = await this.db.user.findUnique({
            where: { id: userId },
            select: { guided_tooltips_enabled: true },
        });
        if (!dbUser) {
            throw new common_1.NotFoundException({ error: "User not found" });
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
            let metadata;
            if (raw &&
                typeof raw === "object" &&
                !Array.isArray(raw) &&
                "tier" in raw &&
                "order" in raw &&
                "seenAt" in raw) {
                metadata = raw;
            }
            else {
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
    async markSeen(user, body) {
        const userId = await this.resolveUserId(user);
        if (!body.tooltipId ||
            body.tier === undefined ||
            body.order === undefined) {
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
                preferenceValue: metadata,
            },
            update: {
                preferenceValue: metadata,
                modified_at: new Date(),
            },
        });
        return { success: true };
    }
    async toggle(user, body) {
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
    async reset(user) {
        const userId = await this.resolveUserId(user);
        await this.db.userPreferences.deleteMany({
            where: {
                userId,
                preferenceKey: { startsWith: TOOLTIP_PREFIX },
            },
        });
        return { success: true };
    }
};
exports.UserPreferencesController = UserPreferencesController;
__decorate([
    (0, common_1.Get)("tooltips"),
    (0, swagger_1.ApiOperation)({ summary: "Get guided tooltip preferences" }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserPreferencesController.prototype, "getTooltips", null);
__decorate([
    (0, common_1.Post)("tooltips"),
    (0, swagger_1.ApiOperation)({ summary: "Mark a tooltip as seen" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserPreferencesController.prototype, "markSeen", null);
__decorate([
    (0, common_1.Put)("tooltips"),
    (0, swagger_1.ApiOperation)({ summary: "Toggle guided tooltips enabled" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], UserPreferencesController.prototype, "toggle", null);
__decorate([
    (0, common_1.Delete)("tooltips"),
    (0, swagger_1.ApiOperation)({ summary: "Reset all seen tooltip preferences" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UserPreferencesController.prototype, "reset", null);
exports.UserPreferencesController = UserPreferencesController = __decorate([
    (0, swagger_1.ApiTags)("user-preferences"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/user-preferences"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], UserPreferencesController);
//# sourceMappingURL=user-preferences.controller.js.map