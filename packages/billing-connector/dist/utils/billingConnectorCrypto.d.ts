export declare function encryptCredentials(credentials: Record<string, unknown>): string;
/**
 * Reads credentials from DB whether stored as AES-GCM (Nest API) or legacy
 * plain JSON (connectors peel used JSON.stringify before encryption existed).
 */
export declare function parseStoredConnectorCredentials(stored: string): Record<string, unknown>;
export declare function decryptCredentials(encryptedBlob: string): Record<string, unknown>;
export declare function isBillingConnectorEncryptionConfigured(): boolean;
