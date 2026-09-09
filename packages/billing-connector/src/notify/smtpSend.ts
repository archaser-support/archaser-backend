import { randomUUID } from "crypto";

export type SmtpSendArgs = {
    toEmail: string;
    subject: string;
    html: string;
    fromName?: string;
};

export type SmtpSendResult = {
    messageId: string;
    skipped?: boolean;
};

/**
 * Minimal fire-once SMTP send for billing-connector internal notifications.
 *
 * Mirrors `packages/cron-jobs/src/email/sendSmtpHtmlEmail.ts` — kept as a
 * thin copy to avoid a circular workspace dependency (cron-jobs depends on
 * billing-connector). Subject prefix behaviour mirrors `addEnvironmentPrefixToEmailSubject`.
 */
export async function smtpSend(args: SmtpSendArgs): Promise<SmtpSendResult> {
    const smtpHost = process.env.EMAIL_SERVER_HOST;
    const smtpUser = process.env.EMAIL_SERVER_USER;
    const smtpPass = process.env.EMAIL_SERVER_PASSWORD;

    if (!smtpHost || !smtpUser || !smtpPass) {
        return { messageId: "smtp-not-configured", skipped: true };
    }

    const from = process.env.EMAIL_FROM || smtpUser || "noreply@archaser.com";
    const fromName = args.fromName ?? "ARchaser";
    const prefixedSubject = addEnvPrefix(args.subject);
    const trackerId = randomUUID();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require("nodemailer") as {
        createTransport: (opts: Record<string, unknown>) => {
            sendMail: (
                opts: Record<string, unknown>
            ) => Promise<{ response?: string; messageId?: string }>;
        };
    };

    const port = Number(process.env.EMAIL_SERVER_PORT || 587);
    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
    });

    const headers: Record<string, string> = {};
    const bounce = process.env.BOUNCE_RECEIVER_EMAIL;
    if (bounce) headers["Return-Path"] = bounce;
    const sesSet = process.env.SES_CONFIGURATION_SET;
    if (sesSet) headers["X-SES-CONFIGURATION-SET"] = sesSet;

    const info = await transporter.sendMail({
        from: `"${fromName}" <${from}>`,
        to: args.toEmail,
        subject: prefixedSubject,
        html: args.html,
        ...(Object.keys(headers).length ? { headers } : {}),
    });

    const messageId =
        info.messageId ||
        (typeof info.response === "string" && info.response.includes("Ok")
            ? info.response.split(" ")[2]?.trim() || trackerId
            : trackerId);

    return { messageId };
}

/** Mirrors `addEnvironmentPrefixToEmailSubject` in cron-jobs. */
function addEnvPrefix(subject: string): string {
    const env = process.env.NODE_ENV;
    if (env === "development") return `[LOCAL] ${subject}`;
    const port = process.env.PORT;
    if (env === "production" && port === "3001") return `[PRE-PROD] ${subject}`;
    return subject;
}
