import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function resolveEncryptionKey(): Buffer {
    const raw = process.env.BILLING_CONNECTOR_ENCRYPTION_KEY;
    if (!raw || raw.trim() === "") {
        throw new Error("BILLING_CONNECTOR_ENCRYPTION_KEY is not configured");
    }

    const trimmed = raw.trim();
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        return Buffer.from(trimmed, "hex");
    }

    const decoded = Buffer.from(trimmed, "base64");
    if (decoded.length !== 32) {
        throw new Error(
            "BILLING_CONNECTOR_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)"
        );
    }
    return decoded;
}

export function encryptCredentials(
    credentials: Record<string, unknown>
): string {
    const key = resolveEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const plaintext = JSON.stringify(credentials);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

export function decryptCredentials(
    encryptedBlob: string
): Record<string, unknown> {
    const key = resolveEncryptionKey();
    const data = Buffer.from(encryptedBlob, "base64");
    if (data.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new Error("Invalid encrypted credentials blob");
    }

    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as Record<string, unknown>;
}

export function isBillingConnectorEncryptionConfigured(): boolean {
    const raw = process.env.BILLING_CONNECTOR_ENCRYPTION_KEY;
    return Boolean(raw && raw.trim() !== "");
}
