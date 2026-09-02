"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertPriorityProvider = assertPriorityProvider;
/**
 * Priority-only provider gate (D68).
 */
function assertPriorityProvider(provider) {
    if (String(provider).toUpperCase() !== "PRIORITY") {
        throw new Error(`Only PRIORITY provider is supported in this phase. Got: ${provider}`);
    }
}
