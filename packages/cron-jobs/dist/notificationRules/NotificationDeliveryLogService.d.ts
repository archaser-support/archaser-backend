import type { PrismaClient } from "@prisma/client";
export type ActiveQualificationKey = {
    ruleId: number;
    entityType: "customer" | "invoice";
    entityId: string;
    offsetDays: number | null;
};
export declare class NotificationDeliveryLogService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    isActive(dedupKey: string): Promise<boolean>;
    recordDelivery(input: {
        accountId: number;
        ruleId: number;
        entityType: "customer" | "invoice";
        entityId: string;
        offsetDays: number | null;
        dedupKey: string;
        channel: "in_app" | "email";
        metadata?: Record<string, unknown>;
    }): Promise<void>;
    matchesActiveKey(log: {
        rule_id: number;
        entity_type: string;
        entity_id: string;
        offset_days: number | null;
    }, activeKeys: ActiveQualificationKey[]): boolean;
    clearStaleEntries(accountId: number, activeKeys: ActiveQualificationKey[]): Promise<number>;
}
