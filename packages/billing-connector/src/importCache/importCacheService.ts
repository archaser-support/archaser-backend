import { resolveImportCacheDay } from "./cacheDay";
import { createMemoryImportCacheStore } from "./memoryStore";
import { mongooseImportCacheStore } from "./mongooseStore";
import type { ImportCacheStore } from "./store";
import {
    IMPORT_CACHE_PENDING_INVOICE_CLOSE,
    PENDING_INVOICE_CLOSE_ROW_MARKER,
    type ImportCacheDocument,
    type ImportCacheDaySummary,
    type ImportCacheEntityType,
    type ImportCacheKey,
    type PendingInvoiceCloseTargets,
    type SameDayCacheRun,
    type SaveEntityImportCacheInput,
} from "./types";

let store: ImportCacheStore = mongooseImportCacheStore;

export function useMemoryImportCacheStoreForTests(
    memoryStore: ImportCacheStore = createMemoryImportCacheStore()
): ImportCacheStore {
    store = memoryStore;
    return memoryStore;
}

export function resetImportCacheStoreForTests(): void {
    store = mongooseImportCacheStore;
}

function requireExecutionId(executionId: string | null | undefined): string {
    if (typeof executionId !== "string" || executionId.trim().length === 0) {
        throw new Error(
            "IMPORT_CACHE_EXECUTION_ID_REQUIRED: execution_id is required to save import cache"
        );
    }
    return executionId.trim();
}

function normalizeCustomerScope(customerScope?: string | null): string {
    return typeof customerScope === "string" && customerScope.trim().length > 0
        ? customerScope.trim()
        : "all";
}

export async function saveEntityImportCache(
    input: Omit<SaveEntityImportCacheInput, "executionId"> & {
        executionId: string | null | undefined;
    }
): Promise<{ rowCount: number; chunkCount: number }> {
    const executionId = requireExecutionId(input.executionId);
    return store.save({ ...input, executionId });
}

export async function loadEntityImportCache(
    key: ImportCacheKey
): Promise<Record<string, unknown>[]> {
    const docs = await store.load(key);
    const rows: Record<string, unknown>[] = [];
    for (const doc of docs) {
        rows.push(...doc.rows);
    }
    return rows;
}

export async function loadEntityImportCacheDocuments(
    key: ImportCacheKey
): Promise<ImportCacheDocument[]> {
    return store.load(key);
}

/**
 * List cache calendar days within TTL that have ≥1 selectable entity for the
 * given mode/scope (and optional enabled entity filter). Newest first.
 */
export async function findImportCacheDays(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    customerScope?: string | null;
    importTypes?: ImportCacheEntityType[];
}): Promise<ImportCacheDaySummary[]> {
    return store.listCacheDays({
        accountId: input.accountId,
        syncMode: input.syncMode,
        customerScope: normalizeCustomerScope(input.customerScope),
        importTypes: input.importTypes,
    });
}

export async function findSameDayCacheRuns(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
    /** When set, list this day; otherwise connector-TZ "today". */
    cacheDay?: string | null;
}): Promise<SameDayCacheRun[]> {
    const cacheDay =
        typeof input.cacheDay === "string" && input.cacheDay.trim().length > 0
            ? input.cacheDay.trim()
            : resolveImportCacheDay(input.at, input.timeZone);
    return store.listSameDayRuns({
        accountId: input.accountId,
        syncMode: input.syncMode,
        cacheDay,
        customerScope: normalizeCustomerScope(input.customerScope),
    });
}

/** @deprecated Use findSameDayCacheRuns — kept for transitional callers. */
export async function findSameDayCaches(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
    cacheDay?: string | null;
}): Promise<
    Array<{
        import_type: ImportCacheKey["importType"];
        sync_mode: ImportCacheKey["syncMode"];
        cache_day: string;
        customer_scope: string;
        row_count: number;
        execution_id: string | null;
        created_at: Date;
        available: true;
    }>
> {
    const runs = await findSameDayCacheRuns(input);
    const out: Array<{
        import_type: ImportCacheKey["importType"];
        sync_mode: ImportCacheKey["syncMode"];
        cache_day: string;
        customer_scope: string;
        row_count: number;
        execution_id: string | null;
        created_at: Date;
        available: true;
    }> = [];
    for (const run of runs) {
        for (const entity of run.entities) {
            if (!entity.available) continue;
            out.push({
                import_type: entity.import_type,
                sync_mode: run.sync_mode,
                cache_day: run.cache_day,
                customer_scope: run.customer_scope,
                row_count: entity.row_count,
                execution_id: run.execution_id,
                created_at: run.created_at,
                available: true,
            });
        }
    }
    return out;
}

export type LoadImportCachesForReplayResult =
    | {
          ok: true;
          cacheDay: string;
          customerScope: string;
          executionId: string;
          rowsByEntity: Map<ImportCacheEntityType, Record<string, unknown>[]>;
      }
    | {
          ok: false;
          cacheDay: string | null;
          customerScope: string;
          executionId: string;
          missing: ImportCacheEntityType[];
      };

/** @deprecated Alias for LoadImportCachesForReplayResult. */
export type LoadSameDayImportCachesResult = LoadImportCachesForReplayResult;

/**
 * Load backups for the requested entities on a specific execution.
 * Loads by execution_id (+ mode/scope/entity) — does **not** require today's
 * cache_day (H4). Missing keys fail clearly (no silent ERP fallback).
 * PendingInvoiceClose is loaded separately via {@link loadPendingInvoiceCloseCache}.
 */
export async function loadImportCachesForReplay(input: {
    accountId: number;
    executionId: string;
    syncMode: ImportCacheKey["syncMode"];
    importTypes: ImportCacheEntityType[];
    customerScope?: string | null;
}): Promise<LoadImportCachesForReplayResult> {
    const executionId = requireExecutionId(input.executionId);
    const customerScope = normalizeCustomerScope(input.customerScope);
    const rowsByEntity = new Map<
        ImportCacheEntityType,
        Record<string, unknown>[]
    >();
    const missing: ImportCacheEntityType[] = [];
    let cacheDay: string | null = null;
    for (const importType of input.importTypes) {
        const docs = await store.load({
            accountId: input.accountId,
            executionId,
            importType,
            syncMode: input.syncMode,
            customerScope,
        });
        if (docs.length === 0) {
            missing.push(importType);
            continue;
        }
        if (!cacheDay && docs[0]?.cache_day) {
            cacheDay = docs[0].cache_day;
        }
        const rows: Record<string, unknown>[] = [];
        for (const doc of docs) {
            rows.push(...doc.rows);
        }
        rowsByEntity.set(importType, rows);
    }
    if (missing.length > 0) {
        return {
            ok: false,
            cacheDay,
            customerScope,
            executionId,
            missing,
        };
    }
    return {
        ok: true,
        cacheDay: cacheDay ?? "",
        customerScope,
        executionId,
        rowsByEntity,
    };
}

/** @deprecated Use loadImportCachesForReplay with executionId. */
export async function loadSameDayImportCachesForReplay(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    importTypes: ImportCacheEntityType[];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
    executionId?: string | null;
}): Promise<LoadImportCachesForReplayResult> {
    if (
        typeof input.executionId !== "string" ||
        input.executionId.trim().length === 0
    ) {
        return {
            ok: false,
            cacheDay: resolveImportCacheDay(input.at, input.timeZone),
            customerScope: normalizeCustomerScope(input.customerScope),
            executionId: "",
            missing: [...input.importTypes],
        };
    }
    return loadImportCachesForReplay({
        accountId: input.accountId,
        executionId: input.executionId,
        syncMode: input.syncMode,
        importTypes: input.importTypes,
        customerScope: input.customerScope,
    });
}

/**
 * Persist import cache after entity success. Throws on missing execution_id
 * or Mongo failure so callers can fail the entity and stop later entities.
 */
export async function saveEntityImportCacheOrThrow(
    input: Omit<SaveEntityImportCacheInput, "executionId"> & {
        executionId: string | null | undefined;
    },
    onLog?: (message: string) => void
): Promise<void> {
    const result = await saveEntityImportCache(input);
    onLog?.(
        `Import cache saved ${input.importType} ${input.syncMode} day=${input.cacheDay} scope=${input.customerScope} execution=${String(input.executionId)} rows=${result.rowCount} chunks=${result.chunkCount}`
    );
}

function encodePendingInvoiceCloseRows(
    targets: PendingInvoiceCloseTargets
): Record<string, unknown>[] {
    return [
        {
            [PENDING_INVOICE_CLOSE_ROW_MARKER]: true,
            invoice_numbers: targets.invoiceNumbers,
            close_dates: targets.closeDates,
        },
    ];
}

export function decodePendingInvoiceCloseRows(
    rows: Record<string, unknown>[]
): PendingInvoiceCloseTargets {
    const invoiceNumbers: string[] = [];
    const closeDates: Record<string, string> = {};
    const seen = new Set<string>();
    for (const row of rows) {
        if (!row || row[PENDING_INVOICE_CLOSE_ROW_MARKER] !== true) {
            continue;
        }
        const numbers = row.invoice_numbers;
        if (Array.isArray(numbers)) {
            for (const value of numbers) {
                if (typeof value !== "string") continue;
                const trimmed = value.trim();
                if (!trimmed || seen.has(trimmed)) continue;
                seen.add(trimmed);
                invoiceNumbers.push(trimmed);
            }
        }
        const dates = row.close_dates;
        if (dates && typeof dates === "object" && !Array.isArray(dates)) {
            for (const [key, value] of Object.entries(
                dates as Record<string, unknown>
            )) {
                const invoiceNumber = key.trim();
                if (
                    !invoiceNumber ||
                    typeof value !== "string" ||
                    value.trim().length === 0
                ) {
                    continue;
                }
                closeDates[invoiceNumber] = value;
            }
        }
    }
    return { invoiceNumbers, closeDates };
}

/**
 * Save reconciled virtual-close IVNUMs for a Payment run so cache replay can
 * flush Helam-debit closes even though those rows are dropped from Payment.
 */
export async function savePendingInvoiceCloseCacheOrThrow(
    input: {
        accountId: number;
        connectorId: number;
        provider: string;
        syncMode: ImportCacheKey["syncMode"];
        cacheDay: string;
        customerScope: string;
        executionId: string | null | undefined;
        invoiceNumbers: Iterable<string>;
        closeDates?: Map<string, Date>;
    },
    onLog?: (message: string) => void
): Promise<void> {
    const invoiceNumbers = Array.from(
        new Set(
            Array.from(input.invoiceNumbers)
                .map((value) => value.trim())
                .filter((value) => value.length > 0)
        )
    );
    const closeDates: Record<string, string> = {};
    if (input.closeDates) {
        for (const [invoiceNumber, date] of input.closeDates) {
            const trimmed = invoiceNumber.trim();
            if (!trimmed || Number.isNaN(date.getTime())) continue;
            closeDates[trimmed] = date.toISOString();
        }
    }
    await saveEntityImportCacheOrThrow(
        {
            accountId: input.accountId,
            connectorId: input.connectorId,
            provider: input.provider,
            importType: IMPORT_CACHE_PENDING_INVOICE_CLOSE,
            syncMode: input.syncMode,
            cacheDay: input.cacheDay,
            customerScope: input.customerScope,
            executionId: input.executionId,
            rows: encodePendingInvoiceCloseRows({
                invoiceNumbers,
                closeDates,
            }),
        },
        onLog
    );
}

/**
 * Load PendingInvoiceClose by execution_id (+ mode/scope).
 * `cacheDay` is optional — omit so prior-day Payment replay still finds closes.
 */
export async function loadPendingInvoiceCloseCache(
    key: Omit<ImportCacheKey, "importType" | "cacheDay"> & {
        cacheDay?: string;
    }
): Promise<PendingInvoiceCloseTargets> {
    const docs = await store.load({
        accountId: key.accountId,
        executionId: key.executionId,
        importType: IMPORT_CACHE_PENDING_INVOICE_CLOSE,
        syncMode: key.syncMode,
        customerScope: key.customerScope,
        ...(typeof key.cacheDay === "string" && key.cacheDay.trim().length > 0
            ? { cacheDay: key.cacheDay.trim() }
            : {}),
    });
    const allRows: Record<string, unknown>[] = [];
    for (const doc of docs) {
        allRows.push(...doc.rows);
    }
    return decodePendingInvoiceCloseRows(allRows);
}

/**
 * @deprecated Best-effort write — prefer saveEntityImportCacheOrThrow (D2/D3).
 */
export async function trySaveEntityImportCache(
    input: Omit<SaveEntityImportCacheInput, "executionId"> & {
        executionId: string | null | undefined;
    },
    onLog?: (message: string) => void
): Promise<void> {
    try {
        await saveEntityImportCacheOrThrow(input, onLog);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onLog?.(
            `Import cache save failed for ${input.importType}: ${message}`
        );
    }
}
