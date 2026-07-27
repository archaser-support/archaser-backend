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
exports.AgentsFollowUpController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const crypto_1 = require("crypto");
const access_scope_service_1 = require("../auth/access-scope.service");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let AgentsFollowUpController = class AgentsFollowUpController {
    constructor(db, accessScope) {
        this.db = db;
        this.accessScope = accessScope;
    }
    async assertReminderPermission(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const role = userInfo.viewAsUserRole || userInfo.role;
        const allowed = await this.accessScope.hasPermission(accountId, role, "view_follow_up_reminders");
        if (!allowed) {
            throw new common_1.ForbiddenException({
                error: "Forbidden: view_follow_up_reminders permission required",
            });
        }
        return userInfo;
    }
    async dismissed(user) {
        const userInfo = await this.assertReminderPermission(user);
        const now = new Date();
        const notifications = await this.db.notification.findMany({
            where: {
                user_id: userInfo.userId,
                metadata: {
                    path: ["followUpReminder"],
                    equals: true,
                },
            },
        });
        const dismissed = [];
        for (const n of notifications) {
            const m = n.metadata;
            if (!m || m.customerCollectionPeriodId == null || !m.followUpTime) {
                continue;
            }
            const snoozedUntil = typeof m.snoozedUntil === "string"
                ? new Date(m.snoozedUntil)
                : null;
            const isSnoozed = !!(snoozedUntil && snoozedUntil > now);
            if (n.read === true || isSnoozed) {
                dismissed.push({
                    customerCollectionPeriodId: m.customerCollectionPeriodId,
                    followUpTime: m.followUpTime,
                    snoozedUntil: typeof m.snoozedUntil === "string"
                        ? m.snoozedUntil
                        : undefined,
                });
            }
        }
        return { dismissed };
    }
    async dismiss(user, body) {
        const userInfo = await this.assertReminderPermission(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const userId = userInfo.userId;
        if (body.customerCollectionPeriodId == null ||
            !body.followUpTime ||
            body.customerId == null) {
            throw new common_1.BadRequestException({
                error: "Missing required fields: customerCollectionPeriodId, followUpTime, customerId",
            });
        }
        const action = body.action ?? "dismiss";
        if (action === "snooze" && !body.snoozedUntil) {
            throw new common_1.BadRequestException({
                error: "snoozedUntil is required when action is snooze",
            });
        }
        const metadata = {
            followUpReminder: true,
            customerCollectionPeriodId: body.customerCollectionPeriodId,
            followUpTime: body.followUpTime,
            customerId: body.customerId,
            customerName: body.customerName ?? "",
            dismissedAt: action === "dismiss" ? new Date().toISOString() : undefined,
            snoozedUntil: action === "snooze" ? body.snoozedUntil : undefined,
            completedById: action === "complete" ? userId : undefined,
        };
        const title = action === "snooze"
            ? "Follow-up reminder snoozed"
            : action === "complete"
                ? "Follow-up marked complete"
                : "Follow-up reminder dismissed";
        const message = action === "snooze"
            ? `Snoozed until ${body.snoozedUntil}`
            : action === "complete"
                ? `Marked follow-up complete for ${body.customerName ?? "customer"}`
                : `Dismissed follow-up for ${body.customerName ?? "customer"}`;
        const actionUrl = `/app/customers/${body.customerId}?activeTab=outstanding-activities-tab`;
        if (action === "complete") {
            await this.db.customerCollectionPeriod.updateMany({
                where: {
                    id: body.customerCollectionPeriodId,
                    Customer: { account_id: accountId },
                },
                data: {
                    follow_up_time: null,
                    modified_by: userId,
                },
            });
        }
        const existing = await this.db.notification.findMany({
            where: {
                account_id: accountId,
                user_id: userId,
                metadata: {
                    path: ["followUpReminder"],
                    equals: true,
                },
            },
        });
        const match = existing.find((n) => {
            const m = n.metadata;
            return (m?.customerCollectionPeriodId ===
                body.customerCollectionPeriodId &&
                m?.followUpTime === body.followUpTime);
        });
        const read = action === "dismiss" || action === "complete";
        if (match) {
            await this.db.notification.update({
                where: { id: match.id },
                data: {
                    title,
                    message,
                    read,
                    action_url: actionUrl,
                    metadata: metadata,
                    modified_at: new Date(),
                },
            });
            return (0, serialize_bigint_1.serializeBigInt)({ success: true, updated: true });
        }
        await this.db.notification.create({
            data: {
                id: (0, crypto_1.randomUUID)(),
                type: "Primary",
                title,
                message,
                priority: "Normal",
                user_id: userId,
                account_id: accountId,
                read,
                action_url: actionUrl,
                metadata: metadata,
                created_at: new Date(),
                modified_at: new Date(),
            },
        });
        return (0, serialize_bigint_1.serializeBigInt)({ success: true, updated: false });
    }
};
exports.AgentsFollowUpController = AgentsFollowUpController;
__decorate([
    (0, common_1.Get)("dismissed"),
    (0, swagger_1.ApiOperation)({ summary: "Dismissed / snoozed follow-up reminders" }),
    (0, swagger_1.ApiUnauthorizedResponse)({
        description: "Missing Bearer or session cookie",
    }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AgentsFollowUpController.prototype, "dismissed", null);
__decorate([
    (0, common_1.Post)("dismiss"),
    (0, swagger_1.ApiOperation)({ summary: "Dismiss, snooze, or complete a follow-up" }),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AgentsFollowUpController.prototype, "dismiss", null);
exports.AgentsFollowUpController = AgentsFollowUpController = __decorate([
    (0, swagger_1.ApiTags)("agents"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/agents/follow-up-reminder"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService])
], AgentsFollowUpController);
//# sourceMappingURL=agents-follow-up.controller.js.map