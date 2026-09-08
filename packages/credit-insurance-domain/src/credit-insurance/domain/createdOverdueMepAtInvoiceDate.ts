import { type DbClient, prisma } from "../domain-db";

import {
    oldestOverdueDueAtEachInvoiceIssueDate,
    loadAsOfOpenInvoiceCandidates,
    type AsOfOpenInvoiceLine,
} from "./asOfOpenAr";
import {
    computeCustomerOverdueBlock,
    isEligibleForCustomerMepOverdue,
} from "./invoiceInsuranceFields";
import { resolveMepBreachStartDate } from "./resolveMepBreachStartDate";
import {
    filterInvoicesInMepBreachScope,
    isInvoiceInMepBreachScope,
} from "./shared/mepBreachScope";

export type InvoiceForCreatedOverdueMep = {
    id: number;
    invoice_date: Date;
    amount: number | null;
};

/**
 * Resolves `ctv_customer_overdue_mep` (created while customer past MEP) for each
 * invoice using the payment ledger, so the answer is the block state on the
 * invoice's own issue date rather than the wall-clock `Customer.overdue_block`.
 *
 * Flag math matches CPT overlay: {@link oldestOverdueDueAtEachInvoiceIssueDate}
 * + {@link computeCustomerOverdueBlock} (O(C log C) sweep, not per-invoice
 * sibling rescans). Credit notes are excluded up front to skip the ledger load
 * when nothing eligible remains; out-of-scope lines are dropped from siblings
 * so a legacy invoice cannot block a newer one.
 */
export async function resolveCreatedOverdueMepByInvoiceId(args: {
    accountId: number;
    customerId: number;
    invoices: InvoiceForCreatedOverdueMep[];
    maxAllowedMep: number | null | undefined;
    /** Pass an already-resolved value to skip the per-account connector read. */
    mepBreachStartDate?: Date | null;
    db?: DbClient;
}): Promise<Map<number, boolean>> {
    const result = new Map<number, boolean>();
    if (args.invoices.length === 0) {
        return result;
    }

    for (const invoice of args.invoices) {
        result.set(invoice.id, false);
    }
    if (args.maxAllowedMep == null) {
        return result;
    }

    const mepBreachStartDate =
        args.mepBreachStartDate !== undefined
            ? args.mepBreachStartDate
            : await resolveMepBreachStartDate(args.accountId, args.db);

    const eligible = filterInvoicesInMepBreachScope(
        args.invoices.filter((invoice) =>
            isEligibleForCustomerMepOverdue(invoice.amount)
        ),
        mepBreachStartDate,
        (invoice) => invoice.invoice_date
    );
    if (eligible.length === 0) {
        return result;
    }

    const latestInvoiceDate = eligible.reduce<Date>(
        (latest, invoice) =>
            invoice.invoice_date > latest ? invoice.invoice_date : latest,
        eligible[0]!.invoice_date
    );
    const allLines: AsOfOpenInvoiceLine[] = await loadAsOfOpenInvoiceCandidates(
        args.accountId,
        latestInvoiceDate,
        { customerIds: [args.customerId], dbClient: args.db ?? prisma }
    );
    const lines = filterInvoicesInMepBreachScope(
        allLines,
        mepBreachStartDate,
        (line) => line.invoiceDate
    );

    const oldestByInvoiceId = oldestOverdueDueAtEachInvoiceIssueDate(
        lines,
        mepBreachStartDate
    );

    for (const invoice of eligible) {
        if (
            !isInvoiceInMepBreachScope(
                invoice.invoice_date,
                mepBreachStartDate
            )
        ) {
            continue;
        }
        result.set(
            invoice.id,
            computeCustomerOverdueBlock({
                oldestInvoiceOverdueDate:
                    oldestByInvoiceId.get(invoice.id) ?? null,
                maxAllowedMepDays: args.maxAllowedMep,
                today: invoice.invoice_date,
            })
        );
    }
    return result;
}

export async function resolveCreatedOverdueMepForInvoice(args: {
    accountId: number;
    customerId: number;
    invoice: InvoiceForCreatedOverdueMep;
    maxAllowedMep: number | null | undefined;
    /** Pass an already-resolved value to skip the per-account connector read. */
    mepBreachStartDate?: Date | null;
    db?: DbClient;
}): Promise<boolean> {
    const byId = await resolveCreatedOverdueMepByInvoiceId({
        accountId: args.accountId,
        customerId: args.customerId,
        invoices: [args.invoice],
        maxAllowedMep: args.maxAllowedMep,
        mepBreachStartDate: args.mepBreachStartDate,
        db: args.db,
    });
    return byId.get(args.invoice.id) ?? false;
}
