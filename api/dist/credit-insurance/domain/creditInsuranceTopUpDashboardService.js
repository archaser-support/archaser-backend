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
exports.computeTopUpDashboardMetrics = computeTopUpDashboardMetrics;
exports.getTopUpExpiringSoonAlerts = getTopUpExpiringSoonAlerts;
exports.enrichCustomerTopUpFields = enrichCustomerTopUpFields;
exports.getTopUpCoverReport = getTopUpCoverReport;
exports.getTopUpExpiringReport = getTopUpExpiringReport;
const client_1 = require("@prisma/client");
const date_fns_1 = require("date-fns");
const domain_db_1 = require("../domain-db");
const customerCreditInsuranceHeaderAmounts_1 = require("./customerCreditInsuranceHeaderAmounts");
const resolveEffectiveApprovedLimit_1 = require("./resolveEffectiveApprovedLimit");
const COLLECTION_LIVE = ["Active", "Inactive"];
const URGENT_EXPIRY_DAYS = 7;
function decimalToNumber(v) {
    if (v == null) {
        return 0;
    }
    return new client_1.Prisma.Decimal(v).toNumber();
}
function customerNameFromRow(row) {
    return row.Person?.full_name || row.Company?.name || null;
}
async function convertLimitAmountToAccount(amount, limitCurrency, accountCurrency) {
    if (!Number.isFinite(amount) || amount <= 0) {
        return 0;
    }
    const from = limitCurrency?.trim().toUpperCase() || accountCurrency;
    if (from === accountCurrency) {
        return amount;
    }
    const converted = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(from, accountCurrency, amount);
    return converted ?? amount;
}
function topUpMatchesPrimaryScope(parentPrimaryPolicyId, filterPrimaryPolicyId) {
    if (filterPrimaryPolicyId == null) {
        return true;
    }
    return (parentPrimaryPolicyId == null ||
        parentPrimaryPolicyId === filterPrimaryPolicyId);
}
async function computeTopUpDashboardMetrics(args) {
    const today = (0, date_fns_1.startOfDay)(new Date());
    const windowEnd = (0, date_fns_1.addDays)(today, Math.max(0, args.expiringWindowDays));
    const urgentEnd = (0, date_fns_1.addDays)(today, URGENT_EXPIRY_DAYS);
    const emptyPolicyUsage = {
        topUpCoverTotal: 0,
        topUpCoverUsed: 0,
        topUpCoverRemaining: 0,
        topUpCoverOverEffective: 0,
    };
    const emptyTopUp = {
        activeCoverTotal: 0,
        customersWithActiveCount: 0,
        expiringWithinDays: {
            customerCount: 0,
            totalAmount: 0,
            windowDays: args.expiringWindowDays,
            urgentCustomerCount: 0,
        },
        incrementalCoverTotal: 0,
        coverDeclinedDueToLimit: { customerCount: 0, coverLostTotal: 0 },
    };
    let activeCoverTotal = 0;
    const customersWithActive = new Set();
    const expiringCustomers = new Set();
    const urgentExpiringCustomers = new Set();
    let expiringTotalAmount = 0;
    let topUpCoverTotal = 0;
    let topUpCoverUsed = 0;
    let topUpCoverRemaining = 0;
    let topUpCoverOverEffective = 0;
    const expiringSoonAlerts = [];
    for (const c of args.customers) {
        if (c.policy_id == null || c.approved_limit == null) {
            continue;
        }
        if (c.outdated_dcl === true || c.excluded_from_policy === true) {
            continue;
        }
        const resolved = await (0, resolveEffectiveApprovedLimit_1.resolveEffectiveApprovedLimit)(c.id, {
            baseApprovedLimit: c.approved_limit,
            baseApprovedLimitCurrency: c.approved_limit_currency?.trim().toUpperCase() ?? null,
            outdatedDcl: c.outdated_dcl ?? false,
            excludedFromPolicy: c.excluded_from_policy ?? false,
            asOfDate: today,
        });
        const limitCurrency = resolved.limitCurrency ??
            c.approved_limit_currency?.trim().toUpperCase() ??
            args.accountCurrency;
        let topUpInLimitCurrency = 0;
        for (const policyBucket of resolved.topUpByPolicy) {
            if (!topUpMatchesPrimaryScope(policyBucket.parentPrimaryPolicyId, args.primaryPolicyId)) {
                continue;
            }
            topUpInLimitCurrency += policyBucket.policySubtotal;
        }
        if (topUpInLimitCurrency <= 0) {
            continue;
        }
        const topUpInAccount = await convertLimitAmountToAccount(topUpInLimitCurrency, limitCurrency, args.accountCurrency);
        const baseInAccount = await convertLimitAmountToAccount(decimalToNumber(c.approved_limit), limitCurrency, args.accountCurrency);
        activeCoverTotal += topUpInAccount;
        customersWithActive.add(c.id);
        const ar = args.openArByCustomerId.get(c.id) ?? 0;
        topUpCoverTotal += topUpInAccount;
        const used = Math.min(topUpInAccount, Math.max(0, ar - baseInAccount));
        topUpCoverUsed += used;
        topUpCoverRemaining += Math.max(0, topUpInAccount - used);
        const effective = baseInAccount + topUpInAccount;
        if (ar > effective) {
            topUpCoverOverEffective += ar - effective;
        }
        for (const policyBucket of resolved.topUpByPolicy) {
            if (!topUpMatchesPrimaryScope(policyBucket.parentPrimaryPolicyId, args.primaryPolicyId)) {
                continue;
            }
            for (const row of policyBucket.rows) {
                const end = (0, date_fns_1.startOfDay)(row.endDate);
                if (end < today || end > windowEnd) {
                    continue;
                }
                const rowAmountInAccount = await convertLimitAmountToAccount(row.resolvedMonetaryAmount, row.currency ?? limitCurrency, args.accountCurrency);
                if (rowAmountInAccount <= 0) {
                    continue;
                }
                expiringCustomers.add(c.id);
                expiringTotalAmount += rowAmountInAccount;
                if (end <= urgentEnd) {
                    urgentExpiringCustomers.add(c.id);
                }
            }
        }
    }
    const coverDeclined = await computeCoverDeclinedDueToLimit(args.accountId, args.accountCurrency, args.primaryPolicyId);
    topUpCoverTotal = topUpCoverUsed + topUpCoverRemaining;
    return {
        topUp: {
            activeCoverTotal,
            customersWithActiveCount: customersWithActive.size,
            expiringWithinDays: {
                customerCount: expiringCustomers.size,
                totalAmount: expiringTotalAmount,
                windowDays: args.expiringWindowDays,
                urgentCustomerCount: urgentExpiringCustomers.size,
            },
            incrementalCoverTotal: activeCoverTotal,
            coverDeclinedDueToLimit: coverDeclined,
        },
        policyUsageTopUp: {
            topUpCoverTotal,
            topUpCoverUsed,
            topUpCoverRemaining,
            topUpCoverOverEffective,
        },
        expiringSoonAlerts,
    };
}
async function computeCoverDeclinedDueToLimit(accountId, accountCurrency, primaryPolicyId) {
    const today = (0, date_fns_1.startOfDay)(new Date());
    const yesterday = (0, date_fns_1.addDays)(today, -1);
    const [todayRows, yesterdayRows] = await Promise.all([
        domain_db_1.prisma.$queryRaw `
            SELECT DISTINCT ON (customer_id)
                customer_id,
                approved_limit,
                top_up_total
            FROM "CustomerPolicyTrend"
            WHERE account_id = ${accountId}
              AND snapshot_date = ${today}::date
              AND insurance_policy_id IS NOT NULL
              ${primaryPolicyId != null ? client_1.Prisma.sql `AND insurance_policy_id = ${primaryPolicyId}` : client_1.Prisma.empty}
            ORDER BY customer_id, id DESC
        `,
        domain_db_1.prisma.$queryRaw `
            SELECT DISTINCT ON (customer_id)
                customer_id,
                approved_limit,
                top_up_total
            FROM "CustomerPolicyTrend"
            WHERE account_id = ${accountId}
              AND snapshot_date = ${yesterday}::date
              AND insurance_policy_id IS NOT NULL
              ${primaryPolicyId != null ? client_1.Prisma.sql `AND insurance_policy_id = ${primaryPolicyId}` : client_1.Prisma.empty}
            ORDER BY customer_id, id DESC
        `,
    ]);
    const yesterdayByCustomer = new Map(yesterdayRows.map((r) => [r.customer_id, r]));
    let customerCount = 0;
    let coverLostTotal = 0;
    for (const todayRow of todayRows) {
        const prev = yesterdayByCustomer.get(todayRow.customer_id);
        if (!prev) {
            continue;
        }
        const prevLimit = decimalToNumber(prev.approved_limit);
        const todayLimit = decimalToNumber(todayRow.approved_limit);
        const prevTopUp = Number(prev.top_up_total ?? 0);
        const todayTopUp = Number(todayRow.top_up_total ?? 0);
        if (todayLimit < prevLimit &&
            todayTopUp < prevTopUp &&
            prevTopUp > 0) {
            customerCount += 1;
            coverLostTotal += Math.max(0, prevTopUp - todayTopUp);
        }
    }
    if (coverLostTotal > 0 && accountCurrency) {
        coverLostTotal = await convertLimitAmountToAccount(coverLostTotal, accountCurrency, accountCurrency);
    }
    return { customerCount, coverLostTotal };
}
async function getTopUpExpiringSoonAlerts(accountId, withinDays, primaryPolicyId, businessUnitFilter) {
    const today = (0, date_fns_1.startOfDay)(new Date());
    const windowEnd = (0, date_fns_1.addDays)(today, Math.max(0, withinDays));
    const rows = await domain_db_1.prisma.customerTopUp.findMany({
        where: {
            cancelled_at: null,
            start_date: { lte: windowEnd },
            end_date: { gte: today, lte: windowEnd },
            Customer: businessUnitFilter &&
                Object.keys(businessUnitFilter).length > 0
                ? {
                    AND: [
                        {
                            account_id: accountId,
                            collection_status: {
                                in: [...COLLECTION_LIVE],
                            },
                        },
                        businessUnitFilter,
                    ],
                }
                : {
                    account_id: accountId,
                    collection_status: { in: [...COLLECTION_LIVE] },
                },
            InsurancePolicy: {
                policy_kind: "TopUp",
                account_id: accountId,
                ...(primaryPolicyId != null
                    ? {
                        OR: [
                            { parent_insurance_policy_id: primaryPolicyId },
                            { parent_insurance_policy_id: null },
                        ],
                    }
                    : {}),
            },
        },
        select: {
            customer_id: true,
            end_date: true,
            insurance_policy_id: true,
            Customer: {
                select: {
                    Person: { select: { full_name: true } },
                    Company: { select: { name: true } },
                },
            },
            InsurancePolicy: {
                select: { policy_number: true, insurer_name: true },
            },
        },
        orderBy: { end_date: "asc" },
    });
    return rows.map((r) => ({
        customerId: r.customer_id,
        customerName: r.Customer ? customerNameFromRow(r.Customer) : null,
        policyId: r.insurance_policy_id,
        policyNumber: r.InsurancePolicy?.policy_number ?? null,
        endDate: (0, date_fns_1.startOfDay)(r.end_date).toISOString().slice(0, 10),
    }));
}
async function enrichCustomerTopUpFields(customerId, accountId, policyFields) {
    const accountHasTopUp = await domain_db_1.prisma.insurancePolicy.count({
        where: { account_id: accountId, policy_kind: "TopUp" },
        take: 1,
    });
    const hasTopUpPolicies = accountHasTopUp > 0;
    if (!hasTopUpPolicies) {
        return {
            has_top_up_policies: false,
            active_top_up_count: 0,
            top_up_total: null,
            effective_approved_limit: null,
            base_approved_limit: policyFields.approved_limit
                ? decimalToNumber(policyFields.approved_limit)
                : null,
            has_active_top_up: false,
            top_up_expires_soonest: null,
            has_scheduled_top_up: false,
        };
    }
    const today = (0, date_fns_1.startOfDay)(new Date());
    const baseLimit = policyFields.approved_limit
        ? decimalToNumber(policyFields.approved_limit)
        : null;
    const resolved = await (0, resolveEffectiveApprovedLimit_1.resolveEffectiveApprovedLimit)(customerId, {
        baseApprovedLimit: policyFields.approved_limit ?? null,
        baseApprovedLimitCurrency: policyFields.approved_limit_currency?.trim().toUpperCase() ?? null,
        outdatedDcl: policyFields.outdated_dcl ?? false,
        excludedFromPolicy: policyFields.excluded_from_policy ?? false,
        asOfDate: today,
    });
    const activeCount = resolved.topUpByPolicy.reduce((sum, p) => sum + p.rows.length, 0);
    const allTopUps = await domain_db_1.prisma.customerTopUp.findMany({
        where: {
            customer_id: customerId,
            cancelled_at: null,
            InsurancePolicy: { policy_kind: "TopUp", account_id: accountId },
        },
        select: { start_date: true, end_date: true },
    });
    let soonestEnd = null;
    let hasScheduled = false;
    for (const row of allTopUps) {
        if ((0, resolveEffectiveApprovedLimit_1.isActiveTopUp)({
            start_date: row.start_date,
            end_date: row.end_date,
            cancelled_at: null,
        }, today)) {
            const end = (0, date_fns_1.startOfDay)(row.end_date);
            if (!soonestEnd || end < soonestEnd) {
                soonestEnd = end;
            }
        }
        else if ((0, date_fns_1.startOfDay)(row.start_date) > today) {
            hasScheduled = true;
        }
    }
    return {
        has_top_up_policies: true,
        active_top_up_count: activeCount,
        top_up_total: resolved.topUpTotalInLimitCurrency > 0
            ? resolved.topUpTotalInLimitCurrency
            : null,
        effective_approved_limit: resolved.effectiveApprovedLimit,
        base_approved_limit: baseLimit,
        has_active_top_up: activeCount > 0,
        top_up_expires_soonest: soonestEnd
            ? soonestEnd.toISOString().slice(0, 10)
            : null,
        has_scheduled_top_up: hasScheduled,
    };
}
function sortTopUpCoverRows(rows, field, direction) {
    const sign = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (typeof av === "number" && typeof bv === "number") {
            return (av - bv) * sign;
        }
        const as = String(av ?? "");
        const bs = String(bv ?? "");
        return as.localeCompare(bs) * sign;
    });
}
function sortTopUpExpiringRows(rows, field, direction) {
    const sign = direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (typeof av === "number" && typeof bv === "number") {
            return (av - bv) * sign;
        }
        const as = String(av ?? "");
        const bs = String(bv ?? "");
        return as.localeCompare(bs) * sign;
    });
}
async function getTopUpCoverReport(accountId, take, skip, options = {}) {
    const { getAccountDisplayCurrency, fetchOpenReceivableByCustomerMap } = await Promise.resolve().then(() => __importStar(require("./creditInsuranceDashboardService")));
    const { enrichCustomersWithPolicyScope } = await Promise.resolve().then(() => __importStar(require("./enrichCustomersWithActivePolicy")));
    const accountCurrency = await getAccountDisplayCurrency(accountId);
    const today = (0, date_fns_1.startOfDay)(new Date());
    const allRaw = await domain_db_1.prisma.customer.findMany({
        where: {
            account_id: accountId,
            collection_status: { in: [...COLLECTION_LIVE] },
            ...(options.customerId != null ? { id: options.customerId } : {}),
            ...(options.businessUnitFilter &&
                Object.keys(options.businessUnitFilter).length > 0
                ? options.businessUnitFilter
                : {}),
        },
        select: {
            id: true,
            customer_number: true,
            Person: { select: { full_name: true } },
            Company: { select: { name: true } },
        },
    });
    const [all, openArByCustomer] = await Promise.all([
        enrichCustomersWithPolicyScope(allRaw, options.policyId),
        fetchOpenReceivableByCustomerMap(accountId, options.policyId),
    ]);
    const built = [];
    for (const c of all) {
        if (c.policy_id == null || c.approved_limit == null) {
            continue;
        }
        if (c.outdated_dcl === true || c.excluded_from_policy === true) {
            continue;
        }
        const resolved = await (0, resolveEffectiveApprovedLimit_1.resolveEffectiveApprovedLimit)(c.id, {
            baseApprovedLimit: c.approved_limit,
            baseApprovedLimitCurrency: c.approved_limit_currency?.trim().toUpperCase() ?? null,
            outdatedDcl: c.outdated_dcl ?? false,
            excludedFromPolicy: c.excluded_from_policy ?? false,
            asOfDate: today,
        });
        if (resolved.topUpTotalInLimitCurrency <= 0) {
            continue;
        }
        const limitCurrency = resolved.limitCurrency ??
            c.approved_limit_currency?.trim().toUpperCase() ??
            accountCurrency;
        const topUpInAccount = await convertLimitAmountToAccount(resolved.topUpTotalInLimitCurrency, limitCurrency, accountCurrency);
        const baseInAccount = await convertLimitAmountToAccount(decimalToNumber(c.approved_limit), limitCurrency, accountCurrency);
        const effectiveInAccount = resolved.effectiveApprovedLimit != null
            ? await convertLimitAmountToAccount(resolved.effectiveApprovedLimit, limitCurrency, accountCurrency)
            : null;
        built.push({
            customerId: c.id,
            customerName: c.Person?.full_name || c.Company?.name || `#${c.id}`,
            policyNumber: c.InsurancePolicy?.policy_number ?? null,
            baseApprovedLimit: baseInAccount,
            topUpTotal: topUpInAccount,
            effectiveLimit: effectiveInAccount,
            totalAR: openArByCustomer.get(c.id) ?? 0,
            currency: accountCurrency,
        });
    }
    const q = options.query?.trim();
    let filtered = built;
    if (q) {
        const tq = q.toLowerCase();
        filtered = built.filter((r) => r.customerName.toLowerCase().includes(tq) ||
            (r.policyNumber || "").toLowerCase().includes(tq));
    }
    const sorted = sortTopUpCoverRows(filtered, options.sortField || "topUpTotal", options.sortDirection || "desc");
    return { total: sorted.length, rows: sorted.slice(skip, skip + take) };
}
async function getTopUpExpiringReport(accountId, take, skip, options = {}) {
    const { getAccountDisplayCurrency } = await Promise.resolve().then(() => __importStar(require("./creditInsuranceDashboardService")));
    const accountCurrency = await getAccountDisplayCurrency(accountId);
    const today = (0, date_fns_1.startOfDay)(new Date());
    const windowDays = Math.max(1, options.withinDays ?? 30);
    const windowEnd = (0, date_fns_1.addDays)(today, windowDays);
    const rows = await domain_db_1.prisma.customerTopUp.findMany({
        where: {
            cancelled_at: null,
            start_date: { lte: windowEnd },
            end_date: { gte: today, lte: windowEnd },
            ...(options.customerId != null
                ? { customer_id: options.customerId }
                : {}),
            Customer: {
                account_id: accountId,
                collection_status: { in: [...COLLECTION_LIVE] },
                ...(options.businessUnitFilter &&
                    Object.keys(options.businessUnitFilter).length > 0
                    ? options.businessUnitFilter
                    : {}),
            },
            InsurancePolicy: {
                policy_kind: "TopUp",
                account_id: accountId,
                ...(options.policyId != null
                    ? {
                        OR: [
                            { parent_insurance_policy_id: options.policyId },
                            { parent_insurance_policy_id: null },
                        ],
                    }
                    : {}),
            },
        },
        select: {
            customer_id: true,
            start_date: true,
            top_up_type: true,
            top_up_value: true,
            currency: true,
            end_date: true,
            InsurancePolicy: {
                select: { policy_number: true },
            },
        },
        orderBy: { end_date: "asc" },
    });
    const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)));
    const { enrichCustomersWithPolicyScope } = await Promise.resolve().then(() => __importStar(require("./enrichCustomersWithActivePolicy")));
    const customersRaw = await domain_db_1.prisma.customer.findMany({
        where: { id: { in: customerIds } },
        select: {
            id: true,
            Person: { select: { full_name: true } },
            Company: { select: { name: true } },
        },
    });
    const enrichedCustomers = await enrichCustomersWithPolicyScope(customersRaw, options.policyId);
    const customerById = new Map(enrichedCustomers.map((customer) => [customer.id, customer]));
    const built = [];
    for (const row of rows) {
        if (!(0, resolveEffectiveApprovedLimit_1.isActiveTopUp)({
            start_date: row.start_date,
            end_date: row.end_date,
            cancelled_at: null,
        }, today)) {
            continue;
        }
        const end = (0, date_fns_1.startOfDay)(row.end_date);
        if (end > windowEnd) {
            continue;
        }
        const customer = customerById.get(row.customer_id);
        let resolvedAmount = 0;
        if (row.top_up_type === "Fixed") {
            resolvedAmount = decimalToNumber(row.top_up_value);
        }
        else if (customer?.approved_limit != null &&
            customer.outdated_dcl !== true &&
            customer.excluded_from_policy !== true) {
            const pct = decimalToNumber(row.top_up_value);
            resolvedAmount =
                (decimalToNumber(customer.approved_limit) * pct) / 100;
        }
        const limitCurrency = customer?.approved_limit_currency?.trim().toUpperCase() ??
            row.currency?.trim().toUpperCase() ??
            accountCurrency;
        const resolvedInAccount = await convertLimitAmountToAccount(resolvedAmount, limitCurrency, accountCurrency);
        const daysLeft = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86_400_000));
        built.push({
            customerId: row.customer_id,
            customerName: customer?.Person?.full_name ||
                customer?.Company?.name ||
                `#${row.customer_id}`,
            policyNumber: row.InsurancePolicy?.policy_number ?? null,
            topUpType: row.top_up_type,
            topUpValue: decimalToNumber(row.top_up_value),
            resolvedAmount: resolvedInAccount,
            endDate: end.toISOString().slice(0, 10),
            daysLeft,
            currency: accountCurrency,
        });
    }
    const q = options.query?.trim();
    let filtered = built;
    if (q) {
        const tq = q.toLowerCase();
        filtered = built.filter((r) => r.customerName.toLowerCase().includes(tq) ||
            (r.policyNumber || "").toLowerCase().includes(tq));
    }
    const sorted = sortTopUpExpiringRows(filtered, options.sortField || "daysLeft", options.sortDirection || "asc");
    return { total: sorted.length, rows: sorted.slice(skip, skip + take) };
}
//# sourceMappingURL=creditInsuranceTopUpDashboardService.js.map