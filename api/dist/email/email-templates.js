"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMAIL_SUBJECTS = exports.EMAIL_TYPES = exports.SUPPORTED_LANGUAGES = void 0;
exports.getEmailTemplate = getEmailTemplate;
exports.getEmailSubject = getEmailSubject;
exports.templateExists = templateExists;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const TEMPLATE_BASE_PATH = path_1.default.join(__dirname, "assets", "emails");
exports.SUPPORTED_LANGUAGES = ["en", "he"];
exports.EMAIL_TYPES = {
    FORGOT_PASSWORD: "forgot-password",
    WELCOME_USER: "welcome-user",
    DISPUTE_NOTIFICATION: "dispute-notification",
    REPORT_SHARED: "report-shared",
};
exports.EMAIL_SUBJECTS = {
    [exports.EMAIL_TYPES.FORGOT_PASSWORD]: {
        en: "Reset Password Request",
        he: "בקשת איפוס סיסמה",
    },
    [exports.EMAIL_TYPES.WELCOME_USER]: {
        en: "Welcome to ARchaser",
        he: "ברוכים הבאים ל-ARchaser",
    },
    [exports.EMAIL_TYPES.DISPUTE_NOTIFICATION]: {
        en: "New Dispute Notification",
        he: "התראה על ערעור חדש",
    },
    [exports.EMAIL_TYPES.REPORT_SHARED]: {
        en: "Report Shared: ${reportName}",
        he: "דוח שותף: ${reportName}",
    },
};
function normalizeLanguage(language) {
    if (language === "he" || language === "Hebrew")
        return "he";
    if (language &&
        exports.SUPPORTED_LANGUAGES.includes(language)) {
        return language;
    }
    return "en";
}
function renderTemplate(templatePath, variables) {
    let template = fs_1.default.readFileSync(templatePath, "utf-8");
    for (const [key, value] of Object.entries(variables)) {
        const placeholder = new RegExp(`\\$\\{${key}\\}`, "g");
        template = template.replace(placeholder, value ?? "");
    }
    return template;
}
function getEmailTemplate(templateType, language = "en", variables = {}) {
    if (!Object.values(exports.EMAIL_TYPES).includes(templateType)) {
        throw new Error(`Invalid template type: ${templateType}`);
    }
    const lang = normalizeLanguage(language);
    const templatePath = path_1.default.join(TEMPLATE_BASE_PATH, templateType, `${lang}.html`);
    if (fs_1.default.existsSync(templatePath)) {
        return renderTemplate(templatePath, variables);
    }
    const fallbackPath = path_1.default.join(TEMPLATE_BASE_PATH, templateType, "en.html");
    if (!fs_1.default.existsSync(fallbackPath)) {
        throw new Error(`Template not found for ${templateType} (tried ${lang} and en) under ${TEMPLATE_BASE_PATH}`);
    }
    return renderTemplate(fallbackPath, variables);
}
function getEmailSubject(templateType, language = "en", variables = {}) {
    if (!Object.values(exports.EMAIL_TYPES).includes(templateType)) {
        throw new Error(`Invalid template type: ${templateType}`);
    }
    const subjects = exports.EMAIL_SUBJECTS[templateType];
    const lang = normalizeLanguage(language);
    let subject = subjects[lang] || subjects.en || "Email from ARchaser";
    for (const [key, value] of Object.entries(variables)) {
        subject = subject.replace(new RegExp(`\\$\\{${key}\\}`, "g"), value ?? "");
    }
    return subject;
}
function templateExists(templateType, language = "en") {
    try {
        const lang = normalizeLanguage(language);
        return fs_1.default.existsSync(path_1.default.join(TEMPLATE_BASE_PATH, templateType, `${lang}.html`));
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=email-templates.js.map