export type ConnectorScheduleSyncMode = "BACKFILL" | "INCREMENTAL";
export type SchedulePreset = "every_4h" | "every_6h" | "every_12h" | "daily" | "weekly" | "custom";
export interface PresetToCronOptions {
    dailyTimeUtc?: string;
    weeklyDay?: number;
}
export interface CronToPresetResult {
    schedule_preset: SchedulePreset | null;
    daily_time_utc?: string;
    weekly_day?: number;
}
export interface ConnectorDueCheckInput {
    syncMode: ConnectorScheduleSyncMode;
    syncCronExpression: string;
    now: Date;
    lastScheduledIncrementalSuccessAt: Date | null;
    hasScheduledIncrementalSuccess: boolean;
    connectorModifiedAt: Date;
}
export declare function hasCronFiredBetween(cronExpression: string, from: Date, to: Date): boolean;
export declare function isConnectorDue(input: ConnectorDueCheckInput): boolean;
export declare function computeNextScheduledSyncAt(cronExpression: string, lastScheduledIncrementalSuccessAt: Date | null, now: Date, connectorModifiedAt?: Date | null): Date | null;
export declare function presetToCron(preset: Exclude<SchedulePreset, "custom">, options?: PresetToCronOptions): string;
export declare function cronToPreset(cronExpression: string): CronToPresetResult;
export declare function describeSchedule(cronExpression: string): string;
