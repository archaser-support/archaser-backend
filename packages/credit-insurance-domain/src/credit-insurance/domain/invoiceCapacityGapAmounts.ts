import { Prisma, invoice_status } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";

import {
    invoiceOutstandingInLimitCurrency,
} from "./invoiceInsuranceFields";

export type CurrencyRateRow = {
    base_currency: string;
    other_currency: string;
    currency_ratio: number;
    rate_date: Date;
};

export type InvoiceGapComputeInput = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    limit_assessed_amount: number | null;
    limit_assessed_currency: string | null;
};

export type StoredInvoiceCapacityGapRow = {
    capacity_gap_amount?: number | Prisma.Decimal | null;
    capacity_gap_amount_limit?: number | Prisma.Decimal | null;
    limit_assessed_amount?: number | Prisma.Decimal | null;
};

/**
 * Sum persisted per-invoice gap fields — same rollup as
 * {@link sumInvoiceCapacityGapForCustomerPolicy} without a DB round-trip.
 */
export function sumStoredInvoiceCapacityGapRows(
    invoices: StoredInvoiceCapacityGapRow[]
): { gapBase: number; gapLimit: number; hasMissingSnapshots: boolean } {
    let gapBase = 0;
    let gapLimit = 0;
    let hasMissingSnapshots = false;

    for (const inv of invoices) {
        if (
            inv.limit_assessed_amount != null &&
            inv.capacity_gap_amount == null
        ) {
            hasMissingSnapshots = true;
            continue;
        }
        gapBase += decimalToNumber(inv.capacity_gap_amount);
        gapLimit += decimalToNumber(inv.capacity_gap_amount_limit);
    }

    return { gapBase, gapLimit, hasMissingSnapshots };
}

/**
 * Per-invoice gap fields using the same rules as
 * {@link syncInvoiceCapacityGapAmountsForCustomer}.
 */
export function computeStoredInvoiceCapacityGapFields(args: {
    row: InvoiceGapComputeInput;
    accountCurrency: string | null;
    currencyRate?: CurrencyRateRow | null;
    isOpenWithPolicy: boolean;
}): { capacity_gap_amount: number; capacity_gap_amount_limit: number } {
    if (!args.isOpenWithPolicy) {
        return { capacity_gap_amount: 0, capacity_gap_amount_limit: 0 };
    }
    if (args.row.limit_assessed_amount == null) {
        return { capacity_gap_amount: 0, capacity_gap_amount_limit: 0 };
    }

    const computed = computeInvoiceCapacityGapDualCurrency({
        row: args.row,
        accountCurrency: args.accountCurrency,
        currencyRate: args.currencyRate,
    });

    return {
        capacity_gap_amount: computed.gapBase ?? 0,
        capacity_gap_amount_limit: computed.gapLimit,
    };
}

/**
 * Implicit FX ratio: account base per one unit of customer/invoice currency.
 * Returns null when both sides are not present with the same sign.
 */
export function invoiceImplicitBasePerCustomerUnit(row: {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
}): number | null {
    const base = row.outstanding_debt;
    const customer = row.customer_outstanding_debt;
    if (
        base == null ||
        customer == null ||
        base === 0 ||
        customer === 0
    ) {
        return null;
    }
    if ((base > 0 && customer < 0) || (base < 0 && customer > 0)) {
        return null;
    }
    return base / customer;
}

type ImplicitFxRow = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
};

type GapFxRow = {
    capacity_gap_amount: Prisma.Decimal | number | null;
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    customer_currency: string | null;
};

/**
 * Portfolio implicit FX: account base per one unit of limit/invoice currency,
 * aggregated from open invoice outstanding fields (same basis as capacity gap).
 */
export function aggregateImplicitBasePerLimitUnit(
    rows: ImplicitFxRow[]
): number | null {
    let totalBase = 0;
    let totalCustomer = 0;
    for (const row of rows) {
        const base =
            row.outstanding_debt != null ? Number(row.outstanding_debt) : 0;
        const customer =
            row.customer_outstanding_debt != null
                ? Number(row.customer_outstanding_debt)
                : 0;
        if (base === 0 || customer === 0) {
            continue;
        }
        if ((base > 0 && customer < 0) || (base < 0 && customer > 0)) {
            continue;
        }
        totalBase += base;
        totalCustomer += customer;
    }
    if (totalCustomer === 0) {
        return null;
    }
    return totalBase / totalCustomer;
}

/**
 * Secondary gap amount from contributing invoices only.
 * Uses weighted implicit invoice FX on rows with positive capacity gap.
 */
export function sumGapInSecondaryCurrencyFromInvoices(
    rows: GapFxRow[],
    secondaryCurrency: string
): number | null {
    const target = secondaryCurrency.trim().toUpperCase();
    if (!target) {
        return null;
    }
    let total = 0;
    for (const row of rows) {
        const ccy = row.customer_currency?.trim().toUpperCase();
        if (ccy !== target) {
            continue;
        }
        const gapBase = decimalToNumber(row.capacity_gap_amount);
        const base = Number(row.outstanding_debt ?? 0);
        const customer = Number(row.customer_outstanding_debt ?? 0);
        if (
            gapBase <= 0 ||
            !Number.isFinite(base) ||
            !Number.isFinite(customer) ||
            base === 0 ||
            customer === 0 ||
            (base > 0 && customer < 0) ||
            (base < 0 && customer > 0)
        ) {
            continue;
        }
        total += gapBase * (customer / base);
    }
    return total > 0 ? total : null;
}

/** Implicit FX from a customer's open invoices in limit currency (falls back to null). */
export async function fetchCustomerImplicitBasePerLimitUnit(
    accountId: number,
    customerId: number,
    limitCurrency: string,
    accountCurrency: string,
    options?: { policyId?: number; dbClient?: DbClient }
): Promise<number | null> {
    const db = options?.dbClient ?? defaultPrisma;
    const limitCcy = limitCurrency.trim().toUpperCase();
    const acct = accountCurrency.trim().toUpperCase();
    if (!limitCcy || limitCcy === acct) {
        return 1;
    }

    const invoices = await db.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            status: { in: [invoice_status.Due, invoice_status.Overdue] },
            ...(options?.policyId != null ? { policy_id: options.policyId } : {}),
            customer_currency: limitCcy,
        },
        select: {
            outstanding_debt: true,
            customer_outstanding_debt: true,
        },
    });

    return aggregateImplicitBasePerLimitUnit(invoices);
}

export async function fetchCustomerCapacityGapSecondaryFromContributingInvoices(
    accountId: number,
    customerId: number,
    secondaryCurrency: string,
    options?: { policyId?: number; dbClient?: DbClient }
): Promise<number | null> {
    const db = options?.dbClient ?? defaultPrisma;
    const rows = (await db.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            status: { in: [invoice_status.Due, invoice_status.Overdue] },
            capacity_gap_amount: { gt: 0 },
            ...(options?.policyId != null ? { policy_id: options.policyId } : {}),
        },
        select: {
            capacity_gap_amount: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            customer_currency: true,
        },
    } as any)) as Array<{
        capacity_gap_amount: Prisma.Decimal | null;
        outstanding_debt: number | null;
        customer_outstanding_debt: number | null;
        customer_currency: string | null;
    }>;
    return sumGapInSecondaryCurrencyFromInvoices(rows, secondaryCurrency);
}

/** Approved limit in account currency for gap capping (implicit invoice FX first). */
export async function resolveApprovedLimitInAccountCurrency(
    accountId: number,
    customerId: number,
    policyId: number,
    approvedLimit: number,
    limitCurrency: string | null | undefined,
    accountCurrency: string | null | undefined,
    dbClient: DbClient = defaultPrisma
): Promise<number> {
    const accountCur = accountCurrency?.trim().toUpperCase() || "USD";
    const limitCcy = limitCurrency?.trim().toUpperCase() || accountCur;
    if (limitCcy === accountCur) {
        return approvedLimit;
    }
    const implicit = await fetchCustomerImplicitBasePerLimitUnit(
        accountId,
        customerId,
        limitCcy,
        accountCur,
        { policyId, dbClient }
    );
    if (implicit != null && Number.isFinite(implicit)) {
        return approvedLimit * implicit;
    }
    const { convertAmountToCurrencyLatestRate } = await import(
        "./customerCreditInsuranceHeaderAmounts"
    );
    const converted = await convertAmountToCurrencyLatestRate(
        limitCcy,
        accountCur,
        approvedLimit
    );
    return converted ?? approvedLimit;
}

function convertWithRate(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    rate: CurrencyRateRow
): number | null {
    if (fromCurrency === toCurrency) {
        return amount;
    }
    if (
        rate.base_currency === toCurrency &&
        rate.other_currency === fromCurrency
    ) {
        return amount / rate.currency_ratio;
    }
    if (
        rate.base_currency === fromCurrency &&
        rate.other_currency === toCurrency
    ) {
        return amount * rate.currency_ratio;
    }
    return null;
}

export function computeInvoiceCapacityGapDualCurrency(args: {
    row: InvoiceGapComputeInput;
    accountCurrency: string | null;
    currencyRate?: CurrencyRateRow | null;
}): {
    gapLimit: number;
    gapBase: number | null;
    rateDate: Date | null;
    usedImplicitRate: boolean;
    missingRate: boolean;
} {
    const outstandingLimit = Math.max(
        0,
        invoiceOutstandingInLimitCurrency({
            outstanding_debt: args.row.outstanding_debt,
            customer_outstanding_debt: args.row.customer_outstanding_debt,
            amount: null,
            limit_assessed_currency: args.row.limit_assessed_currency,
            accountCurrency: args.accountCurrency,
        })
    );
    const assessed = Math.max(0, Number(args.row.limit_assessed_amount ?? 0));
    const gapLimit = Math.max(0, outstandingLimit - assessed);

    if (gapLimit <= 0) {
        return {
            gapLimit: 0,
            gapBase: 0,
            rateDate: null,
            usedImplicitRate: false,
            missingRate: false,
        };
    }

    const limitCurrency = args.row.limit_assessed_currency
        ?.trim()
        .toUpperCase();
    const accountCurrency = args.accountCurrency?.trim().toUpperCase() ?? null;

    if (
        limitCurrency &&
        accountCurrency &&
        limitCurrency === accountCurrency
    ) {
        return {
            gapLimit,
            gapBase: gapLimit,
            rateDate: null,
            usedImplicitRate: false,
            missingRate: false,
        };
    }

    const implicitRatio = invoiceImplicitBasePerCustomerUnit({
        outstanding_debt: args.row.outstanding_debt,
        customer_outstanding_debt: args.row.customer_outstanding_debt,
    });
    if (implicitRatio != null && Number.isFinite(implicitRatio)) {
        return {
            gapLimit,
            gapBase: gapLimit * implicitRatio,
            rateDate: null,
            usedImplicitRate: true,
            missingRate: false,
        };
    }

    if (limitCurrency && accountCurrency && args.currencyRate) {
        const converted = convertWithRate(
            gapLimit,
            limitCurrency,
            accountCurrency,
            args.currencyRate
        );
        if (converted != null && Number.isFinite(converted)) {
            return {
                gapLimit,
                gapBase: converted,
                rateDate: args.currencyRate.rate_date,
                usedImplicitRate: false,
                missingRate: false,
            };
        }
    }

    return {
        gapLimit,
        gapBase: null,
        rateDate: null,
        usedImplicitRate: false,
        missingRate: true,
    };
}

export type InvoiceStoredGapRow = {
    capacity_gap_amount: Prisma.Decimal | number | null;
    capacity_gap_amount_limit: Prisma.Decimal | number | null;
    limit_assessed_amount: Prisma.Decimal | number | null;
};

function decimalToNumber(
    value: Prisma.Decimal | number | null | undefined
): number {
    if (value == null) {
        return 0;
    }
    if (value instanceof Prisma.Decimal) {
        return value.toNumber();
    }
    return Number(value);
}

/** Sum stored invoice gap fields for one customer + primary policy (writer / reconciliation). */
export async function sumInvoiceCapacityGapForCustomerPolicy(
    accountId: number,
    customerId: number,
    policyId: number,
    dbClient: DbClient = defaultPrisma
): Promise<{
    gapBase: number;
    gapLimit: number;
    limitCurrency: string | null;
    hasMissingSnapshots: boolean;
    missingRate: boolean;
}> {
    const invoices = (await dbClient.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            policy_id: policyId,
            status: { in: [invoice_status.Due, invoice_status.Overdue] },
        },
        select: {
            capacity_gap_amount: true,
            capacity_gap_amount_limit: true,
            limit_assessed_amount: true,
            limit_assessed_currency: true,
        },
    } as any)) as Array<{
        capacity_gap_amount: Prisma.Decimal | null;
        capacity_gap_amount_limit: Prisma.Decimal | null;
        limit_assessed_amount: Prisma.Decimal | null;
        limit_assessed_currency: string | null;
    }>;

    if (invoices.length === 0) {
        return {
            gapBase: 0,
            gapLimit: 0,
            limitCurrency: null,
            hasMissingSnapshots: false,
            missingRate: false,
        };
    }

    let limitCurrency: string | null = null;
    for (const inv of invoices) {
        if (inv.limit_assessed_currency) {
            limitCurrency = inv.limit_assessed_currency.trim().toUpperCase();
        }
    }

    const summed = sumStoredInvoiceCapacityGapRows(invoices);
    const missingRate = invoices.some(
        (inv) =>
            inv.limit_assessed_amount != null &&
            inv.capacity_gap_amount == null
    );

    return {
        gapBase: summed.gapBase,
        gapLimit: summed.gapLimit,
        limitCurrency,
        hasMissingSnapshots: summed.hasMissingSnapshots,
        missingRate,
    };
}

export type CustomerPolicyGapAggregateRow = {
    customer_id: number;
    insurance_policy_id: number | null;
    is_active: boolean;
    capacity_gap_amount: number | null;
    capacity_gap_amount1: number | null;
};

/** Portfolio read: SUM synced CustomerPolicy gap fields (D9). */
export async function sumCustomerPolicyCapacityGapForAccount(
    accountId: number,
    options?: {
        policyId?: number;
        businessUnitFilter?: import("@prisma/client").Prisma.CustomerWhereInput;
        dbClient?: DbClient;
    }
): Promise<{
    gapBaseTotal: number;
    customerOverLimitCount: number;
    gapByPolicyId: Map<number, number>;
    gapByCustomerPolicy: Map<string, number>;
}> {
    const dbClient = options?.dbClient ?? defaultPrisma;
    const customerScope: import("@prisma/client").Prisma.CustomerWhereInput = {
        account_id: accountId,
        collection_status: { in: ["Active", "Inactive"] },
    };
    const businessUnitFilter = options?.businessUnitFilter;
    const scopedCustomerWhere =
        businessUnitFilter && Object.keys(businessUnitFilter).length > 0
            ? { AND: [customerScope, businessUnitFilter] }
            : customerScope;

    const rows = await dbClient.customerPolicy.findMany({
        where: {
            is_active: true,
            Customer: scopedCustomerWhere,
            ...(options?.policyId != null
                ? { insurance_policy_id: options.policyId }
                : {}),
        },
        select: {
            customer_id: true,
            insurance_policy_id: true,
            capacity_gap_amount: true,
            capacity_gap_amount1: true,
        },
    });

    let gapBaseTotal = 0;
    const overLimitCustomers = new Set<number>();
    const gapByPolicyId = new Map<number, number>();
    const gapByCustomerPolicy = new Map<string, number>();

    for (const row of rows) {
        const pid = row.insurance_policy_id;
        if (pid == null) {
            continue;
        }
        const gapBase = Math.max(0, Number(row.capacity_gap_amount ?? 0));
        const gapLimit = Math.max(0, Number(row.capacity_gap_amount1 ?? 0));
        gapBaseTotal += gapBase;
        if (gapLimit > 0) {
            overLimitCustomers.add(row.customer_id);
        }
        gapByPolicyId.set(pid, (gapByPolicyId.get(pid) ?? 0) + gapBase);
        const key = `${row.customer_id}:${pid}`;
        gapByCustomerPolicy.set(
            key,
            (gapByCustomerPolicy.get(key) ?? 0) + gapBase
        );
    }

    return {
        gapBaseTotal,
        customerOverLimitCount: overLimitCustomers.size,
        gapByPolicyId,
        gapByCustomerPolicy,
    };
}

/**
 * Sheet 2 usage metrics: policy / top-up / effective utilization.
 * When top-up is active and AR exceeds policy limit, policy usage caps at 100%.
 * Top-up usage is (AR − limit) / topUpTotal and may exceed 100%.
 */
export function computeTopUpUsageMetrics(args: {
    ar: number;
    approvedLimit: number;
    topUpTotal: number;
}): {
    policyUsage: number;
    topUpUsage: number;
    effectiveUsage: number;
} {
    const ar = Math.max(0, args.ar);
    const limit = Math.max(0, args.approvedLimit);
    const topUp = Math.max(0, args.topUpTotal);

    let policyUsage = limit > 0 ? ar / limit : 0;
    if (topUp > 0 && ar > limit) {
        policyUsage = 1;
    }

    const topUpUsage =
        topUp > 0 && ar > limit ? Math.max(0, (ar - limit) / topUp) : 0;

    const effectiveLimit = limit + topUp;
    const effectiveUsage =
        effectiveLimit > 0 ? ar / effectiveLimit : 0;

    return { policyUsage, topUpUsage, effectiveUsage };
}
