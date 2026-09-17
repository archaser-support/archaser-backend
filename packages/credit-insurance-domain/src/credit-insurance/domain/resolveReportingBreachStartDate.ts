/**
 * Account-scoped resolver for the reporting breach start date.
 *
 * Reporting breach marks an invoice whose reporting deadline passed unreported.
 * Invoices issued before `BillingConnector.reporting_breach_start_date` are out of
 * scope permanently (import history / pre-cutover). Live sync, overnight sweep,
 * and Portfolio Health Generate all share this gate.
 *
 * Null means no gate is configured: Generate fails closed and overnight sweeps
 * skip the account. Callers must not treat null as “evaluate all history.”
 */
import { type DbClient, prisma } from "../domain-db";

import { createConnectorDateResolver } from "./shared/connectorDateResolver";

const resolver = createConnectorDateResolver(
    "reporting_breach_start_date",
    "resolveReportingBreachStartDate"
);

/** Drop cached values. Call at the start of a run that must read fresh. */
export function clearReportingBreachStartDateCache(accountId?: number): void {
    resolver.clearCache(accountId);
}

export async function resolveReportingBreachStartDate(
    accountId: number | null | undefined,
    db: DbClient = prisma
): Promise<Date | null> {
    return resolver.resolve(accountId, db);
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
