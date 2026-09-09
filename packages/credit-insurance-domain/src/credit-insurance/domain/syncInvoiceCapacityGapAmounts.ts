import { Prisma, invoice_status } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";

import {
    bulkUpdateInvoiceCapacityGaps,
    bulkZeroInvoiceCapacityGaps,
    type InvoiceCapacityGapWrite,
} from "./bulkInvoiceUpdates";
import {
    computeInvoiceCapacityGapDualCurrency,
    type CurrencyRateRow,
} from "./invoiceCapacityGapAmounts";
import {
    allocateLiveCapacityGapWaterfall,
    compareInvoicesForLiveCapacityGapWaterfall,
    invoiceOutstandingInLimitCurrency,
} from "./invoiceInsuranceFields";
import {
    hasActiveLinkedPolicy,
    isUncoveredExposureCustomer,
} from "./policyExclusion";
import { resolveEffectiveApprovedLimit } from "./resolveEffectiveApprovedLimit";

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

function isCapacityGapAlreadyZero(inv: {
    capacity_gap_amount: Prisma.Decimal | null;
    capacity_gap_amount_limit: Prisma.Decimal | null;
}): boolean {
    return (
        inv.capacity_gap_amount != null &&
        new Prisma.Decimal(inv.capacity_gap_amount).eq(0) &&
        inv.capacity_gap_amount_limit != null &&
        new Prisma.Decimal(inv.capacity_gap_amount_limit).eq(0)
    );
}

/**
 * Persist live waterfall `limit_assessed_*` + dual-currency capacity gap for one customer.
 *
 * Always reallocates over the full open Due/Overdue set (oldest `invoice_date`, then id).
 * `invoiceIds` is ignored for allocation — gaps are interdependent under the waterfall.
 */
export async function syncInvoiceCapacityGapAmountsForCustomer(
    customerId: number,
    options?: {
        invoiceIds?: number[];
        rateDate?: Date;
        dbClient?: DbClient;
    }
): Promise<{ missingRate: boolean }> {
    void options?.invoiceIds;
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
            approved_limit: true,
            approved_limit_currency: true,
            outdated_dcl: true,
            excluded_from_policy: true,
        },
    });
    const uncovered = isUncoveredExposureCustomer({
        hasLinkedPolicy: hasActiveLinkedPolicy(
            activePolicy?.insurance_policy_id
        ),
        exclusionReason: activePolicy?.policy_exclusion_reason ?? null,
    });

    const accountCurrency = normalizeCurrency(customer.Account.currency);

    const invoices = (await dbClient.invoice.findMany({
        where: {
            customer_id: customerId,
            account_id: customer.account_id,
        },
        select: {
            id: true,
            status: true,
            policy_id: true,
            invoice_date: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
            customer_currency: true,
            limit_assessed_amount: true,
            limit_assessed_currency: true,
            capacity_gap_amount: true,
            capacity_gap_amount_limit: true,
        },
    } as any)) as Array<{
        id: number;
        status: invoice_status;
        policy_id: number | null;
        invoice_date: Date | null;
        outstanding_debt: number | null;
        customer_outstanding_debt: number | null;
        amount: number | null;
        customer_currency: string | null;
        limit_assessed_amount: Prisma.Decimal | null;
        limit_assessed_currency: string | null;
        capacity_gap_amount: Prisma.Decimal | null;
        capacity_gap_amount_limit: Prisma.Decimal | null;
    }>;

    if (uncovered) {
        const zeroIds = invoices
            .filter(
                (inv) =>
                    OPEN_STATUSES.includes(inv.status) &&
                    !isCapacityGapAlreadyZero(inv)
            )
            .map((inv) => inv.id);
        await bulkZeroInvoiceCapacityGaps(dbClient, zeroIds);
        return { missingRate: false };
    }

    const limitCurrency =
        normalizeCurrency(activePolicy?.approved_limit_currency) ??
        accountCurrency;
    const policyId = activePolicy?.insurance_policy_id ?? null;
    const baseApprovedLimit =
        activePolicy?.approved_limit != null
            ? activePolicy.approved_limit
            : null;

    let effectiveLimit = 0;
    if (
        baseApprovedLimit != null &&
        Number(baseApprovedLimit) > 0 &&
        policyId != null
    ) {
        const resolved = await resolveEffectiveApprovedLimit(customerId, {
            baseApprovedLimit,
            baseApprovedLimitCurrency: limitCurrency,
            outdatedDcl: Boolean(activePolicy?.outdated_dcl),
            excludedFromPolicy: Boolean(activePolicy?.excluded_from_policy),
            parentPrimaryPolicyId: policyId,
            asOfDate: rateDate,
            dbClient,
        });
        if (resolved.missingRate) {
            missingRate = true;
        }
        effectiveLimit = Math.max(
            0,
            Number(resolved.effectiveApprovedLimit ?? Number(baseApprovedLimit))
        );
    }

    const openInsured = invoices
        .filter(
            (inv) =>
                OPEN_STATUSES.includes(inv.status) &&
                inv.policy_id != null &&
                (policyId == null || inv.policy_id === policyId)
        )
        .slice()
        .sort(compareInvoicesForLiveCapacityGapWaterfall);

    const openIdSet = new Set(openInsured.map((inv) => inv.id));

    const zeroIds = invoices
        .filter((inv) => !openIdSet.has(inv.id) && !isCapacityGapAlreadyZero(inv))
        .map((inv) => inv.id);
    await bulkZeroInvoiceCapacityGaps(dbClient, zeroIds);

    if (openInsured.length === 0) {
        return { missingRate };
    }

    const allocations = allocateLiveCapacityGapWaterfall({
        effectiveLimit,
        openInvoices: openInsured.map((inv) => ({
            id: inv.id,
            outstandingInLimitCurrency: Math.max(
                0,
                invoiceOutstandingInLimitCurrency({
                    outstanding_debt: inv.outstanding_debt,
                    customer_outstanding_debt: inv.customer_outstanding_debt,
                    amount: inv.amount,
                    customer_currency: inv.customer_currency,
                    limit_assessed_currency: limitCurrency,
                    accountCurrency,
                })
            ),
        })),
    });
    const allocationById = new Map(
        allocations.map((row) => [row.id, row] as const)
    );

    const rateCache = new Map<string, CurrencyRateRow | null>();
    const assessedAt = new Date();
    const pendingWrites: InvoiceCapacityGapWrite[] = [];

    for (const inv of openInsured) {
        const allocation = allocationById.get(inv.id);
        if (!allocation) {
            continue;
        }

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
                limit_assessed_amount: allocation.limitAssessedAmount,
                limit_assessed_currency: limitCurrency,
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
        const nextAssessed = new Prisma.Decimal(allocation.limitAssessedAmount);

        const prevBase = inv.capacity_gap_amount;
        const prevLimit = inv.capacity_gap_amount_limit;
        const prevAssessed = inv.limit_assessed_amount;
        const prevAssessedCcy = normalizeCurrency(inv.limit_assessed_currency);

        const baseChanged =
            (prevBase == null && nextBase != null) ||
            (prevBase != null && nextBase == null) ||
            (prevBase != null &&
                nextBase != null &&
                !new Prisma.Decimal(prevBase).eq(nextBase));
        const limitChanged =
            prevLimit == null ||
            !new Prisma.Decimal(prevLimit).eq(nextLimit);
        const assessedChanged =
            prevAssessed == null ||
            !new Prisma.Decimal(prevAssessed).eq(nextAssessed) ||
            prevAssessedCcy !== limitCurrency;

        if (baseChanged || limitChanged || assessedChanged) {
            pendingWrites.push({
                id: inv.id,
                limit_assessed_amount: nextAssessed.toNumber(),
                limit_assessed_currency: limitCurrency,
                capacity_gap_amount:
                    nextBase != null ? nextBase.toNumber() : null,
                capacity_gap_amount_limit: nextLimit.toNumber(),
                capacity_gap_amount_date: computed.rateDate,
            });
        }
    }

    await bulkUpdateInvoiceCapacityGaps(dbClient, pendingWrites, assessedAt);

    return { missingRate };
}
