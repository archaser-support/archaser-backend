/**
 * In-process cancel flags for billing connector sync executions.
 * The cancel API sets the flag; the sync loop checks it between pages/entities.
 */
const cancelledExecutionIds = new Set<string>();

export function requestConnectorSyncCancel(executionId: string): void {
    cancelledExecutionIds.add(executionId);
}

export function isConnectorSyncCancelRequested(executionId: string): boolean {
    return cancelledExecutionIds.has(executionId);
}

export function clearConnectorSyncCancel(executionId: string): void {
    cancelledExecutionIds.delete(executionId);
}

/** Test helper — empties the registry. */
export function resetConnectorSyncCancelRegistryForTests(): void {
    cancelledExecutionIds.clear();
}
