"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sampleNoopExtension = exports.SAMPLE_NOOP_EXTENSION_KEY = void 0;
/** Sample/no-op extension used for framework wiring and tests only. */
exports.SAMPLE_NOOP_EXTENSION_KEY = "sample_noop";
exports.sampleNoopExtension = {
    key: exports.SAMPLE_NOOP_EXTENSION_KEY,
    label: "Sample (no-op)",
    transform(ctx) {
        // Pass-through: return the mapped batch unchanged.
        return ctx.batch;
    },
};
