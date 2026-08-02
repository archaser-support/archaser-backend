import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { DatabaseService } from "../database/database.service";
import { LogLevel } from "../logging/mongo-log.types";
import { MongoLogService } from "../logging/mongo-log.service";
import { addEnvironmentPrefixToEmailSubject } from "./email-subject-prefix";
import {
    EMAIL_TYPES,
    getEmailSubject,
    getEmailTemplate,
} from "./email-templates";

export type WelcomeEmailLogContext = {
    accountId?: number;
    userId?: string;
};

type WelcomeProductFlags = {
    hasCollection: boolean;
    hasCreditInsurance: boolean;
};

type WelcomeContentVariables = {
    product_title: string;
    product_subtitle: string;
    welcome_intro: string;
    feature_1: string;
    feature_2: string;
    feature_3: string;
    feature_4: string;
    feature_5: string;
};

const WELCOME_EMAIL_LOG_SOURCE = "email.welcome";

@Injectable()
export class SystemEmailService {
    private readonly logger = new Logger(SystemEmailService.name);

    constructor(
        private readonly config: ConfigService,
        private readonly db: DatabaseService,
        private readonly mongoLog: MongoLogService
    ) {}

    logWelcomeEmailEvent(
        message: string,
        level: LogLevel,
        details: Record<string, unknown>,
        context?: WelcomeEmailLogContext
    ): void {
        const step =
            typeof details.step === "string" ? details.step : "unknown";
        const logPayload: Record<string, unknown> = {
            ...details,
            accountId: context?.accountId,
            userId: context?.userId,
        };

        if (level === LogLevel.ERROR || level === LogLevel.CRITICAL) {
            this.logger.error(
                `[WelcomeEmail] ${message}: ${JSON.stringify(logPayload)}`
            );
        } else {
            this.logger.log(
                `[WelcomeEmail] ${message}: ${JSON.stringify({
                    step: logPayload.step,
                    toEmail:
                        logPayload.toEmail || logPayload.receiver_email,
                })}`
            );
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

    buildWelcomeContentVars(args: {
        hasCollection: boolean;
        hasCreditInsurance: boolean;
        language: string;
    }): WelcomeContentVariables {
        const { hasCollection, hasCreditInsurance, language } = args;
        const isHebrew = language === "he";
        const isDualProduct = hasCollection && hasCreditInsurance;
        const isCreditOnly = !hasCollection && hasCreditInsurance;

        if (isHebrew) {
            if (isDualProduct) {
                return {
                    product_title: "ARchaser",
                    product_subtitle: "פלטפורמת גבייה וביטוח אשראי שלך",
                    welcome_intro:
                        'ברוכים הבאים ל-<span dir="ltr" style="display: inline;">ARchaser</span>! נשמח לעזור לך לנהל תהליכי גבייה לצד חשיפות, מגבלות והתראות כיסוי בביטוח אשראי. כדי להתחיל, יש להגדיר סיסמה באמצעות הכפתור למטה.',
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
                    welcome_intro:
                        'ברוכים הבאים ל-<span dir="ltr" style="display: inline;">ARchaser</span>! נשמח לעזור לך לנהל סיכוני אשראי, כיסוי ותובנות תיק במקום אחד. כדי להתחיל, יש להגדיר סיסמה באמצעות הכפתור למטה.',
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
                welcome_intro:
                    'ברוכים הבאים ל-<span dir="ltr" style="display: inline;">ARchaser</span>! אנחנו שמחים שתצטרף לקהילה שלנו של אנשי מקצוע בגביית חובות. כדי להתחיל, תצטרך להגדיר את הסיסמה שלך על ידי לחיצה על הכפתור למטה.',
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
                product_subtitle:
                    "Your collections and credit insurance platform",
                welcome_intro:
                    "Welcome to ARchaser! We are excited to help you manage debt collection workflows alongside credit insurance exposure, limits, and coverage alerts. To get started, set your password using the button below.",
                feature_1:
                    "Manage customers and collection workflows efficiently",
                feature_2:
                    "Monitor portfolio exposure, approved limits, and capacity gaps",
                feature_3:
                    "Stay ahead of reporting deadlines and policy breaches",
                feature_4:
                    "Generate operational and risk analytics in one place",
                feature_5: "Integrate with your existing systems",
            };
        }

        if (isCreditOnly) {
            return {
                product_title: "ARchaser",
                product_subtitle: "Your credit insurance management platform",
                welcome_intro:
                    "Welcome to ARchaser! We are excited to help you monitor risk, coverage, and portfolio health in one place. To get started, set your password using the button below.",
                feature_1:
                    "Monitor compliant and at-risk exposure across your portfolio",
                feature_2:
                    "Track approved limits, utilization, and capacity gaps",
                feature_3:
                    "Stay ahead of reporting deadlines and terms breaches",
                feature_4:
                    "View credit dashboard insights and coverage alerts",
                feature_5: "Integrate with your existing systems",
            };
        }

        return {
            product_title: "ARchaser",
            product_subtitle: "Your debt collection management platform",
            welcome_intro:
                "Welcome to ARchaser! We're excited to have you join our community of debt collection professionals. To get started, you'll need to set your password by clicking the button below.",
            feature_1: "Manage customers and track collections efficiently",
            feature_2: "Automate follow-up sequences and reminders",
            feature_3: "Generate detailed reports and analytics",
            feature_4: "Handle disputes and payment promises",
            feature_5: "Integrate with your existing systems",
        };
    }

    async getUserLanguage(email: string): Promise<string> {
        try {
            const user = await this.db.user.findFirst({
                where: { email },
                select: { language: true },
            });
            const languageMap: Record<string, string> = {
                English: "en",
                Hebrew: "he",
            };
            if (user?.language) {
                return languageMap[String(user.language)] || "en";
            }
            return "en";
        } catch {
            return "en";
        }
    }

    private async getWelcomeProductFlags(
        receiverEmail: string,
        hasCollection?: boolean,
        hasCreditInsurance?: boolean
    ): Promise<WelcomeProductFlags> {
        if (
            typeof hasCollection === "boolean" &&
            typeof hasCreditInsurance === "boolean"
        ) {
            return { hasCollection, hasCreditInsurance };
        }

        const user = await this.db.user.findFirst({
            where: { email: receiverEmail },
            select: { account_id: true },
        });
        const account =
            user?.account_id != null
                ? await this.db.account.findUnique({
                      where: { id: user.account_id },
                      select: {
                          has_collection: true,
                          has_credit_insurance: true,
                      },
                  })
                : null;

        return {
            hasCollection:
                typeof hasCollection === "boolean"
                    ? hasCollection
                    : ((account as { has_collection?: boolean } | null)
                          ?.has_collection ?? true),
            hasCreditInsurance:
                typeof hasCreditInsurance === "boolean"
                    ? hasCreditInsurance
                    : Boolean(
                          (account as { has_credit_insurance?: boolean } | null)
                              ?.has_credit_insurance
                      ),
        };
    }

    /** Render report-shared HTML (helper only — not wired to share upsert). */
    renderReportSharedEmail(args: {
        language?: string;
        userName: string;
        creatorName: string;
        reportName: string;
        reportUrl: string;
        permission: string;
    }): { subject: string; html: string } {
        const language = args.language || "en";
        const vars = {
            userName: args.userName,
            creatorName: args.creatorName,
            reportName: args.reportName,
            reportUrl: args.reportUrl,
            permission: args.permission,
        };
        return {
            subject: getEmailSubject(
                EMAIL_TYPES.REPORT_SHARED,
                language,
                vars
            ),
            html: getEmailTemplate(
                EMAIL_TYPES.REPORT_SHARED,
                language,
                vars
            ),
        };
    }

    async sendReportSharedEmail(args: {
        toEmail: string;
        language?: string;
        userName: string;
        creatorName: string;
        reportName: string;
        reportUrl: string;
        permission: string;
    }): Promise<{ messageId: string }> {
        const rendered = this.renderReportSharedEmail(args);
        return this.sendHtmlEmail({
            toEmail: args.toEmail,
            subject: rendered.subject,
            html: rendered.html,
        });
    }

    async sendResetPasswordEmail(
        resetLink: string,
        receiverEmail: string,
        language?: string
    ): Promise<{ messageId: string }> {
        const user = await this.db.user.findFirst({
            where: { email: receiverEmail },
            select: { language: true, username: true, first_name: true },
        });
        const languageMap: Record<string, string> = {
            English: "en",
            Hebrew: "he",
        };
        const userLanguage =
            language ||
            (user?.language
                ? languageMap[String(user.language)] || "en"
                : "en");
        const first_name =
            user?.first_name?.trim() || (userLanguage === "he" ? "" : "there");
        const username =
            user?.username || (userLanguage === "he" ? "" : "there");

        const subject = getEmailSubject(
            EMAIL_TYPES.FORGOT_PASSWORD,
            userLanguage
        );
        const template = getEmailTemplate(
            EMAIL_TYPES.FORGOT_PASSWORD,
            userLanguage,
            { reset_link: resetLink, username, first_name }
        );

        return this.sendHtmlEmail({
            toEmail: receiverEmail,
            subject,
            html: template,
            fromName: "ARchaser",
        });
    }

    async sendWelcomeUserEmail(
        receiverEmail: string,
        userName: string,
        resetLink: string,
        language?: string,
        hasCollection?: boolean,
        hasCreditInsurance?: boolean,
        logContext?: WelcomeEmailLogContext
    ): Promise<{ messageId: string }> {
        this.logWelcomeEmailEvent(
            "sentWelcomeUserEmail starting",
            LogLevel.INFO,
            {
                step: "compose_start",
                receiver_email: receiverEmail,
                user_namePresent: Boolean(userName?.trim()),
                languageProvided: Boolean(language),
                hasCollectionArg: hasCollection,
                hasCreditInsuranceArg: hasCreditInsurance,
                ...this.getResetPasswordUrlDiagnostics(resetLink),
                ...this.getWelcomeEmailDiagnostics(),
            },
            logContext
        );

        const userLanguage =
            language || (await this.getUserLanguage(receiverEmail));
        const productFlags = await this.getWelcomeProductFlags(
            receiverEmail,
            hasCollection,
            hasCreditInsurance
        );
        const welcomeContentVariables = this.buildWelcomeContentVars({
            hasCollection: productFlags.hasCollection,
            hasCreditInsurance: productFlags.hasCreditInsurance,
            language: userLanguage,
        });

        const subject = getEmailSubject(
            EMAIL_TYPES.WELCOME_USER,
            userLanguage
        );
        const template = getEmailTemplate(
            EMAIL_TYPES.WELCOME_USER,
            userLanguage,
            {
                user_name: userName,
                reset_link: resetLink,
                ...welcomeContentVariables,
            }
        );

        this.logWelcomeEmailEvent(
            "sentWelcomeUserEmail composed",
            LogLevel.INFO,
            {
                step: "compose_complete",
                receiver_email: receiverEmail,
                userLanguage,
                hasCollection: productFlags.hasCollection,
                hasCreditInsurance: productFlags.hasCreditInsurance,
                subject,
                templateLength: template?.length ?? 0,
                welcomeIntroLength:
                    welcomeContentVariables.welcome_intro?.length ?? 0,
            },
            logContext
        );

        return this.sendHtmlEmail({
            toEmail: receiverEmail,
            subject,
            html: template,
            fromName: "ARchaser",
            logContext,
        });
    }

    async sendHtmlEmail(args: {
        toEmail: string;
        subject: string;
        html: string;
        fromName?: string;
        replyToEmail?: string;
        messageId?: string;
        logContext?: WelcomeEmailLogContext;
    }): Promise<{ messageId: string }> {
        const fromName = args.fromName || "ARchaser";
        const smtpHost = this.config.get<string>("EMAIL_SERVER_HOST");
        const smtpUser = this.config.get<string>("EMAIL_SERVER_USER");
        const smtpPass = this.config.get<string>("EMAIL_SERVER_PASSWORD");
        const from =
            this.config.get<string>("EMAIL_FROM") ||
            smtpUser ||
            "noreply@archaser.com";
        const prefixedSubject = addEnvironmentPrefixToEmailSubject(
            args.subject
        );
        const trackerId = randomUUID();

        this.logWelcomeEmailEvent(
            "sendMail starting",
            LogLevel.INFO,
            {
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
            },
            args.logContext
        );

        if (!smtpHost || !smtpUser || !smtpPass) {
            this.logWelcomeEmailEvent(
                "sendMail skipped — SMTP not configured",
                LogLevel.WARNING,
                {
                    step: "sendMail_skipped_no_smtp",
                    toEmail: args.toEmail,
                    ...this.getWelcomeEmailDiagnostics(),
                },
                args.logContext
            );
            return { messageId: "smtp-not-configured" };
        }

        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const nodemailer = require("nodemailer") as {
                createTransport: (opts: Record<string, unknown>) => {
                    sendMail: (
                        opts: Record<string, unknown>
                    ) => Promise<{ response?: string; messageId?: string }>;
                };
            };
            const port = Number(
                this.config.get<string>("EMAIL_SERVER_PORT") || 587
            );
            const transporter = nodemailer.createTransport({
                host: smtpHost,
                port,
                secure: port === 465,
                auth: { user: smtpUser, pass: smtpPass },
            });

            const headers: Record<string, string> = {};
            const bounce = this.config.get<string>("BOUNCE_RECEIVER_EMAIL");
            if (bounce) headers["Return-Path"] = bounce;
            const sesSet = this.config.get<string>("SES_CONFIGURATION_SET");
            if (sesSet) headers["X-SES-CONFIGURATION-SET"] = sesSet;
            if (args.messageId) headers["X-Message-ID"] = args.messageId;

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

            const resolvedMessageId =
                info.messageId ||
                (typeof info.response === "string" &&
                info.response.includes("Ok")
                    ? info.response.split(" ")[2]?.trim() || trackerId
                    : trackerId);

            this.logWelcomeEmailEvent(
                "sendMail succeeded",
                LogLevel.INFO,
                {
                    step: "sendMail_success",
                    toEmail: args.toEmail,
                    subject: prefixedSubject,
                    messageId: resolvedMessageId,
                    smtpResponse: info.response,
                },
                args.logContext
            );

            return { messageId: resolvedMessageId };
        } catch (error) {
            this.logWelcomeEmailEvent(
                "sendMail failed",
                LogLevel.ERROR,
                {
                    step: "sendMail_failed",
                    toEmail: args.toEmail,
                    subject: prefixedSubject,
                    errorMessage:
                        error instanceof Error
                            ? error.message
                            : String(error),
                    ...this.getWelcomeEmailDiagnostics(),
                },
                args.logContext
            );
            throw error;
        }
    }

    private getWelcomeEmailDiagnostics() {
        return {
            smtpHost:
                this.config.get<string>("EMAIL_SERVER_HOST") || "unset",
            smtpPort: this.config.get<string>("EMAIL_SERVER_PORT") || "587",
            smtpUserSet: Boolean(
                this.config.get<string>("EMAIL_SERVER_USER")
            ),
            smtpPasswordSet: Boolean(
                this.config.get<string>("EMAIL_SERVER_PASSWORD")
            ),
            emailFrom: this.config.get<string>("EMAIL_FROM") || "unset",
            nextAuthUrlSet: Boolean(
                this.config.get<string>("NEXTAUTH_URL") ||
                    this.config.get<string>("NEXT_PUBLIC_BASE_URL")
            ),
            sesConfigurationSet:
                this.config.get<string>("SES_CONFIGURATION_SET") || "unset",
            bounceReceiverSet: Boolean(
                this.config.get<string>("BOUNCE_RECEIVER_EMAIL")
            ),
        };
    }

    private getResetPasswordUrlDiagnostics(resetLink: string) {
        try {
            const parsed = new URL(resetLink);
            return {
                resetLinkOrigin: parsed.origin,
                resetLinkPath: parsed.pathname,
                resetLinkHasToken: parsed.searchParams.has("token"),
            };
        } catch {
            return {
                resetLinkOrigin: "invalid",
                resetLinkPath: "invalid",
                resetLinkHasToken: false,
            };
        }
    }
}
