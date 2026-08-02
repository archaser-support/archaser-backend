"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SystemEmailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SystemEmailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto_1 = require("crypto");
const database_service_1 = require("../database/database.service");
const mongo_log_types_1 = require("../logging/mongo-log.types");
const mongo_log_service_1 = require("../logging/mongo-log.service");
const email_subject_prefix_1 = require("./email-subject-prefix");
const email_templates_1 = require("./email-templates");
const WELCOME_EMAIL_LOG_SOURCE = "email.welcome";
let SystemEmailService = SystemEmailService_1 = class SystemEmailService {
    constructor(config, db, mongoLog) {
        this.config = config;
        this.db = db;
        this.mongoLog = mongoLog;
        this.logger = new common_1.Logger(SystemEmailService_1.name);
    }
    logWelcomeEmailEvent(message, level, details, context) {
        const step = typeof details.step === "string" ? details.step : "unknown";
        const logPayload = {
            ...details,
            accountId: context?.accountId,
            userId: context?.userId,
        };
        if (level === mongo_log_types_1.LogLevel.ERROR || level === mongo_log_types_1.LogLevel.CRITICAL) {
            this.logger.error(`[WelcomeEmail] ${message}: ${JSON.stringify(logPayload)}`);
        }
        else {
            this.logger.log(`[WelcomeEmail] ${message}: ${JSON.stringify({
                step: logPayload.step,
                toEmail: logPayload.toEmail || logPayload.receiver_email,
            })}`);
        }
        void this.mongoLog
            .logMessage({
            timestamp: new Date(),
            level,
            message: `[WelcomeEmail] ${message}`,
            source: WELCOME_EMAIL_LOG_SOURCE,
            sub_source: step,
            account_id: context?.accountId,
            details: logPayload,
        })
            .catch(() => undefined);
    }
    buildWelcomeContentVars(args) {
        const { hasCollection, hasCreditInsurance, language } = args;
        const isHebrew = language === "he";
        const isDualProduct = hasCollection && hasCreditInsurance;
        const isCreditOnly = !hasCollection && hasCreditInsurance;
        if (isHebrew) {
            if (isDualProduct) {
                return {
                    product_title: "ARchaser",
                    product_subtitle: "פלטפורמת גבייה וביטוח אשראי שלך",
                    welcome_intro: 'ברוכים הבאים ל-<span dir="ltr" style="display: inline;">ARchaser</span>! נשמח לעזור לך לנהל תהליכי גבייה לצד חשיפות, מגבלות והתראות כיסוי בביטוח אשראי. כדי להתחיל, יש להגדיר סיסמה באמצעות הכפתור למטה.',
                    feature_1: "נהל חייבים ותהליכי גבייה ביעילות",
                    feature_2: "נטר חשיפות, מגבלות אשראי ופערי קיבולת",
                    feature_3: "עקוב אחר התראות כיסוי והפרות תנאים",
                    feature_4: "הפק דוחות תפעוליים ואנליטיים מקיפים",
                    feature_5: "שלב בקלות עם המערכות הקיימות שלך",
                };
            }
            if (isCreditOnly) {
                return {
                    product_title: "ARchaser",
                    product_subtitle: "פלטפורמת ניהול ביטוח האשראי שלך",
                    welcome_intro: 'ברוכים הבאים ל-<span dir="ltr" style="display: inline;">ARchaser</span>! נשמח לעזור לך לנהל סיכוני אשראי, כיסוי ותובנות תיק במקום אחד. כדי להתחיל, יש להגדיר סיסמה באמצעות הכפתור למטה.',
                    feature_1: "נטר חשיפות בסיכון וחשיפות תואמות בפורטפוליו",
                    feature_2: "עקוב אחר מגבלות מאושרות, ניצול ופערי קיבולת",
                    feature_3: "קבל התראות על מועדי דיווח והפרות תנאים",
                    feature_4: "צפה במדדי בריאות תיק ותובנות ביטוח אשראי",
                    feature_5: "שלב בקלות עם המערכות הקיימות שלך",
                };
            }
            return {
                product_title: "ARchaser",
                product_subtitle: "פלטפורמת ניהול גביית חובות שלך",
                welcome_intro: 'ברוכים הבאים ל-<span dir="ltr" style="display: inline;">ARchaser</span>! אנחנו שמחים שתצטרף לקהילה שלנו של אנשי מקצוע בגביית חובות. כדי להתחיל, תצטרך להגדיר את הסיסמה שלך על ידי לחיצה על הכפתור למטה.',
                feature_1: "נהל חייבים ועקוב אחר גבייה ביעילות",
                feature_2: "אוטומט סדרות מעקב ותזכורות",
                feature_3: "צור דוחות מפורטים וניתוחים",
                feature_4: "טפל בערעורים והבטחות תשלום",
                feature_5: "שלב עם המערכות הקיימות שלך",
            };
        }
        if (isDualProduct) {
            return {
                product_title: "ARchaser",
                product_subtitle: "Your collections and credit insurance platform",
                welcome_intro: "Welcome to ARchaser! We are excited to help you manage debt collection workflows alongside credit insurance exposure, limits, and coverage alerts. To get started, set your password using the button below.",
                feature_1: "Manage customers and collection workflows efficiently",
                feature_2: "Monitor portfolio exposure, approved limits, and capacity gaps",
                feature_3: "Stay ahead of reporting deadlines and policy breaches",
                feature_4: "Generate operational and risk analytics in one place",
                feature_5: "Integrate with your existing systems",
            };
        }
        if (isCreditOnly) {
            return {
                product_title: "ARchaser",
                product_subtitle: "Your credit insurance management platform",
                welcome_intro: "Welcome to ARchaser! We are excited to help you monitor risk, coverage, and portfolio health in one place. To get started, set your password using the button below.",
                feature_1: "Monitor compliant and at-risk exposure across your portfolio",
                feature_2: "Track approved limits, utilization, and capacity gaps",
                feature_3: "Stay ahead of reporting deadlines and terms breaches",
                feature_4: "View credit dashboard insights and coverage alerts",
                feature_5: "Integrate with your existing systems",
            };
        }
        return {
            product_title: "ARchaser",
            product_subtitle: "Your debt collection management platform",
            welcome_intro: "Welcome to ARchaser! We're excited to have you join our community of debt collection professionals. To get started, you'll need to set your password by clicking the button below.",
            feature_1: "Manage customers and track collections efficiently",
            feature_2: "Automate follow-up sequences and reminders",
            feature_3: "Generate detailed reports and analytics",
            feature_4: "Handle disputes and payment promises",
            feature_5: "Integrate with your existing systems",
        };
    }
    async getUserLanguage(email) {
        try {
            const user = await this.db.user.findFirst({
                where: { email },
                select: { language: true },
            });
            const languageMap = {
                English: "en",
                Hebrew: "he",
            };
            if (user?.language) {
                return languageMap[String(user.language)] || "en";
            }
            return "en";
        }
        catch {
            return "en";
        }
    }
    async getWelcomeProductFlags(receiverEmail, hasCollection, hasCreditInsurance) {
        if (typeof hasCollection === "boolean" &&
            typeof hasCreditInsurance === "boolean") {
            return { hasCollection, hasCreditInsurance };
        }
        const user = await this.db.user.findFirst({
            where: { email: receiverEmail },
            select: { account_id: true },
        });
        const account = user?.account_id != null
            ? await this.db.account.findUnique({
                where: { id: user.account_id },
                select: {
                    has_collection: true,
                    has_credit_insurance: true,
                },
            })
            : null;
        return {
            hasCollection: typeof hasCollection === "boolean"
                ? hasCollection
                : (account
                    ?.has_collection ?? true),
            hasCreditInsurance: typeof hasCreditInsurance === "boolean"
                ? hasCreditInsurance
                : Boolean(account
                    ?.has_credit_insurance),
        };
    }
    renderReportSharedEmail(args) {
        const language = args.language || "en";
        const vars = {
            userName: args.userName,
            creatorName: args.creatorName,
            reportName: args.reportName,
            reportUrl: args.reportUrl,
            permission: args.permission,
        };
        return {
            subject: (0, email_templates_1.getEmailSubject)(email_templates_1.EMAIL_TYPES.REPORT_SHARED, language, vars),
            html: (0, email_templates_1.getEmailTemplate)(email_templates_1.EMAIL_TYPES.REPORT_SHARED, language, vars),
        };
    }
    async sendReportSharedEmail(args) {
        const rendered = this.renderReportSharedEmail(args);
        return this.sendHtmlEmail({
            toEmail: args.toEmail,
            subject: rendered.subject,
            html: rendered.html,
        });
    }
    async sendResetPasswordEmail(resetLink, receiverEmail, language) {
        const user = await this.db.user.findFirst({
            where: { email: receiverEmail },
            select: { language: true, username: true, first_name: true },
        });
        const languageMap = {
            English: "en",
            Hebrew: "he",
        };
        const userLanguage = language ||
            (user?.language
                ? languageMap[String(user.language)] || "en"
                : "en");
        const first_name = user?.first_name?.trim() || (userLanguage === "he" ? "" : "there");
        const username = user?.username || (userLanguage === "he" ? "" : "there");
        const subject = (0, email_templates_1.getEmailSubject)(email_templates_1.EMAIL_TYPES.FORGOT_PASSWORD, userLanguage);
        const template = (0, email_templates_1.getEmailTemplate)(email_templates_1.EMAIL_TYPES.FORGOT_PASSWORD, userLanguage, { reset_link: resetLink, username, first_name });
        return this.sendHtmlEmail({
            toEmail: receiverEmail,
            subject,
            html: template,
            fromName: "ARchaser",
        });
    }
    async sendWelcomeUserEmail(receiverEmail, userName, resetLink, language, hasCollection, hasCreditInsurance, logContext) {
        this.logWelcomeEmailEvent("sentWelcomeUserEmail starting", mongo_log_types_1.LogLevel.INFO, {
            step: "compose_start",
            receiver_email: receiverEmail,
            user_namePresent: Boolean(userName?.trim()),
            languageProvided: Boolean(language),
            hasCollectionArg: hasCollection,
            hasCreditInsuranceArg: hasCreditInsurance,
            ...this.getResetPasswordUrlDiagnostics(resetLink),
            ...this.getWelcomeEmailDiagnostics(),
        }, logContext);
        const userLanguage = language || (await this.getUserLanguage(receiverEmail));
        const productFlags = await this.getWelcomeProductFlags(receiverEmail, hasCollection, hasCreditInsurance);
        const welcomeContentVariables = this.buildWelcomeContentVars({
            hasCollection: productFlags.hasCollection,
            hasCreditInsurance: productFlags.hasCreditInsurance,
            language: userLanguage,
        });
        const subject = (0, email_templates_1.getEmailSubject)(email_templates_1.EMAIL_TYPES.WELCOME_USER, userLanguage);
        const template = (0, email_templates_1.getEmailTemplate)(email_templates_1.EMAIL_TYPES.WELCOME_USER, userLanguage, {
            user_name: userName,
            reset_link: resetLink,
            ...welcomeContentVariables,
        });
        this.logWelcomeEmailEvent("sentWelcomeUserEmail composed", mongo_log_types_1.LogLevel.INFO, {
            step: "compose_complete",
            receiver_email: receiverEmail,
            userLanguage,
            hasCollection: productFlags.hasCollection,
            hasCreditInsurance: productFlags.hasCreditInsurance,
            subject,
            templateLength: template?.length ?? 0,
            welcomeIntroLength: welcomeContentVariables.welcome_intro?.length ?? 0,
        }, logContext);
        return this.sendHtmlEmail({
            toEmail: receiverEmail,
            subject,
            html: template,
            fromName: "ARchaser",
            logContext,
        });
    }
    async sendHtmlEmail(args) {
        const fromName = args.fromName || "ARchaser";
        const smtpHost = this.config.get("EMAIL_SERVER_HOST");
        const smtpUser = this.config.get("EMAIL_SERVER_USER");
        const smtpPass = this.config.get("EMAIL_SERVER_PASSWORD");
        const from = this.config.get("EMAIL_FROM") ||
            smtpUser ||
            "noreply@archaser.com";
        const prefixedSubject = (0, email_subject_prefix_1.addEnvironmentPrefixToEmailSubject)(args.subject);
        const trackerId = (0, crypto_1.randomUUID)();
        this.logWelcomeEmailEvent("sendMail starting", mongo_log_types_1.LogLevel.INFO, {
            step: "sendMail_start",
            toEmail: args.toEmail,
            subject: prefixedSubject,
            fromName,
            senderEmail: from,
            replyToSet: Boolean(args.replyToEmail),
            htmlBodyLength: args.html?.length ?? 0,
            trackerId,
            messageIdProvided: Boolean(args.messageId),
            ...this.getWelcomeEmailDiagnostics(),
        }, args.logContext);
        if (!smtpHost || !smtpUser || !smtpPass) {
            this.logWelcomeEmailEvent("sendMail skipped — SMTP not configured", mongo_log_types_1.LogLevel.WARNING, {
                step: "sendMail_skipped_no_smtp",
                toEmail: args.toEmail,
                ...this.getWelcomeEmailDiagnostics(),
            }, args.logContext);
            return { messageId: "smtp-not-configured" };
        }
        try {
            const nodemailer = require("nodemailer");
            const port = Number(this.config.get("EMAIL_SERVER_PORT") || 587);
            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port,
                secure: port === 465,
                auth: { user: smtpUser, pass: smtpPass },
            });
            const headers = {};
            const bounce = this.config.get("BOUNCE_RECEIVER_EMAIL");
            if (bounce)
                headers["Return-Path"] = bounce;
            const sesSet = this.config.get("SES_CONFIGURATION_SET");
            if (sesSet)
                headers["X-SES-CONFIGURATION-SET"] = sesSet;
            if (args.messageId)
                headers["X-Message-ID"] = args.messageId;
            const info = await transporter.sendMail({
                from: `"${fromName}" <${from}>`,
                to: args.toEmail,
                subject: prefixedSubject,
                html: args.html,
                ...(args.replyToEmail
                    ? { replyTo: args.replyToEmail }
                    : {}),
                ...(Object.keys(headers).length ? { headers } : {}),
            });
            const resolvedMessageId = info.messageId ||
                (typeof info.response === "string" &&
                    info.response.includes("Ok")
                    ? info.response.split(" ")[2]?.trim() || trackerId
                    : trackerId);
            this.logWelcomeEmailEvent("sendMail succeeded", mongo_log_types_1.LogLevel.INFO, {
                step: "sendMail_success",
                toEmail: args.toEmail,
                subject: prefixedSubject,
                messageId: resolvedMessageId,
                smtpResponse: info.response,
            }, args.logContext);
            return { messageId: resolvedMessageId };
        }
        catch (error) {
            this.logWelcomeEmailEvent("sendMail failed", mongo_log_types_1.LogLevel.ERROR, {
                step: "sendMail_failed",
                toEmail: args.toEmail,
                subject: prefixedSubject,
                errorMessage: error instanceof Error
                    ? error.message
                    : String(error),
                ...this.getWelcomeEmailDiagnostics(),
            }, args.logContext);
            throw error;
        }
    }
    getWelcomeEmailDiagnostics() {
        return {
            smtpHost: this.config.get("EMAIL_SERVER_HOST") || "unset",
            smtpPort: this.config.get("EMAIL_SERVER_PORT") || "587",
            smtpUserSet: Boolean(this.config.get("EMAIL_SERVER_USER")),
            smtpPasswordSet: Boolean(this.config.get("EMAIL_SERVER_PASSWORD")),
            emailFrom: this.config.get("EMAIL_FROM") || "unset",
            nextAuthUrlSet: Boolean(this.config.get("NEXTAUTH_URL") ||
                this.config.get("NEXT_PUBLIC_BASE_URL")),
            sesConfigurationSet: this.config.get("SES_CONFIGURATION_SET") || "unset",
            bounceReceiverSet: Boolean(this.config.get("BOUNCE_RECEIVER_EMAIL")),
        };
    }
    getResetPasswordUrlDiagnostics(resetLink) {
        try {
            const parsed = new URL(resetLink);
            return {
                resetLinkOrigin: parsed.origin,
                resetLinkPath: parsed.pathname,
                resetLinkHasToken: parsed.searchParams.has("token"),
            };
        }
        catch {
            return {
                resetLinkOrigin: "invalid",
                resetLinkPath: "invalid",
                resetLinkHasToken: false,
            };
        }
    }
};
exports.SystemEmailService = SystemEmailService;
exports.SystemEmailService = SystemEmailService = SystemEmailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        database_service_1.DatabaseService,
        mongo_log_service_1.MongoLogService])
], SystemEmailService);
//# sourceMappingURL=system-email.service.js.map