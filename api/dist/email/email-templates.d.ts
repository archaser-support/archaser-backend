export declare const SUPPORTED_LANGUAGES: readonly ["en", "he"];
export type EmailLanguage = (typeof SUPPORTED_LANGUAGES)[number];
export declare const EMAIL_TYPES: {
    readonly FORGOT_PASSWORD: "forgot-password";
    readonly WELCOME_USER: "welcome-user";
    readonly DISPUTE_NOTIFICATION: "dispute-notification";
    readonly REPORT_SHARED: "report-shared";
};
export type EmailTemplateType = (typeof EMAIL_TYPES)[keyof typeof EMAIL_TYPES];
export declare const EMAIL_SUBJECTS: Record<EmailTemplateType, Partial<Record<EmailLanguage, string>> & {
    en: string;
}>;
export declare function getEmailTemplate(templateType: EmailTemplateType | string, language?: string, variables?: Record<string, string>): string;
export declare function getEmailSubject(templateType: EmailTemplateType | string, language?: string, variables?: Record<string, string>): string;
export declare function templateExists(templateType: string, language?: string): boolean;
