import { account10149Extension } from "./account_10149";
import { sampleNoopExtension } from "./sample_noop";
import type {
    BillingAccountExtension,
    ExtensionAttachmentUpsertInput,
    ExtensionAttachmentUpsertPatch,
} from "./types";

export { ACCOUNT_10149_EXTENSION_KEY } from "./account_10149";
export { SAMPLE_NOOP_EXTENSION_KEY } from "./sample_noop";
export type {
    BillingAccountExtension,
    ExtensionAfterPaymentLinkedContext,
    ExtensionAfterPaymentLinkedResult,
    ExtensionAlignPaymentAmountsInput,
    ExtensionAlignedPaymentAmounts,
    ExtensionAttachmentUpsertInput,
    ExtensionAttachmentUpsertPatch,
    ExtensionEntityType,
    ExtensionLinkedPayment,
    ExtensionMappedBatch,
    ExtensionPaymentLinkedCandidate,
    ExtensionSyncWindow,
    ExtensionTransformContext,
} from "./types";

const EXTENSION_REGISTRY: ReadonlyMap<string, BillingAccountExtension> =
    new Map([
        [sampleNoopExtension.key, sampleNoopExtension],
        [account10149Extension.key, account10149Extension],
    ]);

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

/** Registry key of the form `account_{accountId}`, or null if unregistered. */
export function getMatchingAccountExtensionKey(
    accountId: number
): string | null {
    const key = `account_${accountId}`;
    return isRegisteredExtensionKey(key) ? key : null;
}

type ConnectorExtensionLookup = {
    billingConnector?: {
        findFirst: (args: {
            where: { account_id: number };
            select: { extension_key: true };
        }) => Promise<{ extension_key: string | null } | null>;
    };
};

/**
 * Load the registered billing extension attached to the account's connector.
 * Returns undefined when the prisma client has no connector delegate (tests)
 * or the connector has no known extension_key.
 */
export async function resolveAccountBillingExtension(
    prisma: ConnectorExtensionLookup,
    accountId: number
): Promise<BillingAccountExtension | undefined> {
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
 * Only `account_{accountId}` registry entries are attachable: auto-set when
 * unset, replace non-matching keys, or clear when no account match exists.
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

    const matchedKey = getMatchingAccountExtensionKey(input.accountId);
    const existing = input.existingKey?.trim() || null;

    if (!matchedKey) {
        return {
            extension_key: null,
            extension_config: null,
        };
    }

    const patch: ExtensionAttachmentUpsertPatch = {
        extension_key: matchedKey,
    };
    if (hasConfig) {
        patch.extension_config =
            normalizeExtensionConfig(input.extension_config) ?? {};
    } else if (existing !== matchedKey) {
        // First attach or replacing a non-matching key — empty config.
        patch.extension_config = {};
    }
    return patch;
}
