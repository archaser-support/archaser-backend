/**
 * Email tracking utilities — open pixel and click-through links.
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * utils/emailTrackingUtils.ts
 */

function resolveBaseUrl(baseUrl?: string): string {
    return (
        baseUrl ||
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.NEXT_PUBLIC_NEST_API_BASE_URL ||
        "https://archaser.com"
    );
}

export function addTrackingPixel(
    htmlContent: string,
    messageId: string,
    baseUrl?: string
): string {
    const trackingUrl = `${resolveBaseUrl(baseUrl)}/api/email/track-open?messageId=${encodeURIComponent(messageId)}`;

    const trackingPixel = `
        <img src="${trackingUrl}" 
             width="1" height="1" 
             style="display:none; width:1px; height:1px; border:0;" 
             alt="" 
             border="0" />
    `;

    if (htmlContent.includes("</body>")) {
        return htmlContent.replace("</body>", `${trackingPixel}\n</body>`);
    }
    return htmlContent + trackingPixel;
}

export function addClickTracking(
    htmlContent: string,
    messageId: string,
    baseUrl?: string
): string {
    const baseUrlForTracking = resolveBaseUrl(baseUrl);

    const linkRegex = /<a\s+([^>]*?)href\s*=\s*["']([^"']+)["']([^>]*?)>/gi;

    return htmlContent.replace(linkRegex, (match, beforeHref, url, afterHref) => {
        if (
            url.includes("/api/email/track-click") ||
            url.startsWith("mailto:") ||
            url.startsWith("tel:") ||
            url.startsWith("#")
        ) {
            return match;
        }

        const encodedUrl = encodeURIComponent(url);
        const trackingUrl = `${baseUrlForTracking}/api/email/track-click?messageId=${encodeURIComponent(messageId)}&url=${encodedUrl}`;

        return `<a ${beforeHref}href="${trackingUrl}"${afterHref}>`;
    });
}

export function addEmailTracking(
    htmlContent: string,
    messageId: string,
    baseUrl?: string
): string {
    let trackedContent = addClickTracking(htmlContent, messageId, baseUrl);
    trackedContent = addTrackingPixel(trackedContent, messageId, baseUrl);
    return trackedContent;
}

export function generateTrackingUrl(
    originalUrl: string,
    messageId: string,
    baseUrl?: string
): string {
    const baseUrlForTracking = resolveBaseUrl(baseUrl);
    const encodedUrl = encodeURIComponent(originalUrl);
    return `${baseUrlForTracking}/api/email/track-click?messageId=${encodeURIComponent(messageId)}&url=${encodedUrl}`;
}

export function generateTrackingPixelUrl(
    messageId: string,
    baseUrl?: string
): string {
    const baseUrlForTracking = resolveBaseUrl(baseUrl);
    return `${baseUrlForTracking}/api/email/track-open?messageId=${encodeURIComponent(messageId)}`;
}
