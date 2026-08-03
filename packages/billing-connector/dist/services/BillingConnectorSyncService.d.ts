import type { ConnectorSyncMode } from "@prisma/client";
import type { EntitySyncStats } from "@/models/ConnectorSyncExecution";
export type ConnectorRunMode = "preview" | "backfill" | "incremental";
export type ConnectorRunTrigger = "scheduled" | "manual" | "preview" | "backfill";
export interface ConnectorSyncRunResult {
    execution_id: string;
    status: string;
    sync_mode: ConnectorSyncMode;
    trigger: ConnectorRunTrigger;
    entity_stats: Record<string, EntitySyncStats>;
    duration_seconds: number;
}
export declare class BillingConnectorSyncService {
    private static instance;
    static getInstance(): BillingConnectorSyncService;
    runSync(options: {
        accountId: number;
        mode: ConnectorRunMode;
        trigger: ConnectorRunTrigger;
        correlationId?: string;
        userId?: string;
        skipAntiSpam?: boolean;
    }): Promise<ConnectorSyncRunResult>;
    private syncEntity;
    private pullWithRetry;
    private getEnabledEntities;
    private logSyncStep;
}
export declare const billingConnectorSyncService: BillingConnectorSyncService;
