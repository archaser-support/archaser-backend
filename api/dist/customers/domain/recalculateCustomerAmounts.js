"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateDueAmountsForCustomers = calculateDueAmountsForCustomers;
exports.calculateOutstandingAmountsForCustomers = calculateOutstandingAmountsForCustomers;
exports.recalculateCustomerAmounts = recalculateCustomerAmounts;
const client_1 = require("@prisma/client");
const EMPTY_DUE = {
    total_due_amount: 0,
    no_of_due_invoices: 0,
    customer_due_amount1: 0,
    customer_due_currency1: null,
    customer_due_amount2: 0,
    customer_due_currency2: null,
};
const EMPTY_OVERDUE = {
    total_outstanding_amount: 0,
    no_of_overdue_invoices: 0,
    customer_currency1: null,
    customer_outstanding_amount1: 0,
    customer_currency2: null,
    customer_outstanding_amount2: 0,
};
async function calculateDueAmountsForCustomers(customerIds, db) {
    const result = new Map();
    if (!customerIds.length) {
        return result;
    }
    const nonZeroBalance = {
        customer_id: { in: customerIds },
        status: "Due",
        OR: [
            { outstanding_debt: { not: 0 } },
            { customer_outstanding_debt: { not: 0 } },
        ],
    };
    const [totalGrouped, currencyGrouped, countGrouped] = await Promise.all([
        db.invoice.groupBy({
            by: ["customer_id"],
            where: nonZeroBalance,
            _sum: { outstanding_debt: true, customer_outstanding_debt: true },
        }),
        db.invoice.groupBy({
            by: ["customer_id", "customer_currency"],
            where: nonZeroBalance,
            _sum: { outstanding_debt: true, customer_outstanding_debt: true },
        }),
        db.invoice.groupBy({
            by: ["customer_id"],
            where: nonZeroBalance,
            _count: { id: true },
        }),
    ]);
    for (const customerId of customerIds) {
        const totalGroup = totalGrouped.find((g) => g.customer_id === customerId);
        const count = countGrouped.find((g) => g.customer_id === customerId)?._count?.id ??
            0;
        const currencyAmounts = currencyGrouped
            .filter((g) => g.customer_id === customerId)
            .map((g) => {
            const accountAmount = g._sum?.outstanding_debt ?? 0;
            const customerAmount = g._sum?.customer_outstanding_debt ?? 0;
            return {
                currency: g.customer_currency,
                amount: customerAmount !== 0 ? customerAmount : accountAmount,
            };
        })
            .filter((g) => g.currency && g.amount > 0)
            .sort((a, b) => b.amount - a.amount);
        result.set(customerId, {
            ...EMPTY_DUE,
            total_due_amount: totalGroup?._sum?.outstanding_debt ?? 0,
            no_of_due_invoices: count,
            customer_due_amount1: currencyAmounts[0]?.amount ?? 0,
            customer_due_currency1: currencyAmounts[0]?.currency || null,
            customer_due_amount2: currencyAmounts[1]?.amount ?? 0,
            customer_due_currency2: currencyAmounts[1]?.currency || null,
        });
    }
    return result;
}
async function calculateOutstandingAmountsForCustomers(customerIds, db) {
    const result = new Map();
    if (!customerIds.length) {
        return result;
    }
    const overdue = {
        customer_id: { in: customerIds },
        status: "Overdue",
    };
    const [totalGrouped, currencyGrouped, countGrouped] = await Promise.all([
        db.invoice.groupBy({
            by: ["customer_id"],
            where: overdue,
            _sum: { outstanding_debt: true, customer_outstanding_debt: true },
        }),
        db.invoice.groupBy({
            by: ["customer_id", "customer_currency"],
            where: overdue,
            _sum: { customer_outstanding_debt: true },
        }),
        db.invoice.groupBy({
            by: ["customer_id"],
            where: overdue,
            _count: { id: true },
        }),
    ]);
    for (const customerId of customerIds) {
        const totalGroup = totalGrouped.find((g) => g.customer_id === customerId);
        const accountAmount = totalGroup?._sum?.outstanding_debt ?? 0;
        const customerAmount = totalGroup?._sum?.customer_outstanding_debt ?? 0;
        const count = countGrouped.find((g) => g.customer_id === customerId)?._count?.id ??
            0;
        const sortedGroups = currencyGrouped
            .filter((g) => g.customer_id === customerId && !!g.customer_currency)
            .sort((a, b) => (a.customer_currency ?? "").localeCompare(b.customer_currency ?? ""));
        result.set(customerId, {
            ...EMPTY_OVERDUE,
            total_outstanding_amount: accountAmount !== 0 ? accountAmount : customerAmount,
            no_of_overdue_invoices: count,
            customer_currency1: sortedGroups[0]?.customer_currency ?? null,
            customer_outstanding_amount1: sortedGroups[0]?._sum?.customer_outstanding_debt ?? 0,
            customer_currency2: sortedGroups[1]?.customer_currency ?? null,
            customer_outstanding_amount2: sortedGroups[1]?._sum?.customer_outstanding_debt ?? 0,
        });
    }
    return result;
}
async function applyCollectionPeriodAmounts(customerId, overdue, db) {
    const openPeriod = await db.customerCollectionPeriod.findFirst({
        where: { customer_id: customerId, period_end_date: null },
        select: { id: true },
    });
    if (!openPeriod) {
        return;
    }
    await db.customerCollectionPeriod.update({
        where: { id: openPeriod.id },
        data: {
            total_outstanding_amount: overdue.total_outstanding_amount,
            no_of_overdue_invoices: overdue.no_of_overdue_invoices,
            customer_currency1: overdue.customer_currency1,
            customer_outstanding_amount1: overdue.customer_outstanding_amount1,
            customer_currency2: overdue.customer_currency2,
            customer_outstanding_amount2: overdue.customer_outstanding_amount2,
        },
    });
}
async function recalculateCustomerAmounts(customerIds, db) {
    const result = new Map();
    if (!customerIds.length) {
        return result;
    }
    const [dueAmounts, overdueAmounts] = await Promise.all([
        calculateDueAmountsForCustomers(customerIds, db),
        calculateOutstandingAmountsForCustomers(customerIds, db),
    ]);
    for (const customerId of customerIds) {
        const due = dueAmounts.get(customerId) ?? EMPTY_DUE;
        const overdue = overdueAmounts.get(customerId) ?? EMPTY_OVERDUE;
        result.set(customerId, { due, overdue });
        const collectionStatus = due.no_of_due_invoices > 0 || overdue.no_of_overdue_invoices > 0
            ? client_1.record_status.Active
            : client_1.record_status.Inactive;
        await db.customer.update({
            where: { id: customerId },
            data: {
                collection_status: collectionStatus,
                total_due_amount: due.total_due_amount,
                no_of_due_invoices: due.no_of_due_invoices,
                customer_due_amount1: due.customer_due_amount1,
                customer_due_currency1: due.customer_due_currency1,
                customer_due_amount2: due.customer_due_amount2,
                customer_due_currency2: due.customer_due_currency2,
                total_overdue_amount: overdue.total_outstanding_amount,
                number_of_overdue_invoices: overdue.no_of_overdue_invoices,
                customer_overdue_amount1: overdue.customer_outstanding_amount1,
                customer_overdue_currency1: overdue.customer_currency1,
                customer_overdue_amount2: overdue.customer_outstanding_amount2,
                customer_overdue_currency2: overdue.customer_currency2,
                total_invoices_overdue: overdue.total_outstanding_amount,
            },
        });
        await applyCollectionPeriodAmounts(customerId, overdue, db);
    }
    return result;
}
//# sourceMappingURL=recalculateCustomerAmounts.js.map