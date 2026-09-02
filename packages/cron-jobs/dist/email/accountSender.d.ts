import type { PrismaClient } from "@prisma/client";
export type AccountEmailSender = {
    fromName: string;
    replyToEmail: string;
};
/**
 * Resolve account display name and reply-to from Account settings.
 * Sender address remains system EMAIL_FROM (verified SES); reply-to uses account email_from.
 */
export declare function resolveAccountEmailSender(prisma: PrismaClient, accountId: number): Promise<AccountEmailSender>;
