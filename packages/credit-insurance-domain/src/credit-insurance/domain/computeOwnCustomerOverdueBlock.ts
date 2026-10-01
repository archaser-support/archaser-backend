/**
 * Invoice-derived MEP overdue_block for one customer (ignores pool contagion).
 */
import { type DbClient, prisma } from "../domain-db";

import {
    computeCustomerOverdueBlock,
    isEligibleForCustomerMepOverdue,
} from "./invoiceInsuranceFields";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";
import { getActiveCustomerPolicyRow } from "./resolveActiveCustomerPolicy";
import { isInvoiceInMepBreachScope } from "./shared/mepBreachScope";

/**
 * Invoice-derived MEP overdue_block for one customer only (ignores pool
 * contagion stored on the row). Used by credit-pool rollup so sibling
 * contagion cannot keep the pool blocked after every leaf clears.
 */
export async function computeOwnCustomerOverdueBlock(
    customerId: number,
    dbClient: DbClient = prisma,
    asOfDate?: Date
): Promise<boolean> {
    const today = asOfDate ? new Date(asOfDate) : new Date();
    today.setHours(0, 0, 0, 0);

    const [overdueInvoices, customerRow, activePolicy] = await Promise.all([
        dbClient.invoice.findMany({
            where: {
                customer_id: customerId,
                status: "Overdue",
                OR: [{ amount: null }, { amount: { gte: 0 } }],
            },
            select: { due_date: true, amount: true, invoice_date: true },
        }),
        dbClient.customer.findUnique({
            where: { id: customerId },
            select: { account_id: true },
        }),
        getActiveCustomerPolicyRow(customerId, dbClient),
    ]);

    const mepBreachStartDate = await resolveMepBreachStartDate(
        customerRow?.account_id,
        dbClient
    );

    let oldestDueInMepScope: Date | null = null;
    let oldestIssueInMepScope: Date | null = null;
    for (const invoice of overdueInvoices) {
        if (!isEligibleForCustomerMepOverdue(invoice.amount)) {
            continue;
        }
        if (!invoice.due_date) {
            continue;
        }
        if (!isInvoiceInMepBreachScope(invoice.invoice_date, mepBreachStartDate)) {
            continue;
        }
        const dueDate = new Date(invoice.due_date);
        const issueDate = invoice.invoice_date
            ? new Date(invoice.invoice_date)
            : null;
        if (
            !oldestDueInMepScope ||
            dueDate < oldestDueInMepScope ||
            (issueDate &&
                oldestDueInMepScope &&
                dueDate.getTime() === oldestDueInMepScope.getTime() &&
                (!oldestIssueInMepScope ||
                    issueDate < oldestIssueInMepScope))
        ) {
            oldestDueInMepScope = dueDate;
            oldestIssueInMepScope = issueDate;
        }
    }

    const policyWithInsurance = activePolicy
        ? await dbClient.customerPolicy.findFirst({
              where: { id: activePolicy.id },
              select: {
                  max_allowed_mep: true,
                  mep_cutoff_day: true,
                  mep_substitute_extra_days: true,
              },
          })
        : null;

    return computeCustomerOverdueBlock({
        oldestInvoiceOverdueDate: oldestDueInMepScope,
        maxAllowedMepDays: policyWithInsurance?.max_allowed_mep ?? null,
        today,
        oldestInvoiceIssueDate: oldestIssueInMepScope,
        mepCutoffDay: policyWithInsurance?.mep_cutoff_day ?? null,
        mepSubstituteExtraDays:
            policyWithInsurance?.mep_substitute_extra_days ?? null,
    });
}
