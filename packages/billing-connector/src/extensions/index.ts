import { sampleNoopExtension } from "./sample_noop";
import type {
    BillingAccountExtension,
    ExtensionAttachmentUpsertInput,
    ExtensionAttachmentUpsertPatch,
} from "./types";

export { SAMPLE_NOOP_EXTENSION_KEY } from "./sample_noop";
export type {
    BillingAccountExtension,
    ExtensionAttachmentUpsertInput,
    ExtensionAttachmentUpsertPatch,
    ExtensionEntityType,
    ExtensionMappedBatch,
    ExtensionSyncWindow,
    ExtensionTransformContext,
} from "./types";

const EXTENSION_REGISTRY: ReadonlyMap<string, BillingAccountExtension> =
    new Map([[sampleNoopExtension.key, sampleNoopExtension]]);

export function listRegisteredExtensionKeys(): string[] {
    return Array.from(EXTENSION_REGISTRY.keys()).sort();
}

export function getRegisteredExtension(
    key: string
): BillingAccountExtension | undefined {
    return EXTENSION_REGISTRY.get(key);
}

export function isRegisteredExtensionKey(key: string): boolean {
    return EXTENSION_REGISTRY.has(key);
}

function normalizeExtensionKey(
    input: string | null | undefined
): string | null | undefined {
    if (input === undefined) {
        return undefined;
    }
    if (input === null) {
        return null;
    }
    const trimmed = String(input).trim();
    return trimmed === "" ? null : trimmed;
}

function normalizeExtensionConfig(
    input: unknown
): Record<string, unknown> | null {
    if (input === null || input === undefined) {
        return null;
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw Object.assign(
            new Error("extension_config must be a JSON object"),
            { statusCode: 400, code: "INVALID_EXTENSION_CONFIG" }
        );
    }
    return { ...(input as Record<string, unknown>) };
}

/**
 * Resolve extension_key / extension_config for billing-connector PUT.
 * Returns undefined when neither field is present (omit from update).
 */
export function resolveExtensionAttachmentInput(
    input: ExtensionAttachmentUpsertInput
): ExtensionAttachmentUpsertPatch | undefined {
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
            throw Object.assign(
                new Error(`Unknown extension_key: ${nextKey}`),
                { statusCode: 400, code: "UNKNOWN_EXTENSION_KEY" }
            );
        }
        const patch: ExtensionAttachmentUpsertPatch = {
            extension_key: nextKey,
        };
        if (hasConfig) {
            patch.extension_config =
                normalizeExtensionConfig(input.extension_config) ?? {};
        } else if (!input.existingKey) {
            // First attach without config payload — store empty object.
            patch.extension_config = {};
        }
        return patch;
    }

    // Config-only update: require an existing known key.
    const existing = input.existingKey?.trim() || null;
    if (!existing) {
        throw Object.assign(
            new Error(
                "extension_config requires an extension_key on the connector"
            ),
            { statusCode: 400, code: "EXTENSION_KEY_REQUIRED" }
        );
    }
    if (!isRegisteredExtensionKey(existing)) {
        throw Object.assign(
            new Error(`Unknown extension_key: ${existing}`),
            { statusCode: 400, code: "UNKNOWN_EXTENSION_KEY" }
        );
    }

    return {
        extension_config: normalizeExtensionConfig(input.extension_config) ?? {},
    };
}
