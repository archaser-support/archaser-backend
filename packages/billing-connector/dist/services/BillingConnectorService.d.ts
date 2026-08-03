import { BillingConnector, BillingConnectorStatus, BillingProvider, ConnectorAuthType, ImportType } from "@prisma/client";
import { type SchedulePreset } from "@/server/services/billingConnectorSchedule";
export interface ConnectorSyncStatePublic {
    entity_type: ImportType;
    backfill_completed: boolean;
    backfill_completed_at: string | null;
    backfill_cursor_present: boolean;
    backfill_records_pulled: number;
    backfill_total_records: number | null;
    last_max_updated_at: string | null;
    last_successful_run_at: string | null;
    last_attempt_at: string | null;
    last_error: string | null;
}
export interface BillingConnectorConfigResponse extends BillingConnectorPublicConfig {
    sync_states: ConnectorSyncStatePublic[];
}
export interface BillingConnectorPublicConfig {
    id: number;
    account_id: number;
    provider: BillingProvider;
    status: BillingConnectorStatus;
    base_url: string | null;
    auth_type: ConnectorAuthType;
    has_credentials: boolean;
    sync_enabled: boolean;
    sync_cron_expression: string;
    sync_mode: BillingConnector["sync_mode"];
    enabled_entities: ImportType[];
    sync_overlap_minutes: number;
    consecutive_auth_failures: number;
    last_connection_test_at: string | null;
    last_connection_error: string | null;
    created_at: string;
    modified_at: string;
    schedule_summary: string;
    next_scheduled_sync_at_utc: string | null;
    schedule_preset: SchedulePreset | null;
    daily_time_utc?: string;
    weekly_day?: number;
    schedule_warning?: string | null;
}
export interface UpsertBillingConnectorInput {
    provider?: BillingProvider;
    base_url?: string | null;
    auth_type?: ConnectorAuthType;
    credentials?: Record<string, unknown> | null;
    sync_enabled?: boolean;
    sync_cron_expression?: string;
    schedule_preset?: SchedulePreset;
    daily_time_utc?: string;
    weekly_day?: number;
    enabled_entities?: ImportType[];
}
export declare function validateSyncCronExpression(expression: string): {
    valid: boolean;
    error?: string;
    minIntervalMinutes?: number;
};
export declare class BillingConnectorService {
    private static instance;
    static getInstance(): BillingConnectorService;
    getConfig(accountId: number): Promise<BillingConnectorConfigResponse | null>;
    resetEntityBackfill(accountId: number, entityType: ImportType, userId: string): Promise<void>;
    upsertConfig(accountId: number, input: UpsertBillingConnectorInput, userId: string): Promise<BillingConnectorPublicConfig>;
    testConnection(accountId: number, overrides?: {
        base_url?: string;
        auth_type?: ConnectorAuthType;
        credentials?: Record<string, unknown>;
    }): Promise<{
        success: boolean;
        error?: string;
        tested_at: string;
    }>;
    getRecommendedPollIntervalMinutes(): number;
}
export declare const billingConnectorService: BillingConnectorService;
