"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sumStoredInvoiceCapacityGapRows = sumStoredInvoiceCapacityGapRows;
exports.computeStoredInvoiceCapacityGapFields = computeStoredInvoiceCapacityGapFields;
exports.invoiceImplicitBasePerCustomerUnit = invoiceImplicitBasePerCustomerUnit;
exports.aggregateImplicitBasePerLimitUnit = aggregateImplicitBasePerLimitUnit;
exports.sumGapInSecondaryCurrencyFromInvoices = sumGapInSecondaryCurrencyFromInvoices;
exports.fetchCustomerImplicitBasePerLimitUnit = fetchCustomerImplicitBasePerLimitUnit;
exports.fetchCustomerCapacityGapSecondaryFromContributingInvoices = fetchCustomerCapacityGapSecondaryFromContributingInvoices;
exports.resolveApprovedLimitInAccountCurrency = resolveApprovedLimitInAccountCurrency;
exports.computeInvoiceCapacityGapDualCurrency = computeInvoiceCapacityGapDualCurrency;
exports.sumInvoiceCapacityGapForCustomerPolicy = sumInvoiceCapacityGapForCustomerPolicy;
exports.sumCustomerPolicyCapacityGapForAccount = sumCustomerPolicyCapacityGapForAccount;
exports.computeTopUpUsageMetrics = computeTopUpUsageMetrics;
const client_1 = require("@prisma/client");
const domain_db_1 = require("../domain-db");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
/**
 * Sum persisted per-invoice gap fields — same rollup as
 * {@link sumInvoiceCapacityGapForCustomerPolicy} without a DB round-trip.
 */
function sumStoredInvoiceCapacityGapRows(invoices) {
    let gapBase = 0;
    let gapLimit = 0;
    let hasMissingSnapshots = false;
    for (const inv of invoices) {
        if (inv.limit_assessed_amount != null &&
            inv.capacity_gap_amount == null) {
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
function computeStoredInvoiceCapacityGapFields(args) {
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
function invoiceImplicitBasePerCustomerUnit(row) {
    const base = row.outstanding_debt;
    const customer = row.customer_outstanding_debt;
    if (base == null ||
        customer == null ||
        base === 0 ||
        customer === 0) {
        return null;
    }
    if ((base > 0 && customer < 0) || (base < 0 && customer > 0)) {
        return null;
    }
    return base / customer;
}
/**
 * Portfolio implicit FX: account base per one unit of limit/invoice currency,
 * aggregated from open invoice outstanding fields (same basis as capacity gap).
 */
function aggregateImplicitBasePerLimitUnit(rows) {
    let totalBase = 0;
    let totalCustomer = 0;
    for (const row of rows) {
        const base = row.outstanding_debt != null ? Number(row.outstanding_debt) : 0;
        const customer = row.customer_outstanding_debt != null
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
function sumGapInSecondaryCurrencyFromInvoices(rows, secondaryCurrency) {
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
        if (gapBase <= 0 ||
            !Number.isFinite(base) ||
            !Number.isFinite(customer) ||
            base === 0 ||
            customer === 0 ||
            (base > 0 && customer < 0) ||
            (base < 0 && customer > 0)) {
            continue;
        }
        total += gapBase * (customer / base);
    }
    return total > 0 ? total : null;
}
/** Implicit FX from a customer's open invoices in limit currency (falls back to null). */
async function fetchCustomerImplicitBasePerLimitUnit(accountId, customerId, limitCurrency, accountCurrency, options) {
    const db = options?.dbClient ?? domain_db_1.prisma;
    const limitCcy = limitCurrency.trim().toUpperCase();
    const acct = accountCurrency.trim().toUpperCase();
    if (!limitCcy || limitCcy === acct) {
        return 1;
    }
    const invoices = await db.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] },
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
async function fetchCustomerCapacityGapSecondaryFromContributingInvoices(accountId, customerId, secondaryCurrency, options) {
    const db = options?.dbClient ?? domain_db_1.prisma;
    const rows = (await db.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] },
            capacity_gap_amount: { gt: 0 },
            ...(options?.policyId != null ? { policy_id: options.policyId } : {}),
        },
        select: {
            capacity_gap_amount: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            customer_currency: true,
        },
    }));
    return sumGapInSecondaryCurrencyFromInvoices(rows, secondaryCurrency);
}
/** Approved limit in account currency for gap capping (implicit invoice FX first). */
async function resolveApprovedLimitInAccountCurrency(accountId, customerId, policyId, approvedLimit, limitCurrency, accountCurrency, dbClient = domain_db_1.prisma) {
    const accountCur = accountCurrency?.trim().toUpperCase() || "USD";
    const limitCcy = limitCurrency?.trim().toUpperCase() || accountCur;
    if (limitCcy === accountCur) {
        return approvedLimit;
    }
    const implicit = await fetchCustomerImplicitBasePerLimitUnit(accountId, customerId, limitCcy, accountCur, { policyId, dbClient });
    if (implicit != null && Number.isFinite(implicit)) {
        return approvedLimit * implicit;
    }
    const { convertAmountToCurrencyLatestRate } = await Promise.resolve().then(() => __importStar(require("./customerCreditInsuranceHeaderAmounts")));
    const converted = await convertAmountToCurrencyLatestRate(limitCcy, accountCur, approvedLimit);
    return converted ?? approvedLimit;
}
function convertWithRate(amount, fromCurrency, toCurrency, rate) {
    if (fromCurrency === toCurrency) {
        return amount;
    }
    if (rate.base_currency === toCurrency &&
        rate.other_currency === fromCurrency) {
        return amount / rate.currency_ratio;
    }
    if (rate.base_currency === fromCurrency &&
        rate.other_currency === toCurrency) {
        return amount * rate.currency_ratio;
    }
    return null;
}
function computeInvoiceCapacityGapDualCurrency(args) {
    const outstandingLimit = Math.max(0, (0, invoiceInsuranceFields_1.invoiceOutstandingInLimitCurrency)({
        outstanding_debt: args.row.outstanding_debt,
        customer_outstanding_debt: args.row.customer_outstanding_debt,
        amount: null,
        limit_assessed_currency: args.row.limit_assessed_currency,
        accountCurrency: args.accountCurrency,
    }));
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
    if (limitCurrency &&
        accountCurrency &&
        limitCurrency === accountCurrency) {
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
        const converted = convertWithRate(gapLimit, limitCurrency, accountCurrency, args.currencyRate);
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
function decimalToNumber(value) {
    if (value == null) {
        return 0;
    }
    if (value instanceof client_1.Prisma.Decimal) {
        return value.toNumber();
    }
    return Number(value);
}
/** Sum stored invoice gap fields for one customer + primary policy (writer / reconciliation). */
async function sumInvoiceCapacityGapForCustomerPolicy(accountId, customerId, policyId, dbClient = domain_db_1.prisma) {
    const invoices = (await dbClient.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            policy_id: policyId,
            status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] },
        },
        select: {
            capacity_gap_amount: true,
            capacity_gap_amount_limit: true,
            limit_assessed_amount: true,
            limit_assessed_currency: true,
        },
    }));
    if (invoices.length === 0) {
        return {
            gapBase: 0,
            gapLimit: 0,
            limitCurrency: null,
            hasMissingSnapshots: false,
            missingRate: false,
        };
    }
    let limitCurrency = null;
    for (const inv of invoices) {
        if (inv.limit_assessed_currency) {
            limitCurrency = inv.limit_assessed_currency.trim().toUpperCase();
        }
    }
    const summed = sumStoredInvoiceCapacityGapRows(invoices);
    const missingRate = invoices.some((inv) => inv.limit_assessed_amount != null &&
        inv.capacity_gap_amount == null);
    return {
        gapBase: summed.gapBase,
        gapLimit: summed.gapLimit,
        limitCurrency,
        hasMissingSnapshots: summed.hasMissingSnapshots,
        missingRate,
    };
}
/** Portfolio read: SUM synced CustomerPolicy gap fields (D9). */
async function sumCustomerPolicyCapacityGapForAccount(accountId, options) {
    const dbClient = options?.dbClient ?? domain_db_1.prisma;
    const customerScope = {
        account_id: accountId,
        collection_status: { in: ["Active", "Inactive"] },
    };
    const businessUnitFilter = options?.businessUnitFilter;
    const scopedCustomerWhere = businessUnitFilter && Object.keys(businessUnitFilter).length > 0
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
    const overLimitCustomers = new Set();
    const gapByPolicyId = new Map();
    const gapByCustomerPolicy = new Map();
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
        gapByCustomerPolicy.set(key, (gapByCustomerPolicy.get(key) ?? 0) + gapBase);
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
function computeTopUpUsageMetrics(args) {
    const ar = Math.max(0, args.ar);
    const limit = Math.max(0, args.approvedLimit);
    const topUp = Math.max(0, args.topUpTotal);
    let policyUsage = limit > 0 ? ar / limit : 0;
    if (topUp > 0 && ar > limit) {
        policyUsage = 1;
    }
    const topUpUsage = topUp > 0 && ar > limit ? Math.max(0, (ar - limit) / topUp) : 0;
    const effectiveLimit = limit + topUp;
    const effectiveUsage = effectiveLimit > 0 ? ar / effectiveLimit : 0;
    return { policyUsage, topUpUsage, effectiveUsage };
}
