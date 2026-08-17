"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptCredentials = encryptCredentials;
exports.parseStoredConnectorCredentials = parseStoredConnectorCredentials;
exports.decryptCredentials = decryptCredentials;
exports.isBillingConnectorEncryptionConfigured = isBillingConnectorEncryptionConfigured;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
function resolveEncryptionKey() {
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
        throw new Error("BILLING_CONNECTOR_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)");
    }
    return decoded;
}
function encryptCredentials(credentials) {
    const key = resolveEncryptionKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    const plaintext = JSON.stringify(credentials);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}
/**
 * Reads credentials from DB whether stored as AES-GCM (Nest API) or legacy
 * plain JSON (connectors peel used JSON.stringify before encryption existed).
 */
function parseStoredConnectorCredentials(stored) {
    const trimmed = stored.trim();
    if (!trimmed) {
        throw new Error("Stored credentials are empty");
    }
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)) {
                return parsed;
            }
        }
        catch {
            // fall through to decrypt
        }
    }
    try {
        return decryptCredentials(trimmed);
    }
    catch (decryptErr) {
        const message = decryptErr instanceof Error ? decryptErr.message : String(decryptErr);
        throw new Error(message.includes("BILLING_CONNECTOR_ENCRYPTION_KEY")
            ? "Billing connector credentials are encrypted but BILLING_CONNECTOR_ENCRYPTION_KEY is not configured"
            : `Unable to read stored connector credentials: ${message}`);
    }
}
function decryptCredentials(encryptedBlob) {
    const key = resolveEncryptionKey();
    const data = Buffer.from(encryptedBlob, "base64");
    if (data.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new Error("Invalid encrypted credentials blob");
    }
    const iv = data.subarray(0, IV_LENGTH);
    const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8"));
}
function isBillingConnectorEncryptionConfigured() {
    const raw = process.env.BILLING_CONNECTOR_ENCRYPTION_KEY;
    return Boolean(raw && raw.trim() !== "");
}
