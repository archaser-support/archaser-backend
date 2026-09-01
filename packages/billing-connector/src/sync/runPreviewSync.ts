import type { ImportType, Prisma, PrismaClient } from "@prisma/client";

import {
    discoverPriorityFields,
    fetchPriorityEntitySamples,
    testPriorityConnection,
    type PriorityConnectionConfig,
} from "../priority/PriorityClient";
import { isPriorityEntityImportType } from "../priority/priorityApiContract";
import { parseStoredConnectorCredentials } from "../utils/billingConnectorCrypto";
import {
    mapErpRecord,
    parseMappingRules,
    validateMappedRow,
} from "../utils/connectorFieldUtils";
import { validateConnectorLiveImportRow } from "../import/validateConnectorLiveImportRow";
import { parseEntitySetsMap } from "../services/billingConnectorEntitySets";
import { resolveEntityPullFilterOData } from "../services/billingConnectorPullFilters";
import {
    computeEntityPreviewPassed,
    setPreviewPasses,
    previewPassesToPrismaJson,
} from "../services/billingConnectorPreviewPasses";

const PREVIEW_SAMPLE_TOP = 50;
const ENTITY_ORDER: ImportType[] = [
    "Customer",
    "Invoice",
    "Payment",
    "Contact",
];

export interface PreviewEntityResult {
    import_type: ImportType;
    pulled: number;
    match_count: number;
    match_count_capped: boolean;
    sample_rows: Record<string, unknown>[];
    validation_errors: string[];
    sorted_preview: boolean;
    pull_phases: string[];
    effective_filter: string | null;
}

export interface PreviewSyncResult {
    mode: "preview";
    started_at: string;
    completed_at: string;
    cutover: {
        backfill_start_date: string | null;
        include_older_open_invoices: boolean;
        skip_reporting_breach_on_backfill: boolean;
    };
    cutover_summary: string | null;
    entities: PreviewEntityResult[];
    go_no_go: {
        required_field_errors: number;
        passed: boolean;
        checks: Array<{
            id: string;
            label: string;
            passed: boolean;
            detail: string;
        }>;
    };
}

function formatBackfillStartDate(value: Date | null | undefined): string | null {
    if (!value) {
        return null;
    }
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function parseEnabledEntities(raw: unknown): ImportType[] {
    if (!Array.isArray(raw)) {
        return ENTITY_ORDER;
    }
    return raw.filter((value): value is ImportType => {
        return (
            typeof value === "string" &&
            isPriorityEntityImportType(value as ImportType)
        );
    });
}

export async function runPreviewSync(params: {
    prisma: PrismaClient;
    accountId: number;
    importType?: ImportType;
}): Promise<PreviewSyncResult> {
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

    const credentials = parseStoredConnectorCredentials(
        connector.credentials_encrypted
    );
    const config: PriorityConnectionConfig = {
        baseUrl: connector.base_url,
        authType: connector.auth_type,
        credentials,
    };
    const connection = await testPriorityConnection(config);
    if (!connection.ok) {
        throw Object.assign(
            new Error(connection.error ?? "Connection test failed"),
            { statusCode: 400, code: "CONNECTION_FAILED" }
        );
    }

    const entitySets = parseEntitySetsMap(connector.entity_sets);
    const enabled = parseEnabledEntities(connector.enabled_entities);
    const targets = params.importType
        ? enabled.filter((entity) => entity === params.importType)
        : enabled;
    const mappingByType = new Map(
        connector.ConnectorFieldMapping.map((row) => [row.import_type, row])
    );

    const entities: PreviewEntityResult[] = [];
    for (const importType of targets) {
        if (!isPriorityEntityImportType(importType)) {
            continue;
        }
        const filter = resolveEntityPullFilterOData(
            connector.pull_filters,
            importType
        );
        const fetchResult = await fetchPriorityEntitySamples(
            config,
            importType,
            PREVIEW_SAMPLE_TOP,
            { entitySet: entitySets[importType] ?? null, filter }
        );
        if (!fetchResult.ok) {
            entities.push({
                import_type: importType,
                pulled: 0,
                match_count: 0,
                match_count_capped: false,
                sample_rows: [],
                validation_errors: [
                    fetchResult.error ?? "Failed to pull preview samples",
                ],
                sorted_preview: importType !== "Invoice",
                pull_phases: ["preview"],
                effective_filter: filter,
            });
            continue;
        }

        const mappingRow = mappingByType.get(importType);
        const rules = parseMappingRules(mappingRow?.mapping);
        const mappedRows: Record<string, unknown>[] = [];
        const validationErrors: string[] = [];
        fetchResult.records.forEach((record, index) => {
            const mapped = mapErpRecord(record, rules) as Record<
                string,
                unknown
            >;
            mappedRows.push(mapped);
            if (importType === "Invoice" || importType === "Payment") {
                const validation = validateConnectorLiveImportRow(
                    importType,
                    mapped
                );
                if (!validation.ok) {
                    validationErrors.push(
                        `Row ${index + 1}: ${validation.reason ?? "incomplete row"}`
                    );
                }
            } else {
                validationErrors.push(
                    ...validateMappedRow(importType, mapped, index)
                );
            }
        });

        const sortedPreview =
            importType !== "Invoice" || mappedRows.length > 0;

        entities.push({
            import_type: importType,
            pulled: fetchResult.records.length,
            match_count: fetchResult.records.length,
            match_count_capped:
                fetchResult.records.length >= PREVIEW_SAMPLE_TOP,
            sample_rows: mappedRows.slice(0, 20),
            validation_errors: validationErrors.slice(0, 25),
            sorted_preview: sortedPreview,
            pull_phases: ["preview"],
            effective_filter: filter,
        });
    }

    const requiredFieldErrors = entities.reduce(
        (sum, entity) => sum + entity.validation_errors.length,
        0
    );
    const entityPasses = entities.map((entity) => ({
        importType: entity.import_type,
        passed: computeEntityPreviewPassed(entity),
    }));
    const allPassed =
        entityPasses.length > 0 &&
        entityPasses.every((entry) => entry.passed) &&
        requiredFieldErrors === 0;

    const nextPasses = setPreviewPasses(
        connector.preview_passes,
        entityPasses,
        new Date()
    );
    await params.prisma.billingConnector.update({
        where: { id: connector.id },
        data: {
            preview_passes: previewPassesToPrismaJson(nextPasses),
            modified_at: new Date(),
        },
    });

    const completedAt = new Date();
    return {
        mode: "preview",
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        cutover: {
            backfill_start_date: formatBackfillStartDate(
                connector.backfill_start_date
            ),
            include_older_open_invoices:
                connector.include_older_open_invoices ?? true,
            skip_reporting_breach_on_backfill:
                connector.skip_reporting_breach_on_backfill ?? false,
        },
        cutover_summary: null,
        entities,
        go_no_go: {
            required_field_errors: requiredFieldErrors,
            passed: allPassed,
            checks: [
                {
                    id: "samples",
                    label: "Sample rows pulled",
                    passed: entities.every((entity) => entity.pulled > 0),
                    detail: entities
                        .map((entity) => `${entity.import_type}:${entity.pulled}`)
                        .join(", "),
                },
                {
                    id: "required_fields",
                    label: "Required fields present",
                    passed: requiredFieldErrors === 0,
                    detail:
                        requiredFieldErrors === 0
                            ? "All required fields mapped"
                            : `${requiredFieldErrors} validation error(s)`,
                },
                {
                    id: "entity_pass",
                    label: "Enabled entities passed preview",
                    passed: entityPasses.every((entry) => entry.passed),
                    detail: entityPasses
                        .map(
                            (entry) =>
                                `${entry.importType}:${entry.passed ? "pass" : "fail"}`
                        )
                        .join(", "),
                },
            ],
        },
    };
}

export async function discoverConnectorFields(params: {
    prisma: PrismaClient;
    accountId: number;
    importType: ImportType;
    userId?: string;
}): Promise<{
    import_type: ImportType;
    raw_headers: string[];
    example_values: Record<string, unknown>;
    sample_count: number;
    discovered_at: string | null;
    archaser_fields: string[];
    required_fields: string[];
    highlighted_fields: string[];
}> {
    const { getImportEntityFieldCatalog } = await import(
        "../utils/connectorFieldUtils"
    );
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
    if (!isPriorityEntityImportType(params.importType)) {
        throw Object.assign(new Error("Invalid import type"), {
            statusCode: 400,
            code: "INVALID_IMPORT_TYPE",
        });
    }

    const credentials = parseStoredConnectorCredentials(
        connector.credentials_encrypted
    );
    const entitySets = parseEntitySetsMap(connector.entity_sets);
    const discovered = await discoverPriorityFields(
        {
            baseUrl: connector.base_url,
            authType: connector.auth_type,
            credentials,
        },
        params.importType,
        5,
        { entitySet: entitySets[params.importType] ?? null }
    );
    if (!discovered.ok) {
        throw Object.assign(
            new Error(discovered.error ?? "Failed to discover fields"),
            {
                statusCode: discovered.statusCode ?? 502,
                code: "DISCOVER_FAILED",
            }
        );
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
            discovered_headers: discovered.rawHeaders as Prisma.InputJsonValue,
            discovered_example_values:
                discovered.exampleValues as Prisma.InputJsonValue,
            discovered_sample_count: discovered.sampleCount,
            discovered_at: discoveredAt,
            modified_by: params.userId ?? null,
        },
        update: {
            discovered_headers: discovered.rawHeaders as Prisma.InputJsonValue,
            discovered_example_values:
                discovered.exampleValues as Prisma.InputJsonValue,
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
