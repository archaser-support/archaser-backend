/**
 * Account-scoped leftover band for as-of open AR residue.
 *
 * Lives on `BillingConnector` (one row per account). This package cannot import
 * `@archaser/billing-connector`, so the default `0.2` is duplicated here.
 * No connector row → default 0.2 (pre-feature behavior).
 */
import { type DbClient, prisma } from "../domain-db";

/** Same default as `ASOF_OPEN_AMOUNT_TOLERANCE` / `INVOICE_PAID_TOLERANCE`. */
const DEFAULT_INVOICE_PAID_TOLERANCE = 0.2;

const CACHE_TTL_MS = 60_000;

type CacheEntry = { value: number; expiresAt: number };

const cache = new Map<number, CacheEntry>();

export function clearInvoicePaidToleranceCache(accountId?: number): void {
    if (accountId == null) {
        cache.clear();
        return;
    }
    cache.delete(accountId);
}

async function readInvoicePaidTolerance(
    accountId: number,
    db: DbClient
): Promise<number> {
    try {
        const connector = await db.billingConnector.findUnique({
            where: { account_id: accountId },
            select: { invoice_paid_tolerance: true },
        });
        if (!connector) {
            return DEFAULT_INVOICE_PAID_TOLERANCE;
        }
        const value = Number(connector.invoice_paid_tolerance);
        return Number.isFinite(value) ? value : DEFAULT_INVOICE_PAID_TOLERANCE;
    } catch (error) {
        console.error("[resolveInvoicePaidTolerance] connector read failed", {
            accountId,
            message: error instanceof Error ? error.message : String(error),
        });
        return DEFAULT_INVOICE_PAID_TOLERANCE;
    }
}

export async function resolveInvoicePaidTolerance(
    accountId: number | null | undefined,
    db: DbClient = prisma
): Promise<number> {
    if (accountId == null || !Number.isFinite(accountId)) {
        return DEFAULT_INVOICE_PAID_TOLERANCE;
    }

    const now = Date.now();
    const cached = cache.get(accountId);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    const value = await readInvoicePaidTolerance(accountId, db);
    cache.set(accountId, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
}
