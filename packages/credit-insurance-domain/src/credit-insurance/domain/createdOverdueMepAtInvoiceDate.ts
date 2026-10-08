import { type DbClient, prisma } from "../domain-db";

import {
    asOfPaymentSumKey,
    computeAsOfOpenInvoiceLine,
    oldestOverdueDueAtEachInvoiceIssueDate,
    loadAsOfOpenInvoiceCandidates,
    loadAsOfPaymentSumsForInvoiceDays,
    toUtcDayStart,
    type AsOfOpenInvoiceLine,
    type CustomerOverdueMepMonthEnd,
    type OldestOverdueAtIssue,
} from "./asOfOpenAr";
import {
    computeCustomerDaysPastMep,
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

/** Cause invoice as of the flagged invoice's issue date (frozen with the flag). */
export type CreatedOverdueMepCauseSnapshot = {
    dueDate: Date;
    /** Customer-currency open amount on the flagged invoice's issue date. */
    outstandingCustomerAmount: number | null;
    /** Flagged issue date − customer MEP deadline (overdue-block math). */
    daysPastMep: number | null;
};

export type CreatedOverdueMepResolution = {
    flagged: boolean;
    causeInvoiceId: number | null;
    cause: CreatedOverdueMepCauseSnapshot | null;
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
export async function resolveCreatedOverdueMepDetailsByInvoiceId(args: {
    accountId: number;
    customerId: number;
    invoices: InvoiceForCreatedOverdueMep[];
    maxAllowedMep: number | null | undefined;
    /** Pass an already-resolved value to skip the per-account connector read. */
    mepBreachStartDate?: Date | null;
    monthEnd?: CustomerOverdueMepMonthEnd;
    db?: DbClient;
}): Promise<Map<number, CreatedOverdueMepResolution>> {
    const result = new Map<number, CreatedOverdueMepResolution>();
    if (args.invoices.length === 0) {
        return result;
    }
    for (const invoice of args.invoices) {
        result.set(invoice.id, {
            flagged: false,
            causeInvoiceId: null,
            cause: null,
        });
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

    const flaggedCauses: Array<{
        invoice: InvoiceForCreatedOverdueMep;
        oldest: OldestOverdueAtIssue;
        daysPastMep: number;
    }> = [];
    for (const invoice of eligible) {
        if (
            !isInvoiceInMepBreachScope(
                invoice.invoice_date,
                mepBreachStartDate
            )
        ) {
            continue;
        }
        const oldest = oldestByInvoiceId.get(invoice.id) ?? null;
        const daysPastMep = computeCustomerDaysPastMep({
            oldestInvoiceOverdueDate: oldest?.dueDate ?? null,
            maxAllowedMepDays: args.maxAllowedMep,
            today: invoice.invoice_date,
            oldestInvoiceIssueDate: oldest?.invoiceDate ?? null,
            mepCutoffDay: args.monthEnd?.mepCutoffDay,
            mepSubstituteExtraDays: args.monthEnd?.mepSubstituteExtraDays,
        });
        if (oldest && daysPastMep != null && daysPastMep > 0) {
            flaggedCauses.push({ invoice, oldest, daysPastMep });
        }
    }

    const lineById = new Map(lines.map((line) => [line.invoiceId, line]));
    const outstandingByInvoiceId = await resolveCauseOutstandingAtIssueDate(
        args.accountId,
        flaggedCauses.map(({ invoice, oldest }) => ({
            flaggedInvoiceId: invoice.id,
            asOfDate: invoice.invoice_date,
            causeLine: lineById.get(oldest.invoiceId),
        })),
        args.db ?? prisma
    );

    for (const { invoice, oldest, daysPastMep } of flaggedCauses) {
        result.set(invoice.id, {
            flagged: true,
            causeInvoiceId: oldest.invoiceId,
            cause: {
                dueDate: oldest.dueDate,
                outstandingCustomerAmount:
                    outstandingByInvoiceId.get(invoice.id) ?? null,
                daysPastMep,
            },
        });
    }
    return result;
}

/**
 * Cause line open (customer currency) on each flagged invoice's issue date.
 * Lines are loaded with payments up to the batch's latest issue date, so a
 * cause paid between the two days is re-summed as of the earlier day.
 */
async function resolveCauseOutstandingAtIssueDate(
    accountId: number,
    requests: Array<{
        flaggedInvoiceId: number;
        asOfDate: Date;
        causeLine: AsOfOpenInvoiceLine | undefined;
    }>,
    db: DbClient
): Promise<Map<number, number | null>> {
    const result = new Map<number, number | null>();
    const needsResum = requests.filter(
        (request): request is typeof request & { causeLine: AsOfOpenInvoiceLine } =>
            request.causeLine != null &&
            request.causeLine.lastPaymentDate != null &&
            toUtcDayStart(request.causeLine.lastPaymentDate).getTime() >
                toUtcDayStart(request.asOfDate).getTime()
    );
    const sums = await loadAsOfPaymentSumsForInvoiceDays(
        accountId,
        needsResum.map((request) => ({
            invoiceId: request.causeLine.invoiceId,
            asOfDate: request.asOfDate,
        })),
        db
    );
    for (const request of requests) {
        if (!request.causeLine) {
            result.set(request.flaggedInvoiceId, null);
            continue;
        }
        const resummed = sums.get(
            asOfPaymentSumKey(request.causeLine.invoiceId, request.asOfDate)
        );
        const computed = computeAsOfOpenInvoiceLine(
            resummed ? { ...request.causeLine, ...resummed } : request.causeLine,
            request.asOfDate
        );
        result.set(
            request.flaggedInvoiceId,
            computed ? computed.openCustomerAmount : null
        );
    }
    return result;
}

export async function resolveCreatedOverdueMepByInvoiceId(args: {
    accountId: number;
    customerId: number;
    invoices: InvoiceForCreatedOverdueMep[];
    maxAllowedMep: number | null | undefined;
    mepBreachStartDate?: Date | null;
    monthEnd?: CustomerOverdueMepMonthEnd;
    db?: DbClient;
}): Promise<Map<number, boolean>> {
    const details = await resolveCreatedOverdueMepDetailsByInvoiceId(args);
    const result = new Map<number, boolean>();
    for (const [invoiceId, row] of details) {
        result.set(invoiceId, row.flagged);
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
    monthEnd?: CustomerOverdueMepMonthEnd;
    db?: DbClient;
}): Promise<boolean> {
    const byId = await resolveCreatedOverdueMepByInvoiceId({
        accountId: args.accountId,
        customerId: args.customerId,
        invoices: [args.invoice],
        maxAllowedMep: args.maxAllowedMep,
        mepBreachStartDate: args.mepBreachStartDate,
        monthEnd: args.monthEnd,
        db: args.db,
    });
    return byId.get(args.invoice.id) ?? false;
}

/** Invoice columns written with `ctv_customer_overdue_mep` (cause + frozen snapshot). */
export type CreatedOverdueMepCauseColumns = {
    ctv_customer_overdue_mep_cause_invoice_number: string | null;
    ctv_customer_overdue_mep_cause_due_date: Date | null;
    ctv_customer_overdue_mep_cause_outstanding: number | null;
    ctv_customer_overdue_mep_days_past: number | null;
};

const EMPTY_CAUSE_COLUMNS: CreatedOverdueMepCauseColumns = {
    ctv_customer_overdue_mep_cause_invoice_number: null,
    ctv_customer_overdue_mep_cause_due_date: null,
    ctv_customer_overdue_mep_cause_outstanding: null,
    ctv_customer_overdue_mep_days_past: null,
};

/** All null unless the invoice is flagged and the cause has an invoice number. */
export function buildCreatedOverdueMepCauseColumns(
    flagged: boolean,
    resolution: CreatedOverdueMepResolution | undefined,
    causeNumbers: Map<number, string>
): CreatedOverdueMepCauseColumns {
    const causeId = resolution?.causeInvoiceId ?? null;
    const causeNumber =
        flagged && causeId != null ? causeNumbers.get(causeId) ?? null : null;
    if (causeNumber == null) {
        return EMPTY_CAUSE_COLUMNS;
    }
    const cause = resolution?.cause ?? null;
    return {
        ctv_customer_overdue_mep_cause_invoice_number: causeNumber,
        ctv_customer_overdue_mep_cause_due_date: cause?.dueDate ?? null,
        ctv_customer_overdue_mep_cause_outstanding:
            cause?.outstandingCustomerAmount ?? null,
        ctv_customer_overdue_mep_days_past: cause?.daysPastMep ?? null,
    };
}

/** `YYYY-MM-DD` (UTC calendar day, as stored in `@db.Date`) or null. */
export function toCauseDueDateYmd(value: Date | null | undefined): string | null {
    return value ? toUtcDayStart(value).toISOString().slice(0, 10) : null;
}

export function isSameCreatedOverdueMepCauseColumns(
    a: CreatedOverdueMepCauseColumns,
    b: CreatedOverdueMepCauseColumns
): boolean {
    return (
        a.ctv_customer_overdue_mep_cause_invoice_number ===
            b.ctv_customer_overdue_mep_cause_invoice_number &&
        toCauseDueDateYmd(a.ctv_customer_overdue_mep_cause_due_date) ===
            toCauseDueDateYmd(b.ctv_customer_overdue_mep_cause_due_date) &&
        a.ctv_customer_overdue_mep_cause_outstanding ===
            b.ctv_customer_overdue_mep_cause_outstanding &&
        a.ctv_customer_overdue_mep_days_past ===
            b.ctv_customer_overdue_mep_days_past
    );
}

export async function loadInvoiceNumbersById(
    invoiceIds: number[],
    db: DbClient = prisma
): Promise<Map<number, string>> {
    const uniqueIds = Array.from(
        new Set(invoiceIds.filter((id) => Number.isFinite(id) && id > 0))
    );
    const result = new Map<number, string>();
    if (uniqueIds.length === 0) {
        return result;
    }
    const rows = await db.invoice.findMany({
        where: { id: { in: uniqueIds } },
        select: { id: true, invoice_number: true },
    });
    for (const row of rows) {
        const number = row.invoice_number?.trim();
        if (number) {
            result.set(row.id, number);
        }
    }
    return result;
}
