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
export declare function sendSmtpHtmlEmail(args: SendSmtpHtmlEmailArgs): Promise<SendSmtpHtmlEmailResult>;
