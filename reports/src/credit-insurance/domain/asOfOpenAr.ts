import { Prisma, type invoice_status } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";
import { convertAmountToCurrencyLatestRate } from "./customerCreditInsuranceHeaderAmounts";
import {
    computeCreatedTermsViolationInvoiceAfterPolicyEnd,
    computeCustomerOverdueBlock,
    computeInvoiceInsuranceRowData,
    computeLimitExcessOverEffective,
} from "./invoiceInsuranceFields";
import { computeInvoiceLineOpenArInAccountCurrency } from "./openReceivableByCustomerCurrency";

/** Invoice statuses excluded from as-of open AR (cancelled / void book). */
export const ASOF_OPEN_AR_EXCLUDED_STATUSES = ["Void", "Cancelled"] as const;

export type AsOfAmountPair = {
    /** Primary / account-side amount (invoice `amount`, payment `amount`). */
    amount: number | null | undefined;
    /** Customer-currency amount (`customer_amount`). */
    customerAmount: number | null | undefined;
};

/**
 * Prefer primary amount when non-zero, else customer amount — same COALESCE
 * spirit as live open-AR line outstanding.
 */
export function preferAmountPair(pair: AsOfAmountPair): number {
    const primary = Number(pair.amount ?? 0);
    if (primary !== 0) {
        return primary;
    }
    return Number(pair.customerAmount ?? 0);
}

/**
 * Payment-ledger open amount as of day D: max(0, original − payments on/before D).
 */
export function computeAsOfOpenAmount(
    original: number,
    paymentsOnOrBeforeAsOf: number
): number {
    const open = Number(original) - Number(paymentsOnOrBeforeAsOf);
    if (!Number.isFinite(open) || open <= 0) {
        return 0;
    }
    return open;
}

export type AsOfOpenStatus = "Due" | "Overdue";

/**
 * Classify remaining open balance vs due date on as-of day D (UTC calendar).
 */
export function classifyAsOfOpenStatus(
    dueDate: Date | null | undefined,
    asOfDate: Date
): AsOfOpenStatus {
    if (!dueDate) {
        return "Due";
    }
    const due = toUtcDayStart(dueDate);
    const asOf = toUtcDayStart(asOfDate);
    return due.getTime() < asOf.getTime() ? "Overdue" : "Due";
}

export function toUtcDayStart(date: Date): Date {
    return new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    );
}

/** Exclusive upper bound: first UTC instant after as-of calendar day. */
export function utcDayAfterExclusive(asOfDate: Date): Date {
    const next = toUtcDayStart(asOfDate);
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
}

export type AsOfOpenInvoiceLine = {
    invoiceId: number;
    customerId: number;
    policyId: number | null;
    invoiceDate: Date;
    dueDate: Date | null;
    amount: number | null;
    customerAmount: number | null;
    customerCurrency: string | null;
    paymentsOnOrBeforeAsOf: number;
    paymentsCustomerOnOrBeforeAsOf: number;
    /** Latest payment on/before the snapshot load day; used to reconstruct open-at-creation. */
    lastPaymentDate?: Date | null;
    reportingBreach: boolean;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl: boolean;
    ctvInvoiceAfterPolicyEnd: boolean;
    inCapacityGap: boolean;
    actualReportingDate?: Date | null;
};

/** Policy terms used to recompute invoice breach flags as of a snapshot day. */
export type AsOfPolicyTermsForBreach = {
    maxPaymentTerm: number | null;
    maxAllowedMep: number | null;
    reportingDays: number | null;
    mepCutoffDayOfMonth?: number | null;
    mepSubstituteDayOfMonth?: number | null;
    reportingCutoffDayOfMonth?: number | null;
    reportingSubstituteDayOfMonth?: number | null;
    paymentTermCutoffDayOfMonth?: number | null;
    paymentTermSubstituteDayOfMonth?: number | null;
    policyEndDate?: Date | null;
};

/**
 * Over-limit slice as of the snapshot day. Outdated DCL suppresses the gap
 * (same rule as live capacity-gap computation).
 */
export function asOfCapacityGapAmount(
    totalReceivables: number,
    effectiveApprovedLimit: number | null | undefined,
    outdatedDcl: boolean
): number {
    if (outdatedDcl) {
        return 0;
    }
    return computeLimitExcessOverEffective(
        totalReceivables,
        effectiveApprovedLimit
    );
}

/**
 * Whether `line` still had open AR on calendar day `atDate`.
 * Snapshot payment totals are as-of the load day; lastPaymentDate reconstructs
 * invoices that were later paid.
 */
export function wasAsOfInvoiceOpenAt(
    line: AsOfOpenInvoiceLine,
    atDate: Date
): boolean {
    const at = toUtcDayStart(atDate);
    if (toUtcDayStart(line.invoiceDate).getTime() > at.getTime()) {
        return false;
    }
    const original = preferAmountPair({
        amount: line.amount,
        customerAmount: line.customerAmount,
    });
    const paidAsOfLoad = preferAmountPair({
        amount: line.paymentsOnOrBeforeAsOf,
        customerAmount: line.paymentsCustomerOnOrBeforeAsOf,
    });
    if (computeAsOfOpenAmount(original, paidAsOfLoad) > 0) {
        return true;
    }
    if (paidAsOfLoad <= 0) {
        return original > 0;
    }
    if (!line.lastPaymentDate) {
        return false;
    }
    return toUtcDayStart(line.lastPaymentDate).getTime() > at.getTime();
}

/**
 * Customer overdue_block as of `atDate`: oldest overdue due among invoices
 * still open that day, plus max allowed MEP.
 */
export function asOfCustomerOverdueBlockAt(
    customerLines: AsOfOpenInvoiceLine[],
    atDate: Date,
    maxAllowedMep: number | null | undefined
): boolean {
    let oldestOverdueDue: Date | null = null;
    for (const line of customerLines) {
        if (!wasAsOfInvoiceOpenAt(line, atDate)) {
            continue;
        }
        if (classifyAsOfOpenStatus(line.dueDate, atDate) !== "Overdue") {
            continue;
        }
        if (!line.dueDate) {
            continue;
        }
        const due = toUtcDayStart(line.dueDate);
        if (!oldestOverdueDue || due.getTime() < oldestOverdueDue.getTime()) {
            oldestOverdueDue = due;
        }
    }
    return computeCustomerOverdueBlock({
        oldestInvoiceOverdueDate: oldestOverdueDue,
        maxAllowedMepDays: maxAllowedMep,
        today: atDate,
    });
}

/**
 * Recompute terms-breach flags for an as-of-open invoice from policy terms and
 * the snapshot calendar day. MEP is created-in-violation: true when the
 * customer overdue block was already on at this invoice's issue date.
 */
export function overlayAsOfTermsFlagsOnLine(
    line: AsOfOpenInvoiceLine,
    asOfDate: Date,
    terms: AsOfPolicyTermsForBreach,
    options?: {
        siblingLines?: AsOfOpenInvoiceLine[];
        /** Snapshot math only — do not count reporting-late. Invoice rows stay unchanged. */
        ignoreReportingBreach?: boolean;
    }
): AsOfOpenInvoiceLine {
    const asOfStatus = classifyAsOfOpenStatus(line.dueDate, asOfDate);
    const row = computeInvoiceInsuranceRowData({
        status: asOfStatus as invoice_status,
        invoice_date: line.invoiceDate,
        due_date: line.dueDate,
        actual_reporting_date: line.actualReportingDate ?? null,
        customer: {
            reporting_days: terms.reportingDays,
            max_allowed_mep: terms.maxAllowedMep,
            max_payment_term: terms.maxPaymentTerm,
            mep_cutoff_day_of_month: terms.mepCutoffDayOfMonth,
            mep_substitute_day_of_month: terms.mepSubstituteDayOfMonth,
            reporting_cutoff_day_of_month: terms.reportingCutoffDayOfMonth,
            reporting_substitute_day_of_month:
                terms.reportingSubstituteDayOfMonth,
            payment_term_cutoff_day_of_month: terms.paymentTermCutoffDayOfMonth,
            payment_term_substitute_day_of_month:
                terms.paymentTermSubstituteDayOfMonth,
        },
        today: asOfDate,
    });
    const siblingLines = options?.siblingLines ?? [line];
    const ctvCustomerOverdueMep = asOfCustomerOverdueBlockAt(
        siblingLines,
        line.invoiceDate,
        terms.maxAllowedMep
    );

    return {
        ...line,
        reportingBreach: options?.ignoreReportingBreach
            ? false
            : row.reporting_breach,
        ctvPaymentTerm: row.ctv_payment_term,
        ctvCustomerOverdueMep,
        ctvInvoiceAfterPolicyEnd: terms.policyEndDate
            ? computeCreatedTermsViolationInvoiceAfterPolicyEnd(
                  line.invoiceDate,
                  terms.policyEndDate
              )
            : line.ctvInvoiceAfterPolicyEnd,
    };
}

export function overlayAsOfTermsFlagsOnLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    termsByCustomerAndPolicy: Map<string, AsOfPolicyTermsForBreach>,
    options?: { ignoreReportingBreach?: boolean }
): AsOfOpenInvoiceLine[] {
    const linesByCustomer = new Map<number, AsOfOpenInvoiceLine[]>();
    for (const line of lines) {
        const bucket = linesByCustomer.get(line.customerId) ?? [];
        bucket.push(line);
        linesByCustomer.set(line.customerId, bucket);
    }
    return lines.map((line) => {
        const exact = termsByCustomerAndPolicy.get(
            `${line.customerId}:${line.policyId ?? "none"}`
        );
        const fallback = termsByCustomerAndPolicy.get(
            `${line.customerId}:none`
        );
        const terms = exact ?? fallback;
        if (!terms) {
            if (options?.ignoreReportingBreach) {
                return { ...line, reportingBreach: false };
            }
            return line;
        }
        return overlayAsOfTermsFlagsOnLine(line, asOfDate, terms, {
            siblingLines: linesByCustomer.get(line.customerId) ?? [line],
            ignoreReportingBreach: options?.ignoreReportingBreach,
        });
    });
}

/** Force reporting-late off on ledger lines (dashboard snapshot path). */
export function withReportingBreachIgnored(
    lines: AsOfOpenInvoiceLine[],
    ignoreReportingBreach: boolean
): AsOfOpenInvoiceLine[] {
    if (!ignoreReportingBreach) {
        return lines;
    }
    return lines.map((line) => ({ ...line, reportingBreach: false }));
}

export function asOfTermsScopeKey(
    customerId: number,
    policyId: number | null | undefined
): string {
    return `${customerId}:${policyId ?? "none"}`;
}

export type AsOfOpenInvoiceComputed = AsOfOpenInvoiceLine & {
    openAmount: number;
    openCustomerAmount: number;
    status: AsOfOpenStatus;
};

export function computeAsOfOpenInvoiceLine(
    line: AsOfOpenInvoiceLine,
    asOfDate: Date
): AsOfOpenInvoiceComputed | null {
    const openAmount = computeAsOfOpenAmount(
        preferAmountPair({
            amount: line.amount,
            customerAmount: line.customerAmount,
        }),
        preferAmountPair({
            amount: line.paymentsOnOrBeforeAsOf,
            customerAmount: line.paymentsCustomerOnOrBeforeAsOf,
        })
    );
    if (openAmount <= 0) {
        return null;
    }
    const openCustomerAmount = computeAsOfOpenAmount(
        Number(line.customerAmount ?? 0) || Number(line.amount ?? 0),
        Number(line.paymentsCustomerOnOrBeforeAsOf ?? 0) ||
            Number(line.paymentsOnOrBeforeAsOf ?? 0)
    );
    return {
        ...line,
        openAmount,
        openCustomerAmount,
        status: classifyAsOfOpenStatus(line.dueDate, asOfDate),
    };
}

function isTermsBreachLine(line: AsOfOpenInvoiceLine): boolean {
    return (
        line.reportingBreach ||
        line.ctvPaymentTerm ||
        line.ctvCustomerOverdueMep ||
        line.ctvOutdatedDcl ||
        line.ctvInvoiceAfterPolicyEnd
    );
}

type AsOfInvoiceSqlRow = {
    invoice_id: number;
    customer_id: number;
    policy_id: number | null;
    invoice_date: Date;
    due_date: Date | null;
    amount: number | null;
    customer_amount: number | null;
    customer_currency: string | null;
    paid_amount: number | null;
    paid_customer_amount: number | null;
    reporting_breach: boolean;
    ctv_payment_term: boolean;
    ctv_customer_overdue_mep: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
    in_capacity_gap: boolean;
    actual_reporting_date: Date | null;
    last_payment_date: Date | null;
};

function mapSqlRow(row: AsOfInvoiceSqlRow): AsOfOpenInvoiceLine {
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
        paymentsOnOrBeforeAsOf: Number(row.paid_amount ?? 0),
        paymentsCustomerOnOrBeforeAsOf: Number(row.paid_customer_amount ?? 0),
        reportingBreach: Boolean(row.reporting_breach),
        ctvPaymentTerm: Boolean(row.ctv_payment_term),
        ctvCustomerOverdueMep: Boolean(row.ctv_customer_overdue_mep),
        ctvOutdatedDcl: Boolean(row.ctv_outdated_dcl),
        ctvInvoiceAfterPolicyEnd: Boolean(row.ctv_invoice_after_policy_end),
        inCapacityGap: Boolean(row.in_capacity_gap),
        actualReportingDate: row.actual_reporting_date,
        lastPaymentDate: row.last_payment_date,
    };
}

/**
 * Load invoice + payment-ledger rows that could be open as of `asOfDate`.
 * Callers filter to open &gt; 0 via {@link computeAsOfOpenInvoiceLine}.
 */
export async function loadAsOfOpenInvoiceCandidates(
    accountId: number,
    asOfDate: Date,
    options?: {
        customerIds?: number[];
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<AsOfOpenInvoiceLine[]> {
    const db = options?.dbClient ?? defaultPrisma;
    const asOf = toUtcDayStart(asOfDate);
    const dayAfter = utcDayAfterExclusive(asOf);
    const customerFilter =
        options?.customerIds != null && options.customerIds.length > 0
            ? Prisma.sql`AND i.customer_id IN (${Prisma.join(options.customerIds)})`
            : Prisma.empty;
    const policyFilter =
        options?.policyId != null
            ? Prisma.sql`AND i.policy_id = ${options.policyId}`
            : Prisma.empty;

    const rows = await db.$queryRaw<AsOfInvoiceSqlRow[]>`
        SELECT
            i.id AS invoice_id,
            i.customer_id,
            i.policy_id,
            i.invoice_date,
            i.due_date,
            i.amount,
            i.customer_amount,
            i.customer_currency,
            COALESCE(p.paid_amount, 0)::float AS paid_amount,
            COALESCE(p.paid_customer_amount, 0)::float AS paid_customer_amount,
            COALESCE(i.reporting_breach, false) AS reporting_breach,
            COALESCE(i.ctv_payment_term, false) AS ctv_payment_term,
            COALESCE(i.ctv_customer_overdue_mep, false) AS ctv_customer_overdue_mep,
            COALESCE(i.ctv_outdated_dcl, false) AS ctv_outdated_dcl,
            COALESCE(i.ctv_invoice_after_policy_end, false) AS ctv_invoice_after_policy_end,
            COALESCE(i.in_capacity_gap, false) AS in_capacity_gap,
            i.actual_reporting_date,
            p.last_payment_date
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        LEFT JOIN LATERAL (
            SELECT
                SUM(COALESCE(ip.amount, 0))::float AS paid_amount,
                SUM(COALESCE(ip.customer_amount, 0))::float AS paid_customer_amount,
                MAX(ip.payment_date) AS last_payment_date
            FROM "InvoicePayment" ip
            WHERE ip.invoice_id = i.id
              AND ip.account_id = ${accountId}
              AND ip.payment_date < ${dayAfter}
        ) p ON true
        WHERE i.account_id = ${accountId}
          AND c.account_id = ${accountId}
          AND c.collection_status IN ('Active', 'Inactive')
          AND i.invoice_date <= ${asOf}
          AND i.status::text NOT IN ('Void', 'Cancelled')
          ${customerFilter}
          ${policyFilter}
    `;

    return rows.map(mapSqlRow);
}

function lineMatchesScope(
    line: AsOfOpenInvoiceLine,
    options?: { customerId?: number; policyId?: number | null }
): boolean {
    if (
        options?.customerId != null &&
        line.customerId !== options.customerId
    ) {
        return false;
    }
    if (options?.policyId === undefined) {
        return true;
    }
    if (options.policyId === null) {
        return line.policyId == null;
    }
    return line.policyId === options.policyId;
}

/** Sum as-of open amount from a preloaded ledger (no DB). */
export function sumAsOfOpenAmountFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    options?: { customerId?: number; policyId?: number | null }
): number {
    let total = 0;
    for (const line of lines) {
        if (!lineMatchesScope(line, options)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        total += computed.openAmount;
    }
    return total;
}

export function sumAsOfOpenAmountByCurrencyFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    currency: string,
    options?: { customerId?: number; policyId?: number | null }
): number {
    const code = currency.trim().toUpperCase();
    if (!code) {
        return 0;
    }
    let total = 0;
    for (const line of lines) {
        if (!lineMatchesScope(line, options)) {
            continue;
        }
        if (line.customerCurrency?.trim().toUpperCase() !== code) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        total +=
            computed.openCustomerAmount > 0
                ? computed.openCustomerAmount
                : computed.openAmount;
    }
    return total;
}

export function resolveAsOfOpenArOnPolicyInLimitCurrencyFromLines(
    lines: AsOfOpenInvoiceLine[],
    customerId: number,
    policyId: number,
    limitCurrency: string,
    accountCurrency: string | null,
    asOfDate: Date
): number {
    const limitCcy = limitCurrency.trim().toUpperCase();
    const acct = accountCurrency?.trim().toUpperCase() ?? "";
    if (limitCcy && acct && limitCcy === acct) {
        return sumAsOfOpenAmountFromLines(lines, asOfDate, {
            customerId,
            policyId,
        });
    }
    return sumAsOfOpenAmountByCurrencyFromLines(lines, asOfDate, limitCcy, {
        customerId,
        policyId,
    });
}

export function sumAsOfTermsBreachFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    options?: {
        customerId?: number;
        policyId?: number | null;
        excludeCapacityGapInvoices?: boolean;
    }
): number {
    let total = 0;
    for (const line of lines) {
        if (!lineMatchesScope(line, options)) {
            continue;
        }
        if (!isTermsBreachLine(line)) {
            continue;
        }
        if (options?.excludeCapacityGapInvoices && line.inCapacityGap) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        total += computed.openAmount;
    }
    return total;
}

export function buildAsOfOpenReceivableByCustomerMapFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date
): Map<number, number> {
    const map = new Map<number, number>();
    for (const line of lines) {
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        map.set(
            computed.customerId,
            (map.get(computed.customerId) ?? 0) + computed.openAmount
        );
    }
    return map;
}

/** Open as-of breach invoice rows for the existing by-reason aggregator. */
export function asOfTermsBreachInvoicesFromLines(
    lines: AsOfOpenInvoiceLine[],
    asOfDate: Date,
    customerId: number,
    policyId: number | null
): Array<{
    policyId: number | null;
    outstanding: number;
    reportingBreach: boolean;
    ctvPaymentTerm: boolean;
    ctvCustomerOverdueMep: boolean;
    ctvOutdatedDcl: boolean;
    ctvInvoiceAfterPolicyEnd: boolean;
}> {
    const invoices: Array<{
        policyId: number | null;
        outstanding: number;
        reportingBreach: boolean;
        ctvPaymentTerm: boolean;
        ctvCustomerOverdueMep: boolean;
        ctvOutdatedDcl: boolean;
        ctvInvoiceAfterPolicyEnd: boolean;
    }> = [];
    for (const line of lines) {
        if (line.customerId !== customerId) {
            continue;
        }
        if (policyId === null && line.policyId != null) {
            continue;
        }
        if (policyId != null && line.policyId !== policyId) {
            continue;
        }
        if (!isTermsBreachLine(line)) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        invoices.push({
            policyId: computed.policyId,
            outstanding: computed.openAmount,
            reportingBreach: computed.reportingBreach,
            ctvPaymentTerm: computed.ctvPaymentTerm,
            ctvCustomerOverdueMep: computed.ctvCustomerOverdueMep,
            ctvOutdatedDcl: computed.ctvOutdatedDcl,
            ctvInvoiceAfterPolicyEnd: computed.ctvInvoiceAfterPolicyEnd,
        });
    }
    return invoices;
}

export async function fetchAsOfOpenReceivableByCustomerMap(
    accountId: number,
    asOfDate: Date,
    options?: {
        customerIds?: number[];
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<Map<number, number>> {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, options);
    const map = new Map<number, number>();
    for (const line of lines) {
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        map.set(
            computed.customerId,
            (map.get(computed.customerId) ?? 0) + computed.openAmount
        );
    }
    return map;
}

/**
 * As-of open AR per customer in account currency (latest FX when needed).
 */
export async function fetchAsOfOpenReceivableByCustomerMapInAccountCurrency(
    accountId: number,
    accountCurrency: string,
    asOfDate: Date,
    options?: {
        customerIds?: number[];
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<Map<number, number>> {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, options);
    return buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines(
        lines,
        accountCurrency,
        asOfDate,
        options
    );
}

export async function buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines(
    lines: AsOfOpenInvoiceLine[],
    accountCurrency: string,
    asOfDate: Date,
    options?: {
        customerIds?: number[];
        policyId?: number;
    }
): Promise<Map<number, number>> {
    const accountCur = accountCurrency.trim().toUpperCase();
    const customerIdSet =
        options?.customerIds != null && options.customerIds.length > 0
            ? new Set(options.customerIds)
            : null;
    const map = new Map<number, number>();
    for (const line of lines) {
        if (customerIdSet && !customerIdSet.has(line.customerId)) {
            continue;
        }
        if (
            options?.policyId != null &&
            line.policyId !== options.policyId
        ) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        const custCurrency = computed.customerCurrency?.trim().toUpperCase();
        const synthetic = {
            outstanding_debt: computed.openAmount,
            customer_outstanding_debt: computed.openCustomerAmount,
            amount: computed.openAmount,
            customer_currency: computed.customerCurrency,
        };
        let converted: number | null | undefined;
        const hasAccountOutstanding =
            synthetic.outstanding_debt != null &&
            synthetic.outstanding_debt !== 0;
        if (
            !hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur
        ) {
            const val =
                synthetic.customer_outstanding_debt !== 0
                    ? synthetic.customer_outstanding_debt
                    : synthetic.amount;
            converted = await convertAmountToCurrencyLatestRate(
                custCurrency,
                accountCur,
                val
            );
        }
        const lineAmount = computeInvoiceLineOpenArInAccountCurrency(
            synthetic,
            accountCur,
            converted
        );
        map.set(
            computed.customerId,
            (map.get(computed.customerId) ?? 0) + lineAmount
        );
    }
    return map;
}

export async function fetchAsOfOpenReceivableForCustomer(
    accountId: number,
    customerId: number,
    asOfDate: Date,
    policyId?: number | null,
    dbClient?: DbClient
): Promise<number> {
    const map = await fetchAsOfOpenReceivableByCustomerMap(accountId, asOfDate, {
        customerIds: [customerId],
        policyId: policyId ?? undefined,
        dbClient,
    });
    return map.get(customerId) ?? 0;
}

export async function fetchAsOfOpenReceivableForCustomerByCurrency(
    accountId: number,
    customerId: number,
    currency: string,
    asOfDate: Date,
    policyId?: number | null,
    dbClient?: DbClient
): Promise<number> {
    const code = currency.trim().toUpperCase();
    if (!code) {
        return 0;
    }
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, {
        customerIds: [customerId],
        policyId: policyId ?? undefined,
        dbClient,
    });
    let total = 0;
    for (const line of lines) {
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        if (computed.customerCurrency?.trim().toUpperCase() !== code) {
            continue;
        }
        total +=
            computed.openCustomerAmount > 0
                ? computed.openCustomerAmount
                : computed.openAmount;
    }
    return total;
}

export async function resolveAsOfOpenArOnPolicyInLimitCurrency(
    accountId: number,
    customerId: number,
    policyId: number,
    limitCurrency: string,
    accountCurrency: string | null,
    asOfDate: Date,
    dbClient?: DbClient
): Promise<number> {
    const limitCcy = limitCurrency.trim().toUpperCase();
    const acct = accountCurrency?.trim().toUpperCase() ?? "";
    if (limitCcy && acct && limitCcy === acct) {
        return fetchAsOfOpenReceivableForCustomer(
            accountId,
            customerId,
            asOfDate,
            policyId,
            dbClient
        );
    }
    return fetchAsOfOpenReceivableForCustomerByCurrency(
        accountId,
        customerId,
        limitCcy,
        asOfDate,
        policyId,
        dbClient
    );
}

export async function getCustomerAsOfTermsBreachOutstandingSum(
    accountId: number,
    customerId: number,
    asOfDate: Date,
    options?: {
        excludeCapacityGapInvoices?: boolean;
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<number> {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, {
        customerIds: [customerId],
        policyId: options?.policyId,
        dbClient: options?.dbClient,
    });
    let total = 0;
    for (const line of lines) {
        if (!isTermsBreachLine(line)) {
            continue;
        }
        if (options?.excludeCapacityGapInvoices && line.inCapacityGap) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        total += computed.openAmount;
    }
    return total;
}

export async function getCustomerAsOfTermsBreachOutstandingForAtRisk(
    accountId: number,
    customerId: number,
    asOfDate: Date,
    options?: { policyId?: number; dbClient?: DbClient }
): Promise<number> {
    return getCustomerAsOfTermsBreachOutstandingSum(accountId, customerId, asOfDate, {
        ...options,
        excludeCapacityGapInvoices: true,
    });
}

/**
 * Terms-breach open outstanding per customer in account currency (as-of).
 */
export async function fetchAsOfTermsBreachOutstandingByCustomerInAccountCurrency(
    accountId: number,
    accountCurrency: string,
    asOfDate: Date,
    options?: {
        policyId?: number;
        excludeCapacityGapInvoices?: boolean;
        customerIds?: number[];
        dbClient?: DbClient;
    }
): Promise<Map<number, number>> {
    const lines = await loadAsOfOpenInvoiceCandidates(accountId, asOfDate, {
        customerIds: options?.customerIds,
        policyId: options?.policyId,
        dbClient: options?.dbClient,
    });
    return buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines(
        lines,
        accountCurrency,
        asOfDate,
        options
    );
}

export async function buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines(
    lines: AsOfOpenInvoiceLine[],
    accountCurrency: string,
    asOfDate: Date,
    options?: {
        policyId?: number;
        excludeCapacityGapInvoices?: boolean;
        customerIds?: number[];
    }
): Promise<Map<number, number>> {
    const accountCur = accountCurrency.trim().toUpperCase();
    const customerIdSet =
        options?.customerIds != null && options.customerIds.length > 0
            ? new Set(options.customerIds)
            : null;
    const map = new Map<number, number>();
    for (const line of lines) {
        if (customerIdSet && !customerIdSet.has(line.customerId)) {
            continue;
        }
        if (
            options?.policyId != null &&
            line.policyId !== options.policyId
        ) {
            continue;
        }
        if (!isTermsBreachLine(line)) {
            continue;
        }
        if (options?.excludeCapacityGapInvoices && line.inCapacityGap) {
            continue;
        }
        const computed = computeAsOfOpenInvoiceLine(line, asOfDate);
        if (!computed) {
            continue;
        }
        const synthetic = {
            outstanding_debt: computed.openAmount,
            customer_outstanding_debt: computed.openCustomerAmount,
            amount: computed.openAmount,
            customer_currency: computed.customerCurrency,
        };
        const custCurrency = computed.customerCurrency?.trim().toUpperCase();
        let converted: number | null | undefined;
        const hasAccountOutstanding =
            synthetic.outstanding_debt != null &&
            synthetic.outstanding_debt !== 0;
        if (
            !hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur
        ) {
            const val =
                synthetic.customer_outstanding_debt !== 0
                    ? synthetic.customer_outstanding_debt
                    : synthetic.amount;
            converted = await convertAmountToCurrencyLatestRate(
                custCurrency,
                accountCur,
                val
            );
        }
        const lineAmount = computeInvoiceLineOpenArInAccountCurrency(
            synthetic,
            accountCur,
            converted
        );
        map.set(
            computed.customerId,
            (map.get(computed.customerId) ?? 0) + lineAmount
        );
    }
    return map;
}
