"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncInvoiceCapacityGapAmountsForCustomer = syncInvoiceCapacityGapAmountsForCustomer;
const client_1 = require("@prisma/client");
const domain_db_1 = require("../domain-db");
const invoiceCapacityGapAmounts_1 = require("./invoiceCapacityGapAmounts");
const policyExclusion_1 = require("./policyExclusion");
const OPEN_STATUSES = [
    client_1.invoice_status.Due,
    client_1.invoice_status.Overdue,
];
function startOfTodayUtc() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function normalizeCurrency(code) {
    const value = code?.trim().toUpperCase();
    return value ? value : null;
}
async function fetchCurrencyRateForPair(rateDate, accountCurrency, limitCurrency, dbClient) {
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
async function syncInvoiceCapacityGapAmountsForCustomer(customerId, options) {
    const dbClient = options?.dbClient ?? domain_db_1.prisma;
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
    const uncovered = (0, policyExclusion_1.isUncoveredExposureCustomer)({
        hasLinkedPolicy: (0, policyExclusion_1.hasActiveLinkedPolicy)(activePolicy?.insurance_policy_id),
        exclusionReason: activePolicy?.policy_exclusion_reason ?? null,
    });
    const accountCurrency = normalizeCurrency(customer.Account.currency);
    const invoiceWhere = {
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
    }));
    const rateCache = new Map();
    for (const inv of invoices) {
        const isOpen = OPEN_STATUSES.includes(inv.status);
        const hasPolicy = inv.policy_id != null;
        if (uncovered && isOpen) {
            const zeroed = inv.capacity_gap_amount != null &&
                new client_1.Prisma.Decimal(inv.capacity_gap_amount).eq(0) &&
                inv.capacity_gap_amount_limit != null &&
                new client_1.Prisma.Decimal(inv.capacity_gap_amount_limit).eq(0);
            if (!zeroed) {
                await dbClient.invoice.update({
                    where: { id: inv.id },
                    data: {
                        capacity_gap_amount: new client_1.Prisma.Decimal(0),
                        capacity_gap_amount_limit: new client_1.Prisma.Decimal(0),
                        capacity_gap_amount_date: null,
                    },
                });
            }
            continue;
        }
        if (!isOpen || !hasPolicy) {
            const zeroed = inv.capacity_gap_amount != null &&
                new client_1.Prisma.Decimal(inv.capacity_gap_amount).eq(0) &&
                inv.capacity_gap_amount_limit != null &&
                new client_1.Prisma.Decimal(inv.capacity_gap_amount_limit).eq(0);
            if (!zeroed) {
                await dbClient.invoice.update({
                    where: { id: inv.id },
                    data: {
                        capacity_gap_amount: new client_1.Prisma.Decimal(0),
                        capacity_gap_amount_limit: new client_1.Prisma.Decimal(0),
                        capacity_gap_amount_date: null,
                    },
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
        let currencyRate = null;
        if (limitCurrency &&
            accountCurrency &&
            limitCurrency !== accountCurrency) {
            const cacheKey = `${accountCurrency}:${limitCurrency}`;
            if (!rateCache.has(cacheKey)) {
                rateCache.set(cacheKey, await fetchCurrencyRateForPair(rateDate, accountCurrency, limitCurrency, dbClient));
            }
            currencyRate = rateCache.get(cacheKey) ?? null;
        }
        const computed = (0, invoiceCapacityGapAmounts_1.computeInvoiceCapacityGapDualCurrency)({
            row: {
                outstanding_debt: inv.outstanding_debt,
                customer_outstanding_debt: inv.customer_outstanding_debt,
                limit_assessed_amount: new client_1.Prisma.Decimal(inv.limit_assessed_amount).toNumber(),
                limit_assessed_currency: inv.limit_assessed_currency,
            },
            accountCurrency,
            currencyRate,
        });
        if (computed.missingRate) {
            missingRate = true;
        }
        const nextBase = computed.gapBase != null
            ? new client_1.Prisma.Decimal(computed.gapBase)
            : null;
        const nextLimit = new client_1.Prisma.Decimal(computed.gapLimit);
        const prevBase = inv.capacity_gap_amount;
        const prevLimit = inv.capacity_gap_amount_limit;
        const baseChanged = (prevBase == null && nextBase != null) ||
            (prevBase != null && nextBase == null) ||
            (prevBase != null &&
                nextBase != null &&
                !new client_1.Prisma.Decimal(prevBase).eq(nextBase));
        const limitChanged = prevLimit == null ||
            !new client_1.Prisma.Decimal(prevLimit).eq(nextLimit);
        if (baseChanged || limitChanged) {
            await dbClient.invoice.update({
                where: { id: inv.id },
                data: {
                    capacity_gap_amount: nextBase,
                    capacity_gap_amount_limit: nextLimit,
                    capacity_gap_amount_date: computed.rateDate,
                },
            });
        }
    }
    return { missingRate };
}
//# sourceMappingURL=syncInvoiceCapacityGapAmounts.js.map