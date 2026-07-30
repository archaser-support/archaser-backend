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
exports.fetchOpenReceivableForCustomerByCurrency = exports.invoiceTermsBreachWhere = void 0;
exports.sumCustomerPolicyInvoiceCapacityGap = sumCustomerPolicyInvoiceCapacityGap;
exports.isTermsBreachReasonFilter = isTermsBreachReasonFilter;
exports.getCustomerTermsBreachOutstandingSum = getCustomerTermsBreachOutstandingSum;
exports.getCustomerTermsBreachOutstandingForAtRisk = getCustomerTermsBreachOutstandingForAtRisk;
exports.getCustomerBreachInvoiceCounts = getCustomerBreachInvoiceCounts;
exports.getCustomerTermsBreachOutstandingSumByCurrency = getCustomerTermsBreachOutstandingSumByCurrency;
exports.getCustomerTermsBreachOutstandingByCurrencyForAtRisk = getCustomerTermsBreachOutstandingByCurrencyForAtRisk;
exports.fetchOpenReceivableByCustomerMap = fetchOpenReceivableByCustomerMap;
exports.fetchOpenReceivableForCustomer = fetchOpenReceivableForCustomer;
exports.resolveOpenArOnPolicyInLimitCurrency = resolveOpenArOnPolicyInLimitCurrency;
exports.getAccountDisplayCurrency = getAccountDisplayCurrency;
exports.convertApprovedLimitToAccountCurrency = convertApprovedLimitToAccountCurrency;
exports.getCreditDashboardSummary = getCreditDashboardSummary;
exports.getOverdueBlockReport = getOverdueBlockReport;
exports.getCustomerCapacityGapForReport = getCustomerCapacityGapForReport;
exports.getCapacityGapReport = getCapacityGapReport;
exports.getPolicyRiskExposureReport = getPolicyRiskExposureReport;
exports.getNoPolicyExposureReport = getNoPolicyExposureReport;
exports.getTermsBreachReport = getTermsBreachReport;
exports.getReportingCountdownOpenReport = getReportingCountdownOpenReport;
exports.getReportedInvoicesReport = getReportedInvoicesReport;
exports.getLimitWarningReport = getLimitWarningReport;
exports.getZeroLimitWarningReport = getZeroLimitWarningReport;
const client_1 = require("@prisma/client");
const date_fns_1 = require("date-fns");
const domain_db_1 = require("../domain-db");
const stringFormatters_stub_1 = require("./stringFormatters-stub");
const customerCreditInsuranceHeaderAmounts_1 = require("./customerCreditInsuranceHeaderAmounts");
const openReceivableByCustomerCurrency_1 = require("./openReceivableByCustomerCurrency");
const customerPolicyQueryHelpers_1 = require("./customerPolicyQueryHelpers");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
const creditInsuranceTopUpDashboardService_1 = require("./creditInsuranceTopUpDashboardService");
const portfolioPolicyLimitUsage_1 = require("./portfolioPolicyLimitUsage");
const hasTopUpPolicies_1 = require("./hasTopUpPolicies");
const invoiceCapacityGapAmounts_1 = require("./invoiceCapacityGapAmounts");
const resolveEffectiveApprovedLimit_1 = require("./resolveEffectiveApprovedLimit");
const policyGapAmounts_1 = require("./policyGapAmounts");
const termBreachResolver_1 = require("./termBreachResolver");
const policyExclusion_1 = require("./policyExclusion");
const COLLECTION_LIVE = [client_1.record_status.Active, client_1.record_status.Inactive];
const DEFAULT_REPORTING_WINDOW_DAYS = 14;
const DEFAULT_LIMIT_WARN_THRESHOLD_PCT = 80;
const DEFAULT_SCORE_VALIDITY_WARN_DAYS = 30;
const CLOSED_INVOICE_STATUS = [
    client_1.invoice_status.Paid,
    client_1.invoice_status.Void,
    client_1.invoice_status.Cancelled,
];
const TERMS_BREACH_OR = [
    { reporting_breach: true },
    { ctv_payment_term: true },
    { ctv_customer_overdue_mep: true },
    { ctv_outdated_dcl: true },
    { ctv_invoice_after_policy_end: true },
];
function customerNameFromRow(c) {
    return c.Person?.full_name || c.Company?.name || "—";
}
function lineOutstanding(row) {
    return (0, invoiceInsuranceFields_1.invoiceOutstandingLeft)(row);
}
async function sumCustomerPolicyInvoiceCapacityGap(accountId, customerId, policyId) {
    const invoices = (await domain_db_1.prisma.invoice.findMany({
        where: {
            account_id: accountId,
            customer_id: customerId,
            policy_id: policyId,
            status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] },
        },
        select: {
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
            limit_assessed_amount: true,
        },
    }));
    return (0, invoiceInsuranceFields_1.sumInvoiceCapacityGapContributions)(invoices);
}
function totalArFromCustomerRow(c) {
    return (0, invoiceInsuranceFields_1.computeCustomerTotalAr)(c).toNumber();
}
const baseAccountCustomers = (accountId) => ({
    account_id: accountId,
    collection_status: { in: COLLECTION_LIVE },
});
function customersScoped(accountId, policyId, businessUnitFilter) {
    return (0, customerPolicyQueryHelpers_1.customersScopedForCreditDashboardWithBusinessUnit)(accountId, policyId, businessUnitFilter);
}
function scopedInvoiceWhere(accountId, policyId) {
    const base = { account_id: accountId };
    if (policyId != null) {
        return { ...base, policy_id: policyId };
    }
    return base;
}
const TERMS_BREACH_REASON_FILTERS = [
    "reporting_breach",
    "ctv_payment_term",
    "ctv_customer_overdue_mep",
    "ctv_outdated_dcl",
    "ctv_invoice_after_policy_end",
];
function isTermsBreachReasonFilter(value) {
    return TERMS_BREACH_REASON_FILTERS.includes(value);
}
function buildCustomerTextSearchWhere(q) {
    const t = q?.trim();
    if (!t) {
        return null;
    }
    return { OR: (0, customerPolicyQueryHelpers_1.customerPolicyTextSearchOr)(t) };
}
function customerRowMatchesQuery(c, q) {
    const t = q.trim().toLowerCase();
    if (!t) {
        return true;
    }
    const name = (c.Person?.full_name || c.Company?.name || "").toLowerCase();
    const policyDisplay = (0, customerPolicyQueryHelpers_1.policyDisplayFromCustomerRow)(c);
    const pol = (policyDisplay.policy_number || "").toLowerCase();
    const cn = (c.customer_number || "").toLowerCase();
    const cnp = (policyDisplay.customer_number_policy || "").toLowerCase();
    return (name.includes(t) || pol.includes(t) || cn.includes(t) || cnp.includes(t));
}
function overdueOrderBy(sortField, sortDirection) {
    const d = sortDirection === "desc" ? "desc" : "asc";
    switch (sortField) {
        case "policyNumber":
            return { id: d };
        case "customerName":
            return { Person: { full_name: d } };
        case "outstandingAmount":
            return [{ total_overdue_amount: d }, { total_due_amount: d }];
        default:
            return { id: "asc" };
    }
}
function dashboardCapacityGapFromStored(c) {
    return (0, policyGapAmounts_1.storedCapacityGapAmount)(c);
}
function capacityGapForCustomerAtRisk(c, openAr, _useInvoiceSnapshots, _invoiceGapByCustomerPolicy) {
    return dashboardCapacityGapFromStored(c);
}
function creditScoreExpiryOnCalendar(inputDate, months) {
    if (!inputDate || months == null || months <= 0) {
        return null;
    }
    return (0, date_fns_1.startOfDay)((0, date_fns_1.addMonths)(inputDate, months));
}
async function buildEffectiveLimitByCustomerIdInAccountCurrency(accountCurrency, customers, openArByCustomerId) {
    const convertPolicyLimitToAccount = async (policyCurrency, amount) => {
        if (!Number.isFinite(amount) || amount <= 0) {
            return 0;
        }
        if (policyCurrency === accountCurrency) {
            return amount;
        }
        const converted = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(policyCurrency, accountCurrency, amount);
        return converted ?? amount;
    };
    const effectiveLimitByCustomerId = new Map();
    for (const c of customers) {
        if (c.InsurancePolicy == null ||
            c.approved_limit == null ||
            c.outdated_dcl === true ||
            c.excluded_from_policy === true) {
            continue;
        }
        const ar = openArByCustomerId.get(c.id) ?? 0;
        if (ar <= 0) {
            continue;
        }
        const limitCurrency = c.approved_limit_currency?.trim().toUpperCase() ?? accountCurrency;
        const resolved = await (0, resolveEffectiveApprovedLimit_1.resolveEffectiveApprovedLimit)(c.id, {
            baseApprovedLimit: c.approved_limit,
            baseApprovedLimitCurrency: limitCurrency,
            outdatedDcl: c.outdated_dcl ?? false,
            excludedFromPolicy: c.excluded_from_policy ?? false,
            parentPrimaryPolicyId: c.policy_id ?? undefined,
        });
        const effectiveNum = resolved.effectiveApprovedLimit != null
            ? Number(resolved.effectiveApprovedLimit)
            : null;
        if (effectiveNum != null && effectiveNum > 0) {
            const effectiveInAccount = await convertPolicyLimitToAccount(limitCurrency, effectiveNum);
            effectiveLimitByCustomerId.set(c.id, effectiveInAccount);
        }
    }
    return effectiveLimitByCustomerId;
}
function isNearLimitForWarning(c, thresholdPct, openArOverride, options) {
    const ar = openArOverride !== undefined
        ? openArOverride
        : totalArFromCustomerRow(c);
    const approvedNum = c.approved_limit != null
        ? new client_1.Prisma.Decimal(c.approved_limit).toNumber()
        : null;
    return (0, invoiceInsuranceFields_1.isNearLimitUtilizationWarning)({
        ar,
        approvedLimit: approvedNum,
        effectiveLimitInAccountCurrency: options?.effectiveLimitInAccountCurrency,
        useEffectiveLimit: options?.useEffectiveLimit,
        thresholdPct,
        outdatedDcl: c.outdated_dcl,
    });
}
function isCreditScoreExpiringInWindow(c, warnDays) {
    const months = c.InsurancePolicy?.score_validity_period_months;
    const expiry = creditScoreExpiryOnCalendar(c.credit_score_input_date, months);
    if (!expiry) {
        return false;
    }
    const today = (0, date_fns_1.startOfDay)(new Date());
    const end = (0, date_fns_1.addDays)(today, Math.max(0, warnDays));
    const t = expiry.getTime();
    return t >= today.getTime() && t <= end.getTime();
}
function isLimitExpiringInWindow(c, warnDays) {
    if (!c.approved_limit_expiration_date || warnDays <= 0) {
        return false;
    }
    const today = (0, date_fns_1.startOfDay)(new Date());
    const end = (0, date_fns_1.addDays)(today, warnDays);
    const expiry = (0, date_fns_1.startOfDay)(new Date(c.approved_limit_expiration_date));
    return expiry.getTime() >= today.getTime() && expiry.getTime() <= end.getTime();
}
const invoiceTermsBreachWhere = (accountId) => ({
    account_id: accountId,
    status: { in: ["Due", "Overdue"] },
    OR: TERMS_BREACH_OR,
});
exports.invoiceTermsBreachWhere = invoiceTermsBreachWhere;
async function getCustomerTermsBreachOutstandingSum(accountId, customerId, options) {
    const excludeGap = options?.excludeCapacityGapInvoices === true;
    const policyId = options?.policyId;
    const rows = excludeGap
        ? await domain_db_1.prisma.$queryRaw `
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                    ELSE COALESCE(i.customer_outstanding_debt, 0)
                END
            ),
            0
        )::float AS t
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND i.status IN ('Due', 'Overdue')
          AND COALESCE(i.in_capacity_gap, false) = false
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
          ${policyId != null ? client_1.Prisma.sql `AND i.policy_id = ${policyId}` : client_1.Prisma.empty}
    `
        : await domain_db_1.prisma.$queryRaw `
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                    ELSE COALESCE(i.customer_outstanding_debt, 0)
                END
            ),
            0
        )::float AS t
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND i.status IN ('Due', 'Overdue')
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
          ${policyId != null ? client_1.Prisma.sql `AND i.policy_id = ${policyId}` : client_1.Prisma.empty}
    `;
    return Number(rows[0]?.t ?? 0);
}
async function getCustomerTermsBreachOutstandingForAtRisk(accountId, customerId, options) {
    return getCustomerTermsBreachOutstandingSum(accountId, customerId, {
        ...options,
        excludeCapacityGapInvoices: true,
    });
}
async function getCustomerBreachInvoiceCounts(accountId, customerId, options) {
    const policyId = options?.policyId;
    const rows = await domain_db_1.prisma.$queryRaw `
        SELECT
            COUNT(*) FILTER (
                WHERE i.status = 'Overdue' AND i.reporting_breach = true
            )::int AS reporting_breach_count,
            COUNT(*) FILTER (
                WHERE i.status IN ('Due', 'Overdue')
                  AND i.ctv_customer_overdue_mep = true
            )::int AS overdue_block_invoice_count
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          ${policyId != null ? client_1.Prisma.sql `AND i.policy_id = ${policyId}` : client_1.Prisma.empty}
    `;
    const row = rows[0];
    return {
        reportingBreachInvoiceCount: Number(row?.reporting_breach_count ?? 0),
        overdueBlockInvoiceCount: Number(row?.overdue_block_invoice_count ?? 0),
    };
}
async function getCustomerTermsBreachOutstandingSumByCurrency(accountId, customerId, currency, options) {
    const code = currency.trim().toUpperCase();
    if (!code) {
        return 0;
    }
    const excludeGap = options?.excludeCapacityGapInvoices === true;
    const policyId = options?.policyId;
    const rows = excludeGap
        ? await domain_db_1.prisma.$queryRaw `
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN COALESCE(i.customer_outstanding_debt, 0) != 0 THEN i.customer_outstanding_debt
                    ELSE COALESCE(i.amount, 0)
                END
            ),
            0
        )::float AS t
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND UPPER(COALESCE(i.customer_currency, '')) = ${code}
          AND i.status IN ('Due', 'Overdue')
          AND COALESCE(i.in_capacity_gap, false) = false
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
          ${policyId != null ? client_1.Prisma.sql `AND i.policy_id = ${policyId}` : client_1.Prisma.empty}
    `
        : await domain_db_1.prisma.$queryRaw `
        SELECT COALESCE(
            SUM(
                CASE
                    WHEN COALESCE(i.customer_outstanding_debt, 0) != 0 THEN i.customer_outstanding_debt
                    ELSE COALESCE(i.amount, 0)
                END
            ),
            0
        )::float AS t
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND UPPER(COALESCE(i.customer_currency, '')) = ${code}
          AND i.status IN ('Due', 'Overdue')
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
          ${policyId != null ? client_1.Prisma.sql `AND i.policy_id = ${policyId}` : client_1.Prisma.empty}
    `;
    return Number(rows[0]?.t ?? 0);
}
async function getCustomerTermsBreachOutstandingByCurrencyForAtRisk(accountId, customerId, currency, options) {
    return getCustomerTermsBreachOutstandingSumByCurrency(accountId, customerId, currency, { ...options, excludeCapacityGapInvoices: true });
}
async function fetchOpenReceivableByCustomerMap(accountId, policyId) {
    const rows = policyId != null
        ? await domain_db_1.prisma.$queryRaw `
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
        WHERE i.account_id = ${accountId}
          AND c.account_id = ${accountId}
          AND c.collection_status IN ('Active', 'Inactive')
          AND i.policy_id = ${policyId}
          AND i.status IN ('Due', 'Overdue')
        GROUP BY i.customer_id
      `
        : await domain_db_1.prisma.$queryRaw `
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
        WHERE i.account_id = ${accountId}
          AND c.account_id = ${accountId}
          AND c.collection_status IN ('Active', 'Inactive')
          AND i.status IN ('Due', 'Overdue')
        GROUP BY i.customer_id
      `;
    const m = new Map();
    for (const r of rows) {
        m.set(r.customer_id, Number(r.ar ?? 0));
    }
    return m;
}
var openReceivableByCustomerCurrency_2 = require("./openReceivableByCustomerCurrency");
Object.defineProperty(exports, "fetchOpenReceivableForCustomerByCurrency", { enumerable: true, get: function () { return openReceivableByCustomerCurrency_2.fetchOpenReceivableForCustomerByCurrency; } });
async function fetchOpenReceivableForCustomer(accountId, customerId, policyId) {
    const m = await fetchOpenReceivableByCustomerMap(accountId, policyId ?? undefined);
    return m.get(customerId) ?? 0;
}
async function resolveOpenArOnPolicyInLimitCurrency(accountId, customerId, policyId, limitCurrency, accountCurrency) {
    const limitCcy = limitCurrency.trim().toUpperCase();
    const acct = accountCurrency?.trim().toUpperCase() ?? "";
    if (limitCcy && acct && limitCcy === acct) {
        return fetchOpenReceivableForCustomer(accountId, customerId, policyId);
    }
    return (0, openReceivableByCustomerCurrency_1.fetchOpenReceivableForCustomerByCurrency)(accountId, customerId, limitCcy, policyId);
}
async function fetchTermsBreachOutstandingByCustomerInAccountCurrency(accountId, accountCurrency, policyId, excludeCapacityGapInvoices, businessUnitFilter) {
    const accountCur = accountCurrency.trim().toUpperCase();
    const excludeGap = excludeCapacityGapInvoices === true;
    const invoices = await domain_db_1.prisma.invoice.findMany({
        where: (0, customerPolicyQueryHelpers_1.applyBusinessUnitFilterToInvoiceWhere)({
            account_id: accountId,
            status: { in: ["Due", "Overdue"] },
            ...(policyId != null ? { policy_id: policyId } : {}),
            ...(excludeGap ? { in_capacity_gap: false } : {}),
            Customer: {
                account_id: accountId,
                collection_status: { in: COLLECTION_LIVE },
            },
            OR: TERMS_BREACH_OR,
        }, businessUnitFilter),
        select: {
            customer_id: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
            customer_currency: true,
        },
    });
    const map = new Map();
    for (const inv of invoices) {
        if (inv.customer_id == null) {
            continue;
        }
        const custCurrency = inv.customer_currency?.trim().toUpperCase();
        const hasAccountOutstanding = inv.outstanding_debt != null && inv.outstanding_debt !== 0;
        let converted;
        if (!hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur) {
            const custOutstanding = inv.customer_outstanding_debt != null
                ? Number(inv.customer_outstanding_debt)
                : 0;
            const amount = inv.amount != null ? Number(inv.amount) : 0;
            const val = custOutstanding !== 0 ? custOutstanding : amount;
            converted = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(custCurrency, accountCur, val);
        }
        const line = (0, openReceivableByCustomerCurrency_1.computeInvoiceLineOpenArInAccountCurrency)(inv, accountCur, converted);
        map.set(inv.customer_id, (map.get(inv.customer_id) ?? 0) + line);
    }
    return map;
}
async function fetchTermsBreachOutstandingByCustomer(accountId, policyId, excludeCapacityGapInvoices) {
    const excludeGap = excludeCapacityGapInvoices === true;
    const rows = policyId != null
        ? excludeGap
            ? await domain_db_1.prisma.$queryRaw `
        SELECT i.customer_id,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ),
            0
          )::float AS t
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        WHERE i.account_id = ${accountId}
          AND c.account_id = ${accountId}
          AND c.collection_status IN ('Active', 'Inactive')
          AND i.policy_id = ${policyId}
          AND i.status IN ('Due', 'Overdue')
          AND COALESCE(i.in_capacity_gap, false) = false
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
        GROUP BY i.customer_id
      `
            : await domain_db_1.prisma.$queryRaw `
        SELECT i.customer_id,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ),
            0
          )::float AS t
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        WHERE i.account_id = ${accountId}
          AND c.account_id = ${accountId}
          AND c.collection_status IN ('Active', 'Inactive')
          AND i.policy_id = ${policyId}
          AND i.status IN ('Due', 'Overdue')
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
        GROUP BY i.customer_id
      `
        : excludeGap
            ? await domain_db_1.prisma.$queryRaw `
        SELECT i.customer_id,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ),
            0
          )::float AS t
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.status IN ('Due', 'Overdue')
          AND COALESCE(i.in_capacity_gap, false) = false
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
        GROUP BY i.customer_id
      `
            : await domain_db_1.prisma.$queryRaw `
        SELECT i.customer_id,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ),
            0
          )::float AS t
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.status IN ('Due', 'Overdue')
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
        GROUP BY i.customer_id
      `;
    const m = new Map();
    for (const r of rows) {
        m.set(r.customer_id, Number(r.t ?? 0));
    }
    return m;
}
async function getAccountDisplayCurrency(accountId) {
    const a = await domain_db_1.prisma.account.findUnique({
        where: { id: accountId },
        select: { currency: true },
    });
    return a?.currency && String(a.currency).trim()
        ? String(a.currency).trim()
        : "USD";
}
async function convertApprovedLimitToAccountCurrency(amount, limitCurrency, accountCurrency, options) {
    if (amount == null || !Number.isFinite(amount)) {
        return null;
    }
    const accountCur = accountCurrency.trim().toUpperCase();
    const limitCcy = limitCurrency?.trim().toUpperCase() || accountCur;
    if (limitCcy === accountCur) {
        return amount;
    }
    if (options?.accountId != null && options.customerId != null) {
        const implicitBasePerLimitUnit = await (0, invoiceCapacityGapAmounts_1.fetchCustomerImplicitBasePerLimitUnit)(options.accountId, options.customerId, limitCcy, accountCur, { policyId: options.policyId });
        if (implicitBasePerLimitUnit != null &&
            Number.isFinite(implicitBasePerLimitUnit)) {
            return amount * implicitBasePerLimitUnit;
        }
    }
    const converted = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(limitCcy, accountCur, amount);
    return converted ?? amount;
}
function displayCurrencyForCustomer(c, policyCurrency, accountCurrency) {
    return (0, stringFormatters_stub_1.resolveCustomerFirstCurrency)({
        customerCurrencyPrimary: c.customer_due_currency1,
        customerCurrencySecondary: c.customer_overdue_currency1,
        collectionCurrencyPrimary: c.customer_due_currency2,
        collectionCurrencySecondary: c.customer_overdue_currency2,
        accountCurrency,
        fallbackCurrency: policyCurrency && String(policyCurrency).trim()
            ? String(policyCurrency).trim()
            : null,
    });
}
function reportingCountdownOpenWhere(accountId, windowDays) {
    const today = (0, date_fns_1.startOfDay)(new Date());
    const lastInclusive = (0, date_fns_1.addDays)(today, Math.max(0, windowDays));
    return {
        account_id: accountId,
        status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] },
        target_reporting_date: { gte: today, lte: lastInclusive },
        actual_reporting_date: null,
        reporting_breach: false,
    };
}
async function aggregateTermsBreachForSummary(accountId, policyId, customerScope) {
    const invoices = await domain_db_1.prisma.invoice.findMany({
        where: (0, customerPolicyQueryHelpers_1.applyBusinessUnitFilterToInvoiceWhere)({
            account_id: accountId,
            status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] },
            OR: TERMS_BREACH_OR,
            ...(policyId != null ? { policy_id: policyId } : {}),
        }, customerScope),
        select: {
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
            reporting_breach: true,
            ctv_payment_term: true,
            ctv_customer_overdue_mep: true,
            ctv_outdated_dcl: true,
            ctv_invoice_after_policy_end: true,
        },
    });
    let total = 0;
    let cntReporting = 0;
    let cntPaymentTerm = 0;
    let cntOverdueMep = 0;
    let cntOutdatedDcl = 0;
    let cntAfterPolicyEnd = 0;
    for (const inv of invoices) {
        total += lineOutstanding(inv);
        if (inv.reporting_breach)
            cntReporting += 1;
        if (inv.ctv_payment_term)
            cntPaymentTerm += 1;
        if (inv.ctv_customer_overdue_mep)
            cntOverdueMep += 1;
        if (inv.ctv_outdated_dcl)
            cntOutdatedDcl += 1;
        if (inv.ctv_invoice_after_policy_end)
            cntAfterPolicyEnd += 1;
    }
    return [
        {
            c: invoices.length,
            t: total,
            cnt_reporting: cntReporting,
            cnt_payment_term: cntPaymentTerm,
            cnt_overdue_mep: cntOverdueMep,
            cnt_outdated_dcl: cntOutdatedDcl,
            cnt_after_policy_end: cntAfterPolicyEnd,
        },
    ];
}
async function getCreditDashboardSummary(accountId, policyId, businessUnitFilter, includeNoPolicyExposure = true) {
    const whereCust = customersScoped(accountId, policyId, businessUnitFilter);
    const useScopedTermsBreachAgg = (0, customerPolicyQueryHelpers_1.hasDashboardBusinessUnitScope)(businessUnitFilter);
    const accountRow = await domain_db_1.prisma.account.findUnique({
        where: { id: accountId },
        select: {
            currency: true,
            customer_limit_expiration_warning_days: true,
            reporting_date_warning_days: true,
            credit_limit_warning_threshold_pct: true,
            credit_score_validity_warning_days: true,
        },
    });
    const windowDays = Math.max(0, accountRow?.reporting_date_warning_days ??
        DEFAULT_REPORTING_WINDOW_DAYS);
    const limitWarnThresholdPct = Math.min(100, Math.max(1, accountRow?.credit_limit_warning_threshold_pct ??
        DEFAULT_LIMIT_WARN_THRESHOLD_PCT));
    const scoreValidityWarnDays = Math.max(0, accountRow?.credit_score_validity_warning_days ??
        DEFAULT_SCORE_VALIDITY_WARN_DAYS);
    const limitExpirationWarnDays = Math.max(0, accountRow?.customer_limit_expiration_warning_days ?? 0);
    const accountCurrency = accountRow?.currency && String(accountRow.currency).trim()
        ? String(accountRow.currency).trim().toUpperCase()
        : "USD";
    const [customersRaw, scopedPolicies, _overdueCount, invAgg, rcInvoices,] = await Promise.all([
        domain_db_1.prisma.customer.findMany({
            where: whereCust,
            select: {
                id: true,
                collection_status: true,
                total_due_amount: true,
                total_overdue_amount: true,
                overdue_block: true,
            },
        }),
        domain_db_1.prisma.insurancePolicy.findMany({
            where: policyId != null
                ? { account_id: accountId, id: policyId }
                : { account_id: accountId },
            select: {
                id: true,
                policy_number: true,
                end_date: true,
            },
        }),
        domain_db_1.prisma.customer.count({
            where: { ...whereCust, overdue_block: true },
        }),
        useScopedTermsBreachAgg
            ? aggregateTermsBreachForSummary(accountId, policyId, whereCust)
            : policyId != null
                ? domain_db_1.prisma.$queryRaw `SELECT COUNT(*)::int AS c,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ),
            0
          )::float AS t,
          COUNT(*) FILTER (WHERE i.reporting_breach = true)::int AS cnt_reporting,
          COUNT(*) FILTER (WHERE i.ctv_payment_term = true)::int AS cnt_payment_term,
          COUNT(*) FILTER (WHERE i.ctv_customer_overdue_mep = true)::int AS cnt_overdue_mep,
          COUNT(*) FILTER (WHERE i.ctv_outdated_dcl = true)::int AS cnt_outdated_dcl,
          COUNT(*) FILTER (WHERE i.ctv_invoice_after_policy_end = true)::int AS cnt_after_policy_end
     FROM "Invoice" i
    INNER JOIN "Customer" c ON c.id = i.customer_id
    WHERE i.account_id = ${accountId}
      AND c.account_id = ${accountId}
      AND c.collection_status IN ('Active', 'Inactive')
      AND i.policy_id = ${policyId}
      AND i.status IN ('Due', 'Overdue')
      AND (
        i.reporting_breach = true
        OR i.ctv_payment_term = true
        OR i.ctv_customer_overdue_mep = true
        OR i.ctv_outdated_dcl = true
        OR i.ctv_invoice_after_policy_end = true
      )`
                : domain_db_1.prisma.$queryRaw `SELECT COUNT(*)::int AS c,
          COALESCE(
            SUM(
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ),
            0
          )::float AS t,
          COUNT(*) FILTER (WHERE i.reporting_breach = true)::int AS cnt_reporting,
          COUNT(*) FILTER (WHERE i.ctv_payment_term = true)::int AS cnt_payment_term,
          COUNT(*) FILTER (WHERE i.ctv_customer_overdue_mep = true)::int AS cnt_overdue_mep,
          COUNT(*) FILTER (WHERE i.ctv_outdated_dcl = true)::int AS cnt_outdated_dcl,
          COUNT(*) FILTER (WHERE i.ctv_invoice_after_policy_end = true)::int AS cnt_after_policy_end
     FROM "Invoice" i
    WHERE i.account_id = ${accountId}
      AND i.status IN ('Due', 'Overdue')
      AND (
        i.reporting_breach = true
        OR i.ctv_payment_term = true
        OR i.ctv_customer_overdue_mep = true
        OR i.ctv_outdated_dcl = true
        OR i.ctv_invoice_after_policy_end = true
      )`,
        domain_db_1.prisma.invoice.findMany({
            where: (0, customerPolicyQueryHelpers_1.applyBusinessUnitFilterToInvoiceWhere)((0, customerPolicyQueryHelpers_1.withInvoiceCustomerPolicyFilter)(reportingCountdownOpenWhere(accountId, windowDays), policyId), businessUnitFilter),
            select: {
                customer_id: true,
                outstanding_debt: true,
                customer_outstanding_debt: true,
                amount: true,
            },
        }),
    ]);
    const { enrichCustomersWithPolicyScope, fetchCustomerIdsWithActiveLinkedPolicy } = await Promise.resolve().then(() => __importStar(require("./enrichCustomersWithActivePolicy")));
    const customers = await enrichCustomersWithPolicyScope(customersRaw, policyId);
    const customerIds = customers.map((c) => c.id);
    const activeLinkedPolicyCustomerIds = await fetchCustomerIdsWithActiveLinkedPolicy(customerIds);
    const customerHasActiveLinkedPolicy = (customerId) => activeLinkedPolicyCustomerIds.has(customerId);
    const [openArByCustomer, termsOutstandingByCustomer, termsBreachForAtRiskByCustomer] = await Promise.all([
        (0, openReceivableByCustomerCurrency_1.fetchOpenReceivableByCustomerMapInAccountCurrency)(accountId, accountCurrency, { customerIds, policyId }),
        fetchTermsBreachOutstandingByCustomerInAccountCurrency(accountId, accountCurrency, policyId, false, businessUnitFilter),
        fetchTermsBreachOutstandingByCustomerInAccountCurrency(accountId, accountCurrency, policyId, true, businessUnitFilter),
    ]);
    const openArForCustomer = (c) => {
        const fromInv = openArByCustomer.get(c.id);
        if (fromInv !== undefined) {
            return fromInv;
        }
        return 0;
    };
    const isNoPolicyExposureCohortCustomer = (c) => (0, policyExclusion_1.isNoPolicyExposureCardCustomer)({
        hasLinkedPolicy: customerHasActiveLinkedPolicy(c.id),
        exclusionReason: c.policy_exclusion_reason,
        openAr: openArForCustomer(c),
    });
    const isUncoveredExposureCohortCustomer = (c) => (0, policyExclusion_1.isUncoveredExposureCustomer)({
        hasLinkedPolicy: customerHasActiveLinkedPolicy(c.id),
        exclusionReason: c.policy_exclusion_reason,
    });
    const dashboardCustomers = includeNoPolicyExposure
        ? customers
        : customers.filter((c) => !isNoPolicyExposureCohortCustomer(c));
    let totalReceivables = 0;
    for (const c of dashboardCustomers) {
        const ar = openArForCustomer(c);
        if (ar <= 0) {
            continue;
        }
        totalReceivables += ar;
    }
    const convertPolicyLimitToAccount = async (policyCurrency, amount) => {
        if (!Number.isFinite(amount) || amount <= 0) {
            return 0;
        }
        if (policyCurrency === accountCurrency) {
            return amount;
        }
        const converted = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(policyCurrency, accountCurrency, amount);
        return converted ?? amount;
    };
    const policyArUsage = new Map();
    for (const c of dashboardCustomers) {
        const pol = c.InsurancePolicy;
        if (!pol) {
            continue;
        }
        const ar = openArForCustomer(c);
        const policyCurrency = pol.currency?.trim()
            ? String(pol.currency).trim().toUpperCase()
            : accountCurrency;
        const row = policyArUsage.get(pol.id) ?? {
            policyNumber: pol.policy_number ?? null,
            maxCover: Math.max(0, Number(pol.max_total_cover ?? 0)),
            policyCurrency,
            totalAr: 0,
        };
        row.totalAr += Math.max(0, ar);
        policyArUsage.set(pol.id, row);
    }
    const policyMaxCoverInAccount = new Map(await Promise.all(Array.from(policyArUsage.entries()).map(async ([pid, row]) => {
        const maxInAccount = await convertPolicyLimitToAccount(row.policyCurrency, row.maxCover);
        return [pid, maxInAccount];
    })));
    const policyMaxCoverAlerts = Array.from(policyArUsage.entries())
        .map(([alertPolicyId, row]) => {
        const maxCoverAccount = policyMaxCoverInAccount.get(alertPolicyId) ?? row.maxCover;
        return {
            policyId: alertPolicyId,
            policyNumber: row.policyNumber,
            totalAr: row.totalAr,
            maxCover: maxCoverAccount,
            exceededAmount: Math.max(0, row.totalAr - maxCoverAccount),
        };
    })
        .filter((r) => r.exceededAmount > 0)
        .sort((a, b) => b.exceededAmount - a.exceededAmount);
    const today = (0, date_fns_1.startOfDay)(new Date());
    const policyExpirationAlerts = scopedPolicies
        .map((policy) => {
        if (policy.end_date == null) {
            return null;
        }
        const endDate = (0, date_fns_1.startOfDay)(new Date(policy.end_date));
        if (Number.isNaN(endDate.getTime()) || endDate >= today) {
            return null;
        }
        return {
            policyId: policy.id,
            policyNumber: policy.policy_number ?? null,
            endDate: endDate.toISOString().slice(0, 10),
        };
    })
        .filter((row) => row != null)
        .sort((a, b) => a.endDate.localeCompare(b.endDate));
    const accountHasTopUp = await (0, hasTopUpPolicies_1.hasTopUpPolicies)(accountId);
    let topUpBlock = null;
    let topUpExpirationAlerts = [];
    let topUpCoverTotal = 0;
    let topUpCoverUsed = 0;
    let topUpCoverRemaining = 0;
    let topUpCoverOverEffective = 0;
    if (accountHasTopUp) {
        const topUpMetrics = await (0, creditInsuranceTopUpDashboardService_1.computeTopUpDashboardMetrics)({
            accountId,
            accountCurrency,
            expiringWindowDays: Math.max(30, limitExpirationWarnDays),
            primaryPolicyId: policyId,
            customers: dashboardCustomers.map((c) => ({
                id: c.id,
                policy_id: c.policy_id,
                approved_limit: c.approved_limit,
                approved_limit_currency: c.approved_limit_currency,
                outdated_dcl: c.outdated_dcl,
                excluded_from_policy: c.excluded_from_policy,
            })),
            openArByCustomerId: openArByCustomer,
        });
        topUpBlock = topUpMetrics.topUp;
        const { getTopUpExpiringSoonAlerts } = await Promise.resolve().then(() => __importStar(require("./creditInsuranceTopUpDashboardService")));
        topUpExpirationAlerts = await getTopUpExpiringSoonAlerts(accountId, 7, policyId, businessUnitFilter);
        topUpCoverTotal = topUpMetrics.policyUsageTopUp.topUpCoverTotal;
        topUpCoverUsed = topUpMetrics.policyUsageTopUp.topUpCoverUsed;
        topUpCoverRemaining = topUpMetrics.policyUsageTopUp.topUpCoverRemaining;
        topUpCoverOverEffective =
            topUpMetrics.policyUsageTopUp.topUpCoverOverEffective;
    }
    const policyLimitUsageRows = [];
    for (const c of dashboardCustomers) {
        const approvedLimitRaw = c.approved_limit != null
            ? new client_1.Prisma.Decimal(c.approved_limit).toNumber()
            : 0;
        const limitCurrency = c.approved_limit_currency?.trim().toUpperCase() || accountCurrency;
        const approvedLimitAccount = Math.max(0, (await convertApprovedLimitToAccountCurrency(approvedLimitRaw, limitCurrency, accountCurrency, {
            accountId,
            customerId: c.id,
            policyId: c.policy_id ?? undefined,
        })) ?? 0);
        let topUpTotalAccount = 0;
        if (accountHasTopUp &&
            c.approved_limit != null &&
            c.outdated_dcl !== true &&
            c.excluded_from_policy !== true) {
            const resolved = await (0, resolveEffectiveApprovedLimit_1.resolveEffectiveApprovedLimit)(c.id, {
                baseApprovedLimit: c.approved_limit,
                baseApprovedLimitCurrency: limitCurrency,
                outdatedDcl: c.outdated_dcl ?? false,
                excludedFromPolicy: c.excluded_from_policy ?? false,
                parentPrimaryPolicyId: policyId,
                asOfDate: today,
            });
            const topUpInLimitCurrency = Math.max(0, resolved.topUpTotalInLimitCurrency);
            if (topUpInLimitCurrency > 0) {
                topUpTotalAccount = await convertPolicyLimitToAccount(resolved.limitCurrency ?? limitCurrency, topUpInLimitCurrency);
            }
        }
        policyLimitUsageRows.push({
            limitType: c.limit_type ?? null,
            openArAccount: openArForCustomer(c),
            approvedLimitAccount,
            topUpTotalAccount,
            isActive: c.is_active === true,
            isCollectionActive: c.collection_status === "Active",
            excludedFromPolicy: c.excluded_from_policy === true,
            outdatedDcl: c.outdated_dcl === true,
            approvedLimitExpirationDate: c.approved_limit_expiration_date ?? null,
        });
    }
    const portfolioPolicyLimitUsage = (0, portfolioPolicyLimitUsage_1.aggregatePortfolioPolicyLimitUsage)(policyLimitUsageRows, today);
    const policyGapRollup = await (0, invoiceCapacityGapAmounts_1.sumCustomerPolicyCapacityGapForAccount)(accountId, { policyId, businessUnitFilter });
    const capacityTotal = policyGapRollup.gapBaseTotal;
    const customerOverLimit = policyGapRollup.customerOverLimitCount;
    const policyCapacityGapById = policyGapRollup.gapByPolicyId;
    const invoiceGapByCustomerPolicy = policyGapRollup.gapByCustomerPolicy;
    const useInvoiceSnapshotsForAtRisk = false;
    const invRow = invAgg[0];
    let termsCount = invRow?.c ?? 0;
    let termsTotal = useScopedTermsBreachAgg
        ? Number(invRow?.t ?? 0)
        : Array.from(termsOutstandingByCustomer.values()).reduce((sum, amount) => sum + Math.max(0, amount), 0);
    let countByReason = {
        reportingBreach: Number(invRow?.cnt_reporting ?? 0),
        paymentTerm: Number(invRow?.cnt_payment_term ?? 0),
        customerOverdueMep: Number(invRow?.cnt_overdue_mep ?? 0),
        outdatedDcl: Number(invRow?.cnt_outdated_dcl ?? 0),
        invoiceAfterPolicyEnd: Number(invRow?.cnt_after_policy_end ?? 0),
    };
    const insuredCustomerIdsForTermsBreach = dashboardCustomers
        .filter((c) => !isUncoveredExposureCohortCustomer(c))
        .map((c) => c.id);
    if (insuredCustomerIdsForTermsBreach.length === 0) {
        termsCount = 0;
        termsTotal = 0;
        countByReason = {
            reportingBreach: 0,
            paymentTerm: 0,
            customerOverdueMep: 0,
            outdatedDcl: 0,
            invoiceAfterPolicyEnd: 0,
        };
    }
    else if (insuredCustomerIdsForTermsBreach.length < dashboardCustomers.length ||
        !includeNoPolicyExposure) {
        const filteredTermInvoices = await domain_db_1.prisma.invoice.findMany({
            where: (0, customerPolicyQueryHelpers_1.applyBusinessUnitFilterToInvoiceWhere)({
                account_id: accountId,
                customer_id: { in: insuredCustomerIdsForTermsBreach },
                status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] },
                OR: TERMS_BREACH_OR,
                ...(policyId != null ? { policy_id: policyId } : {}),
            }, businessUnitFilter),
            select: {
                outstanding_debt: true,
                customer_outstanding_debt: true,
                amount: true,
                reporting_breach: true,
                ctv_payment_term: true,
                ctv_customer_overdue_mep: true,
                ctv_outdated_dcl: true,
                ctv_invoice_after_policy_end: true,
            },
        });
        const agg = (0, termBreachResolver_1.aggregatePortfolioTermsBreachFromInvoices)(filteredTermInvoices);
        termsCount = agg.invoiceCount;
        termsTotal = agg.totalAmount;
        countByReason = agg.countByReason;
    }
    else if (!useScopedTermsBreachAgg) {
        termsTotal = insuredCustomerIdsForTermsBreach.reduce((sum, customerId) => sum + Math.max(0, termsOutstandingByCustomer.get(customerId) ?? 0), 0);
    }
    let withoutPolicyAmount = 0;
    let withoutPolicyCustomerCount = 0;
    for (const c of dashboardCustomers) {
        const ar = openArForCustomer(c);
        if (ar <= 0) {
            continue;
        }
        if (isNoPolicyExposureCohortCustomer(c)) {
            withoutPolicyAmount += ar;
            withoutPolicyCustomerCount += 1;
        }
    }
    const effectiveLimitByCustomerId = accountHasTopUp
        ? await buildEffectiveLimitByCustomerIdInAccountCurrency(accountCurrency, dashboardCustomers, openArByCustomer)
        : new Map();
    let atRiskExposure = 0;
    let policyRiskExposure = 0;
    let policyRiskExposureCustomerCount = 0;
    let grossRiskExposure = 0;
    const allocatedRiskByPolicyId = new Map();
    let withoutPolicyAtRisk = 0;
    for (const c of dashboardCustomers) {
        const ar = openArForCustomer(c);
        if (ar <= 0) {
            continue;
        }
        let allocated;
        if (isUncoveredExposureCohortCustomer(c)) {
            allocated = ar;
            if (isNoPolicyExposureCohortCustomer(c)) {
                withoutPolicyAtRisk += ar;
            }
            grossRiskExposure += ar;
        }
        else {
            const gap = capacityGapForCustomerAtRisk(c, ar, useInvoiceSnapshotsForAtRisk, invoiceGapByCustomerPolicy);
            const tb = termsBreachForAtRiskByCustomer.get(c.id) ?? 0;
            grossRiskExposure += gap + tb;
            allocated = (0, invoiceInsuranceFields_1.computeCustomerRiskExposure)({
                totalAr: ar,
                capacityGapAmount: gap,
                termsBreachOutstanding: tb,
            });
            policyRiskExposure += allocated;
            policyRiskExposureCustomerCount += 1;
            if (c.policy_id != null) {
                const prev = allocatedRiskByPolicyId.get(c.policy_id) ?? 0;
                allocatedRiskByPolicyId.set(c.policy_id, prev + allocated);
            }
        }
        atRiskExposure += allocated;
    }
    const residualAtRiskByPolicyId = new Map();
    for (const [pid, row] of Array.from(policyArUsage.entries())) {
        const maxCoverAccount = policyMaxCoverInAccount.get(pid) ?? row.maxCover;
        const exceededForPolicy = Math.max(0, row.totalAr - maxCoverAccount);
        const capacityGapForPolicy = policyCapacityGapById.get(pid) ?? 0;
        residualAtRiskByPolicyId.set(pid, Math.max(0, exceededForPolicy - capacityGapForPolicy));
    }
    let insuredAtRisk = 0;
    for (const [pid, row] of Array.from(policyArUsage.entries())) {
        const allocated = allocatedRiskByPolicyId.get(pid) ?? 0;
        const residual = residualAtRiskByPolicyId.get(pid) ?? 0;
        insuredAtRisk += Math.min(row.totalAr, allocated + residual);
    }
    atRiskExposure = withoutPolicyAtRisk + insuredAtRisk;
    atRiskExposure = Math.min(totalReceivables, atRiskExposure);
    const compliantExposure = Math.max(0, totalReceivables - atRiskExposure);
    const healthIndex = totalReceivables > 0
        ? Math.max(0, Math.min(100, (100 * compliantExposure) / totalReceivables))
        : 100;
    let overdueBlockTotalOutstanding = 0;
    let overdueCountFiltered = 0;
    for (const c of dashboardCustomers) {
        if (c.overdue_block) {
            overdueCountFiltered += 1;
            overdueBlockTotalOutstanding += openArForCustomer(c);
        }
    }
    const limitWarningIds = new Set();
    for (const c of dashboardCustomers) {
        const ar = openArForCustomer(c);
        if (isNearLimitForWarning(c, limitWarnThresholdPct, ar, {
            useEffectiveLimit: accountHasTopUp,
            effectiveLimitInAccountCurrency: effectiveLimitByCustomerId.get(c.id),
        }) ||
            isCreditScoreExpiringInWindow(c, scoreValidityWarnDays) ||
            isLimitExpiringInWindow(c, limitExpirationWarnDays)) {
            limitWarningIds.add(c.id);
        }
    }
    let limitWarningTotalAr = 0;
    for (const c of dashboardCustomers) {
        if (limitWarningIds.has(c.id)) {
            limitWarningTotalAr += openArForCustomer(c);
        }
    }
    let reportingCount = 0;
    let reportingTotal = 0;
    const dashboardCustomerIds = new Set(dashboardCustomers.map((c) => c.id));
    for (const inv of rcInvoices) {
        if (inv.customer_id != null &&
            !dashboardCustomerIds.has(inv.customer_id)) {
            continue;
        }
        reportingCount += 1;
        reportingTotal += (0, invoiceInsuranceFields_1.invoiceOutstandingInAccountCurrency)(inv);
    }
    const zeroLimitWarningsCount = await domain_db_1.prisma.customerPolicy.count({
        where: {
            is_active: true,
            approved_limit: 0,
            insurance_policy_id: policyId != null ? policyId : { not: null },
            Customer: (0, customerPolicyQueryHelpers_1.mergeDashboardBusinessUnitIntoCustomerScope)({
                account_id: accountId,
                collection_status: { in: COLLECTION_LIVE },
            }, businessUnitFilter),
        },
    });
    return {
        healthIndex,
        totalReceivables,
        compliantExposure,
        atRiskExposure,
        policyRiskExposure,
        policyRiskExposureCustomerCount,
        grossRiskExposure,
        overdueBlockCustomerCount: overdueCountFiltered,
        overdueBlockTotalOutstanding,
        capacityGap: {
            totalAmount: capacityTotal,
            customerOverLimitCount: customerOverLimit,
        },
        termsBreach: {
            invoiceCount: termsCount,
            totalAmount: termsTotal,
            countByReason,
        },
        withoutPolicy: {
            customerCount: withoutPolicyCustomerCount,
            totalAmount: withoutPolicyAmount,
        },
        reportingCountdown: {
            invoiceCount: reportingCount,
            totalAmount: reportingTotal,
            windowDays: windowDays,
        },
        limitWarnings: {
            customerCount: limitWarningIds.size,
            totalAmount: limitWarningTotalAr,
            thresholdPct: limitWarnThresholdPct,
            scoreWarnDays: scoreValidityWarnDays,
        },
        zeroLimitWarnings: {
            customerCount: zeroLimitWarningsCount,
        },
        accountCurrency,
        hasTopUpPolicies: accountHasTopUp,
        topUp: topUpBlock,
        policyUsage: {
            combined: portfolioPolicyLimitUsage.combined,
            named: portfolioPolicyLimitUsage.named,
            dclSdl: portfolioPolicyLimitUsage.dclSdl,
            topUpCoverTotal,
            topUpCoverUsed,
            topUpCoverRemaining,
            topUpCoverOverEffective,
        },
        policyMaxCoverAlerts,
        policyExpirationAlerts,
        topUpExpirationAlerts,
    };
}
async function getOverdueBlockReport(accountId, take, skip, options = {}) {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const searchWhere = buildCustomerTextSearchWhere(options.query);
    const whereCust = {
        AND: [
            customersScoped(accountId, options.policyId, options.businessUnitFilter),
            { overdue_block: true },
            ...(options.customerId != null ? [{ id: options.customerId }] : []),
            ...(searchWhere ? [searchWhere] : []),
        ],
    };
    const ob = overdueOrderBy(options.sortField, options.sortDirection);
    const orderByClause = Array.isArray(ob) ? [...ob, { id: "asc" }] : [ob, { id: "asc" }];
    const [total, pageRaw, openArByCustomer] = await Promise.all([
        domain_db_1.prisma.customer.count({ where: whereCust }),
        domain_db_1.prisma.customer.findMany({
            where: whereCust,
            take,
            skip,
            orderBy: orderByClause,
            select: {
                id: true,
                total_due_amount: true,
                total_overdue_amount: true,
                customer_due_currency1: true,
                customer_due_currency2: true,
                customer_overdue_currency1: true,
                customer_overdue_currency2: true,
                Person: { select: { full_name: true } },
                Company: { select: { name: true } },
            },
        }),
        fetchOpenReceivableByCustomerMap(accountId, options.policyId),
    ]);
    const { enrichCustomersWithPolicyScope } = await Promise.resolve().then(() => __importStar(require("./enrichCustomersWithActivePolicy")));
    const page = await enrichCustomersWithPolicyScope(pageRaw, options.policyId);
    if (page.length === 0) {
        return { total, rows: [] };
    }
    const ids = page.map((c) => c.id);
    const today = (0, date_fns_1.startOfDay)(new Date());
    const invoiceScope = scopedInvoiceWhere(accountId, options.policyId);
    const [openCounts, overdueInv] = await Promise.all([
        domain_db_1.prisma.invoice.groupBy({
            by: ["customer_id"],
            where: {
                ...invoiceScope,
                customer_id: { in: ids },
                status: { notIn: CLOSED_INVOICE_STATUS },
            },
            _count: { _all: true },
        }),
        domain_db_1.prisma.invoice.findMany({
            where: {
                ...invoiceScope,
                customer_id: { in: ids },
                status: "Overdue",
                due_date: { not: null },
            },
            select: { customer_id: true, due_date: true },
        }),
    ]);
    const openMap = new Map();
    for (const g of openCounts) {
        if (g.customer_id != null) {
            openMap.set(g.customer_id, g._count._all);
        }
    }
    const maxDays = new Map();
    for (const inv of overdueInv) {
        if (!inv.due_date) {
            continue;
        }
        const days = Math.max(0, (0, date_fns_1.differenceInCalendarDays)(today, new Date(inv.due_date)));
        const prev = maxDays.get(inv.customer_id) ?? 0;
        if (days > prev) {
            maxDays.set(inv.customer_id, days);
        }
    }
    const rows = page.map((c) => ({
        customerId: c.id,
        policyNumber: c.InsurancePolicy?.policy_number ?? null,
        customerName: customerNameFromRow(c),
        outstandingAmount: openArByCustomer.get(c.id) ?? 0,
        maxDaysOverdue: maxDays.get(c.id) ?? 0,
        openInvoices: openMap.get(c.id) ?? 0,
        currency: displayCurrencyForCustomer(c, c.InsurancePolicy?.currency, accountCur),
    }));
    return { total, rows };
}
async function buildCapacityGapCandidates(accountId, options = {}) {
    const whereAll = {
        ...customersScoped(accountId, options.policyId, options.businessUnitFilter),
        ...(options.customerId != null ? { id: options.customerId } : {}),
    };
    const [allRaw, openArByCustomer] = await Promise.all([
        domain_db_1.prisma.customer.findMany({
            where: whereAll,
            select: {
                id: true,
                customer_number: true,
                total_due_amount: true,
                total_overdue_amount: true,
                customer_due_currency1: true,
                customer_due_currency2: true,
                customer_overdue_currency1: true,
                customer_overdue_currency2: true,
                Person: { select: { full_name: true } },
                Company: { select: { name: true } },
            },
        }),
        fetchOpenReceivableByCustomerMap(accountId, options.policyId),
    ]);
    const { enrichCustomersWithPolicyScope } = await Promise.resolve().then(() => __importStar(require("./enrichCustomersWithActivePolicy")));
    const all = await enrichCustomersWithPolicyScope(allRaw, options.policyId);
    const withGap = [];
    for (const c of all) {
        const ar = openArByCustomer.get(c.id) ?? 0;
        if (ar <= 0) {
            continue;
        }
        if (!c.is_active) {
            continue;
        }
        const gapAmount = dashboardCapacityGapFromStored(c);
        if (gapAmount > 0) {
            withGap.push({
                id: c.id,
                customer_number: c.customer_number ?? null,
                Person: c.Person ?? null,
                Company: c.Company ?? null,
                InsurancePolicy: c.InsurancePolicy
                    ? { policy_number: c.InsurancePolicy.policy_number ?? null }
                    : null,
                approved_limit: c.approved_limit,
                approved_limit_currency: c.approved_limit_currency ?? null,
                limit_type: c.limit_type ?? null,
                capacity_gap_amount1: c.capacity_gap_amount1 ?? null,
                gapAmount,
                openAr: ar,
            });
        }
    }
    if (withGap.length === 0 && all.length > 0) {
        const accountCur = await getAccountDisplayCurrency(accountId);
        const scopedCustomerIds = all.map((c) => c.id);
        const invoiceRows = await domain_db_1.prisma.invoice.findMany({
            where: {
                account_id: accountId,
                customer_id: { in: scopedCustomerIds },
                status: { in: ["Due", "Overdue"] },
                ...(options.policyId != null
                    ? { policy_id: options.policyId }
                    : { policy_id: { not: null } }),
            },
            select: {
                customer_id: true,
                outstanding_debt: true,
                customer_outstanding_debt: true,
                amount: true,
                limit_assessed_amount: true,
                InsurancePolicy: { select: { currency: true } },
            },
        });
        const gapByCustomer = new Map();
        for (const inv of invoiceRows) {
            if (inv.customer_id == null) {
                continue;
            }
            const contribution = (0, invoiceInsuranceFields_1.computeInvoiceCapacityGapContribution)({
                outstandingLeft: lineOutstanding(inv),
                limitAssessedAmount: Number(inv.limit_assessed_amount ?? 0),
            });
            if (contribution <= 0) {
                continue;
            }
            const policyCurrency = inv.InsurancePolicy?.currency?.trim()
                ? String(inv.InsurancePolicy.currency).trim().toUpperCase()
                : accountCur;
            const contributionInAccount = await (0, customerCreditInsuranceHeaderAmounts_1.convertAmountToCurrencyLatestRate)(policyCurrency, accountCur, contribution);
            const normalizedContribution = Number(contributionInAccount ?? 0);
            if (normalizedContribution <= 0) {
                continue;
            }
            gapByCustomer.set(inv.customer_id, (gapByCustomer.get(inv.customer_id) ?? 0) +
                normalizedContribution);
        }
        for (const c of all) {
            if (!c.is_active) {
                continue;
            }
            const gapAmount = gapByCustomer.get(c.id) ?? 0;
            if (gapAmount <= 0) {
                continue;
            }
            withGap.push({
                id: c.id,
                customer_number: c.customer_number ?? null,
                Person: c.Person ?? null,
                Company: c.Company ?? null,
                InsurancePolicy: c.InsurancePolicy
                    ? { policy_number: c.InsurancePolicy.policy_number ?? null }
                    : null,
                approved_limit: c.approved_limit,
                approved_limit_currency: c.approved_limit_currency ?? null,
                limit_type: c.limit_type ?? null,
                capacity_gap_amount1: c.capacity_gap_amount1 ?? null,
                gapAmount,
                openAr: openArByCustomer.get(c.id) ?? 0,
            });
        }
    }
    return withGap;
}
async function getCustomerCapacityGapForReport(accountId, customerId, policyId) {
    const candidates = await buildCapacityGapCandidates(accountId, {
        customerId,
        policyId,
    });
    const amount = candidates.reduce((sum, row) => sum + row.gapAmount, 0);
    let amountSecondary = null;
    for (const row of candidates) {
        if (row.capacity_gap_amount1 != null &&
            Number(row.capacity_gap_amount1) > 0) {
            amountSecondary =
                (amountSecondary ?? 0) + Math.max(0, Number(row.capacity_gap_amount1));
        }
    }
    return { amount, amountSecondary };
}
async function getCapacityGapReport(accountId, take, skip, options = {}) {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const withGap = await buildCapacityGapCandidates(accountId, {
        policyId: options.policyId,
        customerId: options.customerId,
    });
    let filtered = withGap;
    const q = options.query?.trim();
    if (q) {
        filtered = withGap.filter((c) => customerRowMatchesQuery(c, q));
    }
    const sortField = options.sortField || "uninsuredGap";
    const sortDirection = options.sortDirection || "desc";
    const sign = sortDirection === "asc" ? 1 : -1;
    const withAccountLimits = await Promise.all(filtered.map(async (c) => {
        const rawLimit = c.approved_limit != null
            ? new client_1.Prisma.Decimal(c.approved_limit).toNumber()
            : null;
        const approvedLimitInAccount = await convertApprovedLimitToAccountCurrency(rawLimit, c.approved_limit_currency, accountCur, {
            accountId,
            customerId: c.id,
            policyId: options.policyId,
        });
        const uninsuredGap = Math.max(0, c.gapAmount);
        return { ...c, approvedLimitInAccount, uninsuredGap };
    }));
    const overLimit = withAccountLimits.filter((c) => c.uninsuredGap > 0);
    const sorted = [...overLimit].sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
            case "policyNumber":
                cmp = (a.InsurancePolicy?.policy_number || "").localeCompare(b.InsurancePolicy?.policy_number || "");
                break;
            case "customerName":
                cmp = customerNameFromRow(a).localeCompare(customerNameFromRow(b), undefined, { sensitivity: "base" });
                break;
            case "approvedLimit": {
                const av = a.approvedLimitInAccount ?? 0;
                const bv = b.approvedLimitInAccount ?? 0;
                cmp = av - bv;
                break;
            }
            case "limitType":
                cmp = String(a.limit_type || "").localeCompare(String(b.limit_type || ""));
                break;
            case "totalAR":
                cmp = a.openAr - b.openAr;
                break;
            case "uninsuredGap":
            default:
                cmp = a.uninsuredGap - b.uninsuredGap;
        }
        if (cmp !== 0) {
            return cmp * sign;
        }
        return a.id - b.id;
    });
    const total = sorted.length;
    const page = sorted.slice(skip, skip + take);
    if (page.length === 0) {
        return { total, rows: [] };
    }
    const ids = page.map((c) => c.id);
    const invoiceScope = scopedInvoiceWhere(accountId, options.policyId);
    const openCounts = await domain_db_1.prisma.invoice.groupBy({
        by: ["customer_id"],
        where: {
            ...invoiceScope,
            customer_id: { in: ids },
            status: { notIn: CLOSED_INVOICE_STATUS },
        },
        _count: { _all: true },
    });
    const openMap = new Map();
    for (const g of openCounts) {
        if (g.customer_id != null) {
            openMap.set(g.customer_id, g._count._all);
        }
    }
    const rows = page.map((c) => ({
        customerId: c.id,
        policyNumber: c.InsurancePolicy?.policy_number ?? null,
        customerName: customerNameFromRow(c),
        approvedLimit: c.approvedLimitInAccount,
        approvedLimitCurrency: accountCur,
        limitType: c.limit_type != null ? String(c.limit_type) : null,
        totalAR: c.openAr,
        openInvoices: openMap.get(c.id) ?? 0,
        uninsuredGap: c.uninsuredGap,
        currency: accountCur,
    }));
    return { total, rows };
}
function sortPolicyRiskExposureRows(rows, sortField, sortDirection) {
    const sign = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        let c = 0;
        switch (sortField) {
            case "policyNumber":
                c = (a.policyNumber || "").localeCompare(b.policyNumber || "");
                break;
            case "customerName":
                c = a.customerName.localeCompare(b.customerName, undefined, {
                    sensitivity: "base",
                });
                break;
            case "openAR":
                c = a.openAR - b.openAR;
                break;
            case "capacityGap":
                c = a.capacityGap - b.capacityGap;
                break;
            case "termsBreachOutstanding":
                c = a.termsBreachOutstanding - b.termsBreachOutstanding;
                break;
            case "policyRiskAllocated":
            default:
                c = a.policyRiskAllocated - b.policyRiskAllocated;
        }
        if (c !== 0) {
            return c * sign;
        }
        return a.customerId - b.customerId;
    });
}
async function getPolicyRiskExposureReport(accountId, take, skip, options = {}) {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const whereAll = customersScoped(accountId, options.policyId, options.businessUnitFilter);
    const [allRaw, openArByCustomer, termsOutstandingByCustomer, termsBreachForAtRiskByCustomer] = await Promise.all([
        domain_db_1.prisma.customer.findMany({
            where: whereAll,
            select: {
                id: true,
                customer_number: true,
                total_due_amount: true,
                total_overdue_amount: true,
                customer_due_currency1: true,
                customer_due_currency2: true,
                customer_overdue_currency1: true,
                customer_overdue_currency2: true,
                Person: { select: { full_name: true } },
                Company: { select: { name: true } },
            },
        }),
        fetchOpenReceivableByCustomerMap(accountId, options.policyId),
        fetchTermsBreachOutstandingByCustomer(accountId, options.policyId, false),
        fetchTermsBreachOutstandingByCustomer(accountId, options.policyId, true),
    ]);
    const { enrichCustomersWithPolicyScope } = await Promise.resolve().then(() => __importStar(require("./enrichCustomersWithActivePolicy")));
    const all = await enrichCustomersWithPolicyScope(allRaw, options.policyId);
    const openArFor = (c) => {
        return openArByCustomer.get(c.id) ?? 0;
    };
    let list = all;
    const q = options.query?.trim();
    if (q) {
        list = all.filter((c) => customerRowMatchesQuery(c, q));
    }
    const built = [];
    for (const c of list) {
        if (c.InsurancePolicy == null) {
            continue;
        }
        const ar = openArFor(c);
        if (ar <= 0) {
            continue;
        }
        const gap = dashboardCapacityGapFromStored(c);
        const tb = termsOutstandingByCustomer.get(c.id) ?? 0;
        const tbForAtRisk = termsBreachForAtRiskByCustomer.get(c.id) ?? 0;
        const allocated = (0, invoiceInsuranceFields_1.computeCustomerRiskExposure)({
            totalAr: ar,
            capacityGapAmount: gap,
            termsBreachOutstanding: tbForAtRisk,
        });
        built.push({
            customerId: c.id,
            policyNumber: c.InsurancePolicy.policy_number ?? null,
            customerName: customerNameFromRow(c),
            openAR: ar,
            capacityGap: gap,
            termsBreachOutstanding: tb,
            policyRiskAllocated: allocated,
            currency: displayCurrencyForCustomer(c, c.InsurancePolicy?.currency, accountCur),
        });
    }
    const sortField = options.sortField || "policyRiskAllocated";
    const sortDirection = options.sortDirection || "desc";
    const sorted = sortPolicyRiskExposureRows(built, sortField, sortDirection);
    const total = sorted.length;
    const page = sorted.slice(skip, skip + take);
    return { total, rows: page };
}
async function getNoPolicyExposureReport(accountId, take, skip, options = {}) {
    if (options.includeNoPolicyExposure === false) {
        return { total: 0, rows: [] };
    }
    const accountCur = await getAccountDisplayCurrency(accountId);
    const whereAll = customersScoped(accountId, options.policyId, options.businessUnitFilter);
    const [allRaw, openArByCustomer] = await Promise.all([
        domain_db_1.prisma.customer.findMany({
            where: whereAll,
            select: {
                id: true,
                customer_number: true,
                total_due_amount: true,
                total_overdue_amount: true,
                customer_due_currency1: true,
                customer_due_currency2: true,
                customer_overdue_currency1: true,
                customer_overdue_currency2: true,
                Person: { select: { full_name: true } },
                Company: { select: { name: true } },
            },
        }),
        fetchOpenReceivableByCustomerMap(accountId, options.policyId),
    ]);
    const { enrichCustomersWithPolicyScope, fetchCustomerIdsWithActiveLinkedPolicy } = await Promise.resolve().then(() => __importStar(require("./enrichCustomersWithActivePolicy")));
    const all = await enrichCustomersWithPolicyScope(allRaw, options.policyId);
    const customerIds = all.map((c) => c.id);
    const activeLinkedPolicyCustomerIds = await fetchCustomerIdsWithActiveLinkedPolicy(customerIds);
    let list = all.filter((c) => {
        const ar = openArByCustomer.get(c.id) ?? 0;
        return (0, policyExclusion_1.isNoPolicyExposureCardCustomer)({
            hasLinkedPolicy: activeLinkedPolicyCustomerIds.has(c.id),
            exclusionReason: c.policy_exclusion_reason,
            openAr: ar,
        });
    });
    const q = options.query?.trim();
    if (q) {
        list = list.filter((c) => customerRowMatchesQuery(c, q));
    }
    const sortField = options.sortField || "openAR";
    const sortDirection = options.sortDirection || "desc";
    const sign = sortDirection === "asc" ? 1 : -1;
    const sorted = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
            case "customerName":
                cmp = customerNameFromRow(a).localeCompare(customerNameFromRow(b), undefined, { sensitivity: "base" });
                break;
            case "customerNumber":
                cmp = String(a.customer_number ?? "").localeCompare(String(b.customer_number ?? ""), undefined, { sensitivity: "base" });
                break;
            case "policyNumber":
                cmp = String(a.InsurancePolicy?.policy_number ?? "").localeCompare(String(b.InsurancePolicy?.policy_number ?? ""), undefined, { sensitivity: "base" });
                break;
            case "exclusionReason":
                cmp = String(a.policy_exclusion_reason ?? "").localeCompare(String(b.policy_exclusion_reason ?? ""), undefined, { sensitivity: "base" });
                break;
            case "openAR":
            default:
                cmp =
                    (openArByCustomer.get(a.id) ?? 0) -
                        (openArByCustomer.get(b.id) ?? 0);
                break;
        }
        if (cmp !== 0) {
            return cmp * sign;
        }
        return a.id - b.id;
    });
    const total = sorted.length;
    const page = sorted.slice(skip, skip + take);
    const rows = page.map((c) => ({
        customerId: c.id,
        policyNumber: c.InsurancePolicy?.policy_number ?? null,
        customerName: customerNameFromRow(c),
        customerNumber: c.customer_number ?? null,
        openAR: openArByCustomer.get(c.id) ?? 0,
        exclusionReason: c.policy_exclusion_reason ?? null,
        currency: displayCurrencyForCustomer(c, c.InsurancePolicy?.currency, accountCur),
    }));
    return { total, rows };
}
function termsBreachReasonCodesForInvoice(inv) {
    const codes = [];
    if (inv.reporting_breach) {
        codes.push("reporting_breach");
    }
    if (inv.ctv_payment_term) {
        codes.push("ctv_payment_term");
    }
    if (inv.ctv_customer_overdue_mep) {
        codes.push("ctv_customer_overdue_mep");
    }
    if (inv.ctv_outdated_dcl) {
        codes.push("ctv_outdated_dcl");
    }
    if (inv.ctv_invoice_after_policy_end) {
        codes.push("ctv_invoice_after_policy_end");
    }
    return codes;
}
function termsBreachReportWhere(accountId, q, scope) {
    const statusFilter = scope?.termsOverdueOnly
        ? { status: client_1.invoice_status.Overdue }
        : { status: { in: [client_1.invoice_status.Due, client_1.invoice_status.Overdue] } };
    const breachFilter = scope?.termsBreachReason
        ? { [scope.termsBreachReason]: true }
        : { OR: TERMS_BREACH_OR };
    const base = {
        account_id: accountId,
        ...statusFilter,
        ...breachFilter,
    };
    if (!q?.trim()) {
        return {
            ...base,
            Customer: { isNot: null },
        };
    }
    const t = q.trim();
    return {
        ...base,
        Customer: { isNot: null },
        AND: [
            {
                OR: [
                    { invoice_number: { contains: t, mode: "insensitive" } },
                    (0, customerPolicyQueryHelpers_1.invoiceLinkedPolicyTextSearchOr)(t),
                    {
                        Customer: {
                            is: {
                                OR: [
                                    {
                                        customer_number: {
                                            contains: t,
                                            mode: "insensitive",
                                        },
                                    },
                                    {
                                        Person: {
                                            full_name: {
                                                contains: t,
                                                mode: "insensitive",
                                            },
                                        },
                                    },
                                    {
                                        Company: {
                                            name: {
                                                contains: t,
                                                mode: "insensitive",
                                            },
                                        },
                                    },
                                    {
                                        CustomerPolicy: {
                                            some: {
                                                is_active: true,
                                                OR: [
                                                    {
                                                        customer_number_policy: {
                                                            contains: t,
                                                            mode: "insensitive",
                                                        },
                                                    },
                                                    {
                                                        InsurancePolicy: {
                                                            policy_number: {
                                                                contains: t,
                                                                mode: "insensitive",
                                                            },
                                                        },
                                                    },
                                                ],
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        ],
    };
}
function termsOrderBy(sortField, sortDirection) {
    const d = sortDirection === "desc" ? "desc" : "asc";
    switch (sortField) {
        case "invoiceNumber":
            return { invoice_number: d };
        case "invoiceAmount":
            return { outstanding_debt: d };
        case "policyNumber":
            return { InsurancePolicy: { policy_number: d } };
        case "customerName":
            return { Customer: { Person: { full_name: d } } };
        default:
            return { id: d };
    }
}
function displayCurrencyForInvoiceRow(inv, customer, policyCurrency, accountCurrency) {
    return (0, stringFormatters_stub_1.resolveCustomerFirstCurrency)({
        customerCurrencyPrimary: inv.customer_currency,
        collectionCurrencyPrimary: customer.customer_due_currency1,
        collectionCurrencySecondary: customer.customer_overdue_currency1,
        accountCurrency,
        fallbackCurrency: policyCurrency && String(policyCurrency).trim()
            ? String(policyCurrency).trim()
            : null,
    });
}
async function getTermsBreachReport(accountId, take, skip, options = {}) {
    const accountCur = await getAccountDisplayCurrency(accountId);
    let where = (0, customerPolicyQueryHelpers_1.applyBusinessUnitFilterToInvoiceWhere)((0, customerPolicyQueryHelpers_1.withInvoiceCustomerPolicyFilter)(termsBreachReportWhere(accountId, options.query, {
        termsBreachReason: options.termsBreachReason,
        termsOverdueOnly: options.termsOverdueOnly,
    }), options.policyId), options.businessUnitFilter);
    if (options.customerId != null) {
        where = { ...where, customer_id: options.customerId };
    }
    const obT = termsOrderBy(options.sortField, options.sortDirection);
    const orderByClauseTerms = Array.isArray(obT) ? [...obT, { id: "asc" }] : [obT, { id: "asc" }];
    const [total, list] = await Promise.all([
        domain_db_1.prisma.invoice.count({ where }),
        domain_db_1.prisma.invoice.findMany({
            where,
            take,
            skip,
            orderBy: orderByClauseTerms,
            select: {
                id: true,
                invoice_number: true,
                outstanding_debt: true,
                customer_outstanding_debt: true,
                amount: true,
                customer_currency: true,
                reporting_breach: true,
                ctv_payment_term: true,
                ctv_customer_overdue_mep: true,
                ctv_outdated_dcl: true,
                ctv_invoice_after_policy_end: true,
                InsurancePolicy: {
                    select: { policy_number: true, currency: true },
                },
                Customer: {
                    select: {
                        id: true,
                        customer_due_currency1: true,
                        customer_due_currency2: true,
                        customer_overdue_currency1: true,
                        customer_overdue_currency2: true,
                        Person: { select: { full_name: true } },
                        Company: { select: { name: true } },
                        CustomerPolicy: customerPolicyQueryHelpers_1.ACTIVE_CUSTOMER_POLICY_NESTED_SELECT,
                    },
                },
            },
        }),
    ]);
    const rows = (await Promise.all(list.map(async (inv) => {
        const c = inv.Customer;
        if (!c) {
            return null;
        }
        const codes = termsBreachReasonCodesForInvoice(inv);
        const policyDisplay = (0, customerPolicyQueryHelpers_1.policyDisplayFromInvoiceRow)(inv, c);
        const invoiceAmountAccount = await (0, openReceivableByCustomerCurrency_1.resolveInvoiceLineOutstandingInAccountCurrency)(inv, accountCur);
        return {
            customerId: c.id,
            policyNumber: policyDisplay.policy_number,
            customerName: customerNameFromRow(c),
            invoiceId: inv.id,
            invoiceNumber: inv.invoice_number ?? null,
            termsBreachReasonCodes: codes,
            invoiceAmount: lineOutstanding(inv),
            invoiceAmountAccount,
            currency: displayCurrencyForInvoiceRow(inv, c, policyDisplay.currency, accountCur),
        };
    }))).filter((r) => r != null);
    return { total, rows };
}
function invoiceDaysOverdueFromRow(inv) {
    if (inv.status !== "Overdue" || !inv.due_date) {
        return 0;
    }
    return Math.max(0, (0, date_fns_1.differenceInCalendarDays)((0, date_fns_1.startOfDay)(new Date()), (0, date_fns_1.startOfDay)(new Date(inv.due_date))));
}
function daysLeftUntilCalendar(target) {
    if (!target) {
        return 0;
    }
    return Math.max(0, (0, date_fns_1.differenceInCalendarDays)((0, date_fns_1.startOfDay)(new Date(target)), (0, date_fns_1.startOfDay)(new Date())));
}
function reportingCountdownOpenSearchWhere(accountId, windowDays, q) {
    const base = reportingCountdownOpenWhere(accountId, windowDays);
    if (!q?.trim()) {
        return {
            ...base,
            Customer: { isNot: null },
        };
    }
    const t = q.trim();
    return {
        ...base,
        Customer: { isNot: null },
        AND: [
            {
                OR: [
                    { invoice_number: { contains: t, mode: "insensitive" } },
                    (0, customerPolicyQueryHelpers_1.invoiceLinkedPolicyTextSearchOr)(t),
                    {
                        Customer: {
                            is: {
                                OR: [
                                    {
                                        customer_number: {
                                            contains: t,
                                            mode: "insensitive",
                                        },
                                    },
                                    {
                                        Person: {
                                            full_name: {
                                                contains: t,
                                                mode: "insensitive",
                                            },
                                        },
                                    },
                                    {
                                        Company: {
                                            name: {
                                                contains: t,
                                                mode: "insensitive",
                                            },
                                        },
                                    },
                                    {
                                        CustomerPolicy: {
                                            some: {
                                                is_active: true,
                                                OR: [
                                                    {
                                                        customer_number_policy: {
                                                            contains: t,
                                                            mode: "insensitive",
                                                        },
                                                    },
                                                    {
                                                        InsurancePolicy: {
                                                            policy_number: {
                                                                contains: t,
                                                                mode: "insensitive",
                                                            },
                                                        },
                                                    },
                                                ],
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        ],
    };
}
function reportingOrderBy(sortField, sortDirection) {
    const d = sortDirection === "desc" ? "desc" : "asc";
    switch (sortField) {
        case "daysLeftForReporting":
        case "target_reporting_date":
            return { target_reporting_date: d };
        case "daysOverdue":
            return { due_date: d };
        case "invoiceNumber":
            return { invoice_number: d };
        case "policyNumber":
            return { InsurancePolicy: { policy_number: d } };
        case "customerName":
            return { Customer: { Person: { full_name: d } } };
        case "invoiceAmount":
            return { outstanding_debt: d };
        default:
            return { target_reporting_date: "asc" };
    }
}
async function getReportingCountdownOpenReport(accountId, take, skip, windowDays, options = {}) {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const w = Math.max(0, windowDays);
    let where = (0, customerPolicyQueryHelpers_1.applyBusinessUnitFilterToInvoiceWhere)((0, customerPolicyQueryHelpers_1.withInvoiceCustomerPolicyFilter)(reportingCountdownOpenSearchWhere(accountId, w, options.query), options.policyId), options.businessUnitFilter);
    if (options.customerId != null) {
        where = { ...where, customer_id: options.customerId };
    }
    const ob = reportingOrderBy(options.sortField, options.sortDirection);
    const orderByClause = Array.isArray(ob) ? [...ob, { id: "asc" }] : [ob, { id: "asc" }];
    const [total, list] = await Promise.all([
        domain_db_1.prisma.invoice.count({ where }),
        domain_db_1.prisma.invoice.findMany({
            where,
            take,
            skip,
            orderBy: orderByClause,
            select: {
                id: true,
                invoice_number: true,
                status: true,
                due_date: true,
                target_reporting_date: true,
                outstanding_debt: true,
                customer_outstanding_debt: true,
                amount: true,
                customer_currency: true,
                InsurancePolicy: {
                    select: {
                        policy_number: true,
                        currency: true,
                    },
                },
                Customer: {
                    select: {
                        id: true,
                        customer_due_currency1: true,
                        customer_due_currency2: true,
                        customer_overdue_currency1: true,
                        customer_overdue_currency2: true,
                        Person: { select: { full_name: true } },
                        Company: { select: { name: true } },
                        CustomerPolicy: customerPolicyQueryHelpers_1.ACTIVE_CUSTOMER_POLICY_NESTED_SELECT,
                    },
                },
            },
        }),
    ]);
    const rows = list
        .map((inv) => {
        const c = inv.Customer;
        if (!c) {
            return null;
        }
        const policyDisplay = (0, customerPolicyQueryHelpers_1.policyDisplayFromInvoiceRow)(inv, c);
        return {
            customerId: c.id,
            policyNumber: policyDisplay.policy_number,
            customerName: customerNameFromRow(c),
            invoiceId: inv.id,
            invoiceNumber: inv.invoice_number ?? null,
            invoiceAmount: lineOutstanding(inv),
            currency: displayCurrencyForInvoiceRow(inv, c, policyDisplay.currency, accountCur),
            daysOverdue: invoiceDaysOverdueFromRow(inv),
            daysLeftForReporting: inv.target_reporting_date
                ? daysLeftUntilCalendar(inv.target_reporting_date)
                : 0,
        };
    })
        .filter((r) => r != null);
    return { total, rows };
}
function reportedInvoicesSearchWhere(accountId, q) {
    const base = {
        account_id: accountId,
        actual_reporting_date: { not: null },
    };
    if (!q?.trim()) {
        return { ...base, Customer: { isNot: null } };
    }
    const t = q.trim();
    return {
        ...base,
        Customer: { isNot: null },
        AND: [
            {
                OR: [
                    { invoice_number: { contains: t, mode: "insensitive" } },
                    (0, customerPolicyQueryHelpers_1.invoiceLinkedPolicyTextSearchOr)(t),
                    {
                        Customer: {
                            is: {
                                OR: [
                                    {
                                        customer_number: {
                                            contains: t,
                                            mode: "insensitive",
                                        },
                                    },
                                    {
                                        Person: {
                                            full_name: {
                                                contains: t,
                                                mode: "insensitive",
                                            },
                                        },
                                    },
                                    {
                                        Company: {
                                            name: {
                                                contains: t,
                                                mode: "insensitive",
                                            },
                                        },
                                    },
                                    {
                                        CustomerPolicy: {
                                            some: {
                                                is_active: true,
                                                OR: [
                                                    {
                                                        customer_number_policy: {
                                                            contains: t,
                                                            mode: "insensitive",
                                                        },
                                                    },
                                                    {
                                                        InsurancePolicy: {
                                                            policy_number: {
                                                                contains: t,
                                                                mode: "insensitive",
                                                            },
                                                        },
                                                    },
                                                ],
                                            },
                                        },
                                    },
                                ],
                            },
                        },
                    },
                ],
            },
        ],
    };
}
function reportedListOrderBy(sortField, sortDirection) {
    const d = sortDirection === "asc" ? "asc" : "desc";
    switch (sortField) {
        case "reportingCapturedAt":
            return [
                { reporting_captured_at: d },
                { id: d },
            ];
        case "actualReportingDate":
            return [
                { actual_reporting_date: d },
                { id: d },
            ];
        case "invoiceNumber":
            return [{ invoice_number: d }, { id: d }];
        case "invoiceAmount":
            return [{ outstanding_debt: d }, { id: d }];
        case "policyNumber":
            return [{ InsurancePolicy: { policy_number: d } }, { id: d }];
        case "customerName":
            return [{ Customer: { Person: { full_name: d } } }, { id: d }];
        default:
            return [
                { reporting_captured_at: "desc" },
                { actual_reporting_date: "desc" },
                { id: "desc" },
            ];
    }
}
async function getReportedInvoicesReport(accountId, take, skip, options = {}) {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const where = (0, customerPolicyQueryHelpers_1.applyBusinessUnitFilterToInvoiceWhere)((0, customerPolicyQueryHelpers_1.withInvoiceCustomerPolicyFilter)(reportedInvoicesSearchWhere(accountId, options.query), options.policyId), options.businessUnitFilter);
    const orderBy = reportedListOrderBy(options.sortField, options.sortDirection);
    const [total, list] = await Promise.all([
        domain_db_1.prisma.invoice.count({ where }),
        domain_db_1.prisma.invoice.findMany({
            where,
            take,
            skip,
            orderBy: orderBy,
            select: {
                id: true,
                invoice_number: true,
                outstanding_debt: true,
                customer_outstanding_debt: true,
                amount: true,
                customer_currency: true,
                actual_reporting_date: true,
                reporting_captured_at: true,
                reporting_comment: true,
                InsurancePolicy: {
                    select: { policy_number: true, currency: true },
                },
                Customer: {
                    select: {
                        id: true,
                        customer_due_currency1: true,
                        customer_due_currency2: true,
                        customer_overdue_currency1: true,
                        customer_overdue_currency2: true,
                        Person: { select: { full_name: true } },
                        Company: { select: { name: true } },
                        CustomerPolicy: customerPolicyQueryHelpers_1.ACTIVE_CUSTOMER_POLICY_NESTED_SELECT,
                    },
                },
            },
        }),
    ]);
    const rows = list
        .map((inv) => {
        const c = inv.Customer;
        if (!c) {
            return null;
        }
        const ad = inv.actual_reporting_date;
        const cap = inv.reporting_captured_at;
        const policyDisplay = (0, customerPolicyQueryHelpers_1.policyDisplayFromInvoiceRow)(inv, c);
        return {
            customerId: c.id,
            policyNumber: policyDisplay.policy_number,
            customerName: customerNameFromRow(c),
            invoiceId: inv.id,
            invoiceNumber: inv.invoice_number ?? null,
            invoiceAmount: lineOutstanding(inv),
            currency: displayCurrencyForInvoiceRow(inv, c, policyDisplay.currency, accountCur),
            actualReportingDate: ad
                ? new Date(ad).toISOString().slice(0, 10)
                : null,
            reportingCapturedAt: cap ? new Date(cap).toISOString() : null,
            reportingRefComment: inv.reporting_comment
                ? String(inv.reporting_comment)
                : null,
        };
    })
        .filter((r) => r != null);
    return { total, rows };
}
function buildLimitWarningRow(c, accountCur, thresholdPct, scoreWarnDays, limitExpirationWarnDays, openArOverride, limitWarningOptions) {
    const ar = openArOverride !== undefined ? openArOverride : totalArFromCustomerRow(c);
    const near = isNearLimitForWarning(c, thresholdPct, ar, limitWarningOptions);
    const scoreEx = isCreditScoreExpiringInWindow(c, scoreWarnDays);
    const limitEx = isLimitExpiringInWindow(c, limitExpirationWarnDays);
    if (!near && !scoreEx && !limitEx) {
        return null;
    }
    let nearPct = null;
    if (near) {
        const useEffective = limitWarningOptions?.useEffectiveLimit === true &&
            limitWarningOptions.effectiveLimitInAccountCurrency != null &&
            limitWarningOptions.effectiveLimitInAccountCurrency > 0;
        const lim = useEffective
            ? limitWarningOptions.effectiveLimitInAccountCurrency
            : c.approved_limit != null
                ? new client_1.Prisma.Decimal(c.approved_limit).toNumber()
                : null;
        if (lim != null && lim > 0) {
            nearPct = Math.min(100, Math.round((100 * ar) / lim));
        }
    }
    const expiry = creditScoreExpiryOnCalendar(c.credit_score_input_date, c.InsurancePolicy?.score_validity_period_months);
    let daysToScore = null;
    if (scoreEx && expiry) {
        daysToScore = Math.max(0, (0, date_fns_1.differenceInCalendarDays)(expiry, (0, date_fns_1.startOfDay)(new Date())));
    }
    let daysToLimitExpiry = null;
    if (limitEx && c.approved_limit_expiration_date) {
        daysToLimitExpiry = Math.max(0, (0, date_fns_1.differenceInCalendarDays)((0, date_fns_1.startOfDay)(new Date(c.approved_limit_expiration_date)), (0, date_fns_1.startOfDay)(new Date())));
    }
    return {
        customerId: c.id,
        policyNumber: c.InsurancePolicy?.policy_number ?? null,
        customerName: customerNameFromRow(c),
        nearLimit: near,
        nearLimitUtilizationPct: nearPct,
        scoreExpiring: scoreEx,
        scoreExpiresInDays: daysToScore,
        creditScoreInputDate: c.credit_score_input_date
            ? new Date(c.credit_score_input_date).toISOString().slice(0, 10)
            : null,
        approvedLimit: c.approved_limit != null
            ? new client_1.Prisma.Decimal(c.approved_limit).toNumber()
            : null,
        limitType: c.limit_type != null ? String(c.limit_type) : null,
        totalAR: ar,
        currency: displayCurrencyForCustomer(c, c.InsurancePolicy?.currency, accountCur),
        limitExpiring: limitEx,
        limitExpiresInDays: daysToLimitExpiry,
        approvedLimitExpirationDate: c.approved_limit_expiration_date
            ? new Date(c.approved_limit_expiration_date).toISOString().slice(0, 10)
            : null,
    };
}
function sortLimitWarningRows(rows, sortField, sortDirection) {
    const sign = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        let c = 0;
        switch (sortField) {
            case "policyNumber": {
                c = (a.policyNumber || "").localeCompare(b.policyNumber || "");
                break;
            }
            case "customerName": {
                c = a.customerName.localeCompare(b.customerName, undefined, {
                    sensitivity: "base",
                });
                break;
            }
            case "approvedLimit": {
                c = (a.approvedLimit ?? 0) - (b.approvedLimit ?? 0);
                break;
            }
            case "limitType": {
                c = (a.limitType || "").localeCompare(b.limitType || "");
                break;
            }
            case "totalAR": {
                c = a.totalAR - b.totalAR;
                break;
            }
            case "scoreExpiresInDays": {
                c = (a.scoreExpiresInDays ?? 0) - (b.scoreExpiresInDays ?? 0);
                break;
            }
            case "limitExpiresInDays": {
                c = (a.limitExpiresInDays ?? Infinity) - (b.limitExpiresInDays ?? Infinity);
                break;
            }
            default: {
                c = a.customerId - b.customerId;
            }
        }
        if (c !== 0) {
            return c * sign;
        }
        return a.customerId - b.customerId;
    });
}
async function getLimitWarningReport(accountId, take, skip, options = {}) {
    const [accountCur, accountSettings] = await Promise.all([
        getAccountDisplayCurrency(accountId),
        domain_db_1.prisma.account.findUnique({
            where: { id: accountId },
            select: {
                customer_limit_expiration_warning_days: true,
                credit_limit_warning_threshold_pct: true,
                credit_score_validity_warning_days: true,
            },
        }),
    ]);
    const thresholdPct = Math.min(100, Math.max(1, accountSettings?.credit_limit_warning_threshold_pct ??
        DEFAULT_LIMIT_WARN_THRESHOLD_PCT));
    const scoreWarnDays = Math.max(0, accountSettings?.credit_score_validity_warning_days ??
        DEFAULT_SCORE_VALIDITY_WARN_DAYS);
    const limitExpirationWarnDays = Math.max(0, accountSettings?.customer_limit_expiration_warning_days ?? 0);
    const [allRaw, openArByCustomer] = await Promise.all([
        domain_db_1.prisma.customer.findMany({
            where: customersScoped(accountId, options.policyId, options.businessUnitFilter),
            select: {
                id: true,
                customer_number: true,
                total_due_amount: true,
                total_overdue_amount: true,
                customer_due_currency1: true,
                customer_due_currency2: true,
                customer_overdue_currency1: true,
                customer_overdue_currency2: true,
                Person: { select: { full_name: true } },
                Company: { select: { name: true } },
            },
        }),
        fetchOpenReceivableByCustomerMap(accountId, options.policyId),
    ]);
    const { enrichCustomersWithPolicyScope } = await Promise.resolve().then(() => __importStar(require("./enrichCustomersWithActivePolicy")));
    const all = (await enrichCustomersWithPolicyScope(allRaw, options.policyId));
    const accountHasTopUp = await (0, hasTopUpPolicies_1.hasTopUpPolicies)(accountId);
    const effectiveLimitByCustomerId = accountHasTopUp
        ? await buildEffectiveLimitByCustomerIdInAccountCurrency(accountCur, all, openArByCustomer)
        : new Map();
    const built = [];
    for (const c of all) {
        const row = buildLimitWarningRow(c, accountCur, thresholdPct, scoreWarnDays, limitExpirationWarnDays, openArByCustomer.get(c.id) ?? 0, {
            useEffectiveLimit: accountHasTopUp,
            effectiveLimitInAccountCurrency: effectiveLimitByCustomerId.get(c.id),
        });
        if (row) {
            built.push(row);
        }
    }
    const q = options.query?.trim();
    let filtered = built;
    if (q) {
        filtered = built.filter((r) => {
            const tq = q.toLowerCase();
            return (r.customerName.toLowerCase().includes(tq) ||
                (r.policyNumber || "").toLowerCase().includes(tq));
        });
    }
    const sortField = options.sortField || "totalAR";
    const sortDirection = options.sortDirection || "desc";
    const sorted = sortLimitWarningRows(filtered, sortField, sortDirection);
    const total = sorted.length;
    const page = sorted.slice(skip, skip + take);
    return { total, rows: page };
}
async function getZeroLimitWarningReport(accountId, take, skip, options = {}) {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const searchWhere = buildCustomerTextSearchWhere(options.query);
    const whereCust = {
        AND: [
            customersScoped(accountId, options.policyId, options.businessUnitFilter),
            {
                CustomerPolicy: {
                    some: {
                        is_active: true,
                        approved_limit: 0,
                        insurance_policy_id: options.policyId != null ? options.policyId : { not: null },
                    },
                },
            },
            ...(options.customerId != null ? [{ id: options.customerId }] : []),
            ...(searchWhere ? [searchWhere] : []),
        ],
    };
    const [allRaw, openArByCustomer] = await Promise.all([
        domain_db_1.prisma.customer.findMany({
            where: whereCust,
            select: {
                id: true,
                customer_number: true,
                total_due_amount: true,
                total_overdue_amount: true,
                customer_due_currency1: true,
                customer_due_currency2: true,
                customer_overdue_currency1: true,
                customer_overdue_currency2: true,
                Person: { select: { full_name: true } },
                Company: { select: { name: true } },
            },
        }),
        fetchOpenReceivableByCustomerMap(accountId, options.policyId),
    ]);
    const { enrichCustomersWithPolicyScope } = await Promise.resolve().then(() => __importStar(require("./enrichCustomersWithActivePolicy")));
    const enriched = await enrichCustomersWithPolicyScope(allRaw, options.policyId);
    if (enriched.length === 0) {
        return { total: 0, rows: [] };
    }
    const ids = enriched.map((c) => c.id);
    const invoiceScope = scopedInvoiceWhere(accountId, options.policyId);
    const openCounts = await domain_db_1.prisma.invoice.groupBy({
        by: ["customer_id"],
        where: {
            ...invoiceScope,
            customer_id: { in: ids },
            status: { notIn: CLOSED_INVOICE_STATUS },
        },
        _count: { _all: true },
    });
    const openMap = new Map();
    for (const g of openCounts) {
        if (g.customer_id != null) {
            openMap.set(g.customer_id, g._count._all);
        }
    }
    const built = enriched.map((c) => {
        return {
            customerId: c.id,
            policyNumber: c.InsurancePolicy?.policy_number ?? null,
            customerName: customerNameFromRow(c),
            zeroLimitDate: c.zero_limit_date
                ? new Date(c.zero_limit_date).toISOString().slice(0, 10)
                : null,
            totalAR: openArByCustomer.get(c.id) ?? 0,
            openInvoices: openMap.get(c.id) ?? 0,
            currency: displayCurrencyForCustomer(c, c.InsurancePolicy?.currency, accountCur),
        };
    });
    const sortField = options.sortField || "totalAR";
    const sortDirection = options.sortDirection || "desc";
    const sorted = sortZeroLimitWarningRows(built, sortField, sortDirection);
    const total = sorted.length;
    const page = sorted.slice(skip, skip + take);
    return { total, rows: page };
}
function sortZeroLimitWarningRows(rows, sortField, sortDirection) {
    const sign = sortDirection === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        let c = 0;
        switch (sortField) {
            case "policyNumber": {
                c = (a.policyNumber || "").localeCompare(b.policyNumber || "");
                break;
            }
            case "customerName": {
                c = a.customerName.localeCompare(b.customerName, undefined, {
                    sensitivity: "base",
                });
                break;
            }
            case "zeroLimitDate": {
                c = (a.zeroLimitDate || "").localeCompare(b.zeroLimitDate || "");
                break;
            }
            case "totalAR": {
                c = a.totalAR - b.totalAR;
                break;
            }
            case "openInvoices": {
                c = a.openInvoices - b.openInvoices;
                break;
            }
            default: {
                c = a.customerId - b.customerId;
            }
        }
        if (c !== 0) {
            return c * sign;
        }
        return a.customerId - b.customerId;
    });
}
//# sourceMappingURL=creditInsuranceDashboardService.js.map