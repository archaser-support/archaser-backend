import type { PrismaClient } from "@prisma/client";

export type ActiveQualificationKey = {
    ruleId: number;
    entityType: "customer" | "invoice";
    entityId: string;
    offsetDays: number | null;
};

export class NotificationDeliveryLogService {
    constructor(private readonly prisma: PrismaClient) {}

    async isActive(dedupKey: string): Promise<boolean> {
        const row = await (this.prisma as any).notificationDeliveryLog.findFirst(
            {
                where: {
                    cleared_at: null,
                    metadata: {
                        path: ["dedupKey"],
                        equals: dedupKey,
                    },
                },
                select: { id: true },
            }
        );
        return row != null;
    }

    async recordDelivery(input: {
        accountId: number;
        ruleId: number;
        entityType: "customer" | "invoice";
        entityId: string;
        offsetDays: number | null;
        dedupKey: string;
        channel: "in_app" | "email";
        metadata?: Record<string, unknown>;
    }): Promise<void> {
        await (this.prisma as any).notificationDeliveryLog.create({
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

    matchesActiveKey(
        log: {
            rule_id: number;
            entity_type: string;
            entity_id: string;
            offset_days: number | null;
        },
        activeKeys: ActiveQualificationKey[]
    ): boolean {
        return activeKeys.some(
            (key) =>
                key.ruleId === log.rule_id &&
                key.entityType === log.entity_type &&
                key.entityId === log.entity_id &&
                (key.offsetDays ?? null) === (log.offset_days ?? null)
        );
    }

    async clearStaleEntries(
        accountId: number,
        activeKeys: ActiveQualificationKey[]
    ): Promise<number> {
        const activeLogs = await (
            this.prisma as any
        ).notificationDeliveryLog.findMany({
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
            .filter((log: any) => !this.matchesActiveKey(log, activeKeys))
            .map((log: any) => log.id);

        if (staleIds.length === 0) {
            return 0;
        }

        await (this.prisma as any).notificationDeliveryLog.updateMany({
            where: { id: { in: staleIds } },
            data: { cleared_at: new Date(), modified_at: new Date() },
        });
        return staleIds.length;
    }
}
