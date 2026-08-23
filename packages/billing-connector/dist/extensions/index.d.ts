import type { BillingAccountExtension, ExtensionAttachmentUpsertInput, ExtensionAttachmentUpsertPatch } from "./types";
export { SAMPLE_NOOP_EXTENSION_KEY } from "./sample_noop";
export type { BillingAccountExtension, ExtensionAttachmentUpsertInput, ExtensionAttachmentUpsertPatch, ExtensionEntityType, ExtensionMappedBatch, ExtensionSyncWindow, ExtensionTransformContext, } from "./types";
export declare function listRegisteredExtensionKeys(): string[];
export declare function getRegisteredExtension(key: string): BillingAccountExtension | undefined;
export declare function isRegisteredExtensionKey(key: string): boolean;
/**
 * Resolve extension_key / extension_config for billing-connector PUT.
 * Returns undefined when neither field is present (omit from update).
 */
export declare function resolveExtensionAttachmentInput(input: ExtensionAttachmentUpsertInput): ExtensionAttachmentUpsertPatch | undefined;
