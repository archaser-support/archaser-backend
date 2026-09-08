import { resolveImportCacheDay } from "./cacheDay";
import { createMemoryImportCacheStore } from "./memoryStore";
import { mongooseImportCacheStore } from "./mongooseStore";
import type { ImportCacheStore } from "./store";
import {
    IMPORT_CACHE_PENDING_INVOICE_CLOSE,
    PENDING_INVOICE_CLOSE_ROW_MARKER,
    type ImportCacheDocument,
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

export async function findSameDayCacheRuns(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
}): Promise<SameDayCacheRun[]> {
    const cacheDay = resolveImportCacheDay(input.at, input.timeZone);
    const customerScope =
        typeof input.customerScope === "string" &&
        input.customerScope.trim().length > 0
            ? input.customerScope.trim()
            : "all";
    return store.listSameDayRuns({
        accountId: input.accountId,
        syncMode: input.syncMode,
        cacheDay,
        customerScope,
    });
}

/** @deprecated Use findSameDayCacheRuns — kept for transitional callers. */
export async function findSameDayCaches(input: {
    accountId: number;
    syncMode: ImportCacheKey["syncMode"];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
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
          cacheDay: string;
          customerScope: string;
          executionId: string;
          missing: ImportCacheEntityType[];
      };

/** @deprecated Alias for LoadImportCachesForReplayResult. */
export type LoadSameDayImportCachesResult = LoadImportCachesForReplayResult;

/**
 * Load backups for the requested entities on a specific execution.
 * Missing keys fail clearly (no silent ERP fallback). Empty row arrays are
 * valid when a backup exists (including zero-row successes).
 * PendingInvoiceClose is loaded separately via {@link loadPendingInvoiceCloseCache}.
 */
export async function loadImportCachesForReplay(input: {
    accountId: number;
    executionId: string;
    syncMode: ImportCacheKey["syncMode"];
    importTypes: ImportCacheEntityType[];
    customerScope?: string | null;
    timeZone?: string | null;
    at?: Date;
}): Promise<LoadImportCachesForReplayResult> {
    const executionId = requireExecutionId(input.executionId);
    const cacheDay = resolveImportCacheDay(input.at, input.timeZone);
    const customerScope =
        typeof input.customerScope === "string" &&
        input.customerScope.trim().length > 0
            ? input.customerScope.trim()
            : "all";
    const rowsByEntity = new Map<
        ImportCacheEntityType,
        Record<string, unknown>[]
    >();
    const missing: ImportCacheEntityType[] = [];
    for (const importType of input.importTypes) {
        const docs = await store.load({
            accountId: input.accountId,
            executionId,
            importType,
            syncMode: input.syncMode,
            cacheDay,
            customerScope,
        });
        if (docs.length === 0) {
            missing.push(importType);
            continue;
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
    return { ok: true, cacheDay, customerScope, executionId, rowsByEntity };
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
            customerScope:
                typeof input.customerScope === "string" &&
                input.customerScope.trim().length > 0
                    ? input.customerScope.trim()
                    : "all",
            executionId: "",
            missing: [...input.importTypes],
        };
    }
    return loadImportCachesForReplay({
        ...input,
        executionId: input.executionId,
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

export async function loadPendingInvoiceCloseCache(
    key: Omit<ImportCacheKey, "importType">
): Promise<PendingInvoiceCloseTargets> {
    const rows = await loadEntityImportCache({
        ...key,
        importType: IMPORT_CACHE_PENDING_INVOICE_CLOSE,
    });
    return decodePendingInvoiceCloseRows(rows);
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
