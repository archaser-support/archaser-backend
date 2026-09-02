import type { PrismaClient } from "@prisma/client";
import { NotificationService } from "./NotificationService";
import { CreditNotificationEmailService } from "./CreditNotificationEmailService";
import { NotificationDeliveryLogService } from "./NotificationDeliveryLogService";
export declare class NotificationRuleDeliveryService {
    private readonly prisma;
    private readonly ledger;
    private readonly notifications;
    private readonly creditEmail;
    private readonly fetchUncoveredCustomerIds;
    constructor(prisma: PrismaClient, ledger: NotificationDeliveryLogService, notifications: NotificationService, creditEmail: CreditNotificationEmailService, fetchUncoveredCustomerIds: (accountId: number) => Promise<Set<number>>);
    processCreditAccount(input: {
        accountId: number;
        now?: Date;
    }): Promise<{
        delivered: number;
        skipped: number;
        cleared: number;
        intentsEvaluated: number;
    }>;
    private deliverIntent;
    processAllCreditInsuranceAccounts(input?: {
        now?: Date;
        accountId?: number;
        excludeAccountIds?: ReadonlySet<number>;
    }): Promise<{
        accountsProcessed: number;
        delivered: number;
        skipped: number;
        cleared: number;
        skippedFrozenAccountIds: number[];
    }>;
    static createService(prisma: PrismaClient): Promise<NotificationRuleDeliveryService>;
}
