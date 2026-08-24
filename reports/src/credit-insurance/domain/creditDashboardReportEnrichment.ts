/**
 * Post-query enrichment for credit dashboard ViewBased customer reports.
 * Supplies legacy CreditInsuranceReportGrid metrics (open AR, policy risk, etc.).
 */

import { Prisma, invoice_status as InvoiceStatus } from "@prisma/client";
import type { invoice_status } from "@prisma/client";

import { prisma } from "../domain-db";
import { resolveAccountDisplayLanguage } from "./reportExecutionVirtualFields-stub";
import { extractCustomerPolicyReportField } from "./reportCustomerPolicyFields-stub";
import { computeCustomerRiskExposure } from "./invoiceInsuranceFields";

import {
    fetchOpenReceivableByCustomerMap,
    type LimitWarningRow,
} from "./creditInsuranceDashboardService";
import { getTopUpExpiringReport } from "./creditInsuranceTopUpDashboardService";

const CLOSED_INVOICE_STATUS: invoice_status[] = [
    InvoiceStatus.Paid,
    InvoiceStatus.Void,
    InvoiceStatus.Cancelled,
];

export const CREDIT_DASHBOARD_ENRICHED_CUSTOMER_FIELDS = new Set([
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

export function isCreditDashboardEnrichedCustomerField(
    field: string
): boolean {
    return CREDIT_DASHBOARD_ENRICHED_CUSTOMER_FIELDS.has(field);
}

export function reportConfigNeedsCreditDashboardEnrichment(
    fields: Array<{ table?: string; field?: string }> | undefined
): boolean {
    if (!fields?.length) {
        return false;
    }
    return fields.some(
        (f) =>
            f.table === "Customer" &&
            f.field != null &&
            CREDIT_DASHBOARD_ENRICHED_CUSTOMER_FIELDS.has(f.field)
    );
}

function scopedInvoiceWhere(
    accountId: number,
    policyId?: number
): Prisma.InvoiceWhereInput {
    const base: Prisma.InvoiceWhereInput = { account_id: accountId };
    if (policyId != null) {
        return { ...base, policy_id: policyId };
    }
    return base;
}

type TermsBreachByCustomerRow = { customer_id: number; t: number | null };

async function fetchTermsBreachOutstandingByCustomer(
    accountId: number,
    policyId: number | undefined,
    excludeCapacityGapInvoices: boolean
): Promise<Map<number, number>> {
    const line = excludeCapacityGapInvoices
        ? Prisma.sql`GREATEST(
            0,
            (
              CASE
                WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
                ELSE COALESCE(i.customer_outstanding_debt, 0)
              END
            ) - COALESCE(i.capacity_gap_amount, 0)
          )`
        : Prisma.sql`
            CASE
              WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
              ELSE COALESCE(i.customer_outstanding_debt, 0)
            END
          `;
    const rows =
        policyId != null
            ? await prisma.$queryRaw<TermsBreachByCustomerRow[]>`
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
            : await prisma.$queryRaw<TermsBreachByCustomerRow[]>`
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

    const map = new Map<number, number>();
    for (const row of rows) {
        map.set(row.customer_id, row.t ?? 0);
    }
    return map;
}

async function fetchOpenInvoiceCountByCustomer(
    accountId: number,
    customerIds: number[],
    policyId?: number
): Promise<Map<number, number>> {
    if (customerIds.length === 0) {
        return new Map();
    }
    const invoiceScope = scopedInvoiceWhere(accountId, policyId);
    const openCounts = await prisma.invoice.groupBy({
        by: ["customer_id"],
        where: {
            ...invoiceScope,
            customer_id: { in: customerIds },
            status: { notIn: CLOSED_INVOICE_STATUS },
        },
        _count: { _all: true },
    });
    const map = new Map<number, number>();
    for (const g of openCounts) {
        if (g.customer_id != null) {
            map.set(g.customer_id, g._count._all);
        }
    }
    return map;
}

const LIMIT_WARNING_LABELS = {
    en: {
        nearLimit: (pct: number) => `At ${pct}% of approved limit`,
        scoreExp: (days: number) => `Credit score validity in ${days}d`,
        limitExp: (days: number) =>
            `Approved limit expires in ${days} day(s)`,
    },
    he: {
        nearLimit: (pct: number) => `${pct}% ממסגרת מאושרת`,
        scoreExp: (days: number) => `תוקף ציון אשראי בעוד ${days} ימים`,
        limitExp: (days: number) => `תוקף המסגרת יפוג בעוד ${days} ימים`,
    },
} as const;

export function formatLimitWarningSummary(
    row: Pick<
        LimitWarningRow,
        | "nearLimit"
        | "nearLimitUtilizationPct"
        | "scoreExpiring"
        | "scoreExpiresInDays"
        | "limitExpiring"
        | "limitExpiresInDays"
    >,
    accountLanguage?: string | null
): string {
    const language = resolveAccountDisplayLanguage(accountLanguage) as
        keyof typeof LIMIT_WARNING_LABELS;
    const labels =
        LIMIT_WARNING_LABELS[language] ?? LIMIT_WARNING_LABELS.en;
    const parts: string[] = [];
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

export interface CreditDashboardEnrichmentOptions {
    accountId: number;
    policyId?: number;
    accountLanguage?: string | null;
    requestedFields: string[];
    limitWarningByCustomerId?: Map<number, LimitWarningRow>;
}

export async function enrichCreditDashboardCustomerRows(
    rows: any[],
    options: CreditDashboardEnrichmentOptions
): Promise<any[]> {
    if (rows.length === 0) {
        return rows;
    }
    const fields = new Set(options.requestedFields);
    const customerIds = rows
        .map((r) => r.id as number)
        .filter((id) => Number.isFinite(id));

    const needsOpenAr =
        fields.has("open_receivable_amount") ||
        fields.has("policy_risk_allocated");
    const needsOpenInvoices = fields.has("open_invoice_count");
    const needsTermsBreach =
        fields.has("terms_breach_outstanding") ||
        fields.has("policy_risk_allocated");
    const needsPolicyRisk = fields.has("policy_risk_allocated");
    const needsWarningSummary = fields.has("limit_warning_summary");

    const [
        openArByCustomer,
        openInvoiceByCustomer,
        termsOutstandingByCustomer,
        termsForAtRiskByCustomer,
    ] = await Promise.all([
        needsOpenAr || needsPolicyRisk
            ? fetchOpenReceivableByCustomerMap(
                  options.accountId,
                  options.policyId
              )
            : Promise.resolve(new Map<number, number>()),
        needsOpenInvoices
            ? fetchOpenInvoiceCountByCustomer(
                  options.accountId,
                  customerIds,
                  options.policyId
              )
            : Promise.resolve(new Map<number, number>()),
        needsTermsBreach
            ? fetchTermsBreachOutstandingByCustomer(
                  options.accountId,
                  options.policyId,
                  false
              )
            : Promise.resolve(new Map<number, number>()),
        needsPolicyRisk
            ? fetchTermsBreachOutstandingByCustomer(
                  options.accountId,
                  options.policyId,
                  true
              )
            : Promise.resolve(new Map<number, number>()),
    ]);

    return rows.map((row) => {
        const customerId = row.id as number;
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
            const gapRaw = extractCustomerPolicyReportField(
                row,
                "capacity_gap_amount"
            );
            const gap =
                gapRaw == null || gapRaw === ""
                    ? 0
                    : Number(gapRaw);
            const tbForAtRisk = termsForAtRiskByCustomer.get(customerId) ?? 0;
            enriched.policy_risk_allocated = computeCustomerRiskExposure({
                totalAr: ar,
                capacityGapAmount: Number.isFinite(gap) ? gap : 0,
                termsBreachOutstanding: tbForAtRisk,
            });
        }
        if (needsWarningSummary && options.limitWarningByCustomerId) {
            const warningRow = options.limitWarningByCustomerId.get(customerId);
            enriched.limit_warning_summary = warningRow
                ? formatLimitWarningSummary(
                      warningRow,
                      options.accountLanguage
                  )
                : "";
        }

        return enriched;
    });
}

export interface TopUpExpiringReportExecutionOptions {
    accountId: number;
    page: number;
    limit: number;
    search?: string;
    sortField?: string;
    sortDirection?: "ASC" | "DESC";
    policyId?: number;
    customerId?: number;
    withinDays?: number;
    businessUnitFilter?: Prisma.CustomerWhereInput;
}

/**
 * Legacy top-up expiring list is one row per CustomerTopUp (not per Customer).
 */
export async function fetchTopUpExpiringReportAsCustomerRows(
    options: TopUpExpiringReportExecutionOptions
): Promise<{ total: number; rows: any[] }> {
    const skip = ((options.page || 1) - 1) * (options.limit || 20);
    const sortDirection =
        options.sortDirection?.toLowerCase() === "asc" ? "asc" : "desc";

    const sortFieldMap: Record<string, string> = {
        top_up_days_left: "daysLeft",
        top_up_type: "topUpType",
        top_up_value: "topUpValue",
        top_up_resolved_amount: "resolvedAmount",
        top_up_end_date: "endDate",
        "InsurancePolicy.policy_number": "policyNumber",
        name: "customerName",
    };
    const legacySortField =
        sortFieldMap[options.sortField ?? ""] ?? options.sortField ?? "daysLeft";

    const { total, rows } = await getTopUpExpiringReport(
        options.accountId,
        options.limit || 20,
        skip,
        {
            query: options.search,
            sortField: legacySortField,
            sortDirection,
            policyId: options.policyId,
            customerId: options.customerId,
            withinDays: options.withinDays ?? 30,
            businessUnitFilter: options.businessUnitFilter,
        }
    );

    const mapped = rows.map((row, index) => ({
        id: row.customerId * 1_000_000 + skip + index,
        customer_id: row.customerId,
        name:
            row.customerName ||
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

export function isCreditDashboardEnrichedSortField(
    field: string | undefined
): boolean {
    return field != null && ENRICHED_IN_MEMORY_SORT_FIELDS.has(field);
}

export function sortCreditDashboardEnrichedRows(
    rows: any[],
    sortField: string,
    sortDirection: "asc" | "desc" | "ASC" | "DESC" = "desc"
): any[] {
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
