import {
    DEFAULT_IMPORT_CACHE_TIME_ZONE,
    type ImportCacheEntityType,
} from "./types";
import type { EntityImportBatchResult } from "../import/entityImporter";

/**
 * Calendar day `YYYY-MM-DD` in the given IANA timezone (or Asia/Jerusalem).
 * Prefer `BillingConnector.time_zone`; pass null to use the default.
 */
export function resolveImportCacheDay(
    at: Date = new Date(),
    timeZone?: string | null
): string {
    const zone =
        typeof timeZone === "string" && timeZone.trim().length > 0
            ? timeZone.trim()
            : DEFAULT_IMPORT_CACHE_TIME_ZONE;
    try {
        const parts = new Intl.DateTimeFormat("en-CA", {
            timeZone: zone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(at);
        const year = parts.find((p) => p.type === "year")?.value;
        const month = parts.find((p) => p.type === "month")?.value;
        const day = parts.find((p) => p.type === "day")?.value;
        if (year && month && day) {
            return `${year}-${month}-${day}`;
        }
    } catch {
        // Invalid IANA zone — fall through to default.
    }
    if (zone !== DEFAULT_IMPORT_CACHE_TIME_ZONE) {
        return resolveImportCacheDay(at, DEFAULT_IMPORT_CACHE_TIME_ZONE);
    }
    return at.toISOString().slice(0, 10);
}

export function normalizeImportCacheCustomerScope(
    runtimeCustomerNumber?: string | null
): string {
    const trimmed =
        typeof runtimeCustomerNumber === "string"
            ? runtimeCustomerNumber.trim()
            : "";
    return trimmed.length > 0 ? trimmed : "all";
}

/**
 * Rows that entered import and were not skipped by the importer.
 */
export function rowsEnteringImport(
    rows: Record<string, unknown>[],
    importResult: EntityImportBatchResult
): Record<string, unknown>[] {
    const rowResults = importResult.rowResults;
    if (!rowResults || rowResults.length === 0) {
        return rows;
    }
    const kept: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += 1) {
        const rowResult = rowResults[i];
        if (rowResult?.skipped) {
            continue;
        }
        kept.push(rows[i]!);
    }
    return kept;
}

export function isImportCacheEntityType(
    value: string
): value is ImportCacheEntityType {
    return (
        value === "Customer" ||
        value === "Contact" ||
        value === "Invoice" ||
        value === "Payment"
    );
}

/**
 * Normalize Start `use_cached_import` body values.
 * Unknown strings are dropped; duplicates collapse.
 */
export function parseUseCachedImport(raw: unknown): ImportCacheEntityType[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set<ImportCacheEntityType>();
    const out: ImportCacheEntityType[] = [];
    for (const item of raw) {
        if (typeof item !== "string" || !isImportCacheEntityType(item)) {
            continue;
        }
        if (seen.has(item)) {
            continue;
        }
        seen.add(item);
        out.push(item);
    }
    return out;
}

/**
 * Normalize Start `use_cached_execution_id`. Empty / non-string → null.
 */
export function parseUseCachedExecutionId(raw: unknown): string | null {
    if (typeof raw !== "string") {
        return null;
    }
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
}

/**
 * Split rows into chunks that stay under `maxBytes` when BSON-serialized.
 * Empty input yields one empty chunk so same-day replace still records a run.
 */
export function chunkImportCacheRows(
    rows: Record<string, unknown>[],
    maxBytes: number
): Record<string, unknown>[][] {
    if (rows.length === 0) {
        return [[]];
    }
    const chunks: Record<string, unknown>[][] = [];
    let current: Record<string, unknown>[] = [];
    let currentBytes = 2; // []

    for (const row of rows) {
        const rowJson = JSON.stringify(row);
        const rowBytes = Buffer.byteLength(rowJson, "utf8") + 1;
        if (
            current.length > 0 &&
            currentBytes + rowBytes > maxBytes
        ) {
            chunks.push(current);
            current = [];
            currentBytes = 2;
        }
        // Single oversized row — still store alone (ops can investigate).
        current.push(row);
        currentBytes += rowBytes;
    }
    if (current.length > 0 || chunks.length === 0) {
        chunks.push(current);
    }
    return chunks;
}
