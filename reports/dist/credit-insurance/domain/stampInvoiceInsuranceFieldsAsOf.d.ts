import type { DbClient } from "../domain-db";
/**
 * Persist insurance-related invoice fields using {@link asOf} as the evaluation
 * calendar day (invoice import / chronological replay), not wall-clock today.
 *
 * Skips {@link syncInvoiceReportingBreach} so live cron rules do not overwrite
 * backfill stamps immediately afterward.
 */
export declare function stampInvoiceInsuranceFieldsAsOf(invoiceId: number, asOf: Date, db?: DbClient): Promise<void>;
