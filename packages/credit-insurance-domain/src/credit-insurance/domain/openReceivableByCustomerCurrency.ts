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

export type CustomerHeaderCurrencyBuckets = {
    customer_due_amount1: number;
    customer_due_currency1: string | null;
    customer_due_amount2: number;
    customer_due_currency2: string | null;
    customer_overdue_amount1: number;
    customer_overdue_currency1: string | null;
    customer_overdue_amount2: number;
    customer_overdue_currency2: string | null;
};

export type CustomerHeaderOpenArAmounts = CustomerHeaderCurrencyBuckets & {
    total_ar: number;
    /**
     * Live Due rollup when account currency allows live computation
     * (including zero when the open set is empty); else denormalized.
     */
    total_due_amount: number;
    /**
     * Live Overdue rollup when account currency allows live computation
     * (including zero when the open set is empty); else denormalized.
     */
    total_overdue_amount: number;
    no_of_due_invoices: number;
    number_of_overdue_invoices: number;
    total_ar_secondary: number | null;
    credit_insurance_secondary_currency: string | null;
};

export type CustomerHeaderOpenArCustomer = CustomerInvoiceCurrencyBuckets & {
    total_due_amount?: number | null;
    total_overdue_amount?: number | null;
    no_of_due_invoices?: number | null;
    number_of_overdue_invoices?: number | null;
};

function bucketsFromCustomer(
    customer: CustomerHeaderOpenArCustomer
): CustomerHeaderCurrencyBuckets {
    return {
        customer_due_amount1: Number(customer.customer_due_amount1 ?? 0),
        customer_due_currency1: customer.customer_due_currency1 ?? null,
        customer_due_amount2: Number(customer.customer_due_amount2 ?? 0),
        customer_due_currency2: customer.customer_due_currency2 ?? null,
        customer_overdue_amount1: Number(customer.customer_overdue_amount1 ?? 0),
        customer_overdue_currency1: customer.customer_overdue_currency1 ?? null,
        customer_overdue_amount2: Number(customer.customer_overdue_amount2 ?? 0),
        customer_overdue_currency2: customer.customer_overdue_currency2 ?? null,
    };
}

/**
 * Due currency slots: prefer customer-currency outstanding, positive only, largest first.
 * Matches {@link calculateDueAmountsForCustomers} slot rules.
 */
function buildDueCurrencyBuckets(
    byCurrency: Map<string, { account: number; customer: number }>
): Pick<
    CustomerHeaderCurrencyBuckets,
    | "customer_due_amount1"
    | "customer_due_currency1"
    | "customer_due_amount2"
    | "customer_due_currency2"
> {
    const currencyAmounts = Array.from(byCurrency.entries())
        .map(([currency, sums]) => ({
            currency,
            amount: sums.customer !== 0 ? sums.customer : sums.account,
        }))
        .filter((g) => g.currency && g.amount > 0)
        .sort((a, b) => b.amount - a.amount);

    return {
        customer_due_amount1: currencyAmounts[0]?.amount ?? 0,
        customer_due_currency1: currencyAmounts[0]?.currency ?? null,
        customer_due_amount2: currencyAmounts[1]?.amount ?? 0,
        customer_due_currency2: currencyAmounts[1]?.currency ?? null,
    };
}

/**
 * Overdue currency slots: customer-currency outstanding, alphabetical currency order.
 * Matches {@link calculateOutstandingAmountsForCustomers} slot rules.
 */
function buildOverdueCurrencyBuckets(
    byCurrency: Map<string, number>
): Pick<
    CustomerHeaderCurrencyBuckets,
    | "customer_overdue_amount1"
    | "customer_overdue_currency1"
    | "customer_overdue_amount2"
    | "customer_overdue_currency2"
> {
    const sorted = Array.from(byCurrency.entries())
        .filter(([currency]) => !!currency)
        .sort(([a], [b]) => a.localeCompare(b));

    return {
        customer_overdue_currency1: sorted[0]?.[0] ?? null,
        customer_overdue_amount1: sorted[0]?.[1] ?? 0,
        customer_overdue_currency2: sorted[1]?.[0] ?? null,
        customer_overdue_amount2: sorted[1]?.[1] ?? 0,
    };
}

/**
 * Live Due / Overdue / Total AR for one customer in account currency, plus invoice
 * counts and dual-currency buckets for the header cards.
 * Same FX rules as {@link fetchOpenReceivableByCustomerMapInAccountCurrency};
 * Total AR is always Due + Overdue from this split so header cards cannot diverge.
 */
export async function fetchCustomerHeaderOpenArSplitInAccountCurrency(
    accountId: number,
    customerId: number,
    accountCurrency: string,
    dbClient: DbClient = defaultPrisma
): Promise<{
    total_due_amount: number;
    total_overdue_amount: number;
    total_ar: number;
    no_of_due_invoices: number;
    number_of_overdue_invoices: number;
    invoiceCount: number;
} & CustomerHeaderCurrencyBuckets> {
    const accountCur = accountCurrency.trim().toUpperCase();
    const invoices = await dbClient.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            status: { in: ["Due", "Overdue"] },
            Customer: {
                account_id: accountId,
                collection_status: { in: ["Active", "Inactive"] },
            },
        },
        select: {
            status: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
            customer_currency: true,
        },
    });

    let total_due_amount = 0;
    let total_overdue_amount = 0;
    let no_of_due_invoices = 0;
    let number_of_overdue_invoices = 0;
    const dueByCurrency = new Map<string, { account: number; customer: number }>();
    const overdueByCurrency = new Map<string, number>();

    for (const inv of invoices) {
        const custCurrency = inv.customer_currency?.trim().toUpperCase() ?? "";
        const accountOd = Number(inv.outstanding_debt ?? 0);
        const customerOd = Number(inv.customer_outstanding_debt ?? 0);
        const hasAccountOutstanding =
            inv.outstanding_debt != null && inv.outstanding_debt !== 0;
        let converted: number | null | undefined;
        if (
            !hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur
        ) {
            const amount = inv.amount != null ? Number(inv.amount) : 0;
            const val = customerOd !== 0 ? customerOd : amount;
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

        if (inv.status === "Overdue") {
            total_overdue_amount += line;
            number_of_overdue_invoices += 1;
            if (custCurrency) {
                overdueByCurrency.set(
                    custCurrency,
                    (overdueByCurrency.get(custCurrency) ?? 0) + customerOd
                );
            }
            continue;
        }

        // Due rollup excludes zero-balance rows (same as recalculateCustomerAmounts).
        if (accountOd === 0 && customerOd === 0) {
            continue;
        }
        total_due_amount += line;
        no_of_due_invoices += 1;
        if (custCurrency) {
            const existing = dueByCurrency.get(custCurrency) ?? {
                account: 0,
                customer: 0,
            };
            existing.account += accountOd;
            existing.customer += customerOd;
            dueByCurrency.set(custCurrency, existing);
        }
    }

    return {
        total_due_amount,
        total_overdue_amount,
        total_ar: total_due_amount + total_overdue_amount,
        no_of_due_invoices,
        number_of_overdue_invoices,
        invoiceCount: invoices.length,
        ...buildDueCurrencyBuckets(dueByCurrency),
        ...buildOverdueCurrencyBuckets(overdueByCurrency),
    };
}

/**
 * Customer GET header open AR: one live Due/Overdue split (same FX rules) so the
 * three header cards always agree — amounts, invoice counts, and dual-currency
 * buckets.
 *
 * When account currency is available, always use the live split — including when
 * the open Due/Overdue set is empty (amounts/counts are zero). That avoids
 * showing stale denormalized overdue/due after invoices are Paid.
 *
 * Denormalized customer rollups are used only when live computation cannot run
 * (missing/blank account currency). An empty open set is not a fallback case.
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
    const denormalizedDue = Number(customer.total_due_amount ?? 0);
    const denormalizedOverdue = Number(customer.total_overdue_amount ?? 0);
    const denormalizedTotalAr = computeCustomerTotalAr(customer).toNumber();
    const denormalizedBuckets = bucketsFromCustomer(customer);
    const acct = accountCurrency?.trim();

    // Default to denormalized only until/unless live computation can run.
    let total_due_amount = denormalizedDue;
    let total_overdue_amount = denormalizedOverdue;
    let total_ar = denormalizedTotalAr;
    let no_of_due_invoices = Number(customer.no_of_due_invoices ?? 0);
    let number_of_overdue_invoices = Number(
        customer.number_of_overdue_invoices ?? 0
    );
    let buckets = denormalizedBuckets;

    if (acct) {
        const live = await fetchCustomerHeaderOpenArSplitInAccountCurrency(
            accountId,
            customerId,
            acct,
            dbClient ?? defaultPrisma
        );
        // Always trust live (even invoiceCount === 0) so Due/Overdue/Total AR
        // share one source and Paid-only customers cannot show stale rollups.
        total_due_amount = live.total_due_amount;
        total_overdue_amount = live.total_overdue_amount;
        total_ar = live.total_ar;
        no_of_due_invoices = live.no_of_due_invoices;
        number_of_overdue_invoices = live.number_of_overdue_invoices;
        buckets = {
            customer_due_amount1: live.customer_due_amount1,
            customer_due_currency1: live.customer_due_currency1,
            customer_due_amount2: live.customer_due_amount2,
            customer_due_currency2: live.customer_due_currency2,
            customer_overdue_amount1: live.customer_overdue_amount1,
            customer_overdue_currency1: live.customer_overdue_currency1,
            customer_overdue_amount2: live.customer_overdue_amount2,
            customer_overdue_currency2: live.customer_overdue_currency2,
        };
    }

    let credit_insurance_secondary_currency: string | null = null;
    let total_ar_secondary: number | null = null;

    if (acct) {
        const secondaryCurrency = resolveCustomerCreditInsuranceSecondaryCurrency(
            buckets,
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
                          buckets,
                          secondaryCurrency
                      );
            if (total_ar_secondary == null) {
                credit_insurance_secondary_currency = null;
            }
        }
    }

    return {
        total_ar,
        total_due_amount,
        total_overdue_amount,
        no_of_due_invoices,
        number_of_overdue_invoices,
        ...buckets,
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
