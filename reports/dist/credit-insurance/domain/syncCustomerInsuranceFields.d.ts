/**
 * Recomputes `Customer.oldest_invoice_overdue_date` and `Customer.overdue_block`
 * from live Invoice rows; policy-derived fields (MEP, DCL, limits) are written to
 * the active CustomerPolicy.
 *
 * Ported from the legacy `server/services/creditInsurance/syncCustomerInsuranceFields.ts`
 * (deleted in frontend commit 2223f5e). One legacy behaviour is intentionally dropped:
 * the original wrote an "overdue block applied/cleared" timeline Activity via
 * `ActivityService`, which has no Nest equivalent. Its only caller here is checkpoint
 * restore, where manufacturing an Activity row absent from the snapshot would corrupt
 * the restored baseline.
 */
import { type DbClient } from "../domain-db";
export type SyncCustomerInsuranceFieldsOptions = {
    dbClient?: DbClient;
    /** Follow-up effects need a committed client, so they default off inside a transaction. */
    runFollowUpEffects?: boolean;
    validateZeroLimitDate?: boolean;
    /** When set, the gap pipeline only recomputes these invoices' gaps. */
    invoiceIds?: number[];
    /** Calendar day for overdue_block / DCL evaluation (chronological replay). */
    asOfDate?: Date;
    /** Recompute open-invoice terms-breach flags after policy exclusion/limit-type changes. */
    refreshTermsBreachFlags?: boolean;
};
export declare function syncCustomerInsuranceFields(customerId: number, options?: SyncCustomerInsuranceFieldsOptions): Promise<void>;
