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
        Person?: {
            first_name: string | null;
        } | null;
        Company?: {
            name: string;
        } | null;
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
export declare function processTemplateContent(args: ProcessTemplateContentArgs): string;
export declare function replaceDoubleBraceTemplateVariables(template: string, variables: Record<string, string>): string;
export declare function getRawTemplateContent(sequence: {
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
}, customerLanguage: string | null | undefined): {
    subject: string;
    content: string;
};
