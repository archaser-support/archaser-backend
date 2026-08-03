import type { PrismaClient } from "@prisma/client";
import type { NotificationDeliveryIntent } from "./NotificationRuleEvaluator";
/**
 * Credit notification email service.
 * Email delivery is stubbed: records intent in delivery log but skips actual SMTP.
 * When Nest email infrastructure is ready, implement real delivery via system email helper.
 */
export declare class CreditNotificationEmailService {
    private readonly prisma;
    constructor(prisma: PrismaClient);
    sendCreditAlertEmail(input: {
        accountId: number;
        intent: NotificationDeliveryIntent;
    }): Promise<boolean>;
}
