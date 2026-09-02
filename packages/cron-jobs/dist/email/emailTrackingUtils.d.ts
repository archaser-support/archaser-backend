/**
 * Email tracking utilities — open pixel and click-through links.
 * Ported from frontend SHA 81bd37afa048ee2b07f5e2e1a67629567cbc174f
 * utils/emailTrackingUtils.ts
 */
export declare function addTrackingPixel(htmlContent: string, messageId: string, baseUrl?: string): string;
export declare function addClickTracking(htmlContent: string, messageId: string, baseUrl?: string): string;
export declare function addEmailTracking(htmlContent: string, messageId: string, baseUrl?: string): string;
export declare function generateTrackingUrl(originalUrl: string, messageId: string, baseUrl?: string): string;
export declare function generateTrackingPixelUrl(messageId: string, baseUrl?: string): string;
