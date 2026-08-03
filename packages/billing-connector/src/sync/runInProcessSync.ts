import type { PrismaClient } from "@prisma/client";
import { PriorityProviderClient } from "../priority/PriorityProviderClient";
import { testPriorityConnection } from "../priority/PriorityClient";
import { assertPriorityProvider } from "../provider";
import { decryptCredentials } from "../utils/billingConnectorCrypto";
import {
    extractMaxUpdatedAt,
    importMappedEntityBatch,
    updateAccountLastSyncDate,
    type ImportEntityType,
} from "../import/entityImporter";

export interface RunInProcessSyncOptions {
    prisma: PrismaClient;
    accountId: number;
    trigger?: string;
    userId?: string;
}

export interface RunInProcessSyncResult {
    ok: boolean;
    accountId: number;
    provider: string;
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
    message: string;
    error?: string;
}

const ENTITY_ORDER: ImportEntityType[] = [
    "Customer",
    "Payment",
    "Invoice",
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

/**
 * In-process Priority sync for main API / worker (D71).
 * Pulls mapped entities, maps ERP fields, upserts into Postgres.
 */
export async function runInProcessSync(
    options: RunInProcessSyncOptions
): Promise<RunInProcessSyncResult> {
    const { prisma, accountId, trigger = "manual", userId } = options;
    const stats = emptyStats();

    try {
        const connector = await prisma.billingConnector.findUnique({
            where: { account_id: accountId },
        });

        if (!connector) {
            return {
                ok: false,
                accountId,
                provider: "UNKNOWN",
                stats,
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
                stats,
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
                stats,
                message: "Missing base_url or credentials",
                error: "MISSING_CREDENTIALS",
            };
        }

        let credentials: Record<string, unknown>;
        try {
            credentials = decryptCredentials(connector.credentials_encrypted);
        } catch (err) {
            return {
                ok: false,
                accountId,
                provider: connector.provider,
                stats,
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
                stats,
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

        for (const entityType of ENTITY_ORDER) {
            const mapping = mappingByType.get(entityType);
            if (!mapping) continue;

            try {
                const syncState = await prisma.connectorSyncState.findFirst({
                    where: {
                        connector_id: connector.id,
                        entity_type: entityType,
                    },
                });

                const pullResult = await client.pull(entityType, {
                    since: syncState?.last_max_updated_at ?? null,
                    pageSize: 100,
                });

                const processedKey = `${entityType.toLowerCase()}sProcessed` as keyof typeof stats;
                const importedKey = `${entityType.toLowerCase()}sImported` as keyof typeof stats;
                (stats as Record<string, number>)[processedKey] =
                    pullResult.records.length;

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

                const maxUpdated =
                    extractMaxUpdatedAt(
                        pullResult.records as Record<string, unknown>[]
                    ) ?? new Date();

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
                        last_successful_run_at: new Date(),
                        last_attempt_at: new Date(),
                        last_max_updated_at: maxUpdated,
                        last_error:
                            importResult.failed > 0
                                ? importResult.errors.slice(0, 3).join("; ")
                                : null,
                    },
                    update: {
                        last_successful_run_at: new Date(),
                        last_attempt_at: new Date(),
                        last_max_updated_at: maxUpdated,
                        last_error:
                            importResult.failed > 0
                                ? importResult.errors.slice(0, 3).join("; ")
                                : null,
                    },
                });
            } catch (err) {
                const message =
                    err instanceof Error ? err.message : "Unknown error";
                stats.importErrors += 1;
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

        return {
            ok: stats.importErrors === 0,
            accountId,
            provider: connector.provider,
            stats,
            message: `Synced via ${trigger}: imported ${imported} rows (${stats.importErrors} errors)`,
            error:
                stats.importErrors > 0
                    ? `${stats.importErrors} import error(s)`
                    : undefined,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return {
            ok: false,
            accountId,
            provider: "UNKNOWN",
            stats,
            message: "Sync failed with unexpected error",
            error: message,
        };
    }
}
