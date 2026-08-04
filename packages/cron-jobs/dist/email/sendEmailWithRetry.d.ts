import { type SendSmtpHtmlEmailArgs } from "./sendSmtpHtmlEmail";
export type SendEmailWithRetryArgs = Omit<SendSmtpHtmlEmailArgs, "messageId"> & {
    messageId?: string;
};
/**
 * Activity-workflow send with in-process retries on transient SES/SMTP errors.
 */
export declare function sendEmailWithRetry(args: SendEmailWithRetryArgs): Promise<{
    messageId: string;
    skipped?: boolean;
}>;
