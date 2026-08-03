import { type ConnectorExecutionStatus, type ConnectorSyncTrigger, type EntitySyncStats, type IConnectorSyncExecution } from "@/models/ConnectorSyncExecution";
export declare class ConnectorSyncExecutionService {
    static createExecution(data: {
        connectorId: number;
        accountId: number;
        provider: string;
        trigger: ConnectorSyncTrigger;
        syncMode: string;
        correlationId?: string;
        mappingSnapshotHash?: Record<string, string>;
    }): Promise<IConnectorSyncExecution>;
    static updateExecution(executionId: string, data: {
        status?: ConnectorExecutionStatus;
        completedAt?: Date;
        durationSeconds?: number;
        entityStats?: Record<string, EntitySyncStats>;
        importJobIds?: Record<string, string>;
        errorMessage?: string;
        errorType?: string;
        errorDetails?: Record<string, unknown>;
        performanceMetrics?: Record<string, unknown>;
    }): Promise<IConnectorSyncExecution | null>;
    static findByConnectorId(connectorId: number, limit?: number): Promise<IConnectorSyncExecution[]>;
    static findLatestRunning(connectorId: number): Promise<IConnectorSyncExecution | null>;
    static findStaleRunning(connectorId: number, olderThan: Date): Promise<IConnectorSyncExecution[]>;
    static getLastCompletedAt(connectorId: number): Promise<Date | null>;
    static getLastScheduledIncrementalSuccessAt(connectorId: number): Promise<Date | null>;
    static hasScheduledIncrementalSuccess(connectorId: number): Promise<boolean>;
    static hashMapping(mapping: unknown): string;
}
