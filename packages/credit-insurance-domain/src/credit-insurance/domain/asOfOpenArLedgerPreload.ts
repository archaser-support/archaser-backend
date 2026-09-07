import { Prisma } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";
import {
    type AsOfOpenInvoiceLine,
    toUtcDayStart,
    utcDayAfterExclusive,
} from "./asOfOpenAr";
import { resolveInvoicePaidTolerance } from "./resolveInvoicePaidTolerance";

/** Invoice row loaded once for a job's `to_date` window (no per-day payment aggregates). */
export type AsOfLedgerInvoiceRow = {
    invoiceId: number;
    customerId: number;
    policyId: number | null;
    invoiceDate: Date;
    dueDate: Date | null;
    amount: number | null;
    customerAmount: number | null;
    customerCurrency: string | null;
    reportingBreach: boolean;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl: boolean;
    ctvInvoiceAfterPolicyEnd: boolean;
    inCapacityGap: boolean;
    capacityGapAmount: number;
    actualReportingDate: Date | null;
    status: string;
};

export type AsOfLedgerPaymentRow = {
    invoiceId: number;
    paymentDate: Date;
    amount: number | null;
    customerAmount: number | null;
};

/** Preloaded invoice + payment ledger for an account through job `to_date`. */
export type AsOfOpenInvoiceLedger = {
    accountId: number;
    rangeToDate: Date;
    openAmountTolerance: number;
    invoices: AsOfLedgerInvoiceRow[];
    paymentsByInvoiceId: Map<number, AsOfLedgerPaymentRow[]>;
};

type AsOfLedgerInvoiceSqlRow = {
    invoice_id: number;
    customer_id: number;
    policy_id: number | null;
    invoice_date: Date;
    due_date: Date | null;
    amount: number | null;
    customer_amount: number | null;
    customer_currency: string | null;
    reporting_breach: boolean;
    ctv_payment_term: boolean;
    ctv_customer_overdue_mep: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
    in_capacity_gap: boolean;
    capacity_gap_amount: number | null;
    actual_reporting_date: Date | null;
    status: string;
};

type AsOfLedgerPaymentSqlRow = {
    invoice_id: number;
    payment_date: Date;
    amount: number | null;
    customer_amount: number | null;
};

function mapLedgerInvoiceRow(row: AsOfLedgerInvoiceSqlRow): AsOfLedgerInvoiceRow {
    return {
        invoiceId: Number(row.invoice_id),
        customerId: Number(row.customer_id),
        policyId: row.policy_id != null ? Number(row.policy_id) : null,
        invoiceDate: row.invoice_date,
        dueDate: row.due_date,
        amount: row.amount != null ? Number(row.amount) : null,
        customerAmount:
            row.customer_amount != null ? Number(row.customer_amount) : null,
        customerCurrency: row.customer_currency,
        reportingBreach: Boolean(row.reporting_breach),
        ctvPaymentTerm: Boolean(row.ctv_payment_term),
        ctvCustomerOverdueMep: Boolean(row.ctv_customer_overdue_mep),
        ctvOutdatedDcl: Boolean(row.ctv_outdated_dcl),
        ctvInvoiceAfterPolicyEnd: Boolean(row.ctv_invoice_after_policy_end),
        inCapacityGap: Boolean(row.in_capacity_gap),
        capacityGapAmount: Number(row.capacity_gap_amount ?? 0),
        actualReportingDate: row.actual_reporting_date,
        status: row.status,
    };
}

function buildInvoiceScopeSql(
    accountId: number,
    rangeAsOf: Date,
    options?: { customerIds?: number[]; policyId?: number }
) {
    const customerFilter =
        options?.customerIds != null && options.customerIds.length > 0
            ? Prisma.sql`AND i.customer_id IN (${Prisma.join(options.customerIds)})`
            : Prisma.empty;
    const policyFilter =
        options?.policyId != null
            ? Prisma.sql`AND i.policy_id = ${options.policyId}`
            : Prisma.empty;
    return {
        customerFilter,
        policyFilter,
        where: Prisma.sql`
            i.account_id = ${accountId}
            AND c.account_id = ${accountId}
            AND c.collection_status IN ('Active', 'Inactive')
            AND i.invoice_date <= ${rangeAsOf}
            AND i.status::text NOT IN ('Void', 'Cancelled')
            ${customerFilter}
            ${policyFilter}
        `,
    };
}

/**
 * Load invoice rows and payment rows once for the full backfill window through
 * `rangeToDate` (inclusive UTC calendar day).
 */
export async function loadAsOfOpenInvoiceLedgerRange(
    accountId: number,
    rangeToDate: Date,
    options?: {
        customerIds?: number[];
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<AsOfOpenInvoiceLedger> {
    const db = options?.dbClient ?? defaultPrisma;
    const rangeAsOf = toUtcDayStart(rangeToDate);
    const rangeDayAfter = utcDayAfterExclusive(rangeAsOf);
    const { where } = buildInvoiceScopeSql(accountId, rangeAsOf, options);

    const invoiceRows = await db.$queryRaw<AsOfLedgerInvoiceSqlRow[]>`
        SELECT
            i.id AS invoice_id,
            i.customer_id,
            i.policy_id,
            i.invoice_date,
            i.due_date,
            i.amount,
            i.customer_amount,
            i.customer_currency,
            COALESCE(i.reporting_breach, false) AS reporting_breach,
            COALESCE(i.ctv_payment_term, false) AS ctv_payment_term,
            COALESCE(i.ctv_customer_overdue_mep, false) AS ctv_customer_overdue_mep,
            COALESCE(i.ctv_outdated_dcl, false) AS ctv_outdated_dcl,
            COALESCE(i.ctv_invoice_after_policy_end, false) AS ctv_invoice_after_policy_end,
            COALESCE(i.in_capacity_gap, false) AS in_capacity_gap,
            COALESCE(i.capacity_gap_amount, 0)::float AS capacity_gap_amount,
            i.actual_reporting_date,
            i.status::text AS status
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        WHERE ${where}
    `;

    const paymentRows = await db.$queryRaw<AsOfLedgerPaymentSqlRow[]>`
        SELECT
            ip.invoice_id,
            ip.payment_date,
            ip.amount,
            ip.customer_amount
        FROM "InvoicePayment" ip
        INNER JOIN "Invoice" i ON i.id = ip.invoice_id
        INNER JOIN "Customer" c ON c.id = i.customer_id
        WHERE ip.account_id = ${accountId}
          AND ${where}
          AND ip.payment_date < ${rangeDayAfter}
    `;

    const paymentsByInvoiceId = new Map<number, AsOfLedgerPaymentRow[]>();
    for (const row of paymentRows) {
        const invoiceId = Number(row.invoice_id);
        const bucket = paymentsByInvoiceId.get(invoiceId) ?? [];
        bucket.push({
            invoiceId,
            paymentDate: row.payment_date,
            amount: row.amount != null ? Number(row.amount) : null,
            customerAmount:
                row.customer_amount != null
                    ? Number(row.customer_amount)
                    : null,
        });
        paymentsByInvoiceId.set(invoiceId, bucket);
    }

    const openAmountTolerance = await resolveInvoicePaidTolerance(
        accountId,
        db
    );

    return {
        accountId,
        rangeToDate: rangeAsOf,
        openAmountTolerance,
        invoices: invoiceRows.map(mapLedgerInvoiceRow),
        paymentsByInvoiceId,
    };
}

export type LedgerPaymentAggregate = {
    paidAmount: number;
    paidCustomerAmount: number;
    lastPaymentDate: Date | null;
};

/** Sum payments strictly before `dayAfterExclusive` (same cutoff as per-day SQL). */
export function aggregateLedgerPaymentsOnOrBefore(
    payments: AsOfLedgerPaymentRow[] | undefined,
    dayAfterExclusive: Date
): LedgerPaymentAggregate {
    let paidAmount = 0;
    let paidCustomerAmount = 0;
    let lastPaymentDate: Date | null = null;
    if (!payments || payments.length === 0) {
        return { paidAmount, paidCustomerAmount, lastPaymentDate };
    }
    const cutoff = dayAfterExclusive.getTime();
    for (const payment of payments) {
        if (payment.paymentDate.getTime() >= cutoff) {
            continue;
        }
        paidAmount += Number(payment.amount ?? 0);
        paidCustomerAmount += Number(payment.customerAmount ?? 0);
        if (
            !lastPaymentDate ||
            payment.paymentDate.getTime() > lastPaymentDate.getTime()
        ) {
            lastPaymentDate = payment.paymentDate;
        }
    }
    return { paidAmount, paidCustomerAmount, lastPaymentDate };
}

function buildAsOfLineFromLedgerInvoice(
    invoice: AsOfLedgerInvoiceRow,
    aggregate: LedgerPaymentAggregate,
    openAmountTolerance: number
): AsOfOpenInvoiceLine {
    return {
        invoiceId: invoice.invoiceId,
        customerId: invoice.customerId,
        policyId: invoice.policyId,
        invoiceDate: invoice.invoiceDate,
        dueDate: invoice.dueDate,
        amount: invoice.amount,
        customerAmount: invoice.customerAmount,
        customerCurrency: invoice.customerCurrency,
        paymentsOnOrBeforeAsOf: aggregate.paidAmount,
        paymentsCustomerOnOrBeforeAsOf: aggregate.paidCustomerAmount,
        reportingBreach: invoice.reportingBreach,
        ctvPaymentTerm: invoice.ctvPaymentTerm,
        ctvCustomerOverdueMep: invoice.ctvCustomerOverdueMep,
        ctvOutdatedDcl: invoice.ctvOutdatedDcl,
        ctvInvoiceAfterPolicyEnd: invoice.ctvInvoiceAfterPolicyEnd,
        inCapacityGap: invoice.inCapacityGap,
        capacityGapAmount: invoice.capacityGapAmount,
        actualReportingDate: invoice.actualReportingDate,
        lastPaymentDate: aggregate.lastPaymentDate,
        liveClosed: invoice.status === "Paid",
        openAmountTolerance,
    };
}

/**
 * Derive the same {@link AsOfOpenInvoiceLine} candidates as
 * {@link loadAsOfOpenInvoiceCandidates} for `snapshotDate` from a preloaded ledger.
 */
export function deriveAsOfOpenInvoiceCandidatesFromLedger(
    ledger: AsOfOpenInvoiceLedger,
    snapshotDate: Date,
    options?: { customerIds?: number[]; policyId?: number }
): AsOfOpenInvoiceLine[] {
    const asOf = toUtcDayStart(snapshotDate);
    const dayAfter = utcDayAfterExclusive(asOf);
    const asOfTime = asOf.getTime();
    const customerIdSet =
        options?.customerIds != null && options.customerIds.length > 0
            ? new Set(options.customerIds)
            : null;

    const lines: AsOfOpenInvoiceLine[] = [];
    for (const invoice of ledger.invoices) {
        if (toUtcDayStart(invoice.invoiceDate).getTime() > asOfTime) {
            continue;
        }
        if (customerIdSet && !customerIdSet.has(invoice.customerId)) {
            continue;
        }
        if (
            options?.policyId != null &&
            invoice.policyId !== options.policyId
        ) {
            continue;
        }
        const aggregate = aggregateLedgerPaymentsOnOrBefore(
            ledger.paymentsByInvoiceId.get(invoice.invoiceId),
            dayAfter
        );
        lines.push(
            buildAsOfLineFromLedgerInvoice(
                invoice,
                aggregate,
                ledger.openAmountTolerance
            )
        );
    }
    return lines;
}
