"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreditNotificationEmailService = void 0;
const accountSender_1 = require("../email/accountSender");
const sendSmtpHtmlEmail_1 = require("../email/sendSmtpHtmlEmail");
const processTemplateContent_1 = require("../templates/processTemplateContent");
function buildAbsoluteActionUrl(actionUrl) {
    const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    if (!base || actionUrl.startsWith("http")) {
        return actionUrl;
    }
    return `${base}${actionUrl.startsWith("/") ? actionUrl : `/${actionUrl}`}`;
}
function fallbackEmailBody(variables) {
    const entitySummary = [variables.customer_name, variables.invoice_number]
        .filter(Boolean)
        .join(" — ");
    return `
<p>Hello ${variables.recipient_name},</p>
<p>${variables.message}</p>
${entitySummary ? `<p><strong>Related to:</strong> ${entitySummary}</p>` : ""}
<p><a href="${variables.action_url}">View credit report</a></p>
`.trim();
}
async function loadCreditAlertTemplate(prisma, accountId) {
    const accountTemplate = await prisma.internalEmailTemplate.findFirst({
        where: {
            type: "credit_insurance_alert",
            account_id: accountId,
            active: true,
        },
    });
    if (accountTemplate) {
        return accountTemplate;
    }
    return prisma.internalEmailTemplate.findFirst({
        where: {
            type: "credit_insurance_alert",
            master_template: true,
            active: true,
        },
    });
}
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
        const recipientName = user.name?.trim() ||
            `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() ||
            "there";
        const { customerName, invoiceNumber } = await this.resolveEntityLabels(input.intent.metadata);
        const actionUrl = buildAbsoluteActionUrl(input.intent.actionUrl);
        const variables = {
            recipient_name: recipientName,
            title: input.intent.title,
            message: input.intent.message,
            action_url: actionUrl,
            customer_name: customerName,
            invoice_number: invoiceNumber,
            trigger_type: input.intent.triggerType,
        };
        const template = await loadCreditAlertTemplate(this.prisma, input.accountId);
        let emailSubject = input.intent.title;
        let emailBody;
        if (template) {
            emailSubject = (0, processTemplateContent_1.replaceDoubleBraceTemplateVariables)(template.subject, variables);
            emailBody = (0, processTemplateContent_1.replaceDoubleBraceTemplateVariables)(template.content, variables);
        }
        else {
            emailBody = fallbackEmailBody(variables);
        }
        const sender = await (0, accountSender_1.resolveAccountEmailSender)(this.prisma, input.accountId);
        const result = await (0, sendSmtpHtmlEmail_1.sendSmtpHtmlEmail)({
            toEmail: user.email,
            subject: emailSubject,
            html: emailBody,
            fromName: sender.fromName,
            replyToEmail: sender.replyToEmail || undefined,
        });
        return !result.skipped;
    }
    async resolveEntityLabels(metadata) {
        let customerName = "";
        let invoiceNumber = "";
        const customerId = typeof metadata.customerId === "number"
            ? metadata.customerId
            : undefined;
        const invoiceId = typeof metadata.invoiceId === "number"
            ? metadata.invoiceId
            : undefined;
        if (customerId != null) {
            const customer = await this.prisma.customer.findUnique({
                where: { id: customerId },
                select: {
                    Company: { select: { name: true } },
                    Person: {
                        select: { first_name: true, last_name: true },
                    },
                },
            });
            customerName =
                customer?.Company?.name?.trim() ||
                    `${customer?.Person?.first_name ?? ""} ${customer?.Person?.last_name ?? ""}`.trim();
        }
        if (invoiceId != null) {
            const invoice = await this.prisma.invoice.findUnique({
                where: { id: invoiceId },
                select: { invoice_number: true },
            });
            invoiceNumber = invoice?.invoice_number?.trim() ?? "";
        }
        return { customerName, invoiceNumber };
    }
}
exports.CreditNotificationEmailService = CreditNotificationEmailService;
