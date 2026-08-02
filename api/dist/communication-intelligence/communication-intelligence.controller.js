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
    async analytics(customerIdRaw, channel, startDateRaw, endDateRaw, query) {
        const where = {
            channel_selection_reason: { not: null },
        };
        const activityWhere = {};
        if (customerIdRaw) {
            const customerId = parseInt(customerIdRaw, 10);
            if (Number.isFinite(customerId)) {
                activityWhere.customer_id = customerId;
            }
        }
        if (startDateRaw || endDateRaw) {
            activityWhere.created_at = {
                ...(startDateRaw ? { gte: new Date(startDateRaw) } : {}),
                ...(endDateRaw ? { lte: new Date(endDateRaw) } : {}),
            };
        }
        if (Object.keys(activityWhere).length) {
            where.Activity = activityWhere;
        }
        if (channel && channel !== "all") {
            where.communication_channel = channel;
        }
        if (query?.trim()) {
            where.channel_selection_reason = {
                contains: query.trim(),
                mode: "insensitive",
            };
        }
        const rows = await this.db.activityContact.findMany({
            where,
            select: {
                communication_channel: true,
                status: true,
                delivered_at: true,
                failed_at: true,
                created_at: true,
            },
            take: 5000,
        });
        const byChannel = new Map();
        for (const row of rows) {
            const ch = String(row.communication_channel || "Unknown");
            const entry = byChannel.get(ch) || {
                totalAttempts: 0,
                totalSuccesses: 0,
                durations: [],
            };
            entry.totalAttempts += 1;
            const success = row.status === "Delivered" ||
                row.status === "Sent" ||
                !!row.delivered_at;
            if (success)
                entry.totalSuccesses += 1;
            if (row.delivered_at && row.created_at) {
                entry.durations.push(row.delivered_at.getTime() - row.created_at.getTime());
            }
            byChannel.set(ch, entry);
        }
        const channelMetrics = [...byChannel.entries()].map(([ch, m]) => ({
            channel: ch,
            totalAttempts: m.totalAttempts,
            totalSuccesses: m.totalSuccesses,
            successRate: m.totalAttempts > 0
                ? m.totalSuccesses / m.totalAttempts
                : 0,
            averageResponseTime: m.durations.length > 0
                ? m.durations.reduce((a, b) => a + b, 0) / m.durations.length
                : null,
        }));
        return {
            channelMetrics,
            totalRecords: rows.length,
            period: {
                startDate: startDateRaw || null,
                endDate: endDateRaw || null,
            },
            generatedAt: new Date().toISOString(),
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
__decorate([
    (0, common_1.Get)("analytics"),
    (0, swagger_1.ApiOperation)({ summary: "Channel selection analytics aggregates" }),
    __param(0, (0, common_1.Query)("customerId")),
    __param(1, (0, common_1.Query)("channel")),
    __param(2, (0, common_1.Query)("startDate")),
    __param(3, (0, common_1.Query)("endDate")),
    __param(4, (0, common_1.Query)("query")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], CommunicationIntelligenceController.prototype, "analytics", null);
exports.CommunicationIntelligenceController = CommunicationIntelligenceController = __decorate([
    (0, swagger_1.ApiTags)("communication-intelligence"),
    (0, swagger_1.ApiBearerAuth)(),
    (0, common_1.UseGuards)(dual_auth_guard_1.DualAuthGuard),
    (0, common_1.Controller)("api/communication-intelligence"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], CommunicationIntelligenceController);
//# sourceMappingURL=communication-intelligence.controller.js.map