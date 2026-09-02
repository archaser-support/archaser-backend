"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAccountEmailSender = resolveAccountEmailSender;
const DEFAULT_FROM_NAME = "ARchaser";
/**
 * Resolve account display name and reply-to from Account settings.
 * Sender address remains system EMAIL_FROM (verified SES); reply-to uses account email_from.
 */
async function resolveAccountEmailSender(prisma, accountId) {
    const account = await prisma.account.findUnique({
        where: { id: accountId },
        select: {
            email_from_name: true,
            email_from: true,
            name: true,
        },
    });
    if (!account) {
        return { fromName: DEFAULT_FROM_NAME, replyToEmail: "" };
    }
    const fromName = account.email_from_name?.trim() ||
        account.name?.trim() ||
        DEFAULT_FROM_NAME;
    return {
        fromName,
        replyToEmail: account.email_from?.trim() || "",
    };
}
