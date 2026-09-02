"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAMPLE_NOOP_EXTENSION_KEY = exports.ACCOUNT_10149_EXTENSION_KEY = void 0;
exports.listRegisteredExtensionKeys = listRegisteredExtensionKeys;
exports.getRegisteredExtension = getRegisteredExtension;
exports.isRegisteredExtensionKey = isRegisteredExtensionKey;
exports.resolveAccountBillingExtension = resolveAccountBillingExtension;
exports.resolveExtensionAttachmentInput = resolveExtensionAttachmentInput;
const account_10149_1 = require("./account_10149");
const sample_noop_1 = require("./sample_noop");
var account_10149_2 = require("./account_10149");
Object.defineProperty(exports, "ACCOUNT_10149_EXTENSION_KEY", { enumerable: true, get: function () { return account_10149_2.ACCOUNT_10149_EXTENSION_KEY; } });
var sample_noop_2 = require("./sample_noop");
Object.defineProperty(exports, "SAMPLE_NOOP_EXTENSION_KEY", { enumerable: true, get: function () { return sample_noop_2.SAMPLE_NOOP_EXTENSION_KEY; } });
const EXTENSION_REGISTRY = new Map([
    [sample_noop_1.sampleNoopExtension.key, sample_noop_1.sampleNoopExtension],
    [account_10149_1.account10149Extension.key, account_10149_1.account10149Extension],
]);
function listRegisteredExtensionKeys() {
    return Array.from(EXTENSION_REGISTRY.keys()).sort();
}
function getRegisteredExtension(key) {
    return EXTENSION_REGISTRY.get(key);
}
function isRegisteredExtensionKey(key) {
    return EXTENSION_REGISTRY.has(key);
}
/**
 * Load the registered billing extension attached to the account's connector.
 * Returns undefined when the prisma client has no connector delegate (tests)
 * or the connector has no known extension_key.
 */
async function resolveAccountBillingExtension(prisma, accountId) {
    const findFirst = prisma.billingConnector?.findFirst;
    if (typeof findFirst !== "function") {
        return undefined;
    }
    const connector = await findFirst({
        where: { account_id: accountId },
        select: { extension_key: true },
    });
    const key = connector?.extension_key?.trim();
    if (!key) {
        return undefined;
    }
    return getRegisteredExtension(key);
}
function normalizeExtensionKey(input) {
    if (input === undefined) {
        return undefined;
    }
    if (input === null) {
        return null;
    }
    const trimmed = String(input).trim();
    return trimmed === "" ? null : trimmed;
}
function normalizeExtensionConfig(input) {
    if (input === null || input === undefined) {
        return null;
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw Object.assign(new Error("extension_config must be a JSON object"), { statusCode: 400, code: "INVALID_EXTENSION_CONFIG" });
    }
    return { ...input };
}
/**
 * Resolve extension_key / extension_config for billing-connector PUT.
 * Returns undefined when neither field is present (omit from update).
 */
function resolveExtensionAttachmentInput(input) {
    const nextKey = normalizeExtensionKey(input.extension_key);
    const hasConfig = input.extension_config !== undefined;
    if (nextKey === undefined && !hasConfig) {
        return undefined;
    }
    if (nextKey === null) {
        return {
            extension_key: null,
            extension_config: null,
        };
    }
    if (nextKey !== undefined) {
        if (!isRegisteredExtensionKey(nextKey)) {
            throw Object.assign(new Error(`Unknown extension_key: ${nextKey}`), { statusCode: 400, code: "UNKNOWN_EXTENSION_KEY" });
        }
        const patch = {
            extension_key: nextKey,
        };
        if (hasConfig) {
            patch.extension_config =
                normalizeExtensionConfig(input.extension_config) ?? {};
        }
        else if (!input.existingKey) {
            // First attach without config payload — store empty object.
            patch.extension_config = {};
        }
        return patch;
    }
    // Config-only update: require an existing known key.
    const existing = input.existingKey?.trim() || null;
    if (!existing) {
        throw Object.assign(new Error("extension_config requires an extension_key on the connector"), { statusCode: 400, code: "EXTENSION_KEY_REQUIRED" });
    }
    if (!isRegisteredExtensionKey(existing)) {
        throw Object.assign(new Error(`Unknown extension_key: ${existing}`), { statusCode: 400, code: "UNKNOWN_EXTENSION_KEY" });
    }
    return {
        extension_config: normalizeExtensionConfig(input.extension_config) ?? {},
    };
}
