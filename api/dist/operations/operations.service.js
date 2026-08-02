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
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationsService = void 0;
const common_1 = require("@nestjs/common");
const access_scope_service_1 = require("../auth/access-scope.service");
const serialize_bigint_1 = require("../common/serialize-bigint");
const database_service_1 = require("../database/database.service");
const realtime_hub_service_1 = require("../realtime/realtime-hub.service");
let OperationsService = class OperationsService {
    constructor(db, accessScope, realtime) {
        this.db = db;
        this.accessScope = accessScope;
        this.realtime = realtime;
    }
    async list(operationType, user, query) {
        if (operationType === "disputes") {
            return this.listDisputes(user, query);
        }
        if (operationType === "dispute-reasons") {
            return this.listDisputeReasons(user, query);
        }
        if (operationType === "notifications") {
            return this.listNotifications(user, query);
        }
        return this.stubList(operationType);
    }
    async getById(operationType, user, id) {
        if (operationType === "disputes" && id === "stats") {
            return this.getDisputeStats(user);
        }
        if (operationType === "legal-cases" && id === "stats") {
            return this.getLegalCasesStats(user);
        }
        if (operationType === "disputes") {
            return this.getDispute(user, this.parseId(id));
        }
        if (operationType === "dispute-reasons") {
            return this.getDisputeReason(user, this.parseId(id));
        }
        if (operationType === "notifications") {
            throw new common_1.NotFoundException({
                error: "Use DELETE /api/operations/notifications/:id",
            });
        }
        throw new common_1.NotFoundException({
            error: `Operation type ${operationType} not served by Nest domain`,
        });
    }
    async update(operationType, user, id, body) {
        if (operationType === "disputes") {
            return this.updateDispute(user, this.parseId(id), body);
        }
        if (operationType === "dispute-reasons") {
            return this.updateDisputeReason(user, this.parseId(id), body);
        }
        return { ok: true };
    }
    parseId(raw) {
        const id = parseInt(raw, 10);
        if (Number.isNaN(id)) {
            throw new common_1.BadRequestException({ error: "Invalid id" });
        }
        return id;
    }
    stubList(operationType) {
        const camel = operationType.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return { [camel]: [], totalRecords: 0 };
    }
    async scope(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveAccountId(userInfo);
    }
    async getDisputeStats(user) {
        const accountId = await this.scope(user);
        const where = { Customer: { account_id: accountId } };
        const [total, open, resolved, inProgress, account] = await Promise.all([
            this.db.customerDispute.count({ where }),
            this.db.customerDispute.count({
                where: {
                    AND: [
                        where,
                        { dispute_status: { in: ["New", "Awaiting_Update"] } },
                    ],
                },
            }),
            this.db.customerDispute.count({
                where: { AND: [where, { dispute_status: "Resolved" }] },
            }),
            this.db.customerDispute.count({
                where: { AND: [where, { dispute_status: "Under_Review" }] },
            }),
            this.db.account.findUnique({
                where: { id: accountId },
                select: { currency: true },
            }),
        ]);
        return {
            stats: {
                counts: {
                    total,
                    open,
                    resolved,
                    inProgress,
                },
                currency: account?.currency || "USD",
                pieChartData: [
                    { name: "Open", value: open },
                    { name: "In Progress", value: inProgress },
                    { name: "Resolved", value: resolved },
                ],
                disputeAssignFrequencyList: [],
            },
        };
    }
    async getLegalCasesStats(user) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const hasViewAs = await this.accessScope.hasPermission(accountId, effectiveRole, "use_view_as");
        const ownerFilter = await this.accessScope.getOwnerFilter(userInfo.userId, hasViewAs, userInfo.viewAsUserId, userInfo.viewAsUserRole, userInfo.viewAsUserAccountId);
        const account = await this.db.account.findUnique({
            where: { id: accountId },
            select: { currency: true },
        });
        const currency = account?.currency || "USD";
        const baseFilters = {
            Customer: {
                account_id: accountId,
                collection_status: "Active",
                ...ownerFilter,
            },
            current_category: "Legal",
        };
        const [totalCases, totalCustomers, totalAmountResult] = await Promise.all([
            this.db.customerCollectionPeriod.count({
                where: baseFilters,
            }),
            this.db.customer.count({
                where: {
                    account_id: accountId,
                    collection_status: "Active",
                    ...ownerFilter,
                    CustomerCollectionPeriod: {
                        some: {
                            current_category: "Legal",
                            period_end_date: null,
                        },
                    },
                },
            }),
            this.db.customerCollectionPeriod.aggregate({
                where: baseFilters,
                _sum: {
                    total_outstanding_amount: true,
                },
            }),
        ]);
        const totalAmount = Number(totalAmountResult._sum.total_outstanding_amount || 0);
        return {
            legalCases: [],
            totalRecords: totalCases,
            currentPage: 1,
            totalPages: 1,
            currency,
            totalAmount,
            totalCustomers,
        };
    }
    emptyNotificationStats() {
        return {
            total: 0,
            unread: 0,
            byType: {
                controlCenter: 0,
                disputes: 0,
                invoices: 0,
                activities: 0,
                assignments: 0,
                overdue: 0,
                payments: 0,
                system: 0,
            },
            byPriority: {
                low: 0,
                medium: 0,
                high: 0,
                urgent: 0,
            },
        };
    }
    async listNotifications(user, query) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const userId = userInfo.userId;
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const includeFollowUpReminders = await this.accessScope.hasPermission(accountId, effectiveRole, "view_follow_up_reminders");
        if (query.stats === "true") {
            return this.getNotificationStats(userId, accountId, includeFollowUpReminders);
        }
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "25", 10);
        const where = {
            user_id: userId,
            account_id: accountId,
        };
        if (!includeFollowUpReminders) {
            where.NOT = {
                metadata: {
                    path: ["followUpReminder"],
                    equals: true,
                },
            };
        }
        if (query.type && query.type !== "all") {
            where.type = query.type;
        }
        if (query.priority && query.priority !== "all") {
            where.priority = query.priority;
        }
        const [rows, total] = await Promise.all([
            this.db.notification.findMany({
                where,
                orderBy: { created_at: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.notification.count({ where }),
        ]);
        const notifications = rows.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            message: n.message,
            priority: n.priority,
            timestamp: n.created_at,
            actionUrl: n.action_url,
            metadata: n.metadata,
            userId: n.user_id,
            accountId: n.account_id,
            read: n.read,
        }));
        return (0, serialize_bigint_1.serializeBigInt)({
            notifications,
            total,
            page,
            limit,
        });
    }
    async getNotificationStats(userId, accountId, includeFollowUpReminders) {
        const notifications = await this.db.notification.findMany({
            where: { user_id: userId, account_id: accountId },
        });
        const visible = includeFollowUpReminders
            ? notifications
            : notifications.filter((n) => {
                const metadata = n.metadata;
                return metadata?.followUpReminder !== true;
            });
        const stats = this.emptyNotificationStats();
        stats.total = visible.length;
        stats.unread = visible.filter((n) => !n.read).length;
        for (const notification of visible) {
            const metadata = notification.metadata;
            if (metadata?.disputeId) {
                stats.byType.disputes++;
            }
            else if (metadata?.invoiceId) {
                stats.byType.invoices++;
            }
            else if (metadata?.activityId) {
                stats.byType.activities++;
            }
            else if (metadata?.customerId &&
                metadata?.action === "assigned") {
                stats.byType.assignments++;
            }
            else if (metadata?.overdueCount) {
                stats.byType.overdue++;
            }
            else if (metadata?.paymentAmount) {
                stats.byType.payments++;
            }
            else {
                stats.byType.system++;
            }
            if (notification.priority === "Low") {
                stats.byPriority.low++;
            }
            else if (notification.priority === "Normal") {
                stats.byPriority.medium++;
            }
            else if (notification.priority === "High") {
                stats.byPriority.high++;
            }
        }
        return stats;
    }
    async deleteNotification(user, notificationId) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const result = await this.db.notification.deleteMany({
            where: {
                id: notificationId,
                user_id: userInfo.userId,
                account_id: accountId,
            },
        });
        if (result.count === 0) {
            throw new common_1.NotFoundException({ error: "Notification not found" });
        }
        await this.realtime.notifyNotificationChange(userInfo.userId, "notification-deleted");
        return { success: true };
    }
    async updateNotification(user, notificationId, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const read = typeof body.read === "boolean"
            ? body.read
            : body.action === "markRead"
                ? true
                : undefined;
        if (read === undefined) {
            throw new common_1.BadRequestException({ error: "Unsupported update" });
        }
        const result = await this.db.notification.updateMany({
            where: {
                id: notificationId,
                user_id: userInfo.userId,
                account_id: accountId,
            },
            data: { read, modified_at: new Date() },
        });
        if (result.count === 0) {
            throw new common_1.NotFoundException({ error: "Notification not found" });
        }
        await this.realtime.notifyNotificationChange(userInfo.userId, "notification-updated");
        return { success: true, read };
    }
    async deleteNotificationsBulk(user, body) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const baseWhere = {
            user_id: userInfo.userId,
            account_id: accountId,
        };
        const action = typeof body.action === "string" ? body.action : "";
        if (action === "deleteAll") {
            await this.db.notification.deleteMany({ where: baseWhere });
            await this.realtime.notifyNotificationChange(userInfo.userId, "notifications-cleared");
            return { success: true };
        }
        if (action === "deleteByType" && typeof body.type === "string") {
            await this.db.notification.deleteMany({
                where: { ...baseWhere, type: body.type },
            });
            await this.realtime.notifyNotificationChange(userInfo.userId, "notifications-cleared-by-type");
            return { success: true };
        }
        if (action === "deleteRead") {
            const olderThanDays = typeof body.olderThanDays === "number"
                ? body.olderThanDays
                : Number(body.olderThanDays) || 7;
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - olderThanDays);
            await this.db.notification.deleteMany({
                where: {
                    ...baseWhere,
                    read: true,
                    created_at: { lt: cutoff },
                },
            });
            await this.realtime.notifyNotificationChange(userInfo.userId, "notifications-cleared-read");
            return { success: true };
        }
        throw new common_1.BadRequestException({ error: "Unsupported bulk action" });
    }
    async listDisputes(user, query) {
        const accountId = await this.scope(user);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "25", 10);
        const andClause = [
            { Customer: { account_id: accountId } },
            ...(query.status ? [{ dispute_status: query.status }] : []),
            ...(query.customer_id
                ? [{ customer_id: parseInt(query.customer_id, 10) }]
                : []),
        ];
        const where = { AND: andClause };
        const [disputes, totalRecords] = await Promise.all([
            this.db.customerDispute.findMany({
                where: where,
                include: {
                    DisputeReason: true,
                    Customer: {
                        select: {
                            id: true,
                            customer_number: true,
                        },
                    },
                },
                orderBy: { created_at: "desc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.customerDispute.count({ where: where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({ disputes, totalRecords, page, limit });
    }
    async getDispute(user, id) {
        const accountId = await this.scope(user);
        const dispute = await this.db.customerDispute.findFirst({
            where: { id, Customer: { account_id: accountId } },
            include: { DisputeReason: true, DisputeInvoice: true },
        });
        if (!dispute) {
            throw new common_1.NotFoundException({ error: "Dispute not found" });
        }
        return (0, serialize_bigint_1.serializeBigInt)(dispute);
    }
    async updateDispute(user, id, body) {
        const accountId = await this.scope(user);
        const existing = await this.db.customerDispute.findFirst({
            where: { id, Customer: { account_id: accountId } },
            select: { id: true },
        });
        if (!existing) {
            throw new common_1.NotFoundException({ error: "Dispute not found" });
        }
        const data = { ...body };
        delete data.id;
        delete data.customer_id;
        delete data.created_at;
        delete data.created_by;
        const updated = await this.db.customerDispute.update({
            where: { id },
            data: data,
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
    async listDisputeReasons(user, query) {
        const accountId = await this.scope(user);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "50", 10);
        const where = {
            OR: [{ account_id: accountId }, { master_template: true }],
        };
        const [disputeReasons, totalRecords] = await Promise.all([
            this.db.disputeReason.findMany({
                where,
                orderBy: { id: "asc" },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.db.disputeReason.count({ where }),
        ]);
        return (0, serialize_bigint_1.serializeBigInt)({ disputeReasons, totalRecords, page, limit });
    }
    async getDisputeReason(user, id) {
        const accountId = await this.scope(user);
        const reason = await this.db.disputeReason.findFirst({
            where: { id, OR: [{ account_id: accountId }, { master_template: true }] },
        });
        if (!reason) {
            throw new common_1.NotFoundException({ error: "Dispute reason not found" });
        }
        return (0, serialize_bigint_1.serializeBigInt)(reason);
    }
    async updateDisputeReason(user, id, body) {
        const accountId = await this.scope(user);
        const existing = await this.db.disputeReason.findFirst({
            where: { id, account_id: accountId },
            select: { id: true },
        });
        if (!existing) {
            throw new common_1.ForbiddenException({
                error: "Only account-owned dispute reasons can be edited",
            });
        }
        const data = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.created_at;
        delete data.created_by;
        const updated = await this.db.disputeReason.update({
            where: { id },
            data: data,
        });
        return (0, serialize_bigint_1.serializeBigInt)(updated);
    }
};
exports.OperationsService = OperationsService;
exports.OperationsService = OperationsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [database_service_1.DatabaseService,
        access_scope_service_1.AccessScopeService,
        realtime_hub_service_1.RealtimeHubService])
], OperationsService);
//# sourceMappingURL=operations.service.js.map