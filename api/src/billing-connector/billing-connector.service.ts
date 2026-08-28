import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    HttpException,
    Injectable,
    Logger,
    NotFoundException,
} from "@nestjs/common";
import type { ImportType } from "@prisma/client";
import { randomUUID } from "crypto";
import { AccessScopeService } from "../auth/access-scope.service";
import { JwtPayload } from "../auth/auth.service";
import { serializeBigInt } from "../common/serialize-bigint";
import { DatabaseService } from "../database/database.service";
import {
    allEnabledEntitiesPreviewPassed,
    clearPreviewPass,
    clearPreviewPasses,
    computeMappingCompleteness,
    computeNextScheduledSyncAt,
    cronToPreset,
    parseStoredConnectorCredentials,
    describeSchedule,
    discoverConnectorFields,
    encryptCredentials,
    entitySetCatalogToPrismaJson,
    entitySetsToPrismaJson,
    fetchPriorityEntitySetCatalog,
    getDefaultEntitySets,
    getImportEntityFieldCatalog,
    getRunningSync,
    isBillingConnectorEncryptionConfigured,
    isPriorityEntityImportType,
    listChangedEntitySetEntities,
    listChangedPullFilterEntities,
    listSyncRuns,
    mergeEntitySetsPatch,
    mergePullFiltersPatch,
    parseEntitySetCatalog,
    parseEntitySetsMap,
    parseMappingRules,
    parsePreviewPassesMap,
    presetToCron,
    previewPassesToPrismaJson,
    pullFiltersToPrismaJson,
    registerRunningSync,
    requestConnectorSyncCancel,
    runInProcessSync,
    runPreviewSync,
    clearRunningSync,
    resolveExtensionAttachmentInput,
    toPublicPullFilters,
    upsertSyncRun,
    patchSyncRunEntityStats,
    createRunningExecution,
    completeExecution,
    markExecutionCancelled,
    listExecutionsForAccount,
    sweepStaleRunning,
    syncHistoryExecutionToSummary,
    type ConnectorSyncRunSummary,
    type EntitySetsMap,
    type PullFiltersMap,
} from "@archaser/billing-connector";
import {
    areBackfillOptionsLocked,
    formatBackfillStartDateForApi,
    resolveBackfillStartDateChange,
    resolveIncludeOlderOpenInvoicesChange,
    resolveSkipReportingBreachOnBackfillChange,
} from "./billing-connector-backfill-options";
import { recalculateCustomerAmounts } from "../customers/domain/recalculateCustomerAmounts";
import { runArPostIngestForCustomers } from "../credit-insurance/domain/arPostIngestOrchestrator";
import { enqueueRewriteForImport } from "../credit-insurance/domain/asOfRewriteQueue";
import { bindCreditInsurancePrisma } from "../credit-insurance/domain-db";

const ADMIN_ACCOUNT_ID = 10013;

const ENTITY_KEYS: ImportType[] = [
    "Customer",
    "Contact",
    "Invoice",
    "Payment",
];

function parseEnabledEntities(raw: unknown): ImportType[] {
    if (!Array.isArray(raw)) {
        return [...ENTITY_KEYS];
    }
    return raw.filter((value): value is ImportType => {
        return (
            typeof value === "string" &&
            isPriorityEntityImportType(value as ImportType)
        );
    });
}

function parseStringArray(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((item): item is string => typeof item === "string");
}

function parsePullDateField(raw: unknown): string | null {
    if (raw == null || raw === "") {
        return null;
    }
    const trimmed = String(raw).trim();
    if (!trimmed) {
        return null;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
        throw new BadRequestException({
            error: `Invalid date field "${trimmed}"`,
            code: "INVALID_PULL_DATE_FIELD",
        });
    }
    return trimmed;
}

function parseExampleValues(raw: unknown): Record<string, unknown> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return {};
    }
    return raw as Record<string, unknown>;
}

function rethrowCoded(error: unknown): never {
    const err = error as {
        statusCode?: number;
        message?: string;
        code?: string;
    };
    if (err?.statusCode) {
        throw new HttpException(
            { error: err.message, code: err.code },
            err.statusCode
        );
    }
    throw error;
}

@Injectable()
export class BillingConnectorApiService {
    private readonly logger = new Logger(BillingConnectorApiService.name);

    constructor(
        private readonly db: DatabaseService,
        private readonly accessScope: AccessScopeService
    ) {}

    async assertAccess(
        user: JwtPayload,
        accountId: number,
        permission: "view_billing_connector" | "manage_billing_connector"
    ) {
        const userInfo = await this.accessScope.resolveUserInfo(user);
        const effectiveAccount =
            this.accessScope.getEffectiveAccountId(userInfo);
        if (
            userInfo.accountId !== ADMIN_ACCOUNT_ID &&
            effectiveAccount !== accountId &&
            userInfo.accountId !== accountId
        ) {
            throw new ForbiddenException({ error: "Forbidden" });
        }
        const role = userInfo.viewAsUserRole || userInfo.role;
        const allowed = await this.accessScope.hasPermission(
            userInfo.accountId,
            role,
            permission
        );
        if (!allowed) {
            throw new ForbiddenException({ error: "Forbidden" });
        }
        return userInfo;
    }

    private async toPublicConfig(connector: {
        id: number;
        account_id: number;
        provider: string;
        status: string;
        base_url: string | null;
        auth_type: string;
        credentials_encrypted: string | null;
        sync_enabled: boolean;
        sync_cron_expression: string;
        sync_mode: string;
        enabled_entities: unknown;
        sync_overlap_minutes: number;
        consecutive_auth_failures: number;
        backfill_started_at?: Date | null;
        backfill_start_date?: Date | null;
        include_older_open_invoices?: boolean;
        skip_reporting_breach_on_backfill?: boolean;
        pull_filters?: unknown;
        entity_sets?: unknown;
        entity_set_catalog?: unknown;
        entity_set_catalog_fetched_at?: Date | null;
        preview_passes?: unknown;
        extension_key?: string | null;
        extension_config?: unknown;
        last_connection_test_at: Date | null;
        last_connection_error: string | null;
        created_at: Date;
        modified_at: Date;
        ConnectorSyncState?: Array<{
            entity_type: ImportType;
            backfill_completed: boolean;
            backfill_completed_at: Date | null;
            backfill_cursor: string | null;
            backfill_records_pulled: number;
            backfill_total_records: number | null;
            last_max_updated_at: Date | null;
            last_successful_run_at: Date | null;
            last_attempt_at: Date | null;
            last_error: string | null;
        }>;
    }) {
        const pullFilterFields = toPublicPullFilters(connector.pull_filters);
        const entitySets = parseEntitySetsMap(connector.entity_sets);
        const lastIncremental = (connector.ConnectorSyncState ?? [])
            .map((state) => state.last_successful_run_at)
            .filter((value): value is Date => value != null)
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
        const nextScheduled = computeNextScheduledSyncAt(
            connector.sync_cron_expression,
            lastIncremental,
            new Date(),
            connector.modified_at
        );
        const preset = cronToPreset(connector.sync_cron_expression);

        return {
            id: connector.id,
            account_id: connector.account_id,
            provider: connector.provider,
            status: connector.status,
            base_url: connector.base_url,
            auth_type: connector.auth_type,
            has_credentials: !!connector.credentials_encrypted,
            sync_enabled: connector.sync_enabled,
            sync_cron_expression: connector.sync_cron_expression,
            sync_mode: connector.sync_mode,
            enabled_entities: parseEnabledEntities(connector.enabled_entities),
            sync_overlap_minutes: connector.sync_overlap_minutes,
            consecutive_auth_failures: connector.consecutive_auth_failures,
            backfill_start_date: formatBackfillStartDateForApi(
                connector.backfill_start_date
            ),
            include_older_open_invoices:
                connector.include_older_open_invoices ?? true,
            skip_reporting_breach_on_backfill:
                connector.skip_reporting_breach_on_backfill ?? false,
            pull_filters: pullFilterFields.pull_filters,
            effective_pull_filters: pullFilterFields.effective_pull_filters,
            entity_sets: entitySets,
            entity_set_catalog: parseEntitySetCatalog(
                connector.entity_set_catalog
            ),
            entity_set_catalog_fetched_at:
                connector.entity_set_catalog_fetched_at?.toISOString() ?? null,
            default_entity_sets: getDefaultEntitySets(),
            backfill_options_locked: areBackfillOptionsLocked(
                connector.backfill_started_at
            ),
            extension_key: connector.extension_key ?? null,
            extension_config:
                connector.extension_config &&
                typeof connector.extension_config === "object" &&
                !Array.isArray(connector.extension_config)
                    ? (connector.extension_config as Record<string, unknown>)
                    : connector.extension_key
                      ? {}
                      : null,
            preview_passes: parsePreviewPassesMap(connector.preview_passes),
            last_connection_test_at:
                connector.last_connection_test_at?.toISOString() ?? null,
            last_connection_error: connector.last_connection_error,
            created_at: connector.created_at.toISOString(),
            modified_at: connector.modified_at.toISOString(),
            schedule_summary: describeSchedule(connector.sync_cron_expression),
            next_scheduled_sync_at_utc: nextScheduled?.toISOString() ?? null,
            schedule_preset: preset.schedule_preset,
            daily_time_utc: preset.daily_time_utc,
            weekly_day: preset.weekly_day,
            schedule_warning: null,
            sync_states: (connector.ConnectorSyncState ?? []).map((state) => ({
                entity_type: state.entity_type,
                backfill_completed: state.backfill_completed,
                backfill_completed_at:
                    state.backfill_completed_at?.toISOString() ?? null,
                backfill_cursor_present: !!state.backfill_cursor,
                backfill_records_pulled: state.backfill_records_pulled,
                backfill_total_records: state.backfill_total_records,
                last_max_updated_at:
                    state.last_max_updated_at?.toISOString() ?? null,
                last_successful_run_at:
                    state.last_successful_run_at?.toISOString() ?? null,
                last_attempt_at: state.last_attempt_at?.toISOString() ?? null,
                last_error: state.last_error,
            })),
        };
    }

    async getConfig(user: JwtPayload, accountId: number) {
        await this.assertAccess(user, accountId, "view_billing_connector");
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
            include: { ConnectorSyncState: true },
        });
        if (!connector) {
            return { config: null };
        }
        return serializeBigInt({
            config: await this.toPublicConfig(connector),
        });
    }

    async upsertConfig(
        user: JwtPayload,
        accountId: number,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.assertAccess(
            user,
            accountId,
            "manage_billing_connector"
        );
        if (body.provider === "SAP_BUSINESS_ONE") {
            throw new BadRequestException({
                error: "SAP Business One is not available yet",
                code: "PROVIDER_NOT_SUPPORTED",
            });
        }
        const actor = this.accessScope.getEffectiveUserId(userInfo);
        const existing = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });

        const data: Record<string, unknown> = {
            modified_by: actor,
            modified_at: new Date(),
        };
        if (body.provider != null) data.provider = body.provider;
        if (body.base_url !== undefined) data.base_url = body.base_url;
        if (body.auth_type != null) data.auth_type = body.auth_type;
        if (typeof body.sync_enabled === "boolean") {
            data.sync_enabled = body.sync_enabled;
        }
        if (typeof body.sync_cron_expression === "string") {
            data.sync_cron_expression = body.sync_cron_expression;
        }
        if (
            typeof body.schedule_preset === "string" &&
            body.schedule_preset !== "custom"
        ) {
            try {
                data.sync_cron_expression = presetToCron(
                    body.schedule_preset as
                        | "every_4h"
                        | "every_6h"
                        | "every_12h"
                        | "daily"
                        | "weekly",
                    {
                        dailyTimeUtc:
                            typeof body.daily_time_utc === "string"
                                ? body.daily_time_utc
                                : undefined,
                        weeklyDay:
                            typeof body.weekly_day === "number"
                                ? body.weekly_day
                                : undefined,
                    }
                );
            } catch (error) {
                throw new BadRequestException({
                    error:
                        error instanceof Error
                            ? error.message
                            : "Invalid schedule",
                    code: "INVALID_SCHEDULE",
                });
            }
        }
        if (Array.isArray(body.enabled_entities)) {
            data.enabled_entities = parseEnabledEntities(body.enabled_entities);
        }
        if (body.credentials && typeof body.credentials === "object") {
            if (!isBillingConnectorEncryptionConfigured()) {
                throw new BadRequestException({
                    error: "BILLING_CONNECTOR_ENCRYPTION_KEY is not configured",
                    code: "ENCRYPTION_NOT_CONFIGURED",
                });
            }
            data.credentials_encrypted = encryptCredentials(
                body.credentials as Record<string, unknown>
            );
        }

        let startDateChange;
        try {
            startDateChange = resolveBackfillStartDateChange({
                backfillStartedAt: existing?.backfill_started_at,
                existingStartDate: existing?.backfill_start_date,
                nextInput:
                    body.backfill_start_date === undefined
                        ? undefined
                        : (body.backfill_start_date as string | null),
            });
        } catch (error: unknown) {
            const err = error as { code?: string; message?: string };
            if (err?.code === "INVALID_BACKFILL_START_DATE") {
                throw new BadRequestException({
                    error: err.message ?? "Invalid backfill_start_date",
                    code: err.code,
                });
            }
            throw error;
        }
        if (!startDateChange.ok) {
            throw new ConflictException({
                error: startDateChange.message,
                code: startDateChange.code,
            });
        }
        const includeOlderChange = resolveIncludeOlderOpenInvoicesChange({
            backfillStartedAt: existing?.backfill_started_at,
            existingValue: existing?.include_older_open_invoices,
            nextInput:
                body.include_older_open_invoices === undefined
                    ? undefined
                    : Boolean(body.include_older_open_invoices),
        });
        if (!includeOlderChange.ok) {
            throw new ConflictException({
                error: includeOlderChange.message,
                code: includeOlderChange.code,
            });
        }
        const skipBreachChange = resolveSkipReportingBreachOnBackfillChange({
            backfillStartedAt: existing?.backfill_started_at,
            existingValue: existing?.skip_reporting_breach_on_backfill,
            nextInput:
                body.skip_reporting_breach_on_backfill === undefined
                    ? undefined
                    : Boolean(body.skip_reporting_breach_on_backfill),
        });
        if (!skipBreachChange.ok) {
            throw new ConflictException({
                error: skipBreachChange.message,
                code: skipBreachChange.code,
            });
        }
        if (startDateChange.value !== undefined) {
            data.backfill_start_date = startDateChange.value;
        }
        if (includeOlderChange.value !== undefined) {
            data.include_older_open_invoices = includeOlderChange.value;
        }
        if (skipBreachChange.value !== undefined) {
            data.skip_reporting_breach_on_backfill = skipBreachChange.value;
        }

        let extensionPatch;
        try {
            extensionPatch = resolveExtensionAttachmentInput({
                extension_key:
                    body.extension_key === undefined
                        ? undefined
                        : (body.extension_key as string | null),
                extension_config:
                    body.extension_config === undefined
                        ? undefined
                        : body.extension_config,
                existingKey: existing?.extension_key ?? null,
            });
        } catch (error: unknown) {
            const err = error as { code?: string; message?: string };
            if (
                err?.code === "UNKNOWN_EXTENSION_KEY" ||
                err?.code === "INVALID_EXTENSION_CONFIG" ||
                err?.code === "EXTENSION_KEY_REQUIRED"
            ) {
                throw new BadRequestException({
                    error: err.message ?? "Invalid extension attachment",
                    code: err.code,
                });
            }
            throw error;
        }
        if (extensionPatch) {
            if (extensionPatch.extension_key !== undefined) {
                data.extension_key = extensionPatch.extension_key;
            }
            if (extensionPatch.extension_config !== undefined) {
                data.extension_config = extensionPatch.extension_config;
            }
        }

        let nextEntitySets: EntitySetsMap | undefined;
        try {
            nextEntitySets =
                body.entity_sets !== undefined
                    ? mergeEntitySetsPatch(
                          existing?.entity_sets,
                          body.entity_sets as EntitySetsMap
                      )
                    : undefined;
        } catch (error) {
            rethrowCoded(error);
        }
        const nextPullFilters: PullFiltersMap | undefined =
            body.pull_filters !== undefined
                ? mergePullFiltersPatch(
                      existing?.pull_filters,
                      body.pull_filters as PullFiltersMap
                  )
                : undefined;

        const changedEntities: ImportType[] = [];
        if (nextEntitySets && existing) {
            changedEntities.push(
                ...listChangedEntitySetEntities({
                    existing: existing.entity_sets,
                    next: nextEntitySets,
                })
            );
            data.entity_sets = entitySetsToPrismaJson(nextEntitySets);
        }
        if (nextPullFilters && existing) {
            changedEntities.push(
                ...listChangedPullFilterEntities({
                    existing: existing.pull_filters,
                    next: nextPullFilters,
                })
            );
            data.pull_filters = pullFiltersToPrismaJson(nextPullFilters);
        }
        if (changedEntities.length > 0 && existing) {
            data.preview_passes = previewPassesToPrismaJson(
                clearPreviewPasses(existing.preview_passes, changedEntities)
            );
        }

        const connector = existing
            ? await this.db.billingConnector.update({
                  where: { account_id: accountId },
                  data,
                  include: { ConnectorSyncState: true },
              })
            : await this.db.billingConnector.create({
                  data: {
                      account_id: accountId,
                      created_by: actor,
                      include_older_open_invoices:
                          includeOlderChange.value !== undefined
                              ? includeOlderChange.value
                              : true,
                      skip_reporting_breach_on_backfill:
                          skipBreachChange.value !== undefined
                              ? skipBreachChange.value
                              : false,
                      ...(nextEntitySets
                          ? {
                                entity_sets:
                                    entitySetsToPrismaJson(nextEntitySets),
                            }
                          : {}),
                      ...(nextPullFilters
                          ? {
                                pull_filters:
                                    pullFiltersToPrismaJson(nextPullFilters),
                            }
                          : {}),
                      ...data,
                  },
                  include: { ConnectorSyncState: true },
              });
        return serializeBigInt({
            config: await this.toPublicConfig(connector),
        });
    }

    async testConnection(
        user: JwtPayload,
        accountId: number,
        body: Record<string, unknown>
    ) {
        await this.assertAccess(user, accountId, "manage_billing_connector");
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        const baseUrl =
            (typeof body.base_url === "string" ? body.base_url : null) ??
            connector?.base_url;
        const authType =
            (typeof body.auth_type === "string"
                ? body.auth_type
                : null) ??
            connector?.auth_type ??
            "API_KEY";
        let credentials: Record<string, unknown> | null = null;
        if (body.credentials && typeof body.credentials === "object") {
            credentials = body.credentials as Record<string, unknown>;
        } else if (connector?.credentials_encrypted) {
            try {
                credentials = parseStoredConnectorCredentials(
                    connector.credentials_encrypted
                );
            } catch (err) {
                throw new BadRequestException({
                    error:
                        err instanceof Error ? err.message : String(err),
                    code: "CREDENTIALS_UNREADABLE",
                });
            }
        }
        if (!baseUrl || !credentials) {
            throw new BadRequestException({
                error: "Missing base_url or credentials",
                code: "CONNECTOR_NOT_CONFIGURED",
            });
        }
        const { testBillingConnectorConnection } = await import(
            "@archaser/billing-connector"
        );
        const result = await testBillingConnectorConnection({
            provider: (connector?.provider ?? "PRIORITY") as string,
            authType: authType as
                | "API_KEY"
                | "BASIC"
                | "OAUTH2_CLIENT_CREDENTIALS",
            baseUrl,
            credentials,
        });
        if (connector) {
            await this.db.billingConnector.update({
                where: { id: connector.id },
                data: {
                    last_connection_test_at: result.testedAt,
                    last_connection_error: result.ok
                        ? null
                        : result.error ?? "Connection failed",
                    modified_at: new Date(),
                },
            });
        }
        return {
            success: result.ok,
            ok: result.ok,
            error: result.error,
            tested_at: result.testedAt.toISOString(),
        };
    }

    async runSync(
        user: JwtPayload,
        accountId: number,
        modeRaw: string | undefined,
        importTypeRaw?: string
    ) {
        const userInfo = await this.assertAccess(
            user,
            accountId,
            "manage_billing_connector"
        );
        const mode = String(modeRaw ?? "").toLowerCase();
        const actor = this.accessScope.getEffectiveUserId(userInfo);

        if (mode === "preview") {
            const importType =
                typeof importTypeRaw === "string" && importTypeRaw.trim()
                    ? (importTypeRaw.trim() as ImportType)
                    : undefined;
            try {
                const result = await runPreviewSync({
                    prisma: this.db,
                    accountId,
                    importType,
                });
                return { result };
            } catch (error) {
                rethrowCoded(error);
            }
        }

        if (!["backfill", "incremental"].includes(mode)) {
            throw new BadRequestException({
                error: "mode must be preview, backfill, or incremental",
                code: "INVALID_SYNC_MODE",
            });
        }

        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            throw new NotFoundException({
                error: "Billing connector not configured",
            });
        }

        const previewBypassed =
            areBackfillOptionsLocked(connector.backfill_started_at) ||
            connector.sync_mode === "INCREMENTAL";
        if (
            mode === "backfill" &&
            !previewBypassed &&
            !allEnabledEntitiesPreviewPassed(
                parseEnabledEntities(connector.enabled_entities),
                connector.preview_passes
            )
        ) {
            throw new BadRequestException({
                error: "Preview every enabled entity before the first backfill",
                code: "PREVIEW_REQUIRED",
            });
        }

        if (getRunningSync(accountId)) {
            throw new ConflictException({
                error: "A sync is already running for this account",
                code: "SYNC_IN_PROGRESS",
            });
        }

        const executionId = randomUUID();
        const startedAt = new Date();
        const syncMode = mode === "backfill" ? "BACKFILL" : "INCREMENTAL";
        const trigger = mode === "backfill" ? "backfill" : "manual";
        const runningSummary: ConnectorSyncRunSummary = {
            id: executionId,
            trigger,
            sync_mode: syncMode,
            status: "RUNNING",
            started_at: startedAt.toISOString(),
            completed_at: null,
            duration_seconds: null,
            entity_stats: {},
            error_message: null,
            error_type: null,
            cutover_options: {
                backfill_start_date: formatBackfillStartDateForApi(
                    connector.backfill_start_date
                ),
                include_older_open_invoices:
                    connector.include_older_open_invoices ?? true,
                skip_reporting_breach_on_backfill:
                    connector.skip_reporting_breach_on_backfill ?? false,
            },
            cutover_summary: null,
        };
        registerRunningSync({
            accountId,
            executionId,
            startedAt,
            mode: mode as "backfill" | "incremental",
            trigger,
        });
        upsertSyncRun(accountId, runningSummary);
        try {
            await createRunningExecution({
                executionId,
                accountId,
                connectorId: connector.id,
                provider: connector.provider,
                trigger: trigger as "backfill" | "manual",
                syncMode,
                startedAt,
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.logger.error(
                `[account ${accountId}] Failed to create sync history stub ${executionId}: ${message}`
            );
        }
        const onLog = (message: string) => {
            this.logger.log(`[account ${accountId}] ${message}`);
        };
        onLog(`Starting ${mode} (execution ${executionId})`);

        void this.runAcceptedSync({
            accountId,
            actor,
            executionId,
            mode: mode as "backfill" | "incremental",
            trigger,
            syncMode,
            runningSummary,
            onLog,
        });

        return {
            result: {
                ok: true,
                accepted: true,
                execution_id: executionId,
                status: "RUNNING",
                sync_mode: syncMode,
                trigger,
            },
        };
    }

    private async runAcceptedSync(params: {
        accountId: number;
        actor: string | undefined;
        executionId: string;
        mode: "backfill" | "incremental";
        trigger: string;
        syncMode: string;
        runningSummary: ConnectorSyncRunSummary;
        onLog: (message: string) => void;
    }) {
        const {
            accountId,
            actor,
            executionId,
            mode,
            trigger,
            runningSummary,
            onLog,
        } = params;
        try {
            const result = await runInProcessSync({
                prisma: this.db,
                accountId,
                trigger,
                userId: actor,
                executionId,
                mode,
                onLog,
                onProgress: (entityStats) => {
                    patchSyncRunEntityStats(
                        accountId,
                        executionId,
                        entityStats,
                        runningSummary
                    );
                },
                onCustomerBalancesFinal: async (customerIds) => {
                    await recalculateCustomerAmounts(customerIds, this.db);
                },
                onArPostIngest: async (input) => {
                    bindCreditInsurancePrisma(this.db);
                    let skipped = false;
                    let thrown: unknown;
                    try {
                        const result = await runArPostIngestForCustomers({
                            accountId: input.accountId,
                            customerIds: input.customerIds,
                            runReplay: input.runReplay === true,
                            runMaturity: input.runMaturity === true,
                            ...(input.runProcessOverdue !== undefined
                                ? {
                                      runProcessOverdue:
                                          input.runProcessOverdue,
                                  }
                                : {}),
                            runLiveRefresh: input.runLiveRefresh === true,
                            enqueueAsOfRewrite:
                                input.enqueueAsOfRewrite === true,
                            dryRun: input.dryRun === true,
                            asOfRewrite: input.asOfRewrite,
                        });
                        skipped = result.skipped;
                    } catch (error) {
                        skipped = true;
                        thrown = error;
                        const message =
                            error instanceof Error
                                ? error.message
                                : String(error);
                        this.logger.error(
                            `[account ${accountId}] AR post-ingest failed: ${message}`
                        );
                    }
                    // Collection-only / unexpected throw: still enqueue as-of
                    // (same as file import complete). Overdue already ran for
                    // non-CI when the orchestrator returned skipped.
                    if (
                        skipped &&
                        input.enqueueAsOfRewrite &&
                        input.asOfRewrite
                    ) {
                        try {
                            await enqueueRewriteForImport({
                                accountId: input.accountId,
                                importType: input.asOfRewrite.importType,
                                entityIds: input.asOfRewrite.entityIds,
                                customerIds: input.customerIds,
                            });
                        } catch {
                            // Best-effort; do not fail sync for as-of enqueue.
                        }
                    }
                    if (thrown) {
                        throw thrown;
                    }
                },
            });
            const completedAt = new Date();
            const status = result.cancelled
                ? "TIMEOUT"
                : result.ok
                  ? "SUCCESS"
                  : "FAILED";
            const errorType = result.cancelled
                ? "cancelled"
                : result.error ?? null;
            onLog(
                `Finished ${mode}: ${status}${
                    result.error ? ` — ${result.error}` : ""
                }`
            );
            upsertSyncRun(accountId, {
                ...runningSummary,
                status,
                completed_at: completedAt.toISOString(),
                duration_seconds: Math.max(
                    1,
                    Math.round(
                        (completedAt.getTime() -
                            new Date(runningSummary.started_at).getTime()) /
                            1000
                    )
                ),
                entity_stats: result.entity_stats ?? {},
                error_message: result.error ?? null,
                error_type: errorType,
            });
            try {
                await completeExecution(executionId, {
                    status,
                    entityStats: result.entity_stats ?? {},
                    errorMessage: result.error ?? null,
                    errorType,
                    completedAt,
                });
            } catch (historyError) {
                const historyMessage =
                    historyError instanceof Error
                        ? historyError.message
                        : String(historyError);
                this.logger.error(
                    `[account ${accountId}] Failed to complete sync history ${executionId}: ${historyMessage}`
                );
            }
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.logger.error(
                `[account ${accountId}] ${mode} crashed: ${message}`
            );
            const completedAt = new Date();
            upsertSyncRun(accountId, {
                ...runningSummary,
                status: "FAILED",
                completed_at: completedAt.toISOString(),
                duration_seconds: Math.max(
                    1,
                    Math.round(
                        (completedAt.getTime() -
                            new Date(runningSummary.started_at).getTime()) /
                            1000
                    )
                ),
                error_message: message,
                error_type: "unexpected",
            });
            try {
                await completeExecution(executionId, {
                    status: "FAILED",
                    errorMessage: message,
                    errorType: "unexpected",
                    completedAt,
                });
            } catch (historyError) {
                const historyMessage =
                    historyError instanceof Error
                        ? historyError.message
                        : String(historyError);
                this.logger.error(
                    `[account ${accountId}] Failed to complete sync history ${executionId}: ${historyMessage}`
                );
            }
        } finally {
            clearRunningSync(accountId);
        }
    }

    async cancelSync(user: JwtPayload, accountId: number) {
        await this.assertAccess(user, accountId, "manage_billing_connector");
        const running = getRunningSync(accountId);
        if (!running) {
            return { result: { cancelled: false, execution_id: null } };
        }
        requestConnectorSyncCancel(running.executionId);
        const existing = listSyncRuns(accountId).find(
            (run: ConnectorSyncRunSummary) => run.id === running.executionId
        );
        if (existing) {
            upsertSyncRun(accountId, {
                ...existing,
                status: "TIMEOUT",
                error_message: "Sync stopped by operator",
                error_type: "cancelled",
            });
        }
        try {
            await markExecutionCancelled(running.executionId, {
                errorMessage: "Sync stopped by operator",
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.logger.error(
                `[account ${accountId}] Failed to mark sync history cancelled ${running.executionId}: ${message}`
            );
        }
        return {
            result: { cancelled: true, execution_id: running.executionId },
        };
    }

    async listSyncRuns(user: JwtPayload, accountId: number, limitRaw?: string) {
        await this.assertAccess(user, accountId, "view_billing_connector");
        const limit = Number.parseInt(String(limitRaw ?? "25"), 10);
        return { runs: listSyncRuns(accountId, Number.isFinite(limit) ? limit : 25) };
    }

    async listSyncHistory(user: JwtPayload, accountId: number) {
        await this.assertAccess(user, accountId, "view_billing_connector");
        try {
            await sweepStaleRunning({ accountId, olderThanHours: 2 });
            const docs = await listExecutionsForAccount(accountId);
            return {
                runs: docs.map(syncHistoryExecutionToSummary),
            };
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            this.logger.error(
                `[account ${accountId}] Failed to list sync history: ${message}`
            );
            throw error;
        }
    }

    async resetBackfill(
        user: JwtPayload,
        accountId: number,
        body: Record<string, unknown>
    ) {
        await this.assertAccess(user, accountId, "manage_billing_connector");
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            throw new NotFoundException({
                error: "Billing connector not configured",
            });
        }
        const running = getRunningSync(accountId);
        if (running) {
            requestConnectorSyncCancel(running.executionId);
        }

        const entityType =
            typeof body.entity_type === "string" ? body.entity_type : null;
        if (
            entityType &&
            isPriorityEntityImportType(entityType as ImportType)
        ) {
            const typedEntity = entityType as ImportType;
            await this.db.connectorSyncState.updateMany({
                where: {
                    connector_id: connector.id,
                    entity_type: typedEntity,
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
            await this.db.billingConnector.update({
                where: { id: connector.id },
                data: {
                    preview_passes: previewPassesToPrismaJson(
                        clearPreviewPass(connector.preview_passes, typedEntity)
                    ),
                    modified_at: new Date(),
                },
            });
            return { ok: true, reset: true, entity_type: typedEntity };
        }

        await this.db.connectorSyncState.updateMany({
            where: { connector_id: connector.id },
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
        await this.db.billingConnector.update({
            where: { id: connector.id },
            data: {
                sync_mode: "BACKFILL",
                backfill_started_at: null,
                preview_passes: previewPassesToPrismaJson({}),
                modified_at: new Date(),
            },
        });
        return { ok: true, reset: true };
    }

    async getEntitySets(user: JwtPayload, accountId: number) {
        await this.assertAccess(user, accountId, "view_billing_connector");
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        return {
            entity_set_catalog: parseEntitySetCatalog(
                connector?.entity_set_catalog
            ),
            entity_set_catalog_fetched_at:
                connector?.entity_set_catalog_fetched_at?.toISOString() ?? null,
            entity_sets: parseEntitySetsMap(connector?.entity_sets),
            default_entity_sets: getDefaultEntitySets(),
        };
    }

    async refreshEntitySets(user: JwtPayload, accountId: number) {
        const userInfo = await this.assertAccess(
            user,
            accountId,
            "manage_billing_connector"
        );
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector?.base_url || !connector.credentials_encrypted) {
            throw new BadRequestException({
                error: "Billing connector is not configured",
                code: "CONNECTOR_NOT_CONFIGURED",
            });
        }
        const result = await fetchPriorityEntitySetCatalog({
            baseUrl: connector.base_url,
            authType: connector.auth_type,
            credentials: parseStoredConnectorCredentials(
                connector.credentials_encrypted
            ),
        });
        if (!result.ok) {
            throw new HttpException(
                {
                    error: result.error ?? "Failed to fetch Priority tables",
                    code:
                        result.statusCode === 401
                            ? "PRIORITY_AUTH_FAILED"
                            : "PRIORITY_METADATA_FAILED",
                },
                result.statusCode === 401 ? 400 : 502
            );
        }
        const fetchedAt = new Date();
        await this.db.billingConnector.update({
            where: { id: connector.id },
            data: {
                entity_set_catalog: entitySetCatalogToPrismaJson(result.names),
                entity_set_catalog_fetched_at: fetchedAt,
                modified_by: this.accessScope.getEffectiveUserId(userInfo),
                modified_at: fetchedAt,
            },
        });
        return {
            entity_set_catalog: result.names,
            entity_set_catalog_fetched_at: fetchedAt.toISOString(),
        };
    }

    private parseImportType(raw: string): ImportType {
        if (!isPriorityEntityImportType(raw as ImportType)) {
            throw new BadRequestException({
                error: "Invalid import type",
                code: "INVALID_IMPORT_TYPE",
            });
        }
        return raw as ImportType;
    }

    async getMapping(user: JwtPayload, accountId: number, importTypeRaw: string) {
        await this.assertAccess(user, accountId, "view_billing_connector");
        const importType = this.parseImportType(importTypeRaw);
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
            include: {
                ConnectorFieldMapping: { where: { import_type: importType } },
            },
        });
        if (!connector) {
            return { mapping: null };
        }
        const row = connector.ConnectorFieldMapping[0];
        if (!row) {
            return {
                mapping: {
                    import_type: importType,
                    mapping: [],
                    is_complete: false,
                    modified_at: null,
                    modified_by: null,
                    discovered_headers: [],
                    discovered_example_values: {},
                    discovered_sample_count: null,
                    discovered_at: null,
                    pull_date_field: null,
                },
            };
        }
        const rules = parseMappingRules(row.mapping);
        return serializeBigInt({
            mapping: {
                import_type: row.import_type,
                mapping: rules,
                is_complete: row.is_complete,
                modified_at: row.modified_at.toISOString(),
                modified_by: row.modified_by,
                discovered_headers: parseStringArray(row.discovered_headers),
                discovered_example_values: parseExampleValues(
                    row.discovered_example_values
                ),
                discovered_sample_count: row.discovered_sample_count,
                discovered_at: row.discovered_at?.toISOString() ?? null,
                pull_date_field: row.pull_date_field ?? null,
            },
        });
    }

    async putMapping(
        user: JwtPayload,
        accountId: number,
        importTypeRaw: string,
        body: Record<string, unknown>
    ) {
        const userInfo = await this.assertAccess(
            user,
            accountId,
            "manage_billing_connector"
        );
        const importType = this.parseImportType(importTypeRaw);
        const catalog = getImportEntityFieldCatalog(importType);
        if (!catalog) {
            throw new BadRequestException({
                error: "Invalid import type",
                code: "INVALID_IMPORT_TYPE",
            });
        }
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
        });
        if (!connector) {
            throw new NotFoundException({
                error: "Billing connector not configured",
            });
        }
        const rules = parseMappingRules(body.mapping ?? body);
        const allowed = new Set(catalog.fields);
        for (const rule of rules) {
            if (!allowed.has(rule.archaserField)) {
                throw new BadRequestException({
                    error: `Unknown Archaser field: ${rule.archaserField}`,
                    code: "INVALID_MAPPING_FIELD",
                });
            }
        }
        const isComplete = computeMappingCompleteness(importType, rules);
        const actor = this.accessScope.getEffectiveUserId(userInfo);
        const pullDateField =
            body.pull_date_field !== undefined
                ? parsePullDateField(body.pull_date_field)
                : undefined;
        const row = await this.db.connectorFieldMapping.upsert({
            where: {
                connector_id_import_type: {
                    connector_id: connector.id,
                    import_type: importType,
                },
            },
            create: {
                connector_id: connector.id,
                import_type: importType,
                mapping: rules as never,
                is_complete: isComplete,
                modified_by: actor,
                ...(pullDateField !== undefined
                    ? { pull_date_field: pullDateField }
                    : {}),
            },
            update: {
                mapping: rules as never,
                is_complete: isComplete,
                modified_by: actor,
                modified_at: new Date(),
                ...(pullDateField !== undefined
                    ? { pull_date_field: pullDateField }
                    : {}),
            },
        });
        await this.db.billingConnector.update({
            where: { id: connector.id },
            data: {
                preview_passes: previewPassesToPrismaJson(
                    clearPreviewPass(connector.preview_passes, importType)
                ),
                modified_at: new Date(),
            },
        });
        return serializeBigInt({
            mapping: {
                import_type: row.import_type,
                mapping: rules,
                is_complete: row.is_complete,
                modified_at: row.modified_at.toISOString(),
                modified_by: row.modified_by,
                discovered_headers: parseStringArray(row.discovered_headers),
                discovered_example_values: parseExampleValues(
                    row.discovered_example_values
                ),
                discovered_sample_count: row.discovered_sample_count,
                discovered_at: row.discovered_at?.toISOString() ?? null,
                pull_date_field: row.pull_date_field ?? null,
            },
        });
    }

    async getDiscoveredFields(
        user: JwtPayload,
        accountId: number,
        importTypeRaw: string
    ) {
        await this.assertAccess(user, accountId, "view_billing_connector");
        const importType = this.parseImportType(importTypeRaw);
        const catalog = getImportEntityFieldCatalog(importType);
        const empty = {
            import_type: importType,
            raw_headers: [] as string[],
            example_values: {} as Record<string, unknown>,
            sample_count: 0,
            discovered_at: null as string | null,
            archaser_fields: [...(catalog?.fields ?? [])],
            required_fields: [...(catalog?.requiredFields ?? [])],
            highlighted_fields: [...(catalog?.highlightedFields ?? [])],
        };
        const connector = await this.db.billingConnector.findUnique({
            where: { account_id: accountId },
            include: {
                ConnectorFieldMapping: { where: { import_type: importType } },
            },
        });
        const row = connector?.ConnectorFieldMapping[0];
        if (!row) {
            return empty;
        }
        return {
            ...empty,
            raw_headers: parseStringArray(row.discovered_headers),
            example_values: parseExampleValues(row.discovered_example_values),
            sample_count: row.discovered_sample_count ?? 0,
            discovered_at: row.discovered_at?.toISOString() ?? null,
        };
    }

    async discoverFields(
        user: JwtPayload,
        accountId: number,
        importTypeRaw: string
    ) {
        const userInfo = await this.assertAccess(
            user,
            accountId,
            "manage_billing_connector"
        );
        const importType = this.parseImportType(importTypeRaw);
        try {
            return await discoverConnectorFields({
                prisma: this.db,
                accountId,
                importType,
                userId: this.accessScope.getEffectiveUserId(userInfo),
            });
        } catch (error) {
            rethrowCoded(error);
        }
    }
}
