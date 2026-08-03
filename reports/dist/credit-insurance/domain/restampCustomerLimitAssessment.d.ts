import { DbClient } from "../domain-db";
/**
 * Re-stamp `limit_assessed_amount` on open invoices in stable id order so
 * approved limit + top-up waterfall matches import / restamp scripts.
 */
export declare function restampCustomerOpenInvoiceLimitAssessment(customerId: number, options?: {
    dbClient?: DbClient;
    accountCurrency?: string | null;
    dryRun?: boolean;
}): Promise<number>;
/**
 * Sum open Due/Overdue AR per customer+policy in limit/policy currency.
 */
export declare function sumOpenArByCustomerPolicyInLimitCurrency(rows: Array<{
    customer_id: number;
    policy_id: number;
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    customer_currency: string | null;
    amount: number | null;
}>, limitCurrencyByPolicyId: Map<number, string | null | undefined>, accountCurrency: string | null | undefined): Map<string, number>;
