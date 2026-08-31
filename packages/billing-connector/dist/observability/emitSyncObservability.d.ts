import type { BillingConnectorSyncMetricsSink } from "./types";
import type { EmitSyncFinishInput, EmitSyncStartInput } from "./types";
/** Worker/cron can register a process-wide sink when call sites lack DI. */
export declare function setDefaultBillingConnectorMetricsSink(sink: BillingConnectorSyncMetricsSink | null): void;
export declare function getDefaultBillingConnectorMetricsSink(): BillingConnectorSyncMetricsSink | null;
export declare function emitBillingConnectorSyncStart(input: EmitSyncStartInput, onLog?: (message: string) => void, structuredLogs?: boolean): void;
export declare function emitBillingConnectorSyncFinish(input: EmitSyncFinishInput, options?: {
    onLog?: (message: string) => void;
    metrics?: BillingConnectorSyncMetricsSink | null;
    structuredLogs?: boolean;
}): void;
/**
 * Adapt prom-client Counter/Histogram instances (same label shapes as API metrics).
 */
export declare function createBillingConnectorMetricsSinkFromProm(metrics: {
    syncTotal: {
        inc: (labels: {
            provider: string;
            status: string;
            sync_mode: string;
            trigger: string;
        }) => void;
    };
    syncDuration: {
        observe: (labels: {
            provider: string;
            sync_mode: string;
        }, value: number) => void;
    };
    errorsTotal: {
        inc: (labels: {
            provider: string;
            error_type: string;
            sync_mode: string;
        }) => void;
    };
    recordsProcessed: {
        inc: (labels: {
            provider: string;
            entity_type: string;
            result: string;
        }, value?: number) => void;
    };
}): BillingConnectorSyncMetricsSink;
