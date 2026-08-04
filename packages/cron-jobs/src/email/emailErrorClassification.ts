const TRANSIENT_CODE_PATTERNS = [
    /\b421\b/,
    /\b450\b/,
    /\b451\b/,
    /\b452\b/,
    /\b454\b/,
    /\b4\.7\.\d+\b/i,
];

const TRANSIENT_MESSAGE_PATTERNS = [
    /throttl/i,
    /rate\s*limit/i,
    /timeout/i,
    /timed\s*out/i,
    /service\s*unavailable/i,
    /temporar/i,
    /try\s*again/i,
    /connection\s*(?:reset|closed|lost)/i,
    /econnreset/i,
    /etimedout/i,
    /enotfound/i,
    /eai_again/i,
    /socket\s*hang\s*up/i,
    /too\s*many\s*(?:connections|requests)/i,
    /over\s*quota/i,
    /maximum\s*sending\s*rate/i,
];

const PERMANENT_CODE_PATTERNS = [
    /\b550\b/,
    /\b553\b/,
    /\b501\b/,
    /\b552\b/,
    /\b554\b/,
];

const PERMANENT_MESSAGE_PATTERNS = [
    /user\s*unknown/i,
    /mailbox\s*(?:unavailable|not\s*found)/i,
    /recipient\s*(?:rejected|address\s*rejected)/i,
    /does\s*not\s*exist/i,
    /invalid\s*recipient/i,
    /no\s*such\s*user/i,
    /suppression\s*list/i,
    /bounce/i,
    /complaint/i,
    /authentication\s*(?:failed|credentials)/i,
    /invalid\s*credentials/i,
    /access\s*denied/i,
];

function collectErrorText(error: unknown): string {
    if (error == null) {
        return "";
    }
    if (typeof error === "string") {
        return error;
    }
    if (error instanceof Error) {
        const parts = [error.name, error.message];
        const err = error as Error & {
            code?: string | number;
            response?: string;
            responseCode?: number;
        };
        if (err.code != null) {
            parts.push(String(err.code));
        }
        if (err.response) {
            parts.push(String(err.response));
        }
        if (err.responseCode != null) {
            parts.push(String(err.responseCode));
        }
        return parts.join(" ");
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
    return patterns.some((p) => p.test(text));
}

/** True when SES/SMTP failure is likely infrastructure-related and may succeed on retry. */
export function isTransientEmailError(error: unknown): boolean {
    const text = collectErrorText(error);
    if (!text) {
        return false;
    }

    if (matchesAny(text, PERMANENT_MESSAGE_PATTERNS)) {
        return false;
    }
    if (matchesAny(text, PERMANENT_CODE_PATTERNS)) {
        return false;
    }

    return (
        matchesAny(text, TRANSIENT_CODE_PATTERNS) ||
        matchesAny(text, TRANSIENT_MESSAGE_PATTERNS)
    );
}

/** Truncate for ActivityContact.failure_reason (VARCHAR 255). */
export function getEmailErrorSummary(error: unknown): string {
    const text = collectErrorText(error) || "Unknown email error";
    return text.length > 255 ? `${text.slice(0, 252)}...` : text;
}

/** 0 = unlimited workflow-level retries across cron runs. */
export function getEmailTransientMaxRetries(): number {
    const raw = process.env.EMAIL_TRANSIENT_MAX_RETRIES;
    if (raw == null || String(raw).trim() === "") {
        return 0;
    }
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function shouldDeferEmailForRetry(
    error: unknown,
    currentRetryCount: number
): boolean {
    if (!isTransientEmailError(error)) {
        return false;
    }
    const max = getEmailTransientMaxRetries();
    if (max === 0) {
        return true;
    }
    return currentRetryCount < max;
}
