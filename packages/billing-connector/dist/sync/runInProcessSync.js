"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInProcessSync = runInProcessSync;
const extensions_1 = require("../extensions");
const PriorityProviderClient_1 = require("../priority/PriorityProviderClient");
const PriorityClient_1 = require("../priority/PriorityClient");
const provider_1 = require("../provider");
const billingConnectorCrypto_1 = require("../utils/billingConnectorCrypto");
const entityImporter_1 = require("../import/entityImporter");
const connectorFieldUtils_1 = require("../utils/connectorFieldUtils");
const connectorSyncCancelRegistry_1 = require("./connectorSyncCancelRegistry");
const stagedExtensionSync_1 = require("./stagedExtensionSync");
const ENTITY_ORDER = [
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
function entityStatsFrom(stats) {
    return {
        Customer: {
            pulled: stats.customersProcessed,
            success: stats.customersImported,
            failed: 0,
            skipped: 0,
        },
        Contact: {
            pulled: stats.contactsProcessed,
            success: stats.contactsImported,
            failed: 0,
            skipped: 0,
        },
        Invoice: {
            pulled: stats.invoicesProcessed,
            success: stats.invoicesImported,
            failed: 0,
            skipped: 0,
        },
        Payment: {
            pulled: stats.paymentsProcessed,
            success: stats.paymentsImported,
            failed: 0,
            skipped: 0,
        },
    };
}
function attachSyncMeta(result, options) {
    const cancelled = options.executionId
        ? (0, connectorSyncCancelRegistry_1.isConnectorSyncCancelRequested)(options.executionId)
        : Boolean(result.cancelled);
    return {
        ...result,
        cancelled,
        entity_stats: result.entity_stats ?? entityStatsFrom(result.stats),
    };
}
function normalizeExtensionConfig(value) {
    if (value == null)
        return null;
    if (typeof value !== "object" || Array.isArray(value))
        return null;
    return { ...value };
}
function enabledEntitiesFromConnector(raw) {
    if (!Array.isArray(raw)) {
        return [...stagedExtensionSync_1.STAGED_ENTITY_ORDER];
    }
    return raw.filter((e) => typeof e === "string" &&
        stagedExtensionSync_1.STAGED_ENTITY_ORDER.includes(e));
}
/**
 * In-process Priority sync for main API / worker (D71).
 * Accounts with extension_key use staged windowed plugin path;
 * accounts without a key keep entity-by-entity pull/map/import.
 */
async function runInProcessSync(options) {
    return attachSyncMeta(await runInProcessSyncBody(options), options);
}
async function runInProcessSyncBody(options) {
    const { prisma, accountId, trigger = "manual", userId, dryRun = false, } = options;
    const stats = emptyStats();
    const resolveExtension = options.resolveExtension ?? extensions_1.getRegisteredExtension;
    const importBatch = options.importBatch ?? entityImporter_1.importMappedEntityBatch;
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
        const extensionKey = typeof connector.extension_key === "string"
            ? connector.extension_key.trim() || null
            : null;
        const skipReportingBreach = (0, entityImporter_1.shouldSkipReportingBreachOnConnectorWrite)({
            syncMode: options.mode === "incremental" ? "INCREMENTAL" : "BACKFILL",
            skipReportingBreachOnBackfill: connector.skip_reporting_breach_on_backfill === true,
        });
        // Fail fast at sync start — never silently fall back to legacy path.
        let extension;
        if (extensionKey) {
            extension = resolveExtension(extensionKey);
            if (!extension) {
                return {
                    ok: false,
                    accountId,
                    provider: connector.provider,
                    stats,
                    extension_key: extensionKey,
                    dry_run: dryRun,
                    message: `Unknown extension_key: ${extensionKey}`,
                    error: `Unknown extension_key: ${extensionKey}`,
                };
            }
        }
        try {
            (0, provider_1.assertPriorityProvider)(connector.provider);
        }
        catch (err) {
            return {
                ok: false,
                accountId,
                provider: connector.provider,
                stats,
                message: `Provider ${connector.provider} is not supported`,
                error: err instanceof Error ? err.message : "UNSUPPORTED_PROVIDER",
            };
        }
        if (!options.provider) {
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
        }
        let credentials = {};
        if (!options.provider) {
            try {
                credentials = (0, billingConnectorCrypto_1.decryptCredentials)(connector.credentials_encrypted);
            }
            catch (err) {
                return {
                    ok: false,
                    accountId,
                    provider: connector.provider,
                    stats,
                    message: "Failed to decrypt credentials",
                    error: err instanceof Error
                        ? err.message
                        : "DECRYPTION_FAILED",
                };
            }
        }
        if (!options.skipConnectionTest && !options.provider) {
            const connectionResult = await (0, PriorityClient_1.testPriorityConnection)({
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
        }
        const client = options.provider ??
            new PriorityProviderClient_1.PriorityProviderClient({
                baseUrl: connector.base_url,
                authType: connector.auth_type,
                credentials,
            });
        const mappings = await prisma.connectorFieldMapping.findMany({
            where: { connector_id: connector.id },
        });
        const mappingByType = new Map(mappings.map((m) => [String(m.import_type), m]));
        const mappingRulesByType = new Map(mappings.map((m) => [
            String(m.import_type),
            (0, connectorFieldUtils_1.parseMappingRules)(m.mapping),
        ]));
        // -------- Staged extension path --------
        if (extensionKey && extension) {
            const enabled = enabledEntitiesFromConnector(connector.enabled_entities);
            let windows = options.windows;
            if (!windows) {
                let earliest = null;
                for (const entityType of enabled) {
                    const syncState = await prisma.connectorSyncState.findFirst({
                        where: {
                            connector_id: connector.id,
                            entity_type: entityType,
                        },
                    });
                    const watermark = syncState?.last_max_updated_at ?? null;
                    if (watermark &&
                        (!earliest || watermark < earliest)) {
                        earliest = watermark;
                    }
                }
                windows = (0, stagedExtensionSync_1.planDefaultSyncWindows)({
                    earliestWatermark: earliest,
                });
            }
            const staged = await (0, stagedExtensionSync_1.runStagedExtensionSync)({
                prisma,
                accountId,
                connectorId: connector.id,
                extension,
                extensionConfig: normalizeExtensionConfig(connector.extension_config),
                provider: client,
                mappingByType: mappingRulesByType,
                enabledEntities: enabled,
                windows,
                dryRun,
                userId,
                skipReportingBreach,
                importBatch,
            });
            if (!dryRun) {
                await (0, entityImporter_1.updateAccountLastSyncDate)(prisma, accountId);
            }
            const imported = staged.stats.customersImported +
                staged.stats.contactsImported +
                staged.stats.invoicesImported +
                staged.stats.paymentsImported;
            return {
                ok: staged.ok,
                accountId,
                provider: connector.provider,
                stats: staged.stats,
                extension_key: extensionKey,
                dry_run: dryRun,
                preview_batch: staged.previewBatch,
                window_outcomes: staged.windows.map((w) => ({
                    start: w.window.start,
                    end: w.window.end,
                    ok: w.ok,
                    error: w.error,
                    imported: w.imported,
                })),
                message: dryRun
                    ? `Preview via ${trigger} (extension ${extensionKey}): processed without writes`
                    : `Synced via ${trigger} (extension ${extensionKey}): imported ${imported} rows (${staged.stats.importErrors} errors)`,
                error: staged.error,
            };
        }
        // -------- Legacy entity-by-entity path (no extension_key) --------
        if (dryRun) {
            // Preview without extension: pull+map only, no writes.
            for (const entityType of ENTITY_ORDER) {
                const mapping = mappingByType.get(entityType);
                if (!mapping)
                    continue;
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
                const processedKey = `${entityType.toLowerCase()}sProcessed`;
                stats[processedKey] =
                    pullResult.records.length;
            }
            return {
                ok: true,
                accountId,
                provider: connector.provider,
                stats,
                extension_key: null,
                dry_run: true,
                message: `Preview via ${trigger}: no extension (legacy path, no writes)`,
            };
        }
        for (const entityType of ENTITY_ORDER) {
            const mapping = mappingByType.get(entityType);
            if (!mapping)
                continue;
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
                const processedKey = `${entityType.toLowerCase()}sProcessed`;
                const importedKey = `${entityType.toLowerCase()}sImported`;
                stats[processedKey] =
                    pullResult.records.length;
                const importResult = await importBatch(prisma, entityType, pullResult.records, accountId, mapping.mapping, userId, { skipReportingBreach });
                stats[importedKey] =
                    importResult.success;
                stats.importErrors += importResult.failed;
                const maxUpdated = (0, entityImporter_1.extractMaxUpdatedAt)(pullResult.records) ?? new Date();
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
                        last_error: importResult.failed > 0
                            ? importResult.errors.slice(0, 3).join("; ")
                            : null,
                    },
                    update: {
                        last_successful_run_at: new Date(),
                        last_attempt_at: new Date(),
                        last_max_updated_at: maxUpdated,
                        last_error: importResult.failed > 0
                            ? importResult.errors.slice(0, 3).join("; ")
                            : null,
                    },
                });
            }
            catch (err) {
                const message = err instanceof Error ? err.message : "Unknown error";
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
        await (0, entityImporter_1.updateAccountLastSyncDate)(prisma, accountId);
        const imported = stats.customersImported +
            stats.contactsImported +
            stats.invoicesImported +
            stats.paymentsImported;
        return {
            ok: stats.importErrors === 0,
            accountId,
            provider: connector.provider,
            stats,
            extension_key: null,
            dry_run: false,
            message: `Synced via ${trigger}: imported ${imported} rows (${stats.importErrors} errors)`,
            error: stats.importErrors > 0
                ? `${stats.importErrors} import error(s)`
                : undefined,
        };
    }
    catch (err) {
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
