/**
 * Account-scoped leftover band for as-of open AR residue.
 *
 * Lives on `BillingConnector` (one row per account). Default matches shared
 * {@link INVOICE_PAID_TOLERANCE}. No connector row → default 0.2.
 */
import { type DbClient, prisma } from "../domain-db";
import { INVOICE_PAID_TOLERANCE } from "./invoicePaidTolerance";

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
            return INVOICE_PAID_TOLERANCE;
        }
        const value = Number(connector.invoice_paid_tolerance);
        return Number.isFinite(value) ? value : INVOICE_PAID_TOLERANCE;
    } catch (error) {
        console.error("[resolveInvoicePaidTolerance] connector read failed", {
            accountId,
            message: error instanceof Error ? error.message : String(error),
        });
        return INVOICE_PAID_TOLERANCE;
    }
}

export async function resolveInvoicePaidTolerance(
    accountId: number | null | undefined,
    db: DbClient = prisma
): Promise<number> {
    if (accountId == null || !Number.isFinite(accountId)) {
        return INVOICE_PAID_TOLERANCE;
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
