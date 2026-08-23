import type {
    BillingAccountExtension,
    ExtensionMappedBatch,
    ExtensionTransformContext,
} from "../types";

/** Sample/no-op extension used for framework wiring and tests only. */
export const SAMPLE_NOOP_EXTENSION_KEY = "sample_noop";

export const sampleNoopExtension: BillingAccountExtension = {
    key: SAMPLE_NOOP_EXTENSION_KEY,
    label: "Sample (no-op)",
    transform(ctx: ExtensionTransformContext): ExtensionMappedBatch {
        // Pass-through: return the mapped batch unchanged.
        return ctx.batch;
    },
};
