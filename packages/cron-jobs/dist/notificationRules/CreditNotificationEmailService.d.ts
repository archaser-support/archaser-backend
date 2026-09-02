import type { PrismaClient } from "@prisma/client";
import type { NotificationDeliveryIntent } from "./NotificationRuleEvaluator";
export declare class CreditNotificationEmailService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    sendCreditAlertEmail(input: {
        accountId: number;
        intent: NotificationDeliveryIntent;
    }): Promise<boolean>;
    private resolveEntityLabels;
}
