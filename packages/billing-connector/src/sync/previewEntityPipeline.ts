import type { ImportType } from "@prisma/client";

import { getRegisteredExtension } from "../extensions";
import type { ExtensionEntityType } from "../extensions/types";
import { sortInvoicesForImport } from "../import/sortInvoicesForImport";
import {
    fetchPriorityEntitySamples,
    type PriorityConnectionConfig,
} from "../priority/PriorityClient";
import { isPriorityEntityImportType } from "../priority/priorityApiContract";
import { andODataFilters } from "../services/billingConnectorPullFilterCompile";
import { parseEntitySetsMap } from "../services/billingConnectorEntitySets";
import {
    resolveImportPullFilterOData,
    resolveRuntimeCustomerScopeOData,
} from "../services/billingConnectorPullFilters";
import {
    mapErpRecord,
    type MappingRule,
    validateMappedRow,
} from "../utils/connectorFieldUtils";
import { STAGED_ENTITY_ORDER } from "./stagedExtensionSync";

export const PREVIEW_SAMPLE_TOP = 50;
/** Keep Payment preview from hanging for the full 180s Priority timeout. */
const PREVIEW_PAYMENT_TIMEOUT_SECONDS = 45;

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

/**
 * Date cutover for preview samples — same role as live backfill
 * `createdOnOrAfter` / preferredDateField. Uses `gt` to match stored Invoice
 * filters and the Priority Postman shape for this account.
 */
export function previewCutoverDateOData(params: {
    importType: ImportType;
    backfillStartDate: Date | string | null | undefined;
    pullDateField?: string | null;
}): string | null {
    const raw = params.backfillStartDate;
    if (raw == null) {
        return null;
    }
    const date =
        raw instanceof Date ? raw : new Date(typeof raw === "string" ? raw : "");
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const preferred = params.pullDateField?.trim();
    const defaultField =
        params.importType === "Payment"
            ? "FNCDATE"
            : params.importType === "Invoice"
              ? "IVDATE"
              : params.importType === "Customer" ||
                  params.importType === "Contact"
                ? "UDATE"
                : null;
    const field = preferred || defaultField;
    if (!field) {
        return null;
    }
    // Match account 10149 Invoice / Postman literals (+03:00 Israel offset).
    return `${field} gt ${y}-${m}-${d}T00:00:00+03:00`;
}

function filterAlreadyHasDateField(
    filter: string | null,
    dateField: string
): boolean {
    if (!filter?.trim()) {
        return false;
    }
    const re = new RegExp(`\\b${dateField}\\b\\s+(gt|ge|lt|le)\\b`, "i");
    return re.test(filter);
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
    backfillStartDate?: Date | string | null;
    pullDateField?: string | null;
    /** Archaser/ERP customer number — same scope as Start backfill. */
    runtimeCustomerNumber?: string | null;
}): Promise<PreviewEntityResult> {
    const { importType, accountId, config, connector, mappingRules } = params;
    const sampleTop = params.sampleTop ?? PREVIEW_SAMPLE_TOP;
    const entitySets = parseEntitySetsMap(connector.entity_sets);
    const entitySet = entitySets[importType] ?? null;
    const runtimeCustomerNumber =
        typeof params.runtimeCustomerNumber === "string"
            ? params.runtimeCustomerNumber.trim()
            : "";
    const extensionKey =
        typeof connector.extension_key === "string"
            ? connector.extension_key.trim() || null
            : null;
    const extension = extensionKey
        ? getRegisteredExtension(extensionKey)
        : null;
    const extensionConfig = normalizeExtensionConfig(
        connector.extension_config
    );
    const additionalCustomerNumbers =
        runtimeCustomerNumber &&
        typeof extension?.expandRuntimeCustomerScopeNumbers === "function"
            ? extension.expandRuntimeCustomerScopeNumbers({
                  customerNumber: runtimeCustomerNumber,
                  entityType: importType as ExtensionEntityType,
                  entitySet,
                  extension_config: extensionConfig,
              })
            : [];
    const extensionScopeClause =
        runtimeCustomerNumber &&
        typeof extension?.buildRuntimeCustomerScopeOData === "function"
            ? extension.buildRuntimeCustomerScopeOData({
                  customerNumber: runtimeCustomerNumber,
                  additionalCustomerNumbers,
                  entityType: importType as ExtensionEntityType,
                  entitySet,
                  extension_config: extensionConfig,
              })
            : null;
    const runtimeCustomerClause =
        (typeof extensionScopeClause === "string" &&
        extensionScopeClause.trim().length > 0
            ? extensionScopeClause.trim()
            : null) ??
        resolveRuntimeCustomerScopeOData({
            customerNumber: runtimeCustomerNumber || null,
            additionalCustomerNumbers,
            entityType: importType,
            entitySet,
        });
    const fallbackCustomerClause =
        runtimeCustomerNumber &&
        typeof extension?.buildRuntimeCustomerScopeFallbackOData === "function"
            ? extension.buildRuntimeCustomerScopeFallbackOData({
                  customerNumber: runtimeCustomerNumber,
                  entityType: importType as ExtensionEntityType,
                  entitySet,
                  extension_config: extensionConfig,
              })
            : null;
    const entityBaseFilter = resolveImportPullFilterOData(
        connector.pull_filters,
        importType,
        { entitySet }
    );
    const cutoverClause = previewCutoverDateOData({
        importType,
        backfillStartDate: params.backfillStartDate,
        pullDateField: params.pullDateField,
    });
    const cutoverField = cutoverClause?.split(/\s+/)[0] ?? null;
    const withCutover = (scope: string | null): string | null => {
        const withScope = andODataFilters(entityBaseFilter, scope);
        if (
            cutoverClause &&
            cutoverField &&
            !filterAlreadyHasDateField(withScope, cutoverField)
        ) {
            return andODataFilters(withScope, cutoverClause);
        }
        return withScope;
    };
    const primaryFilter = withCutover(runtimeCustomerClause);
    const fallbackFilter =
        typeof fallbackCustomerClause === "string" &&
        fallbackCustomerClause.trim().length > 0
            ? withCutover(fallbackCustomerClause.trim())
            : null;

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
            effective_filter: primaryFilter,
        };
    }

    const timeoutSeconds =
        importType === "Payment" ? PREVIEW_PAYMENT_TIMEOUT_SECONDS : undefined;
    const onLog = config.onLog;
    onLog?.(
        `[preview-entity] start entity=${importType} entitySet=${entitySet ?? "default"} filterLen=${(primaryFilter ?? "").length} filterPreview=${(primaryFilter ?? "").slice(0, 280)}`
    );

    const fetchResult = await fetchPriorityEntitySamples(
        config,
        importType,
        sampleTop,
        { entitySet, filter: primaryFilter, timeoutSeconds }
    );

    if (!fetchResult.ok) {
        onLog?.(
            `[preview-entity] primary fetch failed entity=${importType}: ${fetchResult.error ?? "unknown"}`
        );
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
            effective_filter: primaryFilter,
        };
    }

    onLog?.(
        `[preview-entity] primary fetch ok entity=${importType} rows=${fetchResult.records.length}`
    );

    let mergedRecords = [...fetchResult.records];
    const pullPhases = ["preview"];
    let effectiveFilter = primaryFilter;

    if (fallbackFilter && importType === "Payment") {
        onLog?.(
            `[preview-entity] fallback IDC scope entity=${importType} filterPreview=${fallbackFilter.slice(0, 280)}`
        );
        const fallbackResult = await fetchPriorityEntitySamples(
            config,
            importType,
            sampleTop,
            { entitySet, filter: fallbackFilter, timeoutSeconds }
        );
        if (fallbackResult.ok && fallbackResult.records.length > 0) {
            const seen = new Set(
                mergedRecords.map((row) => paymentRowDedupeKey(row))
            );
            for (const row of fallbackResult.records) {
                const key = paymentRowDedupeKey(row);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                mergedRecords.push(row);
            }
            pullPhases.push("preview_idc_fallback");
            effectiveFilter = andODataFilters(primaryFilter, fallbackFilter);
            onLog?.(
                `[preview-entity] fallback fetch ok entity=${importType} added=${fallbackResult.records.length} merged=${mergedRecords.length}`
            );
        } else if (!fallbackResult.ok) {
            onLog?.(
                `[preview-entity] fallback fetch failed entity=${importType}: ${fallbackResult.error ?? "unknown"} (primary rows kept)`
            );
        } else {
            onLog?.(
                `[preview-entity] fallback fetch ok entity=${importType} rows=0`
            );
        }
    }

    const mappedRows = mergedRecords.map(
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
    const sortedPreview = sortedPreviewForEntity(importType, validRows);

    return {
        import_type: importType,
        pulled: mergedRecords.length,
        importable_count: validRows.length,
        match_count: validRows.length,
        match_count_capped: mergedRecords.length >= sampleTop,
        sample_rows: validRows.slice(0, 20),
        validation_errors: validationErrors,
        sorted_preview: sortedPreview,
        pull_phases: pullPhases,
        effective_filter: effectiveFilter,
    };
}

function paymentRowDedupeKey(row: Record<string, unknown>): string {
    const fncnum = String(row.FNCNUM ?? "").trim();
    const kline = String(row.KLINE ?? "").trim();
    const ivnum = String(row.IVNUM ?? "").trim();
    if (fncnum || kline) {
        return `${fncnum}|${kline}`;
    }
    return ivnum || JSON.stringify(row).slice(0, 120);
}
