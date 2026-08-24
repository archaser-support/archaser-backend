"use strict";
/**
 * Post-query enrichment for credit dashboard ViewBased customer reports.
 * Supplies legacy CreditInsuranceReportGrid metrics (open AR, policy risk, etc.).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CREDIT_DASHBOARD_ENRICHED_CUSTOMER_FIELDS = void 0;
exports.isCreditDashboardEnrichedCustomerField = isCreditDashboardEnrichedCustomerField;
exports.reportConfigNeedsCreditDashboardEnrichment = reportConfigNeedsCreditDashboardEnrichment;
exports.formatLimitWarningSummary = formatLimitWarningSummary;
exports.enrichCreditDashboardCustomerRows = enrichCreditDashboardCustomerRows;
exports.fetchTopUpExpiringReportAsCustomerRows = fetchTopUpExpiringReportAsCustomerRows;
exports.isCreditDashboardEnrichedSortField = isCreditDashboardEnrichedSortField;
exports.sortCreditDashboardEnrichedRows = sortCreditDashboardEnrichedRows;
const client_1 = require("@prisma/client");
const domain_db_1 = require("../domain-db");
const reportExecutionVirtualFields_stub_1 = require("./reportExecutionVirtualFields-stub");
const reportCustomerPolicyFields_stub_1 = require("./reportCustomerPolicyFields-stub");
const invoiceInsuranceFields_1 = require("./invoiceInsuranceFields");
const creditInsuranceDashboardService_1 = require("./creditInsuranceDashboardService");
const creditInsuranceTopUpDashboardService_1 = require("./creditInsuranceTopUpDashboardService");
const CLOSED_INVOICE_STATUS = [
    client_1.invoice_status.Paid,
    client_1.invoice_status.Void,
    client_1.invoice_status.Cancelled,
];
exports.CREDIT_DASHBOARD_ENRICHED_CUSTOMER_FIELDS = new Set([
    "open_receivable_amount",
    "open_invoice_count",
    "terms_breach_outstanding",
    "policy_risk_allocated",
    "limit_warning_summary",
    "top_up_type",
    "top_up_value",
    "top_up_resolved_amount",
    "top_up_end_date",
    "top_up_days_left",
]);
function isCreditDashboardEnrichedCustomerField(field) {
    return exports.CREDIT_DASHBOARD_ENRICHED_CUSTOMER_FIELDS.has(field);
}
function reportConfigNeedsCreditDashboardEnrichment(fields) {
    if (!fields?.length) {
        return false;
    }
    return fields.some((f) => f.table === "Customer" &&
        f.field != null &&
        exports.CREDIT_DASHBOARD_ENRICHED_CUSTOMER_FIELDS.has(f.field));
}
function scopedInvoiceWhere(accountId, policyId) {
    const base = { account_id: accountId };
    if (policyId != null) {
        return { ...base, policy_id: policyId };
    }
    return base;
}
async function fetchTermsBreachOutstandingByCustomer(accountId, policyId, excludeCapacityGapInvoices) {
    const line = excludeCapacityGapInvoices
        ? client_1.Prisma.sql `GREATEST(
            0,
            (
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ) - COALESCE(i.capacity_gap_amount, 0)
          )`
        : client_1.Prisma.sql `
            CASE
              WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
              ELSE COALESCE(i.customer_outstanding_debt, 0)
            END
          `;
    const rows = policyId != null
        ? await domain_db_1.prisma.$queryRaw `
        SELECT i.customer_id,
          COALESCE(SUM(${line}), 0)::float AS t
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
        : await domain_db_1.prisma.$queryRaw `
        SELECT i.customer_id,
          COALESCE(SUM(${line}), 0)::float AS t
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        WHERE i.account_id = ${accountId}
          AND c.account_id = ${accountId}
          AND c.collection_status IN ('Active', 'Inactive')
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
    const map = new Map();
    for (const row of rows) {
        map.set(row.customer_id, row.t ?? 0);
    }
    return map;
}
async function fetchOpenInvoiceCountByCustomer(accountId, customerIds, policyId) {
    if (customerIds.length === 0) {
        return new Map();
    }
    const invoiceScope = scopedInvoiceWhere(accountId, policyId);
    const openCounts = await domain_db_1.prisma.invoice.groupBy({
        by: ["customer_id"],
        where: {
            ...invoiceScope,
            customer_id: { in: customerIds },
            status: { notIn: CLOSED_INVOICE_STATUS },
        },
        _count: { _all: true },
    });
    const map = new Map();
    for (const g of openCounts) {
        if (g.customer_id != null) {
            map.set(g.customer_id, g._count._all);
        }
    }
    return map;
}
const LIMIT_WARNING_LABELS = {
    en: {
        nearLimit: (pct) => `At ${pct}% of approved limit`,
        scoreExp: (days) => `Credit score validity in ${days}d`,
        limitExp: (days) => `Approved limit expires in ${days} day(s)`,
    },
    he: {
        nearLimit: (pct) => `${pct}% ממסגרת מאושרת`,
        scoreExp: (days) => `תוקף ציון אשראי בעוד ${days} ימים`,
        limitExp: (days) => `תוקף המסגרת יפוג בעוד ${days} ימים`,
    },
};
function formatLimitWarningSummary(row, accountLanguage) {
    const language = (0, reportExecutionVirtualFields_stub_1.resolveAccountDisplayLanguage)(accountLanguage);
    const labels = LIMIT_WARNING_LABELS[language] ?? LIMIT_WARNING_LABELS.en;
    const parts = [];
    if (row.nearLimit && row.nearLimitUtilizationPct != null) {
        parts.push(labels.nearLimit(row.nearLimitUtilizationPct));
    }
    if (row.scoreExpiring) {
        parts.push(labels.scoreExp(row.scoreExpiresInDays ?? 0));
    }
    if (row.limitExpiring) {
        parts.push(labels.limitExp(row.limitExpiresInDays ?? 0));
    }
    return parts.join(" · ");
}
async function enrichCreditDashboardCustomerRows(rows, options) {
    if (rows.length === 0) {
        return rows;
    }
    const fields = new Set(options.requestedFields);
    const customerIds = rows
        .map((r) => r.id)
        .filter((id) => Number.isFinite(id));
    const needsOpenAr = fields.has("open_receivable_amount") ||
        fields.has("policy_risk_allocated");
    const needsOpenInvoices = fields.has("open_invoice_count");
    const needsTermsBreach = fields.has("terms_breach_outstanding") ||
        fields.has("policy_risk_allocated");
    const needsPolicyRisk = fields.has("policy_risk_allocated");
    const needsWarningSummary = fields.has("limit_warning_summary");
    const [openArByCustomer, openInvoiceByCustomer, termsOutstandingByCustomer, termsForAtRiskByCustomer,] = await Promise.all([
        needsOpenAr || needsPolicyRisk
            ? (0, creditInsuranceDashboardService_1.fetchOpenReceivableByCustomerMap)(options.accountId, options.policyId)
            : Promise.resolve(new Map()),
        needsOpenInvoices
            ? fetchOpenInvoiceCountByCustomer(options.accountId, customerIds, options.policyId)
            : Promise.resolve(new Map()),
        needsTermsBreach
            ? fetchTermsBreachOutstandingByCustomer(options.accountId, options.policyId, false)
            : Promise.resolve(new Map()),
        needsPolicyRisk
            ? fetchTermsBreachOutstandingByCustomer(options.accountId, options.policyId, true)
            : Promise.resolve(new Map()),
    ]);
    return rows.map((row) => {
        const customerId = row.id;
        const enriched = { ...row };
        if (fields.has("open_receivable_amount")) {
            enriched.open_receivable_amount =
                openArByCustomer.get(customerId) ?? 0;
        }
        if (fields.has("open_invoice_count")) {
            enriched.open_invoice_count =
                openInvoiceByCustomer.get(customerId) ?? 0;
        }
        if (fields.has("terms_breach_outstanding")) {
            enriched.terms_breach_outstanding =
                termsOutstandingByCustomer.get(customerId) ?? 0;
        }
        if (fields.has("policy_risk_allocated")) {
            const ar = openArByCustomer.get(customerId) ?? 0;
            const gapRaw = (0, reportCustomerPolicyFields_stub_1.extractCustomerPolicyReportField)(row, "capacity_gap_amount");
            const gap = gapRaw == null || gapRaw === ""
                ? 0
                : Number(gapRaw);
            const tbForAtRisk = termsForAtRiskByCustomer.get(customerId) ?? 0;
            enriched.policy_risk_allocated = (0, invoiceInsuranceFields_1.computeCustomerRiskExposure)({
                totalAr: ar,
                capacityGapAmount: Number.isFinite(gap) ? gap : 0,
                termsBreachOutstanding: tbForAtRisk,
            });
        }
        if (needsWarningSummary && options.limitWarningByCustomerId) {
            const warningRow = options.limitWarningByCustomerId.get(customerId);
            enriched.limit_warning_summary = warningRow
                ? formatLimitWarningSummary(warningRow, options.accountLanguage)
                : "";
        }
        return enriched;
    });
}
/**
 * Legacy top-up expiring list is one row per CustomerTopUp (not per Customer).
 */
async function fetchTopUpExpiringReportAsCustomerRows(options) {
    const skip = ((options.page || 1) - 1) * (options.limit || 20);
    const sortDirection = options.sortDirection?.toLowerCase() === "asc" ? "asc" : "desc";
    const sortFieldMap = {
        top_up_days_left: "daysLeft",
        top_up_type: "topUpType",
        top_up_value: "topUpValue",
        top_up_resolved_amount: "resolvedAmount",
        top_up_end_date: "endDate",
        "InsurancePolicy.policy_number": "policyNumber",
        name: "customerName",
    };
    const legacySortField = sortFieldMap[options.sortField ?? ""] ?? options.sortField ?? "daysLeft";
    const { total, rows } = await (0, creditInsuranceTopUpDashboardService_1.getTopUpExpiringReport)(options.accountId, options.limit || 20, skip, {
        query: options.search,
        sortField: legacySortField,
        sortDirection,
        policyId: options.policyId,
        customerId: options.customerId,
        withinDays: options.withinDays ?? 30,
        businessUnitFilter: options.businessUnitFilter,
    });
    const mapped = rows.map((row, index) => ({
        id: row.customerId * 1_000_000 + skip + index,
        customer_id: row.customerId,
        name: row.customerName ||
            (row.policyNumber ? String(row.customerId) : String(row.customerId)),
        open_receivable_amount: null,
        top_up_type: row.topUpType,
        top_up_value: row.topUpValue,
        top_up_resolved_amount: row.resolvedAmount,
        top_up_end_date: row.endDate,
        top_up_days_left: row.daysLeft,
        CustomerPolicy: [
            {
                is_active: true,
                InsurancePolicy: {
                    policy_number: row.policyNumber,
                    currency: row.currency,
                },
            },
        ],
        Person: null,
        Company: row.customerName ? { name: row.customerName } : null,
    }));
    return { total, rows: mapped };
}
const ENRICHED_IN_MEMORY_SORT_FIELDS = new Set([
    "open_receivable_amount",
    "open_invoice_count",
    "terms_breach_outstanding",
    "policy_risk_allocated",
    "top_up_days_left",
    "top_up_value",
    "top_up_resolved_amount",
]);
function isCreditDashboardEnrichedSortField(field) {
    return field != null && ENRICHED_IN_MEMORY_SORT_FIELDS.has(field);
}
function sortCreditDashboardEnrichedRows(rows, sortField, sortDirection = "desc") {
    const sign = String(sortDirection).toLowerCase() === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = a[sortField];
        const bv = b[sortField];
        if (av == null && bv == null) {
            return 0;
        }
        if (av == null) {
            return 1 * sign;
        }
        if (bv == null) {
            return -1 * sign;
        }
        if (typeof av === "number" && typeof bv === "number") {
            return (av - bv) * sign;
        }
        return String(av).localeCompare(String(bv), undefined, {
            sensitivity: "base",
        }) * sign;
    });
}
