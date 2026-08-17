"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestConnectorSyncCancel = requestConnectorSyncCancel;
exports.isConnectorSyncCancelRequested = isConnectorSyncCancelRequested;
exports.clearConnectorSyncCancel = clearConnectorSyncCancel;
exports.resetConnectorSyncCancelRegistryForTests = resetConnectorSyncCancelRegistryForTests;
/**
 * In-process cancel flags for billing connector sync executions.
 * The cancel API sets the flag; the sync loop checks it between pages/entities.
 */
const cancelledExecutionIds = new Set();
function requestConnectorSyncCancel(executionId) {
    cancelledExecutionIds.add(executionId);
}
function isConnectorSyncCancelRequested(executionId) {
    return cancelledExecutionIds.has(executionId);
}
function clearConnectorSyncCancel(executionId) {
    cancelledExecutionIds.delete(executionId);
}
/** Test helper — empties the registry. */
function resetConnectorSyncCancelRegistryForTests() {
    cancelledExecutionIds.clear();
}
