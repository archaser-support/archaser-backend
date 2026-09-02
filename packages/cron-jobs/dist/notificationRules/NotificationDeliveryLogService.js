"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationDeliveryLogService = void 0;
class NotificationDeliveryLogService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async isActive(dedupKey) {
        const row = await this.prisma.notificationDeliveryLog.findFirst({
            where: {
                cleared_at: null,
                metadata: {
                    path: ["dedupKey"],
                    equals: dedupKey,
                },
            },
            select: { id: true },
        });
        return row != null;
    }
    async recordDelivery(input) {
        await this.prisma.notificationDeliveryLog.create({
            data: {
                account_id: input.accountId,
                rule_id: input.ruleId,
                entity_type: input.entityType,
                entity_id: input.entityId,
                offset_days: input.offsetDays,
                channel: input.channel,
                metadata: {
                    dedupKey: input.dedupKey,
                    ...(input.metadata ?? {}),
                },
            },
        });
    }
    matchesActiveKey(log, activeKeys) {
        return activeKeys.some((key) => key.ruleId === log.rule_id &&
            key.entityType === log.entity_type &&
            key.entityId === log.entity_id &&
            (key.offsetDays ?? null) === (log.offset_days ?? null));
    }
    async clearStaleEntries(accountId, activeKeys) {
        const activeLogs = await this.prisma.notificationDeliveryLog.findMany({
            where: { account_id: accountId, cleared_at: null },
            select: {
                id: true,
                rule_id: true,
                entity_type: true,
                entity_id: true,
                offset_days: true,
            },
        });
        const staleIds = activeLogs
            .filter((log) => !this.matchesActiveKey(log, activeKeys))
            .map((log) => log.id);
        if (staleIds.length === 0) {
            return 0;
        }
        await this.prisma.notificationDeliveryLog.updateMany({
            where: { id: { in: staleIds } },
            data: { cleared_at: new Date(), modified_at: new Date() },
        });
        return staleIds.length;
    }
}
exports.NotificationDeliveryLogService = NotificationDeliveryLogService;
