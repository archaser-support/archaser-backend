/**
 * Decode literal `\uXXXX` sequences (common when Priority JSON is shown as text).
 */
export function decodeJsonUnicodeEscapes(text: string): string {
    return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
    );
}

/**
 * Turn a Priority HTTP error body into a short, human-readable message.
 * Prefer `error.message` from Priority JSON so Hebrew is decoded characters,
 * not `\u05dc…` escapes.
 */
export function summarizePriorityHttpErrorBody(
    status: number,
    body: string
): string {
    const trimmed = body.trim();
    if (!trimmed) {
        return `HTTP ${status}`;
    }
    if (/^<!DOCTYPE/i.test(trimmed) || /^<html/i.test(trimmed)) {
        return `HTTP ${status} HTML gateway error`;
    }

    try {
        const parsed = JSON.parse(trimmed) as {
            error?: { message?: unknown };
            message?: unknown;
        };
        const fromNested =
            typeof parsed?.error?.message === "string"
                ? parsed.error.message.trim()
                : "";
        const fromTop =
            typeof parsed?.message === "string" ? parsed.message.trim() : "";
        const message = fromNested || fromTop;
        if (message) {
            return decodeJsonUnicodeEscapes(message);
        }
    } catch {
        // Not JSON — fall through.
    }

    return decodeJsonUnicodeEscapes(trimmed).slice(0, 400);
}
