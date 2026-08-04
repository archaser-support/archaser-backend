"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processTemplateContent = processTemplateContent;
exports.replaceDoubleBraceTemplateVariables = replaceDoubleBraceTemplateVariables;
exports.getRawTemplateContent = getRawTemplateContent;
const getCustomerPortalUrl_1 = require("./getCustomerPortalUrl");
function replaceContentMacros(content, replacements) {
    let result = content;
    for (const [macro, value] of Object.entries(replacements)) {
        const regex = new RegExp(`\\{${macro}\\}`, "g");
        result = result.replace(regex, value);
        if (["link", "pay_now_link", "settle_payment"].includes(macro)) {
            const specialRegex = new RegExp(`https://portal.archaser.com/en/app/%7B${macro}%7D`, "g");
            result = result.replace(specialRegex, value);
        }
    }
    return result;
}
function replaceAccountContent(content, account) {
    const hostUrl = process.env.NODE_ENV === "production" && process.env.NEXTAUTH_URL
        ? new URL(process.env.NEXTAUTH_URL).hostname
        : `localhost:${process.env.PORT || 3000}`;
    const customerName = account.name || "";
    let logoHtml = "";
    if (account.logo) {
        const logoUrl = `${process.env.NEXTAUTH_URL || `http://${hostUrl}`}/api/accounts/${account.id}/logo?v=${Date.now()}`;
        logoHtml = `<img src="${logoUrl}" alt="${customerName} Logo" style="max-width: 200px; height: auto;" />`;
    }
    return replaceContentMacros(content, {
        account_name: customerName,
        customer_logo: logoHtml,
    });
}
function replaceCustomerContent(content, customer, account, portalPath) {
    const customerName = (customer.type === "Company"
        ? customer.Company?.name
        : customer.Person?.first_name) || "";
    const generatedLink = (0, getCustomerPortalUrl_1.getCustomerPortalUrl)(customer.customer_uuid, account.sub_domain, customer.language, customer.contactId, portalPath);
    const generatedPayNowLink = (0, getCustomerPortalUrl_1.getCustomerPortalUrl)(customer.customer_uuid, account.sub_domain, customer.language, customer.contactId, "");
    const generatedSettlePayment = (0, getCustomerPortalUrl_1.getCustomerPortalUrl)(customer.customer_uuid, account.sub_domain, customer.language, customer.contactId, "");
    const generatedViewInvoiceLink = (0, getCustomerPortalUrl_1.getCustomerPortalUrl)(customer.customer_uuid, account.sub_domain, customer.language, customer.contactId, "");
    return replaceContentMacros(content, {
        customer_name: customerName,
        debor_name: customerName,
        link: generatedLink,
        pay_now_link: generatedPayNowLink,
        settle_payment: generatedSettlePayment,
        view_invoice_link: generatedViewInvoiceLink,
    });
}
function replaceContactContent(content, contact) {
    const greetingName = contact.first_name || "";
    const lastName = contact.last_name || "";
    const fullName = `${contact.first_name || ""} ${contact.last_name || ""}`.trim();
    return replaceContentMacros(content, {
        first_name: greetingName,
        last_name: lastName,
        contact_name: fullName,
        debor_name: greetingName,
        email: contact.email || "",
        phone: contact.phone || contact.mobile || "",
        mobile: contact.mobile || contact.phone || "",
        role: contact.role || "",
    });
}
function replaceInvoiceContent(content, invoice) {
    const dueDate = invoice.due_date
        ? new Date(invoice.due_date).toLocaleDateString()
        : "";
    const daysUntilDue = invoice.days_until_due ??
        (invoice.due_date
            ? Math.ceil((new Date(invoice.due_date).getTime() - Date.now()) /
                (24 * 60 * 60 * 1000))
            : 0);
    return replaceContentMacros(content, {
        invoice_number: invoice.invoice_number ?? "",
        due_date: dueDate,
        amount: String(invoice.outstanding_debt ?? 0),
        days_until_due: String(daysUntilDue),
    });
}
/**
 * Consolidated template macro replacement for activity emails/SMS content.
 */
function processTemplateContent(args) {
    const { content, account, customer, contact, invoice, portalPath } = args;
    if (!content)
        return "";
    let processedContent = replaceAccountContent(content, account);
    processedContent = replaceCustomerContent(processedContent, { ...customer, contactId: contact.id }, account, portalPath);
    processedContent = replaceContactContent(processedContent, contact);
    if (invoice) {
        processedContent = replaceInvoiceContent(processedContent, invoice);
    }
    return processedContent;
}
function replaceDoubleBraceTemplateVariables(template, variables) {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
    }
    return result;
}
function getRawTemplateContent(sequence, customerLanguage) {
    const template = sequence.ActivitiesTemplate;
    const lang = customerLanguage || "English";
    const langTemplate = template?.ActivityTemplateLanguage?.find((l) => l.language === lang);
    const subject = langTemplate?.email_subject ?? template?.email_subject ?? "";
    const content = sequence.activity_type === "SMS"
        ? (langTemplate?.sms_content ?? template?.sms_content ?? "")
        : (langTemplate?.email_content ?? template?.email_content ?? "");
    return { subject, content };
}
