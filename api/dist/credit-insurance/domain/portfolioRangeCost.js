"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RANGE_COST_EXCLUDED_INVOICE_STATUSES = void 0;
exports.computeLimitDayCostSlice = computeLimitDayCostSlice;
exports.computeActualSalesInvoiceCostSlice = computeActualSalesInvoiceCostSlice;
exports.computePortfolioRangeCost = computePortfolioRangeCost;
const policyExclusion_1 = require("./shared/policyExclusion");
exports.RANGE_COST_EXCLUDED_INVOICE_STATUSES = [
    "Draft",
    "Void",
    "Cancelled",
];
const EXCLUDED_INVOICE_STATUS_SET = new Set(exports.RANGE_COST_EXCLUDED_INVOICE_STATUSES);
function isApprovedOnDay(input) {
    if (!input.hasLinkedPolicy) {
        return false;
    }
    return !(0, policyExclusion_1.normalizePolicyExclusionReason)(input.exclusionReason);
}
function computeLimitDayCostSlice(input) {
    if (input.excludedFromPolicy || input.outdatedDcl) {
        return 0;
    }
    if (input.costCalculationMethod !== "Limit") {
        return 0;
    }
    if (input.approvedLimit == null ||
        input.costPercent == null ||
        !Number.isFinite(input.approvedLimit) ||
        !Number.isFinite(input.costPercent) ||
        input.approvedLimit <= 0) {
        return 0;
    }
    return (input.approvedLimit * input.costPercent) / 100 / 365;
}
function computeActualSalesInvoiceCostSlice(input) {
    if (input.costCalculationMethod !== "ActualSales") {
        return 0;
    }
    if (input.costPercent == null ||
        !Number.isFinite(input.costPercent) ||
        !Number.isFinite(input.amount)) {
        return 0;
    }
    return (input.amount * input.costPercent) / 100;
}
function addToMonthBucket(buckets, ymd, amount) {
    if (!Number.isFinite(amount) || amount === 0) {
        return;
    }
    const month = ymd.slice(0, 7);
    buckets.set(month, (buckets.get(month) ?? 0) + amount);
}
function dayKey(customerId, snapshotDate) {
    return `${customerId}|${snapshotDate}`;
}
function computePortfolioRangeCost(input) {
    const monthBuckets = new Map();
    let periodCost = 0;
    const dayByCustomerDate = new Map();
    for (const row of input.dayRows) {
        dayByCustomerDate.set(dayKey(row.customerId, row.snapshotDate), row);
        const approved = isApprovedOnDay({
            hasLinkedPolicy: row.insurancePolicyId != null,
            exclusionReason: row.policyExclusionReason,
        });
        if (!approved) {
            continue;
        }
        const limitCost = computeLimitDayCostSlice({
            approvedLimit: row.approvedLimit,
            costPercent: row.costPercent,
            costCalculationMethod: row.costCalculationMethod,
            excludedFromPolicy: row.excludedFromPolicy,
            outdatedDcl: row.outdatedDcl,
        });
        if (limitCost !== 0) {
            periodCost += limitCost;
            addToMonthBucket(monthBuckets, row.snapshotDate, limitCost);
        }
    }
    for (const invoice of input.invoices) {
        if (EXCLUDED_INVOICE_STATUS_SET.has(String(invoice.status))) {
            continue;
        }
        if (input.policyId != null &&
            invoice.policyId !== input.policyId) {
            continue;
        }
        if (invoice.customerId == null) {
            continue;
        }
        const dayRow = dayByCustomerDate.get(dayKey(invoice.customerId, invoice.invoiceDate));
        if (dayRow == null) {
            continue;
        }
        const approved = isApprovedOnDay({
            hasLinkedPolicy: dayRow.insurancePolicyId != null,
            exclusionReason: dayRow.policyExclusionReason,
        });
        if (!approved) {
            continue;
        }
        if (dayRow.excludedFromPolicy || dayRow.outdatedDcl) {
            continue;
        }
        const salesCost = computeActualSalesInvoiceCostSlice({
            amount: invoice.amount,
            costPercent: dayRow.costPercent,
            costCalculationMethod: dayRow.costCalculationMethod,
        });
        if (salesCost !== 0) {
            periodCost += salesCost;
            addToMonthBucket(monthBuckets, invoice.invoiceDate, salesCost);
        }
    }
    for (const slice of input.topUpSlices) {
        if (!Number.isFinite(slice.amount) || slice.amount === 0) {
            continue;
        }
        periodCost += slice.amount;
        addToMonthBucket(monthBuckets, slice.snapshotDate, slice.amount);
    }
    const monthly = Array.from(monthBuckets.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([month, totalCost]) => ({ month, totalCost }));
    return { periodCost, monthly };
}
//# sourceMappingURL=portfolioRangeCost.js.map