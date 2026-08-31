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
 * to `null` — the ungated behavior that predates the gate.
 */
import { type DbClient, prisma } from "../domain-db";

import { createConnectorDateResolver } from "./shared/connectorDateResolver";

const resolver = createConnectorDateResolver(
    "mep_breach_start_date",
    "resolveMepBreachStartDate"
);

/** Drop cached values. Call at the start of a run that must read fresh. */
export function clearMepBreachStartDateCache(accountId?: number): void {
    resolver.clearCache(accountId);
}

export async function resolveMepBreachStartDate(
    accountId: number | null | undefined,
    db: DbClient = prisma
): Promise<Date | null> {
    return resolver.resolve(accountId, db);
}
