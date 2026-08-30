/**
 * Account-scoped resolver for the MEP breach start date.
 *
 * The value lives on `BillingConnector` (one row per account, `account_id` is
 * unique) and is locked while backfill runs, so it cannot change mid-run. Every
 * MEP path resolves it through here and gets a cached answer, so a sync or
 * recompute that touches thousands of invoices issues one connector read per
 * account rather than one per invoice.
 *
 * An account with no connector, or a connector with no configured date, resolves
 * to `null` — the ungated behavior that predates this gate.
 */
import { type DbClient, prisma } from "../domain-db";

import { toUtcDateOnly } from "./shared/insurancePolicyLifecycle";

/**
 * Cache lifetime. Long enough that a single sync / recompute run resolves once,
 * short enough that a newly saved date takes effect without a process restart
 * (the API and worker processes are long-lived).
 */
const CACHE_TTL_MS = 60_000;

type CacheEntry = { value: Date | null; expiresAt: number };

const cache = new Map<number, CacheEntry>();

/** Drop cached values. Call at the start of a run that must read fresh. */
export function clearMepBreachStartDateCache(accountId?: number): void {
    if (accountId == null) {
        cache.clear();
        return;
    }
    cache.delete(accountId);
}

async function readMepBreachStartDate(
    accountId: number,
    db: DbClient
): Promise<Date | null> {
    try {
        const connector = await db.billingConnector.findUnique({
            where: { account_id: accountId },
            select: { mep_breach_start_date: true },
        });
        const value = connector?.mep_breach_start_date ?? null;
        return value ? toUtcDateOnly(value) : null;
    } catch (error) {
        // Never fail a MEP recompute over the gate lookup: an unreadable
        // connector row degrades to ungated evaluation, which is the behavior
        // before this feature existed.
        console.error("[resolveMepBreachStartDate] connector read failed", {
            accountId,
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export async function resolveMepBreachStartDate(
    accountId: number | null | undefined,
    db: DbClient = prisma
): Promise<Date | null> {
    if (accountId == null || !Number.isFinite(accountId)) {
        return null;
    }

    const now = Date.now();
    const cached = cache.get(accountId);
    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    const value = await readMepBreachStartDate(accountId, db);
    cache.set(accountId, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
}
