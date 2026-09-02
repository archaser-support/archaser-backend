"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPreviewSync = runPreviewSync;
exports.discoverConnectorFields = discoverConnectorFields;
const PriorityClient_1 = require("../priority/PriorityClient");
const priorityApiContract_1 = require("../priority/priorityApiContract");
const billingConnectorCrypto_1 = require("../utils/billingConnectorCrypto");
const connectorFieldUtils_1 = require("../utils/connectorFieldUtils");
const billingConnectorEntitySets_1 = require("../services/billingConnectorEntitySets");
const billingConnectorPreviewPasses_1 = require("../services/billingConnectorPreviewPasses");
const previewEntityPipeline_1 = require("./previewEntityPipeline");
function formatBackfillStartDate(value) {
    if (!value) {
        return null;
    }
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
function parseEnabledEntities(raw) {
    if (!Array.isArray(raw)) {
        return [...previewEntityPipeline_1.PREVIEW_ENTITY_ORDER];
    }
    return raw.filter((value) => {
        return (typeof value === "string" &&
            (0, priorityApiContract_1.isPriorityEntityImportType)(value));
    });
}
async function runPreviewSync(params) {
    const startedAt = new Date();
    const connector = await params.prisma.billingConnector.findUnique({
        where: { account_id: params.accountId },
        include: { ConnectorFieldMapping: true },
    });
    if (!connector?.base_url || !connector.credentials_encrypted) {
        throw Object.assign(new Error("Billing connector is not configured"), {
            statusCode: 400,
            code: "CONNECTOR_NOT_CONFIGURED",
        });
    }
    const credentials = (0, billingConnectorCrypto_1.parseStoredConnectorCredentials)(connector.credentials_encrypted);
    const config = {
        baseUrl: connector.base_url,
        authType: connector.auth_type,
        credentials,
    };
    const connection = await (0, PriorityClient_1.testPriorityConnection)(config);
    if (!connection.ok) {
        throw Object.assign(new Error(connection.error ?? "Connection test failed"), { statusCode: 400, code: "CONNECTION_FAILED" });
    }
    const enabled = parseEnabledEntities(connector.enabled_entities);
    const targets = (0, previewEntityPipeline_1.resolvePreviewTargets)(enabled, params.importType);
    const mappingByType = new Map(connector.ConnectorFieldMapping.map((row) => [row.import_type, row]));
    const connectorPreviewContext = {
        extension_key: connector.extension_key,
        extension_config: connector.extension_config,
        pull_filters: connector.pull_filters,
        entity_sets: connector.entity_sets,
    };
    const entities = [];
    for (const importType of targets) {
        const mappingRow = mappingByType.get(importType);
        const rules = (0, connectorFieldUtils_1.parseMappingRules)(mappingRow?.mapping);
        entities.push(await (0, previewEntityPipeline_1.previewEntityFromConnector)({
            importType,
            accountId: params.accountId,
            config,
            connector: connectorPreviewContext,
            mappingRules: rules,
        }));
    }
    const requiredFieldErrors = entities.reduce((sum, entity) => sum + entity.validation_errors.length, 0);
    const entityPasses = entities.map((entity) => ({
        importType: entity.import_type,
        passed: (0, billingConnectorPreviewPasses_1.computeEntityPreviewPassed)(entity),
    }));
    const allPassed = entityPasses.length > 0 &&
        entityPasses.every((entry) => entry.passed) &&
        requiredFieldErrors === 0;
    const nextPasses = (0, billingConnectorPreviewPasses_1.setPreviewPasses)(connector.preview_passes, entityPasses, new Date());
    await params.prisma.billingConnector.update({
        where: { id: connector.id },
        data: {
            preview_passes: (0, billingConnectorPreviewPasses_1.previewPassesToPrismaJson)(nextPasses),
            modified_at: new Date(),
        },
    });
    const completedAt = new Date();
    return {
        mode: "preview",
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        cutover: {
            backfill_start_date: formatBackfillStartDate(connector.backfill_start_date),
            include_older_open_invoices: connector.include_older_open_invoices ?? true,
            skip_reporting_breach_on_backfill: connector.skip_reporting_breach_on_backfill ?? false,
        },
        cutover_summary: null,
        entities,
        go_no_go: {
            required_field_errors: requiredFieldErrors,
            passed: allPassed,
            checks: [
                {
                    id: "samples",
                    label: "Importable sample rows",
                    passed: entities.every((entity) => entity.importable_count > 0),
                    detail: entities
                        .map((entity) => `${entity.import_type}:${entity.importable_count}/${entity.pulled}`)
                        .join(", "),
                },
                {
                    id: "required_fields",
                    label: "Required fields present",
                    passed: requiredFieldErrors === 0,
                    detail: requiredFieldErrors === 0
                        ? "All required fields mapped on importable rows"
                        : `${requiredFieldErrors} validation error(s)`,
                },
                {
                    id: "entity_pass",
                    label: "Enabled entities passed preview",
                    passed: entityPasses.every((entry) => entry.passed),
                    detail: entityPasses
                        .map((entry) => `${entry.importType}:${entry.passed ? "pass" : "fail"}`)
                        .join(", "),
                },
            ],
        },
    };
}
async function discoverConnectorFields(params) {
    const { getImportEntityFieldCatalog } = await Promise.resolve().then(() => __importStar(require("../utils/connectorFieldUtils")));
    const catalog = getImportEntityFieldCatalog(params.importType);
    const connector = await params.prisma.billingConnector.findUnique({
        where: { account_id: params.accountId },
    });
    if (!connector?.base_url || !connector.credentials_encrypted) {
        throw Object.assign(new Error("Billing connector is not configured"), {
            statusCode: 400,
            code: "CONNECTOR_NOT_CONFIGURED",
        });
    }
    if (!(0, priorityApiContract_1.isPriorityEntityImportType)(params.importType)) {
        throw Object.assign(new Error("Invalid import type"), {
            statusCode: 400,
            code: "INVALID_IMPORT_TYPE",
        });
    }
    const credentials = (0, billingConnectorCrypto_1.parseStoredConnectorCredentials)(connector.credentials_encrypted);
    const entitySets = (0, billingConnectorEntitySets_1.parseEntitySetsMap)(connector.entity_sets);
    const discovered = await (0, PriorityClient_1.discoverPriorityFields)({
        baseUrl: connector.base_url,
        authType: connector.auth_type,
        credentials,
    }, params.importType, 5, { entitySet: entitySets[params.importType] ?? null });
    if (!discovered.ok) {
        throw Object.assign(new Error(discovered.error ?? "Failed to discover fields"), {
            statusCode: discovered.statusCode ?? 502,
            code: "DISCOVER_FAILED",
        });
    }
    const discoveredAt = new Date();
    await params.prisma.connectorFieldMapping.upsert({
        where: {
            connector_id_import_type: {
                connector_id: connector.id,
                import_type: params.importType,
            },
        },
        create: {
            connector_id: connector.id,
            import_type: params.importType,
            mapping: [],
            is_complete: false,
            discovered_headers: discovered.rawHeaders,
            discovered_example_values: discovered.exampleValues,
            discovered_sample_count: discovered.sampleCount,
            discovered_at: discoveredAt,
            modified_by: params.userId ?? null,
        },
        update: {
            discovered_headers: discovered.rawHeaders,
            discovered_example_values: discovered.exampleValues,
            discovered_sample_count: discovered.sampleCount,
            discovered_at: discoveredAt,
            modified_at: discoveredAt,
            ...(params.userId ? { modified_by: params.userId } : {}),
        },
    });
    return {
        import_type: params.importType,
        raw_headers: discovered.rawHeaders,
        example_values: discovered.exampleValues,
        sample_count: discovered.sampleCount,
        discovered_at: discoveredAt.toISOString(),
        archaser_fields: [...(catalog?.fields ?? [])],
        required_fields: [...(catalog?.requiredFields ?? [])],
        highlighted_fields: [...(catalog?.highlightedFields ?? [])],
    };
}
