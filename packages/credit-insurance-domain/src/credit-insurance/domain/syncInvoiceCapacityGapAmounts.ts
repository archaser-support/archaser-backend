import { Prisma, invoice_status } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";

import {
    computeInvoiceCapacityGapDualCurrency,
    type CurrencyRateRow,
} from "./invoiceCapacityGapAmounts";
import {
    hasActiveLinkedPolicy,
    isUncoveredExposureCustomer,
} from "./policyExclusion";

const OPEN_STATUSES: invoice_status[] = [
    invoice_status.Due,
    invoice_status.Overdue,
];

function startOfTodayUtc(): Date {
    const now = new Date();
    return new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
}

function normalizeCurrency(code: string | null | undefined): string | null {
    const value = code?.trim().toUpperCase();
    return value ? value : null;
}

async function fetchCurrencyRateForPair(
    rateDate: Date,
    accountCurrency: string,
    limitCurrency: string,
    dbClient: DbClient
): Promise<CurrencyRateRow | null> {
    const rates = await dbClient.currencyRate.findMany({
        where: {
            rate_date: rateDate,
            OR: [
                {
                    base_currency: accountCurrency,
                    other_currency: limitCurrency,
                },
                {
                    base_currency: limitCurrency,
                    other_currency: accountCurrency,
                },
            ],
        },
        select: {
            base_currency: true,
            other_currency: true,
            currency_ratio: true,
            rate_date: true,
        },
        take: 1,
    });
    return rates[0] ?? null;
}

/**
 * Persist per-invoice dual-currency capacity gap for one customer.
 * When `invoiceIds` is set, only those open invoices are recomputed; others unchanged.
 */
export async function syncInvoiceCapacityGapAmountsForCustomer(
    customerId: number,
    options?: {
        invoiceIds?: number[];
        rateDate?: Date;
        dbClient?: DbClient;
    }
): Promise<{ missingRate: boolean }> {
    const dbClient = options?.dbClient ?? defaultPrisma;
    const rateDate = options?.rateDate ?? startOfTodayUtc();
    let missingRate = false;

    const customer = await dbClient.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            account_id: true,
            Account: {
                select: { currency: true, has_credit_insurance: true },
            },
        },
    });

    if (!customer?.Account?.has_credit_insurance) {
        return { missingRate: false };
    }

    const activePolicy = await dbClient.customerPolicy.findFirst({
        where: { customer_id: customerId, is_active: true },
        select: {
            insurance_policy_id: true,
            policy_exclusion_reason: true,
        },
    });
    const uncovered = isUncoveredExposureCustomer({
        hasLinkedPolicy: hasActiveLinkedPolicy(
            activePolicy?.insurance_policy_id
        ),
        exclusionReason: activePolicy?.policy_exclusion_reason ?? null,
    });

    const accountCurrency = normalizeCurrency(customer.Account.currency);

    const invoiceWhere: Prisma.InvoiceWhereInput = {
        customer_id: customerId,
        account_id: customer.account_id,
        ...(options?.invoiceIds?.length
            ? { id: { in: options.invoiceIds } }
            : {}),
    };

    const invoices = (await dbClient.invoice.findMany({
        where: invoiceWhere,
        select: {
            id: true,
            status: true,
            policy_id: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            limit_assessed_amount: true,
            limit_assessed_currency: true,
            capacity_gap_amount: true,
            capacity_gap_amount_limit: true,
        },
    } as any)) as Array<{
        id: number;
        status: invoice_status;
        policy_id: number | null;
        outstanding_debt: number | null;
        customer_outstanding_debt: number | null;
        limit_assessed_amount: Prisma.Decimal | null;
        limit_assessed_currency: string | null;
        capacity_gap_amount: Prisma.Decimal | null;
        capacity_gap_amount_limit: Prisma.Decimal | null;
    }>;

    const rateCache = new Map<string, CurrencyRateRow | null>();

    for (const inv of invoices) {
        const isOpen = OPEN_STATUSES.includes(inv.status);
        const hasPolicy = inv.policy_id != null;

        if (uncovered && isOpen) {
            const zeroed =
                inv.capacity_gap_amount != null &&
                new Prisma.Decimal(inv.capacity_gap_amount).eq(0) &&
                inv.capacity_gap_amount_limit != null &&
                new Prisma.Decimal(inv.capacity_gap_amount_limit).eq(0);
            if (!zeroed) {
                await dbClient.invoice.updateMany({
                    where: { id: inv.id },
                    data: {
                        capacity_gap_amount: new Prisma.Decimal(0),
                        capacity_gap_amount_limit: new Prisma.Decimal(0),
                        capacity_gap_amount_date: null,
                    } as any,
                });
            }
            continue;
        }

        if (!isOpen || !hasPolicy) {
            const zeroed =
                inv.capacity_gap_amount != null &&
                new Prisma.Decimal(inv.capacity_gap_amount).eq(0) &&
                inv.capacity_gap_amount_limit != null &&
                new Prisma.Decimal(inv.capacity_gap_amount_limit).eq(0);
            if (!zeroed) {
                await dbClient.invoice.updateMany({
                    where: { id: inv.id },
                    data: {
                        capacity_gap_amount: new Prisma.Decimal(0),
                        capacity_gap_amount_limit: new Prisma.Decimal(0),
                        capacity_gap_amount_date: null,
                    } as any,
                });
            }
            continue;
        }

        if (options?.invoiceIds?.length && !OPEN_STATUSES.includes(inv.status)) {
            continue;
        }

        if (inv.limit_assessed_amount == null) {
            continue;
        }

        const limitCurrency = normalizeCurrency(inv.limit_assessed_currency);
        let currencyRate: CurrencyRateRow | null = null;
        if (
            limitCurrency &&
            accountCurrency &&
            limitCurrency !== accountCurrency
        ) {
            const cacheKey = `${accountCurrency}:${limitCurrency}`;
            if (!rateCache.has(cacheKey)) {
                rateCache.set(
                    cacheKey,
                    await fetchCurrencyRateForPair(
                        rateDate,
                        accountCurrency,
                        limitCurrency,
                        dbClient
                    )
                );
            }
            currencyRate = rateCache.get(cacheKey) ?? null;
        }

        const computed = computeInvoiceCapacityGapDualCurrency({
            row: {
                outstanding_debt: inv.outstanding_debt,
                customer_outstanding_debt: inv.customer_outstanding_debt,
                limit_assessed_amount: new Prisma.Decimal(
                    inv.limit_assessed_amount
                ).toNumber(),
                limit_assessed_currency: inv.limit_assessed_currency,
            },
            accountCurrency,
            currencyRate,
        });

        if (computed.missingRate) {
            missingRate = true;
        }

        const nextBase =
            computed.gapBase != null
                ? new Prisma.Decimal(computed.gapBase)
                : null;
        const nextLimit = new Prisma.Decimal(computed.gapLimit);

        const prevBase = inv.capacity_gap_amount;
        const prevLimit = inv.capacity_gap_amount_limit;
        const baseChanged =
            (prevBase == null && nextBase != null) ||
            (prevBase != null && nextBase == null) ||
            (prevBase != null &&
                nextBase != null &&
                !new Prisma.Decimal(prevBase).eq(nextBase));
        const limitChanged =
            prevLimit == null ||
            !new Prisma.Decimal(prevLimit).eq(nextLimit);

        if (baseChanged || limitChanged) {
            await dbClient.invoice.updateMany({
                where: { id: inv.id },
                data: {
                    capacity_gap_amount: nextBase,
                    capacity_gap_amount_limit: nextLimit,
                    capacity_gap_amount_date: computed.rateDate,
                } as any,
            });
        }
    }

    return { missingRate };
}
