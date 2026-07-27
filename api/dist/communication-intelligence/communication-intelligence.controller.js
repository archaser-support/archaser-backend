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
exports.CommunicationIntelligenceController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const dual_auth_guard_1 = require("../auth/dual-auth.guard");
const database_service_1 = require("../database/database.service");
let CommunicationIntelligenceController = class CommunicationIntelligenceController {
    constructor(db) {
        this.db = db;
    }
    async channelSelection(body) {
        const activityId = body.activityId;
        const customerId = body.customerId;
        if (!activityId || !customerId) {
            return {
                error: "activityId and customerId are required",
            };
        }
        const activity = await this.db.activity.findUnique({
            where: { id: BigInt(Number(activityId)) },
            include: {
                Account: {
                    select: {
                        id: true,
                        intelligent_channel_selection_enabled: true,
                    },
                },
                ActivityContact: {
                    include: { Contact: true },
                    take: 10,
                },
            },
        });
        if (!activity) {
            throw new common_1.NotFoundException({ error: "Activity not found" });
        }
        if (!activity.Account?.intelligent_channel_selection_enabled) {
            return {
                error: "Intelligent channel selection is not enabled for this customer",
                enabled: false,
            };
        }
        const contacts = activity.ActivityContact || [];
        const preferred = contacts.find((c) => c.Contact?.email)?.communication_channel ||
            contacts.find((c) => c.Contact?.mobile)?.communication_channel ||
            activity.type ||
            "Email";
        return {
            enabled: true,
            selectedChannel: preferred,
            reason: "nest_pragmatic_default",
            alternatives: ["Email", "SMS", "WhatsApp"].filter((c) => c !== preferred),
            activityId: Number(activityId),
            customerId: Number(customerId),
        };
    }
    async learningData(accountIdRaw, limitRaw) {
        const accountId = accountIdRaw ? parseInt(accountIdRaw, 10) : null;
        const limit = Math.min(parseInt(limitRaw || "50", 10) || 50, 200);
        const where = {
            channel_selection_reason: { not: null },
        };
        if (accountId && Number.isFinite(accountId)) {
            where.Activity = { account_id: accountId };
        }
        const rows = await this.db.activityContact.findMany({
            where,
            take: limit,
            orderBy: { modified_at: "desc" },
            select: {
                id: true,
                communication_channel: true,
                channel_selection_reason: true,
                predicted_success_rate: true,
                status: true,
                delivered_at: true,
                failed_at: true,
            },
        });
        return {
            samples: rows.map((r) => ({
                ...r,
                predicted_success_rate: r.predicted_success_rate != null
                    ? Number(r.predicted_success_rate)
                    : null,
            })),
            total: rows.length,
        };
    }
};
exports.CommunicationIntelligenceController = CommunicationIntelligenceController;
__decorate([
    (0, common_1.Post)("channel-selection"),
    (0, swagger_1.ApiOperation)({
        summary: "Intelligent channel selection (Nest-native pragmatic)",
    }),
    (0, swagger_1.ApiUnauthorizedResponse)({ description: "Missing Bearer or session cookie" }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CommunicationIntelligenceController.prototype, "channelSelection", null);
__decorate([
    (0, common_1.Get)("learning-data"),
    (0, swagger_1.ApiOperation)({ summary: "Communication intelligence learning data" }),
    __param(0, (0, common_1.Query)("accountId")),
    __param(1, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], CommunicationIntelligenceController.prototype, "learningData", null);
exports.CommunicationIntelligenceController = CommunicationIntelligenceController = __decorate([
    (0, swagger_1.ApiTags)("communication-intelligence"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/communication-intelligence"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], CommunicationIntelligenceController);
//# sourceMappingURL=communication-intelligence.controller.js.map