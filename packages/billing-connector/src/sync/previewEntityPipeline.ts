import type { ImportType } from "@prisma/client";

import { getRegisteredExtension } from "../extensions";
import type { ExtensionEntityType } from "../extensions/types";
import { sortInvoicesForImport } from "../import/sortInvoicesForImport";
import {
    fetchPriorityEntitySamples,
    type PriorityConnectionConfig,
} from "../priority/PriorityClient";
import { isPriorityEntityImportType } from "../priority/priorityApiContract";
import { parseEntitySetsMap } from "../services/billingConnectorEntitySets";
import { resolveEntityPullFilterOData } from "../services/billingConnectorPullFilters";
import {
    mapErpRecord,
    type MappingRule,
    validateMappedRow,
} from "../utils/connectorFieldUtils";
import { STAGED_ENTITY_ORDER } from "./stagedExtensionSync";

export const PREVIEW_SAMPLE_TOP = 50;

/** Same entity order as staged live sync (Customer → Payment → Invoice → Contact). */
export const PREVIEW_ENTITY_ORDER: ImportType[] = [...STAGED_ENTITY_ORDER];

export interface PreviewEntityResult {
    import_type: ImportType;
    pulled: number;
    importable_count: number;
    match_count: number;
    match_count_capped: boolean;
    sample_rows: Record<string, unknown>[];
    validation_errors: string[];
    sorted_preview: boolean;
    pull_phases: string[];
    effective_filter: string | null;
}

function normalizeExtensionConfig(
    value: unknown
): Record<string, unknown> | null {
    if (value == null) {
        return null;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return { ...(value as Record<string, unknown>) };
}

export function resolvePreviewTargets(
    enabled: ImportType[],
    importType?: ImportType
): ImportType[] {
    const enabledSet = new Set(enabled);
    const ordered = PREVIEW_ENTITY_ORDER.filter((entity) =>
        enabledSet.has(entity)
    );
    if (importType) {
        return ordered.filter((entity) => entity === importType);
    }
    return ordered;
}

/**
 * Live import skips rows with missing required fields; preview matches that
 * behavior. Fail only when every post-extension row is incomplete.
 */
export function partitionPreviewImportRows(
    importType: ImportType,
    rows: Record<string, unknown>[]
): {
    validRows: Record<string, unknown>[];
    validationErrors: string[];
} {
    const validRows: Record<string, unknown>[] = [];
    const allErrors: string[] = [];

    rows.forEach((mapped, index) => {
        const rowErrors = validateMappedRow(importType, mapped, index);
        if (rowErrors.length === 0) {
            validRows.push(mapped);
            return;
        }
        allErrors.push(...rowErrors);
    });

    if (validRows.length > 0) {
        return { validRows, validationErrors: [] };
    }

    return {
        validRows: [],
        validationErrors: allErrors.slice(0, 25),
    };
}

export async function applyPreviewExtensionTransform(
    accountId: number,
    importType: ImportType,
    mappedRows: Record<string, unknown>[],
    connector: { extension_key: string | null; extension_config: unknown }
): Promise<Record<string, unknown>[]> {
    const extensionKey =
        typeof connector.extension_key === "string"
            ? connector.extension_key.trim() || null
            : null;
    if (!extensionKey || mappedRows.length === 0) {
        return mappedRows;
    }

    const extension = getRegisteredExtension(extensionKey);
    if (!extension) {
        return mappedRows;
    }

    const afterPlugin = await extension.transform({
        accountId,
        window: { start: null, end: null },
        batch: { [importType as ExtensionEntityType]: mappedRows },
        extension_config: normalizeExtensionConfig(connector.extension_config),
        dryRun: true,
    });
    return afterPlugin[importType as ExtensionEntityType] ?? [];
}

/** True when valid invoice rows can be sorted the same way as live import. */
export function computeInvoiceSortedPreview(
    validRows: Record<string, unknown>[]
): boolean {
    if (validRows.length === 0) {
        return false;
    }
    const sortable = validRows
        .map((row) => ({
            customer_number: String(row.customer_number ?? "").trim(),
            invoice_number: String(row.invoice_number ?? "").trim(),
            invoice_date: String(row.invoice_date ?? "").trim(),
        }))
        .filter(
            (row) =>
                row.customer_number &&
                row.invoice_number &&
                row.invoice_date
        );
    if (sortable.length === 0) {
        return false;
    }
    sortInvoicesForImport(sortable);
    return true;
}

function sortedPreviewForEntity(
    importType: ImportType,
    validRows: Record<string, unknown>[]
): boolean {
    if (importType !== "Invoice") {
        return true;
    }
    return computeInvoiceSortedPreview(validRows);
}

export async function previewEntityFromConnector(params: {
    importType: ImportType;
    accountId: number;
    config: PriorityConnectionConfig;
    connector: {
        extension_key: string | null;
        extension_config: unknown;
        pull_filters: unknown;
        entity_sets: unknown;
    };
    mappingRules: MappingRule[];
    sampleTop?: number;
}): Promise<PreviewEntityResult> {
    const { importType, accountId, config, connector, mappingRules } = params;
    const sampleTop = params.sampleTop ?? PREVIEW_SAMPLE_TOP;
    const entitySets = parseEntitySetsMap(connector.entity_sets);
    const filter = resolveEntityPullFilterOData(
        connector.pull_filters,
        importType
    );

    if (!isPriorityEntityImportType(importType)) {
        return {
            import_type: importType,
            pulled: 0,
            importable_count: 0,
            match_count: 0,
            match_count_capped: false,
            sample_rows: [],
            validation_errors: ["Unsupported import type for preview"],
            sorted_preview: false,
            pull_phases: ["preview"],
            effective_filter: filter,
        };
    }

    const fetchResult = await fetchPriorityEntitySamples(
        config,
        importType,
        sampleTop,
        { entitySet: entitySets[importType] ?? null, filter }
    );

    if (!fetchResult.ok) {
        return {
            import_type: importType,
            pulled: 0,
            importable_count: 0,
            match_count: 0,
            match_count_capped: false,
            sample_rows: [],
            validation_errors: [
                fetchResult.error ?? "Failed to pull preview samples",
            ],
            sorted_preview: importType !== "Invoice",
            pull_phases: ["preview"],
            effective_filter: filter,
        };
    }

    const mappedRows = fetchResult.records.map(
        (record) => mapErpRecord(record, mappingRules) as Record<string, unknown>
    );
    const importableRows = await applyPreviewExtensionTransform(
        accountId,
        importType,
        mappedRows,
        connector
    );
    const { validRows, validationErrors } = partitionPreviewImportRows(
        importType,
        importableRows
    );

    return {
        import_type: importType,
        pulled: fetchResult.records.length,
        importable_count: validRows.length,
        match_count: validRows.length,
        match_count_capped: fetchResult.records.length >= sampleTop,
        sample_rows: validRows.slice(0, 20),
        validation_errors: validationErrors,
        sorted_preview: sortedPreviewForEntity(importType, validRows),
        pull_phases: ["preview"],
        effective_filter: filter,
    };
}
