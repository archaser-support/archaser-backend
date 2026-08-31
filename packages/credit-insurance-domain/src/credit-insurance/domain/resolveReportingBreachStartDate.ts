/**
 * Account-scoped resolver for the reporting-breach start date.
 *
 * Reporting breach is gated on `BillingConnector.backfill_start_date`: invoices
 * issued before the backfill window are historical rows whose reporting
 * filings were never imported, so they must not be promoted to breach. Mirrors
 * {@link ./resolveMepBreachStartDate} — one connector read per account per run
 * rather than one per invoice.
 *
 * An account with no connector, or a connector with no configured date,
 * resolves to `null` — the ungated behavior that predates this gate.
 */
import { type DbClient, prisma } from "../domain-db";

import { toUtcDateOnly } from "./shared/insurancePolicyLifecycle";

/** Matches the MEP resolver: long enough for one run, short enough to pick up a save. */
const CACHE_TTL_MS = 60_000;

type CacheEntry = { value: Date | null; expiresAt: number };

const cache = new Map<number, CacheEntry>();

/** Drop cached values. Call at the start of a run that must read fresh. */
export function clearReportingBreachStartDateCache(accountId?: number): void {
    if (accountId == null) {
        cache.clear();
        return;
    }
    cache.delete(accountId);
}

async function readReportingBreachStartDate(
    accountId: number,
    db: DbClient
): Promise<Date | null> {
    try {
        const connector = await db.billingConnector.findUnique({
            where: { account_id: accountId },
            select: { backfill_start_date: true },
        });
        const value = connector?.backfill_start_date ?? null;
        return value ? toUtcDateOnly(value) : null;
    } catch (error) {
        // Never fail a reporting-breach sweep over the gate lookup: an
        // unreadable connector row degrades to ungated evaluation, which is the
        // behavior before this feature existed.
        console.error(
            "[resolveReportingBreachStartDate] connector read failed",
            {
                accountId,
                message: error instanceof Error ? error.message : String(error),
            }
        );
        return null;
    }
}

export async function resolveReportingBreachStartDate(
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

    const value = await readReportingBreachStartDate(accountId, db);
    cache.set(accountId, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
}

/**
 * Batch variant: one connector read per distinct account in a sweep.
 */
export async function resolveReportingBreachStartDatesForAccounts(
    accountIds: Iterable<number | null | undefined>,
    db: DbClient = prisma
): Promise<Map<number, Date | null>> {
    const resolved = new Map<number, Date | null>();
    const distinct = new Set<number>();
    for (const accountId of accountIds) {
        if (accountId != null && Number.isFinite(accountId)) {
            distinct.add(accountId);
        }
    }
    for (const accountId of distinct) {
        resolved.set(
            accountId,
            await resolveReportingBreachStartDate(accountId, db)
        );
    }
    return resolved;
}
