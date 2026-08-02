import fs from "fs";
import path from "path";

/** On-disk email template folder (copied beside this file under assets/emails). */
const TEMPLATE_BASE_PATH = path.join(__dirname, "assets", "emails");

export const SUPPORTED_LANGUAGES = ["en", "he"] as const;
export type EmailLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const EMAIL_TYPES = {
    FORGOT_PASSWORD: "forgot-password",
    WELCOME_USER: "welcome-user",
    DISPUTE_NOTIFICATION: "dispute-notification",
    REPORT_SHARED: "report-shared",
} as const;

export type EmailTemplateType =
    (typeof EMAIL_TYPES)[keyof typeof EMAIL_TYPES];

export const EMAIL_SUBJECTS: Record<
    EmailTemplateType,
    Partial<Record<EmailLanguage, string>> & { en: string }
> = {
    [EMAIL_TYPES.FORGOT_PASSWORD]: {
        en: "Reset Password Request",
        he: "בקשת איפוס סיסמה",
    },
    [EMAIL_TYPES.WELCOME_USER]: {
        en: "Welcome to ARchaser",
        he: "ברוכים הבאים ל-ARchaser",
    },
    [EMAIL_TYPES.DISPUTE_NOTIFICATION]: {
        en: "New Dispute Notification",
        he: "התראה על ערעור חדש",
    },
    [EMAIL_TYPES.REPORT_SHARED]: {
        en: "Report Shared: ${reportName}",
        he: "דוח שותף: ${reportName}",
    },
};

function normalizeLanguage(language?: string): EmailLanguage {
    if (language === "he" || language === "Hebrew") return "he";
    if (
        language &&
        (SUPPORTED_LANGUAGES as readonly string[]).includes(language)
    ) {
        return language as EmailLanguage;
    }
    return "en";
}

function renderTemplate(
    templatePath: string,
    variables: Record<string, string>
): string {
    let template = fs.readFileSync(templatePath, "utf-8");
    for (const [key, value] of Object.entries(variables)) {
        const placeholder = new RegExp(`\\$\\{${key}\\}`, "g");
        template = template.replace(placeholder, value ?? "");
    }
    return template;
}

export function getEmailTemplate(
    templateType: EmailTemplateType | string,
    language = "en",
    variables: Record<string, string> = {}
): string {
    if (!Object.values(EMAIL_TYPES).includes(templateType as EmailTemplateType)) {
        throw new Error(`Invalid template type: ${templateType}`);
    }

    const lang = normalizeLanguage(language);
    const templatePath = path.join(
        TEMPLATE_BASE_PATH,
        templateType,
        `${lang}.html`
    );

    if (fs.existsSync(templatePath)) {
        return renderTemplate(templatePath, variables);
    }

    const fallbackPath = path.join(
        TEMPLATE_BASE_PATH,
        templateType,
        "en.html"
    );
    if (!fs.existsSync(fallbackPath)) {
        throw new Error(
            `Template not found for ${templateType} (tried ${lang} and en) under ${TEMPLATE_BASE_PATH}`
        );
    }
    return renderTemplate(fallbackPath, variables);
}

export function getEmailSubject(
    templateType: EmailTemplateType | string,
    language = "en",
    variables: Record<string, string> = {}
): string {
    if (!Object.values(EMAIL_TYPES).includes(templateType as EmailTemplateType)) {
        throw new Error(`Invalid template type: ${templateType}`);
    }

    const subjects = EMAIL_SUBJECTS[templateType as EmailTemplateType];
    const lang = normalizeLanguage(language);
    let subject = subjects[lang] || subjects.en || "Email from ARchaser";
    for (const [key, value] of Object.entries(variables)) {
        subject = subject.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value ?? "");
    }
    return subject;
}

export function templateExists(
    templateType: string,
    language = "en"
): boolean {
    try {
        const lang = normalizeLanguage(language);
        return fs.existsSync(
            path.join(TEMPLATE_BASE_PATH, templateType, `${lang}.html`)
        );
    } catch {
        return false;
    }
}
