import { randomUUID } from "crypto";
import { addEnvironmentPrefixToEmailSubject } from "./emailSubjectPrefix";

export type SendSmtpHtmlEmailArgs = {
    toEmail: string;
    subject: string;
    html: string;
    fromName?: string;
    replyToEmail?: string;
    messageId?: string;
    attachments?: Array<{
        filename: string;
        content: Buffer | string;
        contentType: string;
    }>;
};

export type SendSmtpHtmlEmailResult = {
    messageId: string;
    skipped?: boolean;
};

/**
 * Send HTML email via Nest-compatible SMTP env (EMAIL_SERVER_* / EMAIL_FROM / SES / bounce).
 * Mirrors api/src/email/system-email.service.ts sendHtmlEmail.
 */
export async function sendSmtpHtmlEmail(
    args: SendSmtpHtmlEmailArgs
): Promise<SendSmtpHtmlEmailResult> {
    const fromName = args.fromName || "ARchaser";
    const smtpHost = process.env.EMAIL_SERVER_HOST;
    const smtpUser = process.env.EMAIL_SERVER_USER;
    const smtpPass = process.env.EMAIL_SERVER_PASSWORD;
    const from =
        process.env.EMAIL_FROM || smtpUser || "noreply@archaser.com";
    const prefixedSubject = addEnvironmentPrefixToEmailSubject(args.subject);
    const trackerId = randomUUID();

    if (!smtpHost || !smtpUser || !smtpPass) {
        return { messageId: "smtp-not-configured", skipped: true };
    }

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
    if (args.messageId) headers["X-Message-ID"] = args.messageId;

    const info = await transporter.sendMail({
        from: `"${fromName}" <${from}>`,
        to: args.toEmail,
        subject: prefixedSubject,
        html: args.html,
        ...(args.replyToEmail ? { replyTo: args.replyToEmail } : {}),
        ...(args.attachments?.length
            ? {
                  attachments: args.attachments.map((attachment) => ({
                      filename: attachment.filename,
                      content: attachment.content,
                      contentType: attachment.contentType,
                  })),
              }
            : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
    });

    const resolvedMessageId =
        info.messageId ||
        (typeof info.response === "string" && info.response.includes("Ok")
            ? info.response.split(" ")[2]?.trim() || trackerId
            : trackerId);

    return { messageId: resolvedMessageId };
}
