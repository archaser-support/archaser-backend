import {
    BillingConnector,
    BillingConnectorStatus,
    BillingProvider,
    ConnectorAuthType,
    ImportType,
    Prisma,
} from "@prisma/client";
import { parseExpression } from "cron-parser";

import { prisma } from "@/lib/prisma";
import { testPriorityConnection } from "@/server/integrations/priority/PriorityClient";
import { PRIORITY_RATE_LIMITS } from "@/server/integrations/priority/priorityApiContract";
import {
    computeNextScheduledSyncAt,
    cronToPreset,
    describeSchedule,
    presetToCron,
    type SchedulePreset,
} from "@/server/services/billingConnectorSchedule";
import { ConnectorSyncExecutionService } from "@/server/services/ConnectorSyncExecutionService";
import { SettingsAuditLogService } from "@/server/services/SettingsAuditLogService";
import {
    decryptCredentials,
    encryptCredentials,
    isBillingConnectorEncryptionConfigured,
} from "@/server/utils/billingConnectorCrypto";

const DEFAULT_ENABLED_ENTITIES: ImportType[] = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];

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

async function buildScheduleFields(
    connector: BillingConnector
): Promise<{
    schedule_summary: string;
    next_scheduled_sync_at_utc: string | null;
    schedule_preset: SchedulePreset | null;
    daily_time_utc?: string;
    weekly_day?: number;
    schedule_warning: string | null;
}> {
    const presetFields = cronToPreset(connector.sync_cron_expression);
    const scheduleSummary = describeSchedule(connector.sync_cron_expression);
    const scheduleWarning = buildScheduleWarning(
        connector.sync_cron_expression,
        connector.provider
    );
    const now = new Date();

    if (!connector.sync_enabled || connector.status !== "Active") {
        return {
            schedule_summary: scheduleSummary,
            next_scheduled_sync_at_utc: null,
            schedule_warning: scheduleWarning,
            ...presetFields,
        };
    }

    const lastScheduledIncrementalSuccessAt =
        await ConnectorSyncExecutionService.getLastScheduledIncrementalSuccessAt(
            connector.id
        );

    const nextAt = computeNextScheduledSyncAt(
        connector.sync_cron_expression,
        lastScheduledIncrementalSuccessAt,
        now,
        connector.modified_at
    );

    return {
        schedule_summary: scheduleSummary,
        next_scheduled_sync_at_utc: nextAt ? nextAt.toISOString() : null,
        schedule_warning: scheduleWarning,
        ...presetFields,
    };
}

function buildScheduleWarning(
    cronExpression: string,
    provider: BillingProvider
): string | null {
    const cronCheck = validateSyncCronExpression(cronExpression);
    if (!cronCheck.valid || cronCheck.minIntervalMinutes === undefined) {
        return null;
    }

    const recommended =
        BillingConnectorService.getInstance().getRecommendedPollIntervalMinutes();
    if (cronCheck.minIntervalMinutes < recommended) {
        const intervalMinutes = Math.round(cronCheck.minIntervalMinutes);
        return `Sync interval (${intervalMinutes} minutes) is more frequent than the recommended minimum (${recommended} minutes) for ${provider}.`;
    }

    return null;
}

function resolveSyncCronExpression(
    input: UpsertBillingConnectorInput,
    existing: BillingConnector | null
): string | undefined {
    if (input.schedule_preset !== undefined) {
        if (input.schedule_preset === "custom") {
            if (!input.sync_cron_expression?.trim()) {
                throw Object.assign(
                    new Error("sync_cron_expression is required for custom schedule"),
                    { statusCode: 400, code: "INVALID_CRON_EXPRESSION" }
                );
            }
            return input.sync_cron_expression.trim();
        }

        try {
            return presetToCron(input.schedule_preset, {
                dailyTimeUtc: input.daily_time_utc,
                weeklyDay: input.weekly_day,
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Invalid schedule preset";
            throw Object.assign(new Error(message), {
                statusCode: 400,
                code: "INVALID_CRON_EXPRESSION",
            });
        }
    }

    if (input.sync_cron_expression !== undefined) {
        return input.sync_cron_expression.trim();
    }

    return undefined;
}

async function toPublicConfig(
    connector: BillingConnector
): Promise<BillingConnectorPublicConfig> {
    const enabledEntities = parseEnabledEntities(connector.enabled_entities);
    const scheduleFields = await buildScheduleFields(connector);

    return {
        id: connector.id,
        account_id: connector.account_id,
        provider: connector.provider,
        status: connector.status,
        base_url: connector.base_url,
        auth_type: connector.auth_type,
        has_credentials: Boolean(connector.credentials_encrypted),
        sync_enabled: connector.sync_enabled,
        sync_cron_expression: connector.sync_cron_expression,
        sync_mode: connector.sync_mode,
        enabled_entities: enabledEntities,
        sync_overlap_minutes: connector.sync_overlap_minutes,
        consecutive_auth_failures: connector.consecutive_auth_failures,
        last_connection_test_at: connector.last_connection_test_at
            ? connector.last_connection_test_at.toISOString()
            : null,
        last_connection_error: connector.last_connection_error,
        created_at: connector.created_at.toISOString(),
        modified_at: connector.modified_at.toISOString(),
        ...scheduleFields,
    };
}

function sanitizeForAudit(
    connector: Partial<BillingConnector> & {
        credentials?: Record<string, unknown> | null;
    }
): Record<string, unknown> {
    const { credentials_encrypted, credentials, ...rest } = connector as Record<
        string,
        unknown
    >;
    return {
        ...rest,
        credentials_encrypted: credentials_encrypted ? "[REDACTED]" : null,
        credentials: credentials ? "[REDACTED]" : undefined,
    };
}

export function validateSyncCronExpression(expression: string): {
    valid: boolean;
    error?: string;
    minIntervalMinutes?: number;
} {
    try {
        const interval = parseExpression(expression);
        const first = interval.next().toDate();
        const second = interval.next().toDate();
        const diffMinutes = (second.getTime() - first.getTime()) / (60 * 1000);
        if (diffMinutes < 30) {
            return {
                valid: false,
                error: "Sync schedule must be at least 30 minutes apart",
                minIntervalMinutes: diffMinutes,
            };
        }
        return { valid: true, minIntervalMinutes: diffMinutes };
    } catch {
        return { valid: false, error: "Invalid cron expression" };
    }
}

function parseEnabledEntities(raw: unknown): ImportType[] {
    if (!Array.isArray(raw) || raw.length === 0) {
        return [...DEFAULT_ENABLED_ENTITIES];
    }
    const allowed = new Set<ImportType>(DEFAULT_ENABLED_ENTITIES);
    const filtered = raw.filter(
        (item): item is ImportType =>
            typeof item === "string" && allowed.has(item as ImportType)
    );
    return filtered.length > 0 ? filtered : [...DEFAULT_ENABLED_ENTITIES];
}

async function ensureSyncStateRows(
    tx: Pick<typeof prisma, "connectorSyncState">,
    connectorId: number,
    enabledEntities: ImportType[]
): Promise<void> {
    for (const entityType of enabledEntities) {
        await tx.connectorSyncState.upsert({
            where: {
                connector_id_entity_type: {
                    connector_id: connectorId,
                    entity_type: entityType,
                },
            },
            create: { connector_id: connectorId, entity_type: entityType },
            update: {},
        });
    }
}

export class BillingConnectorService {
    private static instance: BillingConnectorService;

    public static getInstance(): BillingConnectorService {
        if (!BillingConnectorService.instance) {
            BillingConnectorService.instance = new BillingConnectorService();
        }
        return BillingConnectorService.instance;
    }

    async getConfig(
        accountId: number
    ): Promise<BillingConnectorConfigResponse | null> {
        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
            include: { ConnectorSyncState: true },
        });
        if (!connector) {
            return null;
        }
        return {
            ...(await toPublicConfig(connector)),
            sync_states: connector.ConnectorSyncState.map((state) => ({
                entity_type: state.entity_type,
                backfill_completed: state.backfill_completed,
                backfill_completed_at: state.backfill_completed_at
                    ? state.backfill_completed_at.toISOString()
                    : null,
                backfill_cursor_present: Boolean(state.backfill_cursor),
                backfill_records_pulled: state.backfill_records_pulled,
                backfill_total_records: state.backfill_total_records,
                last_max_updated_at: state.last_max_updated_at
                    ? state.last_max_updated_at.toISOString()
                    : null,
                last_successful_run_at: state.last_successful_run_at
                    ? state.last_successful_run_at.toISOString()
                    : null,
                last_attempt_at: state.last_attempt_at
                    ? state.last_attempt_at.toISOString()
                    : null,
                last_error: state.last_error,
            })),
        };
    }

    async resetEntityBackfill(
        accountId: number,
        entityType: ImportType,
        userId: string
    ): Promise<void> {
        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            throw new Error("Billing connector is not configured");
        }

        await prisma.connectorSyncState.update({
            where: {
                connector_id_entity_type: {
                    connector_id: connector.id,
                    entity_type: entityType,
                },
            },
            data: {
                backfill_completed: false,
                backfill_completed_at: null,
                backfill_cursor: null,
                backfill_records_pulled: 0,
                backfill_last_checkpoint_at: null,
                backfill_total_records: null,
                last_max_updated_at: null,
                last_error: null,
            },
        });

        await prisma.billingConnector.update({
            where: { id: connector.id },
            data: {
                sync_mode: "BACKFILL",
                modified_by: userId,
            },
        });
    }

    async upsertConfig(
        accountId: number,
        input: UpsertBillingConnectorInput,
        userId: string
    ): Promise<BillingConnectorPublicConfig> {
        if (!isBillingConnectorEncryptionConfigured()) {
            throw new Error("BILLING_CONNECTOR_ENCRYPTION_KEY is not configured");
        }

        const existing = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });

        const resolvedCronExpression = resolveSyncCronExpression(input, existing);
        if (resolvedCronExpression !== undefined) {
            const cronCheck = validateSyncCronExpression(resolvedCronExpression);
            if (!cronCheck.valid) {
                throw Object.assign(
                    new Error(cronCheck.error || "Invalid cron expression"),
                    { statusCode: 400, code: "INVALID_CRON_EXPRESSION" }
                );
            }
        }

        const enabledEntities = input.enabled_entities
            ? parseEnabledEntities(input.enabled_entities)
            : existing
              ? parseEnabledEntities(existing.enabled_entities)
              : [...DEFAULT_ENABLED_ENTITIES];

        let credentialsEncrypted = existing?.credentials_encrypted ?? null;
        if (input.credentials !== undefined && input.credentials !== null) {
            credentialsEncrypted = encryptCredentials(input.credentials);
        }

        const data: Prisma.BillingConnectorUncheckedCreateInput = {
            account_id: accountId,
            provider: input.provider ?? existing?.provider ?? "PRIORITY",
            base_url:
                input.base_url !== undefined
                    ? input.base_url
                    : (existing?.base_url ?? null),
            auth_type:
                input.auth_type ?? existing?.auth_type ?? "API_KEY",
            credentials_encrypted: credentialsEncrypted,
            sync_enabled:
                input.sync_enabled !== undefined
                    ? input.sync_enabled
                    : (existing?.sync_enabled ?? false),
            sync_cron_expression:
                resolvedCronExpression ??
                existing?.sync_cron_expression ??
                "0 */6 * * *",
            enabled_entities: enabledEntities,
            status: (() => {
                const syncOn =
                    input.sync_enabled ?? existing?.sync_enabled ?? false;
                if (!syncOn) {
                    return "Disabled" as const;
                }
                if (existing?.status === "Error") {
                    return "Error" as const;
                }
                return "Active" as const;
            })(),
            modified_by: userId,
            created_by: existing?.created_by ?? userId,
        };

        const auditLog = SettingsAuditLogService.getInstance();

        const connector = await prisma.$transaction(async (tx) => {
            const { account_id: _omit, ...updateFields } = data;
            const saved = existing
                ? await tx.billingConnector.update({
                      where: { account_id: accountId },
                      data: updateFields,
                  })
                : await tx.billingConnector.create({ data });

            await ensureSyncStateRows(tx, saved.id, enabledEntities);
            return saved;
        });

        const operation = existing ? "UPDATE" : "CREATE";
        const auditPayload = sanitizeForAudit({
            ...connector,
            credentials:
                input.credentials !== undefined ? input.credentials : undefined,
        });

        if (operation === "CREATE") {
            await auditLog.logCreate(
                "billing-connector",
                connector.id,
                userId,
                accountId,
                auditPayload
            );
        } else {
            await auditLog.logUpdate(
                "billing-connector",
                connector.id,
                userId,
                accountId,
                sanitizeForAudit(existing ?? {}),
                auditPayload
            );
        }

        return await toPublicConfig(connector);
    }

    async testConnection(
        accountId: number,
        overrides?: {
            base_url?: string;
            auth_type?: ConnectorAuthType;
            credentials?: Record<string, unknown>;
        }
    ): Promise<{ success: boolean; error?: string; tested_at: string }> {
        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });

        const baseUrl = overrides?.base_url ?? connector?.base_url;
        const authType =
            overrides?.auth_type ?? connector?.auth_type ?? "API_KEY";

        let credentials: Record<string, unknown> | undefined =
            overrides?.credentials;
        if (!credentials && connector?.credentials_encrypted) {
            credentials = decryptCredentials(connector.credentials_encrypted);
        }

        if (!baseUrl || !credentials) {
            throw new Error("Base URL and credentials are required");
        }

        const result = await testPriorityConnection({
            baseUrl,
            authType,
            credentials,
        });

        const updateData: Prisma.BillingConnectorUpdateInput = {
            last_connection_test_at: result.testedAt,
            last_connection_error: result.ok ? null : (result.error ?? "Failed"),
            consecutive_auth_failures: result.ok
                ? 0
                : { increment: 1 },
            status: result.ok
                ? "Active"
                : result.statusCode === 401 || result.statusCode === 403
                  ? "Error"
                  : connector?.status ?? "Disabled",
            modified_at: new Date(),
        };

        if (connector) {
            await prisma.billingConnector.update({
                where: { id: connector.id },
                data: updateData,
            });
        }

        return {
            success: result.ok,
            error: result.error,
            tested_at: result.testedAt.toISOString(),
        };
    }

    getRecommendedPollIntervalMinutes(): number {
        const perMinute = PRIORITY_RATE_LIMITS.callsPerMinutePerUser;
        return Math.max(30, Math.ceil(60 / perMinute) * 6);
    }
}

export const billingConnectorService = BillingConnectorService.getInstance();
