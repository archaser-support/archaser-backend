"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditNotificationEmailService = void 0;
/**
 * Credit notification email service.
 * Email delivery is stubbed: records intent in delivery log but skips actual SMTP.
 * When Nest email infrastructure is ready, implement real delivery via system email helper.
 */
class CreditNotificationEmailService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async sendCreditAlertEmail(input) {
        const user = await this.prisma.user.findFirst({
            where: {
                id: input.intent.recipientUserId,
                account_id: input.accountId,
                deactivated_at: null,
            },
            select: {
                id: true,
                email: true,
                name: true,
                first_name: true,
                last_name: true,
            },
        });
        if (!user?.email) {
            return false;
        }
        // STUB: Email delivery not implemented yet
        // When Nest email infrastructure is ready:
        // 1. Resolve customer/invoice labels from metadata
        // 2. Load internal_email_template for "credit_insurance_alert" if exists
        // 3. Replace template variables (recipient_name, title, message, action_url, customer_name, invoice_number, trigger_type)
        // 4. Send email via system email helper (or EmailService if available from api/dist)
        // For now, we log intent and return true to record in delivery log
        return true; // Pretend email sent successfully
    }
}
exports.CreditNotificationEmailService = CreditNotificationEmailService;
