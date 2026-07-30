import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import { RealtimeHubService } from "../realtime/realtime-hub.service";

export type OperationsListQuery = {
    page?: string;
    limit?: string;
    status?: string;
    customer_id?: string;
    stats?: string;
    type?: string;
    priority?: string;
};

@Injectable()
export class OperationsService {
    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService,
        private readonly realtime: RealtimeHubService
    ) {}

    async list(
        operationType: string,
        user: JwtPayload,
        query: OperationsListQuery
    ) {
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

    async getById(operationType: string, user: JwtPayload, id: string) {
        if (operationType === "disputes" && id === "stats") {
            return this.getDisputeStats(user);
        }
        if (operationType === "disputes") {
            return this.getDispute(user, this.parseId(id));
        }
        if (operationType === "dispute-reasons") {
            return this.getDisputeReason(user, this.parseId(id));
        }
        if (operationType === "notifications") {
            throw new NotFoundException({
                error: "Use DELETE /api/operations/notifications/:id",
            });
        }
        throw new NotFoundException({
            error: `Operation type ${operationType} not served by Nest domain`,
        });
    }

    async update(
        operationType: string,
        user: JwtPayload,
        id: string,
        body: Record<string, unknown>
    ) {
        if (operationType === "disputes") {
            return this.updateDispute(user, this.parseId(id), body);
        }
        if (operationType === "dispute-reasons") {
            return this.updateDisputeReason(user, this.parseId(id), body);
        }
        return { ok: true };
    }

    private parseId(raw: string): number {
        const id = parseInt(raw, 10);
        if (Number.isNaN(id)) {
            throw new BadRequestException({ error: "Invalid id" });
        }
        return id;
    }

    private stubList(operationType: string) {
        const camel = operationType.replace(/-([a-z])/g, (_, c: string) =>
            c.toUpperCase()
        );
        return { [camel]: [], totalRecords: 0 };
    }

    private async scope(user: JwtPayload) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        return this.accessScope.getEffectiveAccountId(userInfo);
    }

    async getDisputeStats(user: JwtPayload) {
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

    private emptyNotificationStats() {
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

    private async listNotifications(
        user: JwtPayload,
        query: OperationsListQuery
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const userId = userInfo.userId;
        const effectiveRole = userInfo.viewAsUserRole || userInfo.role;
        const includeFollowUpReminders = await this.accessScope.hasPermission(
            accountId,
            effectiveRole,
            "view_follow_up_reminders"
        );

        if (query.stats === "true") {
            return this.getNotificationStats(
                userId,
                accountId,
                includeFollowUpReminders
            );
        }

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "25", 10);

        const where: Record<string, unknown> = {
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

        return serializeBigInt({
            notifications,
            total,
            page,
            limit,
        });
    }

    private async getNotificationStats(
        userId: string,
        accountId: number,
        includeFollowUpReminders: boolean
    ) {
        const notifications = await this.db.notification.findMany({
            where: { user_id: userId, account_id: accountId },
        });

        const visible = includeFollowUpReminders
            ? notifications
            : notifications.filter((n) => {
                  const metadata = n.metadata as Record<string, unknown> | null;
                  return metadata?.followUpReminder !== true;
              });

        const stats = this.emptyNotificationStats();
        stats.total = visible.length;
        stats.unread = visible.filter((n) => !n.read).length;

        for (const notification of visible) {
            const metadata = notification.metadata as Record<
                string,
                unknown
            > | null;
            if (metadata?.disputeId) {
                stats.byType.disputes++;
            } else if (metadata?.invoiceId) {
                stats.byType.invoices++;
            } else if (metadata?.activityId) {
                stats.byType.activities++;
            } else if (
                metadata?.customerId &&
                metadata?.action === "assigned"
            ) {
                stats.byType.assignments++;
            } else if (metadata?.overdueCount) {
                stats.byType.overdue++;
            } else if (metadata?.paymentAmount) {
                stats.byType.payments++;
            } else {
                stats.byType.system++;
            }

            if (notification.priority === "Low") {
                stats.byPriority.low++;
            } else if (notification.priority === "Normal") {
                stats.byPriority.medium++;
            } else if (notification.priority === "High") {
                stats.byPriority.high++;
            }
        }

        return stats;
    }

    async deleteNotification(user: JwtPayload, notificationId: string) {
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
            throw new NotFoundException({ error: "Notification not found" });
        }
        await this.realtime.notifyNotificationChange(
            userInfo.userId,
            "notification-deleted"
        );
        return { success: true };
    }

    async updateNotification(
        user: JwtPayload,
        notificationId: string,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const read =
            typeof body.read === "boolean"
                ? body.read
                : body.action === "markRead"
                  ? true
                  : undefined;
        if (read === undefined) {
            throw new BadRequestException({ error: "Unsupported update" });
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
            throw new NotFoundException({ error: "Notification not found" });
        }
        await this.realtime.notifyNotificationChange(
            userInfo.userId,
            "notification-updated"
        );
        return { success: true, read };
    }

    async deleteNotificationsBulk(
        user: JwtPayload,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const accountId = this.accessScope.getEffectiveAccountId(userInfo);
        const baseWhere = {
            user_id: userInfo.userId,
            account_id: accountId,
        };
        const action = typeof body.action === "string" ? body.action : "";

        if (action === "deleteAll") {
            await this.db.notification.deleteMany({ where: baseWhere });
            await this.realtime.notifyNotificationChange(
                userInfo.userId,
                "notifications-cleared"
            );
            return { success: true };
        }

        if (action === "deleteByType" && typeof body.type === "string") {
            await this.db.notification.deleteMany({
                where: { ...baseWhere, type: body.type as never },
            });
            await this.realtime.notifyNotificationChange(
                userInfo.userId,
                "notifications-cleared-by-type"
            );
            return { success: true };
        }

        if (action === "deleteRead") {
            const olderThanDays =
                typeof body.olderThanDays === "number"
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
            await this.realtime.notifyNotificationChange(
                userInfo.userId,
                "notifications-cleared-read"
            );
            return { success: true };
        }

        throw new BadRequestException({ error: "Unsupported bulk action" });
    }

    private async listDisputes(user: JwtPayload, query: OperationsListQuery) {
        const accountId = await this.scope(user);
        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "25", 10);

        const andClause: Record<string, unknown>[] = [
            { Customer: { account_id: accountId } },
            ...(query.status ? [{ dispute_status: query.status }] : []),
            ...(query.customer_id
                ? [{ customer_id: parseInt(query.customer_id, 10) }]
                : []),
        ];
        const where = { AND: andClause };

        const [disputes, totalRecords] = await Promise.all([
            this.db.customerDispute.findMany({
                where: where as never,
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
            this.db.customerDispute.count({ where: where as never }),
        ]);

        return serializeBigInt({ disputes, totalRecords, page, limit });
    }

    private async getDispute(user: JwtPayload, id: number) {
        const accountId = await this.scope(user);
        const dispute = await this.db.customerDispute.findFirst({
            where: { id, Customer: { account_id: accountId } },
            include: { DisputeReason: true, DisputeInvoice: true },
        });
        if (!dispute) {
            throw new NotFoundException({ error: "Dispute not found" });
        }
        return serializeBigInt(dispute);
    }

    private async updateDispute(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const accountId = await this.scope(user);
        const existing = await this.db.customerDispute.findFirst({
            where: { id, Customer: { account_id: accountId } },
            select: { id: true },
        });
        if (!existing) {
            throw new NotFoundException({ error: "Dispute not found" });
        }

        const data: Record<string, unknown> = { ...body };
        delete data.id;
        delete data.customer_id;
        delete data.created_at;
        delete data.created_by;

        const updated = await this.db.customerDispute.update({
            where: { id },
            data: data as never,
        });
        return serializeBigInt(updated);
    }

    private async listDisputeReasons(
        user: JwtPayload,
        query: OperationsListQuery
    ) {
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

        return serializeBigInt({ disputeReasons, totalRecords, page, limit });
    }

    private async getDisputeReason(user: JwtPayload, id: number) {
        const accountId = await this.scope(user);
        const reason = await this.db.disputeReason.findFirst({
            where: { id, OR: [{ account_id: accountId }, { master_template: true }] },
        });
        if (!reason) {
            throw new NotFoundException({ error: "Dispute reason not found" });
        }
        return serializeBigInt(reason);
    }

    private async updateDisputeReason(
        user: JwtPayload,
        id: number,
        body: Record<string, unknown>
    ) {
        const accountId = await this.scope(user);
        const existing = await this.db.disputeReason.findFirst({
            where: { id, account_id: accountId },
            select: { id: true },
        });
        if (!existing) {
            throw new ForbiddenException({
                error: "Only account-owned dispute reasons can be edited",
            });
        }

        const data: Record<string, unknown> = { ...body };
        delete data.id;
        delete data.account_id;
        delete data.created_at;
        delete data.created_by;

        const updated = await this.db.disputeReason.update({
            where: { id },
            data: data as never,
        });
        return serializeBigInt(updated);
    }
}
