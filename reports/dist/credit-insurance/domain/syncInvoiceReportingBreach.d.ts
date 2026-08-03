import { prisma } from "../domain-db";
type DbClient = typeof prisma;
/**
 * Sets Invoice.reporting_breach to true when Due/Overdue, target reporting date &lt; today,
 * and no actual_reporting_date. Sets to false only when actual_reporting_date is set.
 * Does not clear reporting_breach on Paid/Cancelled alone.
 */
export declare function syncInvoiceReportingBreach(invoiceId: number, db?: DbClient): Promise<void>;
/**
 * When reporting was filed (actual date set), clear reporting_breach for IDs in this batch.
 * Matches {@link syncInvoiceReportingBreach} clearing rules.
 */
export declare function clearReportingBreachWhenReportedForInvoiceIds(invoiceIds: number[], db?: DbClient): Promise<number>;
/**
 * Cron / batch: set reporting_breach to true using {@link shouldSetReportingBreach}
 * (Due/Overdue, target reporting date &lt; today, no actual_reporting_date). Only promotes false → true.
 */
export declare function sweepReportingBreachForOverdueInvoiceIds(invoiceIds: number[], db?: DbClient): Promise<number>;
/**
 * Recompute target_reporting_date and target_mep_date from invoice due_date and
 * Customer.reporting_days / max_allowed_mep (same as import / refreshInsuranceFields).
 */
export declare function refreshInsuranceTargetDatesForInvoiceIds(invoiceIds: number[], db?: DbClient): Promise<number>;
/**
 * Recompute ctv_payment_term from invoice dates and Customer.max_payment_term (batch / cron).
 */
export declare function refreshPaymentTermBreachForInvoiceIds(invoiceIds: number[], db?: DbClient): Promise<number>;
/**
 * Recompute created-terms violation snapshot booleans from current Customer + InsurancePolicy rows.
 * Uses batched reads + parallel updates (for cron/post-import sweep; avoids N sequential full-service refreshes).
 */
export declare function refreshCtvSnapshotsForInvoiceIds(invoiceIds: number[], db?: DbClient): Promise<number>;
/**
 * Clear the "customer excluded from policy at creation" invoice flag
 * ({@link Invoice.ctv_customer_excluded_from_policy}) for every invoice of a customer
 * once the customer is included again (active policy `excluded_from_policy` is not true).
 * No-op while the customer is still excluded.
 */
export declare function clearCustomerExcludedFromPolicyFlagWhenIncluded(customerId: number, db?: DbClient): Promise<number>;
/**
 * Recompute terms-breach invoice flags for a customer's open Due/Overdue invoices
 * after policy exclusion or limit-type changes. Also clears the "excluded from policy
 * at creation" flag across all of the customer's invoices when they are now included.
 */
export declare function refreshTermsBreachFlagsForCustomer(customerId: number, db?: DbClient): Promise<number>;
export {};
