"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmailWithRetry = sendEmailWithRetry;
const emailErrorClassification_1 = require("./emailErrorClassification");
const sendSmtpHtmlEmail_1 = require("./sendSmtpHtmlEmail");
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function getInProcessMaxAttempts() {
    const raw = process.env.EMAIL_INPROCESS_MAX_ATTEMPTS;
    if (raw == null || String(raw).trim() === "") {
        return 3;
    }
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n >= 1 ? n : 3;
}
function getInProcessBackoffMs() {
    const raw = process.env.EMAIL_INPROCESS_BACKOFF_MS;
    if (raw == null || String(raw).trim() === "") {
        return 2000;
    }
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n >= 0 ? n : 2000;
}
/**
 * Activity-workflow send with in-process retries on transient SES/SMTP errors.
 */
async function sendEmailWithRetry(args) {
    const maxAttempts = getInProcessMaxAttempts();
    const baseBackoffMs = getInProcessBackoffMs();
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const result = await (0, sendSmtpHtmlEmail_1.sendSmtpHtmlEmail)(args);
            if (result.skipped) {
                return result;
            }
            if (!result.messageId?.trim()) {
                const emptyError = new Error("SES SMTP accepted send but returned no message id");
                if (attempt < maxAttempts &&
                    (0, emailErrorClassification_1.isTransientEmailError)(emptyError)) {
                    lastError = emptyError;
                    await sleep(baseBackoffMs * attempt);
                    continue;
                }
                throw emptyError;
            }
            return result;
        }
        catch (error) {
            lastError = error;
            if (attempt < maxAttempts && (0, emailErrorClassification_1.isTransientEmailError)(error)) {
                await sleep(baseBackoffMs * attempt);
                continue;
            }
            throw error;
        }
    }
    throw lastError instanceof Error
        ? lastError
        : new Error((0, emailErrorClassification_1.getEmailErrorSummary)(lastError));
}
