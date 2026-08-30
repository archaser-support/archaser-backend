/**
 * Cached, account-scoped reader for a date column on `BillingConnector`.
 *
 * Several gates (MEP breach start, reporting breach start) key off a single
 * date stored once per account. A sync or recompute that touches thousands of
 * invoices must not issue one connector read per invoice, so each gate gets its
 * own resolver built here with a short-lived cache.
 *
 * An account with no connector, or a connector with no configured date,
 * resolves to `null` — the ungated behavior that predates these gates.
 */
import { type DbClient, prisma } from "../../domain-db";

import { toUtcDateOnly } from "./insurancePolicyLifecycle";

/**
 * Cache lifetime. Long enough that a single sync / recompute run resolves once,
 * short enough that a newly saved date takes effect without a process restart
 * (the API and worker processes are long-lived).
 */
const CACHE_TTL_MS = 60_000;

type CacheEntry = { value: Date | null; expiresAt: number };

type ConnectorDateColumn = "mep_breach_start_date" | "backfill_start_date";

export interface ConnectorDateResolver {
    resolve(
        accountId: number | null | undefined,
        db?: DbClient
    ): Promise<Date | null>;
    clearCache(accountId?: number): void;
}

export function createConnectorDateResolver(
    column: ConnectorDateColumn,
    logLabel: string
): ConnectorDateResolver {
    const cache = new Map<number, CacheEntry>();

    async function read(
        accountId: number,
        db: DbClient
    ): Promise<Date | null> {
        try {
            const connector = await db.billingConnector.findUnique({
                where: { account_id: accountId },
                select: { [column]: true } as never,
            });
            const value =
                (connector as Record<string, unknown> | null)?.[column] ?? null;
            return value ? toUtcDateOnly(value as Date) : null;
        } catch (error) {
            // Never fail a recompute over the gate lookup: an unreadable
            // connector row degrades to ungated evaluation, which is the
            // behavior before this feature existed.
            console.error(`[${logLabel}] connector read failed`, {
                accountId,
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    return {
        async resolve(accountId, db = prisma) {
            if (accountId == null || !Number.isFinite(accountId)) {
                return null;
            }
            const now = Date.now();
            const cached = cache.get(accountId);
            if (cached && cached.expiresAt > now) {
                return cached.value;
            }
            const value = await read(accountId, db);
            cache.set(accountId, { value, expiresAt: now + CACHE_TTL_MS });
            return value;
        },
        clearCache(accountId) {
            if (accountId == null) {
                cache.clear();
                return;
            }
            cache.delete(accountId);
        },
    };
}
