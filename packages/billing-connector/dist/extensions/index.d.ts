import type { BillingAccountExtension, ExtensionAttachmentUpsertInput, ExtensionAttachmentUpsertPatch } from "./types";
export { ACCOUNT_10149_EXTENSION_KEY } from "./account_10149";
export { SAMPLE_NOOP_EXTENSION_KEY } from "./sample_noop";
export type { BillingAccountExtension, ExtensionAfterPaymentLinkedContext, ExtensionAfterPaymentLinkedResult, ExtensionAlignPaymentAmountsInput, ExtensionAlignedPaymentAmounts, ExtensionAttachmentUpsertInput, ExtensionAttachmentUpsertPatch, ExtensionCreditPaymentCloseInput, ExtensionEntityType, ExtensionLinkedPayment, ExtensionMappedBatch, ExtensionPaymentLinkedCandidate, ExtensionSyncWindow, ExtensionTransformContext, } from "./types";
export declare function listRegisteredExtensionKeys(): string[];
export declare function getRegisteredExtension(key: string): BillingAccountExtension | undefined;
export declare function isRegisteredExtensionKey(key: string): boolean;
type ConnectorExtensionLookup = {
    billingConnector?: {
        findFirst: (args: {
            where: {
                account_id: number;
            };
            select: {
                extension_key: true;
            };
        }) => Promise<{
            extension_key: string | null;
        } | null>;
    };
};
/**
 * Load the registered billing extension attached to the account's connector.
 * Returns undefined when the prisma client has no connector delegate (tests)
 * or the connector has no known extension_key.
 */
export declare function resolveAccountBillingExtension(prisma: ConnectorExtensionLookup, accountId: number): Promise<BillingAccountExtension | undefined>;
/**
 * Resolve extension_key / extension_config for billing-connector PUT.
 * Returns undefined when neither field is present (omit from update).
 */
export declare function resolveExtensionAttachmentInput(input: ExtensionAttachmentUpsertInput): ExtensionAttachmentUpsertPatch | undefined;
