"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSmtpHtmlEmail = sendSmtpHtmlEmail;
const crypto_1 = require("crypto");
const emailSubjectPrefix_1 = require("./emailSubjectPrefix");
/**
 * Send HTML email via Nest-compatible SMTP env (EMAIL_SERVER_* / EMAIL_FROM / SES / bounce).
 * Mirrors api/src/email/system-email.service.ts sendHtmlEmail.
 */
async function sendSmtpHtmlEmail(args) {
    const fromName = args.fromName || "ARchaser";
    const smtpHost = process.env.EMAIL_SERVER_HOST;
    const smtpUser = process.env.EMAIL_SERVER_USER;
    const smtpPass = process.env.EMAIL_SERVER_PASSWORD;
    const from = process.env.EMAIL_FROM || smtpUser || "noreply@archaser.com";
    const prefixedSubject = (0, emailSubjectPrefix_1.addEnvironmentPrefixToEmailSubject)(args.subject);
    const trackerId = (0, crypto_1.randomUUID)();
    if (!smtpHost || !smtpUser || !smtpPass) {
        return { messageId: "smtp-not-configured", skipped: true };
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require("nodemailer");
    const port = Number(process.env.EMAIL_SERVER_PORT || 587);
    const transporter = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: smtpPass },
    });
    const headers = {};
    const bounce = process.env.BOUNCE_RECEIVER_EMAIL;
    if (bounce)
        headers["Return-Path"] = bounce;
    const sesSet = process.env.SES_CONFIGURATION_SET;
    if (sesSet)
        headers["X-SES-CONFIGURATION-SET"] = sesSet;
    if (args.messageId)
        headers["X-Message-ID"] = args.messageId;
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
    const resolvedMessageId = info.messageId ||
        (typeof info.response === "string" && info.response.includes("Ok")
            ? info.response.split(" ")[2]?.trim() || trackerId
            : trackerId);
    return { messageId: resolvedMessageId };
}
