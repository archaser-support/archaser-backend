"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.billingConnectorService = exports.BillingConnectorService = void 0;
exports.validateSyncCronExpression = validateSyncCronExpression;
const cron_parser_1 = require("cron-parser");
const prisma_1 = require("@/lib/prisma");
const PriorityClient_1 = require("@/server/integrations/priority/PriorityClient");
const priorityApiContract_1 = require("@/server/integrations/priority/priorityApiContract");
const billingConnectorSchedule_1 = require("@/server/services/billingConnectorSchedule");
const ConnectorSyncExecutionService_1 = require("@/server/services/ConnectorSyncExecutionService");
const SettingsAuditLogService_1 = require("@/server/services/SettingsAuditLogService");
const billingConnectorCrypto_1 = require("@/server/utils/billingConnectorCrypto");
const DEFAULT_ENABLED_ENTITIES = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];
async function buildScheduleFields(connector) {
    const presetFields = (0, billingConnectorSchedule_1.cronToPreset)(connector.sync_cron_expression);
    const scheduleSummary = (0, billingConnectorSchedule_1.describeSchedule)(connector.sync_cron_expression);
    const scheduleWarning = buildScheduleWarning(connector.sync_cron_expression, connector.provider);
    const now = new Date();
    if (!connector.sync_enabled || connector.status !== "Active") {
        return {
            schedule_summary: scheduleSummary,
            next_scheduled_sync_at_utc: null,
            schedule_warning: scheduleWarning,
            ...presetFields,
        };
    }
    const lastScheduledIncrementalSuccessAt = await ConnectorSyncExecutionService_1.ConnectorSyncExecutionService.getLastScheduledIncrementalSuccessAt(connector.id);
    const nextAt = (0, billingConnectorSchedule_1.computeNextScheduledSyncAt)(connector.sync_cron_expression, lastScheduledIncrementalSuccessAt, now, connector.modified_at);
    return {
        schedule_summary: scheduleSummary,
        next_scheduled_sync_at_utc: nextAt ? nextAt.toISOString() : null,
        schedule_warning: scheduleWarning,
        ...presetFields,
    };
}
function buildScheduleWarning(cronExpression, provider) {
    const cronCheck = validateSyncCronExpression(cronExpression);
    if (!cronCheck.valid || cronCheck.minIntervalMinutes === undefined) {
        return null;
    }
    const recommended = BillingConnectorService.getInstance().getRecommendedPollIntervalMinutes();
    if (cronCheck.minIntervalMinutes < recommended) {
        const intervalMinutes = Math.round(cronCheck.minIntervalMinutes);
        return `Sync interval (${intervalMinutes} minutes) is more frequent than the recommended minimum (${recommended} minutes) for ${provider}.`;
    }
    return null;
}
function resolveSyncCronExpression(input, existing) {
    if (input.schedule_preset !== undefined) {
        if (input.schedule_preset === "custom") {
            if (!input.sync_cron_expression?.trim()) {
                throw Object.assign(new Error("sync_cron_expression is required for custom schedule"), { statusCode: 400, code: "INVALID_CRON_EXPRESSION" });
            }
            return input.sync_cron_expression.trim();
        }
        try {
            return (0, billingConnectorSchedule_1.presetToCron)(input.schedule_preset, {
                dailyTimeUtc: input.daily_time_utc,
                weeklyDay: input.weekly_day,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Invalid schedule preset";
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
async function toPublicConfig(connector) {
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
function sanitizeForAudit(connector) {
    const { credentials_encrypted, credentials, ...rest } = connector;
    return {
        ...rest,
        credentials_encrypted: credentials_encrypted ? "[REDACTED]" : null,
        credentials: credentials ? "[REDACTED]" : undefined,
    };
}
function validateSyncCronExpression(expression) {
    try {
        const interval = (0, cron_parser_1.parseExpression)(expression);
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
    }
    catch {
        return { valid: false, error: "Invalid cron expression" };
    }
}
function parseEnabledEntities(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
        return [...DEFAULT_ENABLED_ENTITIES];
    }
    const allowed = new Set(DEFAULT_ENABLED_ENTITIES);
    const filtered = raw.filter((item) => typeof item === "string" && allowed.has(item));
    return filtered.length > 0 ? filtered : [...DEFAULT_ENABLED_ENTITIES];
}
async function ensureSyncStateRows(tx, connectorId, enabledEntities) {
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
class BillingConnectorService {
    static getInstance() {
        if (!BillingConnectorService.instance) {
            BillingConnectorService.instance = new BillingConnectorService();
        }
        return BillingConnectorService.instance;
    }
    async getConfig(accountId) {
        const connector = await prisma_1.prisma.billingConnector.findUnique({
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
    async resetEntityBackfill(accountId, entityType, userId) {
        const connector = await prisma_1.prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            throw new Error("Billing connector is not configured");
        }
        await prisma_1.prisma.connectorSyncState.update({
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
        await prisma_1.prisma.billingConnector.update({
            where: { id: connector.id },
            data: {
                sync_mode: "BACKFILL",
                modified_by: userId,
            },
        });
    }
    async upsertConfig(accountId, input, userId) {
        if (!(0, billingConnectorCrypto_1.isBillingConnectorEncryptionConfigured)()) {
            throw new Error("BILLING_CONNECTOR_ENCRYPTION_KEY is not configured");
        }
        const existing = await prisma_1.prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        const resolvedCronExpression = resolveSyncCronExpression(input, existing);
        if (resolvedCronExpression !== undefined) {
            const cronCheck = validateSyncCronExpression(resolvedCronExpression);
            if (!cronCheck.valid) {
                throw Object.assign(new Error(cronCheck.error || "Invalid cron expression"), { statusCode: 400, code: "INVALID_CRON_EXPRESSION" });
            }
        }
        const enabledEntities = input.enabled_entities
            ? parseEnabledEntities(input.enabled_entities)
            : existing
                ? parseEnabledEntities(existing.enabled_entities)
                : [...DEFAULT_ENABLED_ENTITIES];
        let credentialsEncrypted = existing?.credentials_encrypted ?? null;
        if (input.credentials !== undefined && input.credentials !== null) {
            credentialsEncrypted = (0, billingConnectorCrypto_1.encryptCredentials)(input.credentials);
        }
        const data = {
            account_id: accountId,
            provider: input.provider ?? existing?.provider ?? "PRIORITY",
            base_url: input.base_url !== undefined
                ? input.base_url
                : (existing?.base_url ?? null),
            auth_type: input.auth_type ?? existing?.auth_type ?? "API_KEY",
            credentials_encrypted: credentialsEncrypted,
            sync_enabled: input.sync_enabled !== undefined
                ? input.sync_enabled
                : (existing?.sync_enabled ?? false),
            sync_cron_expression: resolvedCronExpression ??
                existing?.sync_cron_expression ??
                "0 */6 * * *",
            enabled_entities: enabledEntities,
            status: (() => {
                const syncOn = input.sync_enabled ?? existing?.sync_enabled ?? false;
                if (!syncOn) {
                    return "Disabled";
                }
                if (existing?.status === "Error") {
                    return "Error";
                }
                return "Active";
            })(),
            modified_by: userId,
            created_by: existing?.created_by ?? userId,
        };
        const auditLog = SettingsAuditLogService_1.SettingsAuditLogService.getInstance();
        const connector = await prisma_1.prisma.$transaction(async (tx) => {
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
            credentials: input.credentials !== undefined ? input.credentials : undefined,
        });
        if (operation === "CREATE") {
            await auditLog.logCreate("billing-connector", connector.id, userId, accountId, auditPayload);
        }
        else {
            await auditLog.logUpdate("billing-connector", connector.id, userId, accountId, sanitizeForAudit(existing ?? {}), auditPayload);
        }
        return await toPublicConfig(connector);
    }
    async testConnection(accountId, overrides) {
        const connector = await prisma_1.prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        const baseUrl = overrides?.base_url ?? connector?.base_url;
        const authType = overrides?.auth_type ?? connector?.auth_type ?? "API_KEY";
        let credentials = overrides?.credentials;
        if (!credentials && connector?.credentials_encrypted) {
            credentials = (0, billingConnectorCrypto_1.decryptCredentials)(connector.credentials_encrypted);
        }
        if (!baseUrl || !credentials) {
            throw new Error("Base URL and credentials are required");
        }
        const result = await (0, PriorityClient_1.testPriorityConnection)({
            baseUrl,
            authType,
            credentials,
        });
        const updateData = {
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
            await prisma_1.prisma.billingConnector.update({
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
    getRecommendedPollIntervalMinutes() {
        const perMinute = priorityApiContract_1.PRIORITY_RATE_LIMITS.callsPerMinutePerUser;
        return Math.max(30, Math.ceil(60 / perMinute) * 6);
    }
}
exports.BillingConnectorService = BillingConnectorService;
exports.billingConnectorService = BillingConnectorService.getInstance();
