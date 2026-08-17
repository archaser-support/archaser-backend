import type { PrismaClient } from "@prisma/client";
import { PriorityProviderClient } from "../priority/PriorityProviderClient";
import { testPriorityConnection } from "../priority/PriorityClient";
import { assertPriorityProvider } from "../provider";
import { parseStoredConnectorCredentials } from "../utils/billingConnectorCrypto";
import {
    extractMaxUpdatedAt,
    importMappedEntityBatch,
    updateAccountLastSyncDate,
    type ImportEntityType,
} from "../import/entityImporter";
import { parseEntitySetsMap } from "../services/billingConnectorEntitySets";
import { resolveEntityPullFilterOData } from "../services/billingConnectorPullFilters";
import { isConnectorSyncCancelRequested } from "./connectorSyncCancelRegistry";

export class ConnectorSyncCancelledError extends Error {
    constructor(executionId: string) {
        super(`Sync cancelled (${executionId})`);
        this.name = "ConnectorSyncCancelledError";
    }
}

export interface RunInProcessSyncOptions {
    prisma: PrismaClient;
    accountId: number;
    trigger?: string;
    userId?: string;
    executionId?: string;
    mode?: "backfill" | "incremental";
    importTypes?: ImportEntityType[];
}

export interface RunInProcessSyncResult {
    ok: boolean;
    accountId: number;
    provider: string;
    cancelled?: boolean;
    executionId?: string;
    stats: {
        customersProcessed: number;
        contactsProcessed: number;
        invoicesProcessed: number;
        paymentsProcessed: number;
        customersImported: number;
        contactsImported: number;
        invoicesImported: number;
        paymentsImported: number;
        importErrors: number;
    };
    entity_stats: Record<
        string,
        { pulled: number; success: number; failed: number; skipped: number }
    >;
    message: string;
    error?: string;
}

/** Matches staging BillingConnectorSyncService backfill walk order. */
const ENTITY_ORDER: ImportEntityType[] = [
    "Customer",
    "Invoice",
    "Payment",
    "Contact",
];

function emptyStats() {
    return {
        customersProcessed: 0,
        contactsProcessed: 0,
        invoicesProcessed: 0,
        paymentsProcessed: 0,
        customersImported: 0,
        contactsImported: 0,
        invoicesImported: 0,
        paymentsImported: 0,
        importErrors: 0,
    };
}

function throwIfCancelled(executionId?: string): void {
    if (executionId && isConnectorSyncCancelRequested(executionId)) {
        throw new ConnectorSyncCancelledError(executionId);
    }
}

/**
 * In-process Priority sync for main API / worker (D71).
 * Pulls mapped entities, maps ERP fields, upserts into Postgres.
 * Manual backfill/incremental checks the in-process cancel registry between entities.
 */
export async function runInProcessSync(
    options: RunInProcessSyncOptions
): Promise<RunInProcessSyncResult> {
    const {
        prisma,
        accountId,
        trigger = "manual",
        userId,
        executionId,
        mode,
    } = options;
    const stats = emptyStats();
    const entity_stats: RunInProcessSyncResult["entity_stats"] = {};

    try {
        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });

        if (!connector) {
            return {
                ok: false,
                accountId,
                provider: "UNKNOWN",
                executionId,
                stats,
                entity_stats,
                message: "No billing connector configured for this account",
                error: "CONNECTOR_NOT_FOUND",
            };
        }

        try {
            assertPriorityProvider(connector.provider);
        } catch (err) {
            return {
                ok: false,
                accountId,
                provider: connector.provider,
                executionId,
                stats,
                entity_stats,
                message: `Provider ${connector.provider} is not supported`,
                error:
                    err instanceof Error ? err.message : "UNSUPPORTED_PROVIDER",
            };
        }

        if (!connector.credentials_encrypted || !connector.base_url) {
            return {
                ok: false,
                accountId,
                provider: connector.provider,
                executionId,
                stats,
                entity_stats,
                message: "Missing base_url or credentials",
                error: "MISSING_CREDENTIALS",
            };
        }

        let credentials: Record<string, unknown>;
        try {
            credentials = parseStoredConnectorCredentials(
                connector.credentials_encrypted
            );
        } catch (err) {
            return {
                ok: false,
                accountId,
                provider: connector.provider,
                executionId,
                stats,
                entity_stats,
                message: "Failed to decrypt credentials",
                error: err instanceof Error ? err.message : "DECRYPTION_FAILED",
            };
        }

        const connectionResult = await testPriorityConnection({
            baseUrl: connector.base_url,
            authType: connector.auth_type,
            credentials,
        });

        await prisma.billingConnector.update({
            where: { id: connector.id },
            data: {
                last_connection_test_at: connectionResult.testedAt,
                last_connection_error: connectionResult.ok
                    ? null
                    : connectionResult.error ?? null,
            },
        });

        if (!connectionResult.ok) {
            return {
                ok: false,
                accountId,
                provider: connector.provider,
                executionId,
                stats,
                entity_stats,
                message: "Connection test failed",
                error: connectionResult.error,
            };
        }

        const client = new PriorityProviderClient({
            baseUrl: connector.base_url,
            authType: connector.auth_type,
            credentials,
        });

        const mappings = await prisma.connectorFieldMapping.findMany({
            where: { connector_id: connector.id },
        });
        const mappingByType = new Map(
            mappings.map((m) => [String(m.import_type), m])
        );
        const entitySets = parseEntitySetsMap(connector.entity_sets);
        const enabled = Array.isArray(connector.enabled_entities)
            ? (connector.enabled_entities as string[])
            : ENTITY_ORDER;
        const requested = options.importTypes
            ? new Set(options.importTypes)
            : null;
        const effectiveMode =
            mode ??
            (connector.sync_mode === "INCREMENTAL"
                ? "incremental"
                : "backfill");

        if (effectiveMode === "backfill" && !connector.backfill_started_at) {
            await prisma.billingConnector.update({
                where: { id: connector.id },
                data: { backfill_started_at: new Date() },
            });
        }

        for (const entityType of ENTITY_ORDER) {
            throwIfCancelled(executionId);
            if (requested && !requested.has(entityType)) {
                continue;
            }
            if (!enabled.includes(entityType)) {
                continue;
            }
            const mapping = mappingByType.get(entityType);
            if (!mapping) continue;

            const entityStat = {
                pulled: 0,
                success: 0,
                failed: 0,
                skipped: 0,
            };
            entity_stats[entityType] = entityStat;

            try {
                throwIfCancelled(executionId);
                const syncState = await prisma.connectorSyncState.findFirst({
                    where: {
                        connector_id: connector.id,
                        entity_type: entityType,
                    },
                });

                const pullResult = await client.pull(entityType, {
                    since:
                        effectiveMode === "incremental"
                            ? syncState?.last_max_updated_at ?? null
                            : null,
                    pageSize: 100,
                    entitySet: entitySets[entityType] ?? null,
                    filter: resolveEntityPullFilterOData(
                        connector.pull_filters,
                        entityType
                    ),
                });

                throwIfCancelled(executionId);

                const processedKey =
                    `${entityType.toLowerCase()}sProcessed` as keyof typeof stats;
                const importedKey =
                    `${entityType.toLowerCase()}sImported` as keyof typeof stats;
                (stats as Record<string, number>)[processedKey] =
                    pullResult.records.length;
                entityStat.pulled = pullResult.records.length;

                const importResult = await importMappedEntityBatch(
                    prisma,
                    entityType,
                    pullResult.records as Record<string, unknown>[],
                    accountId,
                    mapping.mapping,
                    userId
                );
                (stats as Record<string, number>)[importedKey] =
                    importResult.success;
                stats.importErrors += importResult.failed;
                entityStat.success = importResult.success;
                entityStat.failed = importResult.failed;

                const maxUpdated =
                    extractMaxUpdatedAt(
                        pullResult.records as Record<string, unknown>[]
                    ) ?? new Date();

                const now = new Date();
                await prisma.connectorSyncState.upsert({
                    where: {
                        connector_id_entity_type: {
                            connector_id: connector.id,
                            entity_type: entityType,
                        },
                    },
                    create: {
                        connector_id: connector.id,
                        entity_type: entityType,
                        last_successful_run_at: now,
                        last_attempt_at: now,
                        last_max_updated_at: maxUpdated,
                        backfill_records_pulled: pullResult.records.length,
                        backfill_completed: effectiveMode === "backfill",
                        backfill_completed_at:
                            effectiveMode === "backfill" ? now : null,
                        last_error:
                            importResult.failed > 0
                                ? importResult.errors.slice(0, 3).join("; ")
                                : null,
                    },
                    update: {
                        last_successful_run_at: now,
                        last_attempt_at: now,
                        last_max_updated_at: maxUpdated,
                        backfill_records_pulled: pullResult.records.length,
                        ...(effectiveMode === "backfill"
                            ? {
                                  backfill_completed: true,
                                  backfill_completed_at: now,
                              }
                            : {}),
                        last_error:
                            importResult.failed > 0
                                ? importResult.errors.slice(0, 3).join("; ")
                                : null,
                    },
                });
            } catch (err) {
                if (err instanceof ConnectorSyncCancelledError) {
                    throw err;
                }
                const message =
                    err instanceof Error ? err.message : "Unknown error";
                stats.importErrors += 1;
                entityStat.failed += 1;
                await prisma.connectorSyncState.upsert({
                    where: {
                        connector_id_entity_type: {
                            connector_id: connector.id,
                            entity_type: entityType,
                        },
                    },
                    create: {
                        connector_id: connector.id,
                        entity_type: entityType,
                        last_error: `${entityType} sync failed: ${message}`,
                        last_attempt_at: new Date(),
                    },
                    update: {
                        last_error: `${entityType} sync failed: ${message}`,
                        last_attempt_at: new Date(),
                    },
                });
            }
        }

        await updateAccountLastSyncDate(prisma, accountId);

        const imported =
            stats.customersImported +
            stats.contactsImported +
            stats.invoicesImported +
            stats.paymentsImported;

        if (effectiveMode === "backfill") {
            await prisma.billingConnector.update({
                where: { id: connector.id },
                data: { sync_mode: "INCREMENTAL" },
            });
        }

        return {
            ok: stats.importErrors === 0,
            accountId,
            provider: connector.provider,
            executionId,
            stats,
            entity_stats,
            message: `Synced via ${trigger}: imported ${imported} rows (${stats.importErrors} errors)`,
            error:
                stats.importErrors > 0
                    ? `${stats.importErrors} import error(s)`
                    : undefined,
        };
    } catch (err) {
        if (err instanceof ConnectorSyncCancelledError) {
            return {
                ok: false,
                cancelled: true,
                accountId,
                provider: "UNKNOWN",
                executionId,
                stats,
                entity_stats,
                message: "Sync stopped by operator",
                error: "cancelled",
            };
        }
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
            ok: false,
            accountId,
            provider: "UNKNOWN",
            executionId,
            stats,
            entity_stats,
            message: "Sync failed with unexpected error",
            error: message,
        };
    }
}
