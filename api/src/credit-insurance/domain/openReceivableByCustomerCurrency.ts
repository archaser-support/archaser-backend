import { Prisma } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";

import {
    resolveCustomerCreditInsuranceSecondaryCurrency,
    resolveCustomerTotalArSecondaryFromInvoiceBuckets,
    type CustomerInvoiceCurrencyBuckets,
} from "./shared/invoiceBucketAmounts";

import { convertAmountToCurrencyLatestRate } from "./customerCreditInsuranceHeaderAmounts";
import {
    computeCustomerTotalAr,
    invoiceOutstandingInAccountCurrency,
} from "./invoiceInsuranceFields";

export type OpenReceivableCurrencyBucket = {
    currency: string;
    openAr: number;
};

type CurrencyGroupedRow = {
    customer_currency: string | null;
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
};

/**
 * Line outstanding for open Due/Overdue invoices (matches dashboard / FIFO rules).
 */
export function lineOutstandingFromAggregateRow(row: {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
}): number {
    if (row.outstanding_debt != null && row.outstanding_debt !== 0) {
        return row.outstanding_debt;
    }
    if (
        row.customer_outstanding_debt != null &&
        row.customer_outstanding_debt !== 0
    ) {
        return row.customer_outstanding_debt;
    }
    return 0;
}

export type OpenArInvoiceLine = {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    amount: number | null;
    customer_currency: string | null;
};

/**
 * One open invoice line total in account currency (policy usage / portfolio KPIs).
 * Prefers `outstanding_debt` (already in account currency). Only when that is zero
 * and invoice currency differs from account currency, uses FX on customer-currency amounts.
 */
/**
 * One invoice line outstanding in account currency (latest FX when needed).
 * Matches terms-breach / portfolio totals when customer currency differs.
 */
export async function resolveInvoiceLineOutstandingInAccountCurrency(
    row: OpenArInvoiceLine,
    accountCurrency: string
): Promise<number> {
    const accountCur = accountCurrency.trim().toUpperCase();
    const custCurrency = row.customer_currency?.trim().toUpperCase();
    const hasAccountOutstanding =
        row.outstanding_debt != null && row.outstanding_debt !== 0;
    let converted: number | null | undefined;
    if (
        !hasAccountOutstanding &&
        custCurrency &&
        custCurrency !== accountCur
    ) {
        const custOutstanding =
            row.customer_outstanding_debt != null
                ? Number(row.customer_outstanding_debt)
                : 0;
        const amount = row.amount != null ? Number(row.amount) : 0;
        const val = custOutstanding !== 0 ? custOutstanding : amount;
        converted = await convertAmountToCurrencyLatestRate(
            custCurrency,
            accountCur,
            val
        );
    }
    return computeInvoiceLineOpenArInAccountCurrency(
        row,
        accountCur,
        converted
    );
}

export function computeInvoiceLineOpenArInAccountCurrency(
    row: OpenArInvoiceLine,
    accountCurrency: string,
    convertedFromCustomerCurrency?: number | null
): number {
    if (row.outstanding_debt != null && row.outstanding_debt !== 0) {
        return Number(row.outstanding_debt);
    }

    const accountCur = accountCurrency.trim().toUpperCase();
    const custCurrency = row.customer_currency?.trim().toUpperCase();
    const custOutstanding =
        row.customer_outstanding_debt != null
            ? Number(row.customer_outstanding_debt)
            : 0;
    const amount = row.amount != null ? Number(row.amount) : 0;

    if (custCurrency && custCurrency !== accountCur) {
        const val = custOutstanding !== 0 ? custOutstanding : amount;
        return convertedFromCustomerCurrency ?? val;
    }

    return invoiceOutstandingInAccountCurrency(row);
}

/**
 * Open Due/Overdue AR per customer summed in account currency (latest FX for foreign invoice currency).
 */
export async function fetchOpenReceivableByCustomerMapInAccountCurrency(
    accountId: number,
    accountCurrency: string,
    options?: {
        customerIds?: number[];
        policyId?: number;
        dbClient?: DbClient;
    }
): Promise<Map<number, number>> {
    const db = options?.dbClient ?? defaultPrisma;
    const accountCur = accountCurrency.trim().toUpperCase();
    const invoices = await db.invoice.findMany({
        where: {
            account_id: accountId,
            status: { in: ["Due", "Overdue"] },
            ...(options?.customerIds?.length
                ? { customer_id: { in: options.customerIds } }
                : {}),
            ...(options?.policyId != null ? { policy_id: options.policyId } : {}),
            Customer: {
                account_id: accountId,
                collection_status: { in: ["Active", "Inactive"] },
            },
        },
        select: {
            customer_id: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
            customer_currency: true,
        },
    });

    const map = new Map<number, number>();
    for (const inv of invoices) {
        if (inv.customer_id == null) {
            continue;
        }
        const custCurrency = inv.customer_currency?.trim().toUpperCase();
        const hasAccountOutstanding =
            inv.outstanding_debt != null && inv.outstanding_debt !== 0;
        let converted: number | null | undefined;
        if (
            !hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur
        ) {
            const custOutstanding =
                inv.customer_outstanding_debt != null
                    ? Number(inv.customer_outstanding_debt)
                    : 0;
            const amount = inv.amount != null ? Number(inv.amount) : 0;
            const val = custOutstanding !== 0 ? custOutstanding : amount;
            converted = await convertAmountToCurrencyLatestRate(
                custCurrency,
                accountCur,
                val
            );
        }
        const line = computeInvoiceLineOpenArInAccountCurrency(
            inv,
            accountCur,
            converted
        );
        map.set(inv.customer_id, (map.get(inv.customer_id) ?? 0) + line);
    }
    return map;
}

/**
 * Group open Due/Overdue AR by invoice customer_currency, sort desc, take top N.
 * Same outstanding rule as CustomerService due aggregation.
 */
export function topOpenReceivableCurrencyBuckets(
    rows: CurrencyGroupedRow[],
    topN = 2
): OpenReceivableCurrencyBucket[] {
    const byCurrency = new Map<string, number>();
    for (const row of rows) {
        const currency = row.customer_currency?.trim().toUpperCase();
        if (!currency) {
            continue;
        }
        const amount = row.customer_outstanding_debt != null && row.customer_outstanding_debt !== 0
            ? row.customer_outstanding_debt
            : (row.outstanding_debt ?? 0);
        if (amount <= 0) {
            continue;
        }
        byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + amount);
    }
    return Array.from(byCurrency.entries())
        .map(([currency, openAr]) => ({ currency, openAr }))
        .sort((a, b) => b.openAr - a.openAr)
        .slice(0, topN);
}

/** Open Due/Overdue receivable for one customer in invoice currency (customer-level, all policies). */
export async function fetchOpenReceivableForCustomerByCurrency(
    accountId: number,
    customerId: number,
    currency: string,
    policyId?: number | null,
    dbClient: DbClient = defaultPrisma
): Promise<number> {
    const code = currency.trim().toUpperCase();
    if (!code) {
        return 0;
    }
    const rows = await dbClient.$queryRaw<{ ar: number | null }[]>`
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN COALESCE(i.customer_outstanding_debt, 0) != 0 THEN i.customer_outstanding_debt
                    ELSE COALESCE(i.amount, 0)
                END
            ),
            0
        )::float AS ar
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND UPPER(COALESCE(i.customer_currency, '')) = ${code}
          AND i.status IN ('Due', 'Overdue')
          ${policyId != null ? Prisma.sql`AND i.policy_id = ${policyId}` : Prisma.empty}
    `;
    return Number(rows[0]?.ar ?? 0);
}

export type CustomerHeaderOpenArAmounts = {
    total_ar: number;
    total_ar_secondary: number | null;
    credit_insurance_secondary_currency: string | null;
};

export type CustomerHeaderOpenArCustomer = CustomerInvoiceCurrencyBuckets & {
    total_due_amount?: number | null;
    total_overdue_amount?: number | null;
};

/**
 * Customer GET header open AR: FX-aware primary (account currency) and live
 * invoice-currency secondary with denormalized bucket fallback.
 */
export async function resolveCustomerHeaderOpenArAmounts(
    params: {
        accountId: number;
        customerId: number;
        accountCurrency: string | null | undefined;
        customer: CustomerHeaderOpenArCustomer;
        dbClient?: DbClient;
    }
): Promise<CustomerHeaderOpenArAmounts> {
    const { accountId, customerId, accountCurrency, customer, dbClient } =
        params;
    const denormalizedTotalAr = computeCustomerTotalAr(customer).toNumber();
    const acct = accountCurrency?.trim();

    let total_ar = denormalizedTotalAr;
    if (acct) {
        const liveByCustomer =
            await fetchOpenReceivableByCustomerMapInAccountCurrency(
                accountId,
                acct,
                { customerIds: [customerId], dbClient }
            );
        const livePrimary = liveByCustomer.get(customerId) ?? 0;
        if (livePrimary > 0) {
            total_ar = livePrimary;
        }
    }

    let credit_insurance_secondary_currency: string | null = null;
    let total_ar_secondary: number | null = null;

    if (acct) {
        const secondaryCurrency = resolveCustomerCreditInsuranceSecondaryCurrency(
            customer,
            acct
        );
        if (secondaryCurrency) {
            credit_insurance_secondary_currency = secondaryCurrency;
            const liveSecondary = await fetchOpenReceivableForCustomerByCurrency(
                accountId,
                customerId,
                secondaryCurrency,
                undefined,
                dbClient
            );
            total_ar_secondary =
                liveSecondary > 0
                    ? liveSecondary
                    : resolveCustomerTotalArSecondaryFromInvoiceBuckets(
                          customer,
                          secondaryCurrency
                      );
            if (total_ar_secondary == null) {
                credit_insurance_secondary_currency = null;
            }
        }
    }

    return {
        total_ar,
        total_ar_secondary,
        credit_insurance_secondary_currency,
    };
}

export async function fetchOpenReceivableTotalForCustomer(
    customerId: number,
    accountId: number,
    dbClient: DbClient = defaultPrisma
): Promise<number> {
    const rows = await dbClient.$queryRaw<{ ar: number | null }[]>`
        SELECT COALESCE(
          SUM(
            CASE
              WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
              ELSE COALESCE(i.customer_outstanding_debt, 0)
            END
          ),
          0
        )::float AS ar
        FROM "Invoice" i
        WHERE i.customer_id = ${customerId}
          AND i.account_id = ${accountId}
          AND i.status IN ('Due', 'Overdue')
    `;
    return Number(rows[0]?.ar ?? 0);
}

/** Open Due/Overdue AR for one customer, optionally scoped to a policy. */
export async function fetchOpenReceivableForCustomer(
    accountId: number,
    customerId: number,
    policyId?: number | null,
    dbClient: DbClient = defaultPrisma
): Promise<number> {
    const rows = await dbClient.$queryRaw<{ ar: number | null }[]>`
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                    ELSE COALESCE(i.customer_outstanding_debt, 0)
                END
            ),
            0
        )::float AS ar
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND i.status IN ('Due', 'Overdue')
          ${policyId != null ? Prisma.sql`AND i.policy_id = ${policyId}` : Prisma.empty}
    `;
    return Number(rows[0]?.ar ?? 0);
}

export async function fetchOpenReceivableCurrencyRowsForCustomer(
    customerId: number,
    accountId: number,
    dbClient: DbClient = defaultPrisma
): Promise<CurrencyGroupedRow[]> {
    return dbClient.$queryRaw<CurrencyGroupedRow[]>`
        SELECT
          i.customer_currency,
          COALESCE(SUM(i.outstanding_debt), 0)::float AS outstanding_debt,
          COALESCE(SUM(i.customer_outstanding_debt), 0)::float AS customer_outstanding_debt
        FROM "Invoice" i
        WHERE i.customer_id = ${customerId}
          AND i.account_id = ${accountId}
          AND i.status IN ('Due', 'Overdue')
        GROUP BY i.customer_currency
    `;
}

export async function fetchOpenReceivableByCustomerMap(
    dbClient: DbClient = defaultPrisma
): Promise<Map<number, number>> {
    type OpenArByCustomerRow = { customer_id: number; ar: number | null };
    const rows = await dbClient.$queryRaw<OpenArByCustomerRow[]>`
        SELECT i.customer_id,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ),
            0
          )::float AS ar
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        INNER JOIN "Account" a ON a.id = c.account_id
        WHERE c.collection_status IN ('Active', 'Inactive')
          AND a.has_credit_insurance = true
          AND i.status IN ('Due', 'Overdue')
        GROUP BY i.customer_id
    `;
    const map = new Map<number, number>();
    for (const row of rows) {
        map.set(row.customer_id, Number(row.ar ?? 0));
    }
    return map;
}

export type OpenReceivableScope = {
    customerId: number;
    accountId: number;
    policyId?: number;
};

/** Optional policy_id filter for policy-scoped open AR (credit dashboard). */
export function invoiceOpenReceivableWhere(
    scope: OpenReceivableScope
): Prisma.InvoiceWhereInput {
    return {
        customer_id: scope.customerId,
        account_id: scope.accountId,
        status: { in: ["Due", "Overdue"] },
        ...(scope.policyId != null ? { policy_id: scope.policyId } : {}),
    };
}
