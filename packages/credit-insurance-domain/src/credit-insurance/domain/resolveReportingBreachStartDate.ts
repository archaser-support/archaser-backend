/**
 * Account-scoped resolver for the reporting breach start date.
 *
 * Reporting breach marks an invoice whose reporting deadline passed unreported.
 * Invoices issued before the account went live on the connector are imported
 * history: their reporting deadlines predate the customer's use of the system,
 * so promoting them to breach is noise. `BillingConnector.backfill_start_date`
 * is that go-live boundary, and it is locked once backfill starts.
 *
 * An account with no connector, or a connector with no configured date, resolves
 * to `null` — every invoice stays in scope, the behavior that predates the gate.
 */
import { type DbClient, prisma } from "../domain-db";

import { createConnectorDateResolver } from "./shared/connectorDateResolver";

const resolver = createConnectorDateResolver(
    "backfill_start_date",
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
