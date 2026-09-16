import type { PrismaClient } from "@prisma/client";

export type ConnectorReconcileSyncMode = "BACKFILL" | "INCREMENTAL";

export type ConnectorSyncStateForReconcile = {
    entity_type: string;
    backfill_completed: boolean;
};

export type ReconcileConnectorSyncModeInput = {
    currentMode: string;
    enabledEntities: readonly string[];
    syncStates: readonly ConnectorSyncStateForReconcile[];
    /**
     * Customer-scoped Start backfill must never promote, even when entity rows
     * look complete. Config GET repair leaves this false (no invented history).
     */
    customerScoped?: boolean;
    /**
     * When false (default), Incremental never demotes — end-of-sync / config
     * repair only promote. Pass true on connector save so newly enabled
     * incomplete entities drop Incremental → Backfill.
     */
    allowDemote?: boolean;
};

/**
 * Pure sync-mode reconcile: promote when every enabled entity is
 * `backfill_completed`, demote Incremental only when `allowDemote` and any
 * enabled entity is incomplete. Disabled entities are ignored. Empty /
 * never-started enabled sets stay Backfill.
 */
export function reconcileConnectorSyncMode(
    input: ReconcileConnectorSyncModeInput
): ConnectorReconcileSyncMode {
    const current = normalizeConnectorSyncMode(input.currentMode);
    const allEnabledComplete = areAllEnabledEntitiesBackfillComplete(
        input.enabledEntities,
        input.syncStates
    );

    if (current === "INCREMENTAL") {
        if (input.allowDemote === true && !allEnabledComplete) {
            return "BACKFILL";
        }
        return "INCREMENTAL";
    }

    if (input.customerScoped) {
        return "BACKFILL";
    }

    return allEnabledComplete ? "INCREMENTAL" : "BACKFILL";
}

export function normalizeConnectorSyncMode(
    mode: string
): ConnectorReconcileSyncMode {
    return mode === "INCREMENTAL" ? "INCREMENTAL" : "BACKFILL";
}

export function areAllEnabledEntitiesBackfillComplete(
    enabledEntities: readonly string[],
    syncStates: readonly ConnectorSyncStateForReconcile[]
): boolean {
    if (enabledEntities.length === 0) {
        return false;
    }
    const completedByType = new Map<string, boolean>();
    for (const state of syncStates) {
        completedByType.set(state.entity_type, state.backfill_completed === true);
    }
    return enabledEntities.every(
        (entityType) => completedByType.get(entityType) === true
    );
}

export type PersistReconciledConnectorSyncModeParams = {
    prisma: PrismaClient;
    connectorId: number;
    currentMode: string;
    enabledEntities: readonly string[];
    syncStates: readonly ConnectorSyncStateForReconcile[];
    customerScoped?: boolean;
    allowDemote?: boolean;
    onLog?: (message: string) => void;
};

/**
 * Compute next mode and persist only when it changes.
 * Returns the mode after reconcile (unchanged or updated).
 */
export async function persistReconciledConnectorSyncMode(
    params: PersistReconciledConnectorSyncModeParams
): Promise<ConnectorReconcileSyncMode> {
    const current = normalizeConnectorSyncMode(params.currentMode);
    const next = reconcileConnectorSyncMode({
        currentMode: current,
        enabledEntities: params.enabledEntities,
        syncStates: params.syncStates,
        customerScoped: params.customerScoped === true,
        allowDemote: params.allowDemote === true,
    });
    if (next === current) {
        return current;
    }
    await params.prisma.billingConnector.update({
        where: { id: params.connectorId },
        data: {
            sync_mode: next,
            modified_at: new Date(),
        },
    });
    params.onLog?.(
        `Sync mode reconciled: ${current} → ${next}`
    );
    return next;
}
