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
exports.PlatformLeavesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
let PlatformLeavesController = class PlatformLeavesController {
    constructor(db) {
        this.db = db;
    }
    async alertDetails(apiKey, type, limitRaw) {
        if (apiKey !== process.env.ALERT_DETAILS_API_KEY) {
            throw new common_1.UnauthorizedException({ error: "Unauthorized" });
        }
        const limitNum = Math.min(parseInt(limitRaw || "10", 10) || 10, 50);
        const currentTime = new Date();
        const twentyFourHoursAgo = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000);
        switch (type) {
            case "automation_stuck_no_contacts": {
                const stuckCustomers = await this.db.customer.findMany({
                    where: { automation_stuck_no_contacts: true },
                    select: {
                        id: true,
                        customer_number: true,
                        email: true,
                        CustomerCollectionPeriod: {
                            where: { period_end_date: null },
                            take: 1,
                            orderBy: { created_at: "desc" },
                            select: {
                                id: true,
                                current_category: true,
                                total_outstanding_amount: true,
                                period_start_date: true,
                            },
                        },
                    },
                    take: limitNum,
                    orderBy: { id: "desc" },
                });
                return (0, serialize_bigint_1.serializeBigInt)({
                    type,
                    count: stuckCustomers.length,
                    details: stuckCustomers.map((c) => {
                        const p = c.CustomerCollectionPeriod?.[0];
                        return {
                            period_id: p?.id,
                            customer_id: c.customer_number || String(c.id),
                            customer_email: c.email || "N/A",
                            category: p?.current_category,
                            outstanding_amount: p?.total_outstanding_amount,
                            period_start: p?.period_start_date,
                        };
                    }),
                });
            }
            case "cron_jobs_overdue":
            case "cron_jobs_not_run_24h": {
                const jobs = await this.db.cronJob.findMany({
                    where: {
                        active: true,
                        OR: [
                            { next_run_at: { lt: currentTime } },
                            {
                                last_run_at: {
                                    lt: twentyFourHoursAgo,
                                },
                            },
                            { last_run_at: null },
                        ],
                    },
                    take: limitNum,
                    orderBy: { next_run_at: "asc" },
                });
                return (0, serialize_bigint_1.serializeBigInt)({
                    type,
                    count: jobs.length,
                    details: jobs.map((j) => ({
                        id: j.id,
                        name: j.name,
                        last_run_at: j.last_run_at,
                        next_run_at: j.next_run_at,
                    })),
                });
            }
            case "stuck_activities": {
                const activities = await this.db.activity.findMany({
                    where: {
                        status: { in: ["SCHEDULED", "PAUSED"] },
                        schedule_time: { lt: twentyFourHoursAgo },
                    },
                    take: limitNum,
                    orderBy: { schedule_time: "asc" },
                    select: {
                        id: true,
                        type: true,
                        status: true,
                        schedule_time: true,
                        customer_id: true,
                    },
                });
                return (0, serialize_bigint_1.serializeBigInt)({
                    type,
                    count: activities.length,
                    details: activities,
                });
            }
            default:
                return {
                    type: type || "unknown",
                    count: 0,
                    details: [],
                    message: "Unsupported or missing alert type",
                };
        }
    }
    async contactResponse(body) {
        const activityId = Number(body.activityId);
        const contactId = Number(body.contactId);
        const channel = body.channel;
        if (!activityId || !contactId || !channel) {
            return {
                error: "Missing required fields: activityId, contactId, channel",
            };
        }
        const row = await this.db.activityContact.findFirst({
            where: {
                activity_id: BigInt(activityId),
                contact_id: contactId,
            },
        });
        if (row) {
            await this.db.activityContact.update({
                where: { id: row.id },
                data: {
                    response_received_at: new Date(),
                    response_channel: channel,
                    modified_at: new Date(),
                },
            });
        }
        return {
            success: true,
            message: "Contact response handled successfully",
            data: {
                activityId,
                contactId,
                channel,
                timestamp: new Date().toISOString(),
            },
        };
    }
};
exports.PlatformLeavesController = PlatformLeavesController;
__decorate([
    (0, common_1.Get)("alert-details"),
    (0, swagger_1.ApiOperation)({
        summary: "Alert enrichment details for SNS Lambda (API key)",
    }),
    __param(0, (0, common_1.Headers)("x-api-key")),
    __param(1, (0, common_1.Query)("type")),
    __param(2, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], PlatformLeavesController.prototype, "alertDetails", null);
__decorate([
    (0, common_1.Post)("contact-response"),
    (0, swagger_1.ApiOperation)({
        summary: "Public contact response / stop escalation (Nest-native)",
    }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PlatformLeavesController.prototype, "contactResponse", null);
exports.PlatformLeavesController = PlatformLeavesController = __decorate([
    (0, swagger_1.ApiTags)("platform-leaves"),
    (0, common_1.Controller)("api"),
    __metadata("design:paramtypes", [database_service_1.DatabaseService])
], PlatformLeavesController);
//# sourceMappingURL=platform-leaves.controller.js.map