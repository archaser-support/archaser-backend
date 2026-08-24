import { resolvePublicApiOrigin } from "../publicApiUrl";
import { getCustomerPortalUrl } from "./getCustomerPortalUrl";

function replaceContentMacros(
    content: string,
    replacements: Record<string, string>
): string {
    let result = content;
    for (const [macro, value] of Object.entries(replacements)) {
        const regex = new RegExp(`\\{${macro}\\}`, "g");
        result = result.replace(regex, value);

        if (["link", "pay_now_link", "settle_payment"].includes(macro)) {
            const specialRegex = new RegExp(
                `https://portal.archaser.com/en/app/%7B${macro}%7D`,
                "g"
            );
            result = result.replace(specialRegex, value);
        }
    }
    return result;
}

function replaceAccountContent(
    content: string,
    account: {
        id: number;
        name: string | null;
        logo: string | null;
        sub_domain?: string | null;
    }
): string {
    const customerName = account.name || "";
    let logoHtml = "";
    if (account.logo) {
        const logoUrl = `${resolvePublicApiOrigin()}/api/accounts/${account.id}/logo?v=${Date.now()}`;
        logoHtml = `<img src="${logoUrl}" alt="${customerName} Logo" style="max-width: 200px; height: auto;" />`;
    }

    return replaceContentMacros(content, {
        account_name: customerName,
        customer_logo: logoHtml,
    });
}

function replaceCustomerContent(
    content: string,
    customer: {
        type: "Person" | "Company";
        customer_uuid: string;
        language?: string | null;
        Person?: { first_name: string | null } | null;
        Company?: { name: string } | null;
        contactId?: number;
    },
    account: {
        id: number;
        name: string | null;
        logo: string | null;
        sub_domain: string | null;
    },
    portalPath?: string
): string {
    const customerName =
        (customer.type === "Company"
            ? customer.Company?.name
            : customer.Person?.first_name) || "";

    const generatedLink = getCustomerPortalUrl(
        customer.customer_uuid,
        account.sub_domain,
        customer.language,
        customer.contactId,
        portalPath
    );
    const generatedPayNowLink = getCustomerPortalUrl(
        customer.customer_uuid,
        account.sub_domain,
        customer.language,
        customer.contactId,
        ""
    );
    const generatedSettlePayment = getCustomerPortalUrl(
        customer.customer_uuid,
        account.sub_domain,
        customer.language,
        customer.contactId,
        ""
    );
    const generatedViewInvoiceLink = getCustomerPortalUrl(
        customer.customer_uuid,
        account.sub_domain,
        customer.language,
        customer.contactId,
        ""
    );

    return replaceContentMacros(content, {
        customer_name: customerName,
        debor_name: customerName,
        link: generatedLink,
        pay_now_link: generatedPayNowLink,
        settle_payment: generatedSettlePayment,
        view_invoice_link: generatedViewInvoiceLink,
    });
}

function replaceContactContent(
    content: string,
    contact: {
        first_name: string | null;
        last_name?: string | null;
        email?: string | null;
        phone?: string | null;
        mobile?: string | null;
        role?: string | null;
    }
): string {
    const greetingName = contact.first_name || "";
    const lastName = contact.last_name || "";
    const fullName =
        `${contact.first_name || ""} ${contact.last_name || ""}`.trim();

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

function replaceInvoiceContent(
    content: string,
    invoice: {
        invoice_number: string | null;
        due_date: Date | string | null;
        outstanding_debt: number | null;
        days_until_due?: number;
    }
): string {
    const dueDate = invoice.due_date
        ? new Date(invoice.due_date).toLocaleDateString()
        : "";
    const daysUntilDue =
        invoice.days_until_due ??
        (invoice.due_date
            ? Math.ceil(
                  (new Date(invoice.due_date).getTime() - Date.now()) /
                      (24 * 60 * 60 * 1000)
              )
            : 0);

    return replaceContentMacros(content, {
        invoice_number: invoice.invoice_number ?? "",
        due_date: dueDate,
        amount: String(invoice.outstanding_debt ?? 0),
        days_until_due: String(daysUntilDue),
    });
}

export type ProcessTemplateContentArgs = {
    content: string;
    account: {
        id: number;
        name: string | null;
        logo: string | null;
        sub_domain: string | null;
    };
    customer: {
        type: "Person" | "Company";
        customer_uuid: string;
        language?: string | null;
        Person?: { first_name: string | null } | null;
        Company?: { name: string } | null;
    };
    contact: {
        first_name: string | null;
        last_name?: string | null;
        email?: string | null;
        phone?: string | null;
        mobile?: string | null;
        role?: string | null;
        id?: number;
    };
    invoice?: {
        invoice_number: string | null;
        due_date: Date | string | null;
        outstanding_debt: number | null;
        days_until_due?: number;
    };
    portalPath?: string;
};

/**
 * Consolidated template macro replacement for activity emails/SMS content.
 */
export function processTemplateContent(
    args: ProcessTemplateContentArgs
): string {
    const { content, account, customer, contact, invoice, portalPath } = args;
    if (!content) return "";

    let processedContent = replaceAccountContent(content, account);
    processedContent = replaceCustomerContent(
        processedContent,
        { ...customer, contactId: contact.id },
        account,
        portalPath
    );
    processedContent = replaceContactContent(processedContent, contact);

    if (invoice) {
        processedContent = replaceInvoiceContent(processedContent, invoice);
    }

    return processedContent;
}

export function replaceDoubleBraceTemplateVariables(
    template: string,
    variables: Record<string, string>
): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
        result = result.replace(
            new RegExp(`\\{\\{${key}\\}\\}`, "g"),
            value || ""
        );
    }
    return result;
}

export function getRawTemplateContent(
    sequence: {
        activity_type?: string;
        ActivitiesTemplate?: {
            email_subject?: string | null;
            sms_content?: string | null;
            email_content?: string | null;
            ActivityTemplateLanguage?: Array<{
                language: string;
                email_subject?: string | null;
                sms_content?: string | null;
                email_content?: string | null;
            }>;
        } | null;
    },
    customerLanguage: string | null | undefined
): { subject: string; content: string } {
    const template = sequence.ActivitiesTemplate;
    const lang = customerLanguage || "English";
    const langTemplate = template?.ActivityTemplateLanguage?.find(
        (l) => l.language === lang
    );

    const subject =
        langTemplate?.email_subject ?? template?.email_subject ?? "";
    const content =
        sequence.activity_type === "SMS"
            ? (langTemplate?.sms_content ?? template?.sms_content ?? "")
            : (langTemplate?.email_content ?? template?.email_content ?? "");

    return { subject, content };
}
