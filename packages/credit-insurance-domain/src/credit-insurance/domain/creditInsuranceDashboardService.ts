import { Prisma, invoice_status, record_status } from "@prisma/client";
import { addDays, addMonths, differenceInCalendarDays, startOfDay } from "date-fns";

import { prisma } from "../domain-db";
import { resolveCustomerFirstCurrency } from "./stringFormatters-stub";

import { convertAmountToCurrencyLatestRate } from "./customerCreditInsuranceHeaderAmounts";
import {
    computeInvoiceLineOpenArInAccountCurrency,
    fetchOpenReceivableByCustomerMapInAccountCurrency,
    fetchOpenReceivableForCustomerByCurrency,
    resolveInvoiceLineOutstandingInAccountCurrency,
} from "./openReceivableByCustomerCurrency";
import {
    ACTIVE_CUSTOMER_POLICY_NESTED_SELECT,
    applyBusinessUnitFilterToInvoiceWhere,
    customerPolicyTextSearchOr,
    customersScopedForCreditDashboardWithBusinessUnit,
    hasDashboardBusinessUnitScope,
    mergeDashboardBusinessUnitIntoCustomerScope,
    invoiceLinkedPolicyTextSearchOr,
    policyDisplayFromCustomerRow,
    policyDisplayFromInvoiceRow,
    withInvoiceCustomerPolicyFilter,
} from "./customerPolicyQueryHelpers";
import {
    computeCustomerRiskExposure,
    computeCustomerTotalAr,
    computeInvoiceCapacityGapContribution,
    isNearLimitUtilizationWarning,
    invoiceOutstandingLeft,
    invoiceOutstandingInAccountCurrency,
    sumInvoiceCapacityGapContributions,
    type InvoiceForCapacityGapSum,
} from "./invoiceInsuranceFields";
import {
    computeTopUpDashboardMetrics,
    type TopUpDashboardBlock,
    type TopUpExpiringSoonAlert,
} from "./creditInsuranceTopUpDashboardService";
import {
    aggregatePortfolioPolicyLimitUsage,
    type PolicyLimitUsageCategoryTotals,
    type PolicyLimitUsageRowInput,
} from "./portfolioPolicyLimitUsage";
import { hasTopUpPolicies } from "./hasTopUpPolicies";
import {
    fetchCustomerImplicitBasePerLimitUnit,
    sumCustomerPolicyCapacityGapForAccount,
} from "./invoiceCapacityGapAmounts";
import { resolveEffectiveApprovedLimit } from "./resolveEffectiveApprovedLimit";
import { storedCapacityGapAmount } from "./policyGapAmounts";
import {
    aggregatePortfolioTermsBreachFromInvoices,
} from "./termBreachResolver";
import {
    isNoPolicyExposureCardCustomer,
    isUncoveredExposureCustomer,
} from "./policyExclusion";

const COLLECTION_LIVE: record_status[] = [record_status.Active, record_status.Inactive];
const DEFAULT_REPORTING_WINDOW_DAYS = 14;
const DEFAULT_LIMIT_WARN_THRESHOLD_PCT = 80;
const DEFAULT_SCORE_VALIDITY_WARN_DAYS = 30;

const CLOSED_INVOICE_STATUS: invoice_status[] = [
    invoice_status.Paid,
    invoice_status.Void,
    invoice_status.Cancelled,
];

const TERMS_BREACH_OR: Prisma.InvoiceWhereInput[] = [
    { reporting_breach: true },
    { ctv_payment_term: true },
    { ctv_customer_overdue_mep: true },
    { ctv_outdated_dcl: true },
    { ctv_invoice_after_policy_end: true },
];

function customerNameFromRow(
    c: { Person: { full_name: string | null } | null; Company: { name: string | null } | null }
): string {
    return c.Person?.full_name || c.Company?.name || "—";
}

function lineOutstanding(row: {
    outstanding_debt: number | null;
    customer_outstanding_debt: number | null;
    amount: number | null;
}): number {
    return invoiceOutstandingLeft(row);
}

/** Invoice-summed capacity gap for one customer policy (null → use stored policy fallback). */
export async function sumCustomerPolicyInvoiceCapacityGap(
    accountId: number,
    customerId: number,
    policyId: number
): Promise<{ total: number | null; hasMissingSnapshots: boolean }> {
    const invoices = (await (prisma.invoice.findMany as any)({
        where: {
            account_id: accountId,
            customer_id: customerId,
            policy_id: policyId,
            status: { in: [invoice_status.Due, invoice_status.Overdue] },
        },
        select: {
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
            limit_assessed_amount: true,
        },
    })) as InvoiceForCapacityGapSum[];
    return sumInvoiceCapacityGapContributions(invoices);
}

function totalArFromCustomerRow(c: {
    total_due_amount: number | null;
    total_overdue_amount: number | null;
}): number {
    return computeCustomerTotalAr(c).toNumber();
}

function customersScoped(
    accountId: number,
    policyId?: number,
    businessUnitFilter?: Prisma.CustomerWhereInput
): Prisma.CustomerWhereInput {
    return customersScopedForCreditDashboardWithBusinessUnit(
        accountId,
        policyId,
        businessUnitFilter
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

const TERMS_BREACH_REASON_FILTERS = [
    "reporting_breach",
    "ctv_payment_term",
    "ctv_customer_overdue_mep",
    "ctv_outdated_dcl",
    "ctv_invoice_after_policy_end",
] as const;

export type TermsBreachReasonFilter =
    (typeof TERMS_BREACH_REASON_FILTERS)[number];

export function isTermsBreachReasonFilter(
    value: string
): value is TermsBreachReasonFilter {
    return (TERMS_BREACH_REASON_FILTERS as readonly string[]).includes(value);
}

export type CreditReportListOptions = {
    query?: string;
    sortField?: string;
    sortDirection?: "asc" | "desc";
    /** When set, restrict rows to customers linked to this policy (must belong to the account). */
    policyId?: number;
    /** When set, restrict invoice reports to this customer (must belong to the account). */
    customerId?: number;
    /** Terms report only: single breach flag (matches `termsBreachReasonCodes` on rows). */
    termsBreachReason?: TermsBreachReasonFilter;
    /** Terms report only: Overdue invoices only (e.g. customer dashboard reporting breach KPI). */
    termsOverdueOnly?: boolean;
    /** Top-up expiring report: window in days (default 30). */
    withinDays?: number;
    /** Dashboard business-unit filter from {@link resolveDashboardBusinessUnitFilter}. */
    businessUnitFilter?: Prisma.CustomerWhereInput;
    /** Dashboard/report cohort toggle: include no-policy exposure cohort when true. */
    includeNoPolicyExposure?: boolean;
};

function buildCustomerTextSearchWhere(
    q: string | undefined
): Prisma.CustomerWhereInput | null {
    const t = q?.trim();
    if (!t) {
        return null;
    }
    return { OR: customerPolicyTextSearchOr(t) };
}

function customerRowMatchesQuery(
    c: {
        customer_number: string | null;
        customer_number_policy?: string | null;
        Person: { full_name: string | null } | null;
        Company: { name: string | null } | null;
        InsurancePolicy?: { policy_number: string | null } | null;
        CustomerPolicy?: Array<{
            customer_number_policy?: string | null;
            InsurancePolicy?: { policy_number: string | null } | null;
        }>;
    },
    q: string
): boolean {
    const t = q.trim().toLowerCase();
    if (!t) {
        return true;
    }
    const name = (c.Person?.full_name || c.Company?.name || "").toLowerCase();
    const policyDisplay = policyDisplayFromCustomerRow(c);
    const pol = (policyDisplay.policy_number || "").toLowerCase();
    const cn = (c.customer_number || "").toLowerCase();
    const cnp = (policyDisplay.customer_number_policy || "").toLowerCase();
    return (
        name.includes(t) || pol.includes(t) || cn.includes(t) || cnp.includes(t)
    );
}

function overdueOrderBy(
    sortField: string | undefined,
    sortDirection: "asc" | "desc" | undefined
): Prisma.Enumerable<Prisma.CustomerOrderByWithRelationInput> {
    const d: Prisma.SortOrder = sortDirection === "desc" ? "desc" : "asc";
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

/** Dashboard capacity gap from stored CustomerPolicy KPI rollup. */
function dashboardCapacityGapFromStored(c: {
    outdated_dcl?: boolean | null;
    approved_limit?: Prisma.Decimal | null;
    capacity_gap_amount?: number | null;
}): number {
    return storedCapacityGapAmount(c);
}

function capacityGapForCustomerAtRisk(
    c: {
        id: number;
        policy_id: number | null;
        outdated_dcl?: boolean | null;
        approved_limit?: Prisma.Decimal | null;
        capacity_gap_amount?: number | null;
    },
    _useInvoiceSnapshots: boolean,
    _invoiceGapByCustomerPolicy: Map<string, number>
): number {
    return dashboardCapacityGapFromStored(c);
}

function creditScoreExpiryOnCalendar(
    inputDate: Date | null | undefined,
    months: number | null | undefined
): Date | null {
    if (!inputDate || months == null || months <= 0) {
        return null;
    }
    return startOfDay(addMonths(inputDate, months));
}

type CustomerForEffectiveLimitResolution = {
    id: number;
    policy_id?: number | null;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency?: string | null;
    outdated_dcl?: boolean | null;
    excluded_from_policy?: boolean | null;
    InsurancePolicy?: unknown | null;
};

async function buildEffectiveLimitByCustomerIdInAccountCurrency(
    accountCurrency: string,
    customers: CustomerForEffectiveLimitResolution[],
    openArByCustomerId: Map<number, number>
): Promise<Map<number, number>> {
    const convertPolicyLimitToAccount = async (
        policyCurrency: string,
        amount: number
    ): Promise<number> => {
        if (!Number.isFinite(amount) || amount <= 0) {
            return 0;
        }
        if (policyCurrency === accountCurrency) {
            return amount;
        }
        const converted = await convertAmountToCurrencyLatestRate(
            policyCurrency,
            accountCurrency,
            amount
        );
        return converted ?? amount;
    };

    const effectiveLimitByCustomerId = new Map<number, number>();
    for (const c of customers) {
        if (
            c.InsurancePolicy == null ||
            c.approved_limit == null ||
            c.outdated_dcl === true ||
            c.excluded_from_policy === true
        ) {
            continue;
        }
        const ar = openArByCustomerId.get(c.id) ?? 0;
        if (ar <= 0) {
            continue;
        }
        const limitCurrency =
            c.approved_limit_currency?.trim().toUpperCase() ?? accountCurrency;
        const resolved = await resolveEffectiveApprovedLimit(c.id, {
            baseApprovedLimit: c.approved_limit,
            baseApprovedLimitCurrency: limitCurrency,
            outdatedDcl: c.outdated_dcl ?? false,
            excludedFromPolicy: c.excluded_from_policy ?? false,
            parentPrimaryPolicyId: c.policy_id ?? undefined,
        });
        const effectiveNum =
            resolved.effectiveApprovedLimit != null
                ? Number(resolved.effectiveApprovedLimit)
                : null;
        if (effectiveNum != null && effectiveNum > 0) {
            const effectiveInAccount = await convertPolicyLimitToAccount(
                limitCurrency,
                effectiveNum
            );
            effectiveLimitByCustomerId.set(c.id, effectiveInAccount);
        }
    }
    return effectiveLimitByCustomerId;
}

/** Customer at ≥ threshold % of limit but not over 100% (moves to capacity gap when over). */
function isNearLimitForWarning(
    c: {
        total_due_amount: number | null;
        total_overdue_amount: number | null;
        approved_limit: Prisma.Decimal | null;
        outdated_dcl?: boolean | null;
    },
    thresholdPct: number,
    openArOverride?: number,
    options?: {
        useEffectiveLimit?: boolean;
        effectiveLimitInAccountCurrency?: number | null;
    }
): boolean {
    const ar =
        openArOverride !== undefined
            ? openArOverride
            : totalArFromCustomerRow(c);
    const approvedNum =
        c.approved_limit != null
            ? new Prisma.Decimal(c.approved_limit).toNumber()
            : null;
    return isNearLimitUtilizationWarning({
        ar,
        approvedLimit: approvedNum,
        effectiveLimitInAccountCurrency: options?.effectiveLimitInAccountCurrency,
        useEffectiveLimit: options?.useEffectiveLimit,
        thresholdPct,
        outdatedDcl: c.outdated_dcl,
    });
}

function isCreditScoreExpiringInWindow(
    c: {
        credit_score_input_date: Date | null;
        InsurancePolicy: { score_validity_period_months: number | null } | null;
    },
    warnDays: number
): boolean {
    const months = c.InsurancePolicy?.score_validity_period_months;
    const expiry = creditScoreExpiryOnCalendar(c.credit_score_input_date, months);
    if (!expiry) {
        return false;
    }
    const today = startOfDay(new Date());
    const end = addDays(today, Math.max(0, warnDays));
    const t = expiry.getTime();
    return t >= today.getTime() && t <= end.getTime();
}

/**
 * Customer's approved_limit_expiration_date is between today and today + warnDays (inclusive).
 * Returns false when warnDays is 0 or no expiration date is set.
 */
function isLimitExpiringInWindow(
    c: { approved_limit_expiration_date: Date | null },
    warnDays: number
): boolean {
    if (!c.approved_limit_expiration_date || warnDays <= 0) {
        return false;
    }
    const today = startOfDay(new Date());
    const end = addDays(today, warnDays);
    const expiry = startOfDay(new Date(c.approved_limit_expiration_date));
    return expiry.getTime() >= today.getTime() && expiry.getTime() <= end.getTime();
}

/**
 * Invoices in terms breach: Due/Overdue with any breach flag or reporting_breach.
 */
export const invoiceTermsBreachWhere = (
    accountId: number
): Prisma.InvoiceWhereInput => ({
    account_id: accountId,
    status: { in: ["Due", "Overdue"] },
    amount: { gte: 0 },
    OR: TERMS_BREACH_OR,
});

function termsBreachOutstandingLineSql(netOfCapacityGap: boolean): Prisma.Sql {
    const outstanding = Prisma.sql`
        CASE
            WHEN COALESCE(i.outstanding_debt, 0) != 0 THEN i.outstanding_debt
            ELSE COALESCE(i.customer_outstanding_debt, 0)
        END
    `;
    if (!netOfCapacityGap) {
        return outstanding;
    }
    return Prisma.sql`GREATEST(0, (${outstanding}) - COALESCE(i.capacity_gap_amount, 0))`;
}

function termsBreachOutstandingLineSqlByCurrency(
    netOfCapacityGap: boolean
): Prisma.Sql {
    const outstanding = Prisma.sql`
        CASE
            WHEN COALESCE(i.customer_outstanding_debt, 0) != 0 THEN i.customer_outstanding_debt
            ELSE COALESCE(i.amount, 0)
        END
    `;
    if (!netOfCapacityGap) {
        return outstanding;
    }
    return Prisma.sql`GREATEST(0, (${outstanding}) - COALESCE(i.capacity_gap_amount_limit, 0))`;
}

/**
 * Sum of line outstanding for this customer's invoices in due/overdue terms breach
 * (same breach flags as the credit dashboard terms report).
 *
 * When {@link excludeCapacityGapInvoices} is true, each breached invoice contributes
 * outstanding minus its capacity gap so at-risk does not double-count.
 */
export async function getCustomerTermsBreachOutstandingSum(
    accountId: number,
    customerId: number,
    options?: {
        excludeCapacityGapInvoices?: boolean;
        /** When set, only Due/Overdue invoices tagged with this insurance policy. */
        policyId?: number;
    }
): Promise<number> {
    const line = termsBreachOutstandingLineSql(
        options?.excludeCapacityGapInvoices === true
    );
    const policyId = options?.policyId;
    const rows = await prisma.$queryRaw<{ t: number | null }[]>`
        SELECT COALESCE(SUM(${line}), 0)::float AS t
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND i.status IN ('Due', 'Overdue')
          AND i.amount >= 0
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
          ${policyId != null ? Prisma.sql`AND i.policy_id = ${policyId}` : Prisma.empty}
    `;
    return Number(rows[0]?.t ?? 0);
}

/** Terms-breach outstanding for at-risk (net of invoice capacity gap). */
export async function getCustomerTermsBreachOutstandingForAtRisk(
    accountId: number,
    customerId: number,
    options?: { policyId?: number }
): Promise<number> {
    return getCustomerTermsBreachOutstandingSum(accountId, customerId, {
        ...options,
        excludeCapacityGapInvoices: true,
    });
}

export type CustomerBreachInvoiceCounts = {
    reportingBreachInvoiceCount: number;
    overdueBlockInvoiceCount: number;
};

/** Open invoice counts for customer dashboard breach cards. */
export async function getCustomerBreachInvoiceCounts(
    accountId: number,
    customerId: number,
    options?: { policyId?: number }
): Promise<CustomerBreachInvoiceCounts> {
    const policyId = options?.policyId;
    const rows = await prisma.$queryRaw<
        {
            reporting_breach_count: number;
            overdue_block_invoice_count: number;
        }[]
    >`
        SELECT
            COUNT(*) FILTER (
                WHERE i.status = 'Overdue'
                  AND i.reporting_breach = true
                  AND i.amount >= 0
            )::int AS reporting_breach_count,
            COUNT(*) FILTER (
                WHERE i.status IN ('Due', 'Overdue')
                  AND i.ctv_customer_overdue_mep = true
                  AND i.amount >= 0
            )::int AS overdue_block_invoice_count
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          ${policyId != null ? Prisma.sql`AND i.policy_id = ${policyId}` : Prisma.empty}
    `;
    const row = rows[0];
    return {
        reportingBreachInvoiceCount: Number(row?.reporting_breach_count ?? 0),
        overdueBlockInvoiceCount: Number(row?.overdue_block_invoice_count ?? 0),
    };
}

/**
 * Terms-breach outstanding in a specific invoice/customer currency (e.g. GBP),
 * derived from invoice-side customer amounts, not FX conversion.
 */
export async function getCustomerTermsBreachOutstandingSumByCurrency(
    accountId: number,
    customerId: number,
    currency: string,
    options?: { excludeCapacityGapInvoices?: boolean; policyId?: number }
): Promise<number> {
    const code = currency.trim().toUpperCase();
    if (!code) {
        return 0;
    }
    const line = termsBreachOutstandingLineSqlByCurrency(
        options?.excludeCapacityGapInvoices === true
    );
    const policyId = options?.policyId;
    const rows = await prisma.$queryRaw<{ t: number | null }[]>`
        SELECT COALESCE(SUM(${line}), 0)::float AS t
        FROM "Invoice" i
        WHERE i.account_id = ${accountId}
          AND i.customer_id = ${customerId}
          AND UPPER(COALESCE(i.customer_currency, '')) = ${code}
          AND i.status IN ('Due', 'Overdue')
          AND i.amount >= 0
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
          ${policyId != null ? Prisma.sql`AND i.policy_id = ${policyId}` : Prisma.empty}
    `;
    return Number(rows[0]?.t ?? 0);
}

/** Terms-breach outstanding in invoice currency for at-risk (net of invoice capacity gap). */
export async function getCustomerTermsBreachOutstandingByCurrencyForAtRisk(
    accountId: number,
    customerId: number,
    currency: string,
    options?: { policyId?: number }
): Promise<number> {
    return getCustomerTermsBreachOutstandingSumByCurrency(
        accountId,
        customerId,
        currency,
        { ...options, excludeCapacityGapInvoices: true }
    );
}

type TermsBreachByCustomerRow = { customer_id: number; t: number | null };

type OpenArByCustomerRow = { customer_id: number; ar: number | null };

/**
 * Open Due/Overdue receivable per customer (same line-outstanding rule as dashboard terms SQL).
 * Prefer this over {@link totalArFromCustomerRow} for portfolio KPIs when customer denormalized
 * totals may lag invoice balances.
 */
export async function fetchOpenReceivableByCustomerMap(
    accountId: number,
    policyId?: number
): Promise<Map<number, number>> {
    const rows =
        policyId != null
            ? await prisma.$queryRaw<OpenArByCustomerRow[]>`
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
            : await prisma.$queryRaw<OpenArByCustomerRow[]>`
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
    const m = new Map<number, number>();
    for (const r of rows) {
        m.set(r.customer_id, Number(r.ar ?? 0));
    }
    return m;
}

export { fetchOpenReceivableForCustomerByCurrency } from "./openReceivableByCustomerCurrency";

/**
 * Open Due/Overdue receivable for one customer (same rule as {@link fetchOpenReceivableByCustomerMap} /
 * capacity-gap cron). Use for credit-insurance header when denormalized customer AR may disagree with invoices.
 */
export async function fetchOpenReceivableForCustomer(
    accountId: number,
    customerId: number,
    policyId?: number | null
): Promise<number> {
    const m = await fetchOpenReceivableByCustomerMap(
        accountId,
        policyId ?? undefined
    );
    return m.get(customerId) ?? 0;
}

/**
 * Open AR on a policy in the same currency as {@link CustomerPolicy.approved_limit}.
 * When limit currency matches account currency, uses account-currency invoice totals
 * (`outstanding_debt`). Otherwise sums invoice lines in the limit currency.
 */
export async function resolveOpenArOnPolicyInLimitCurrency(
    accountId: number,
    customerId: number,
    policyId: number,
    limitCurrency: string,
    accountCurrency: string | null
): Promise<number> {
    const limitCcy = limitCurrency.trim().toUpperCase();
    const acct = accountCurrency?.trim().toUpperCase() ?? "";
    if (limitCcy && acct && limitCcy === acct) {
        return fetchOpenReceivableForCustomer(accountId, customerId, policyId);
    }
    return fetchOpenReceivableForCustomerByCurrency(
        accountId,
        customerId,
        limitCcy,
        policyId
    );
}

/**
 * Terms-breach open outstanding per customer in account currency (latest FX).
 */
async function fetchTermsBreachOutstandingByCustomerInAccountCurrency(
    accountId: number,
    accountCurrency: string,
    policyId?: number,
    excludeCapacityGapInvoices?: boolean,
    businessUnitFilter?: Prisma.CustomerWhereInput
): Promise<Map<number, number>> {
    const accountCur = accountCurrency.trim().toUpperCase();
    const netOfGap = excludeCapacityGapInvoices === true;
    const invoices = await prisma.invoice.findMany({
        where: applyBusinessUnitFilterToInvoiceWhere(
            {
                account_id: accountId,
                status: { in: ["Due", "Overdue"] },
                ...(policyId != null ? { policy_id: policyId } : {}),
                Customer: {
                    account_id: accountId,
                    collection_status: { in: COLLECTION_LIVE },
                },
                OR: TERMS_BREACH_OR,
                amount: { gte: 0 },
            },
            businessUnitFilter
        ),
        select: {
            customer_id: true,
            outstanding_debt: true,
            customer_outstanding_debt: true,
            amount: true,
            customer_currency: true,
            capacity_gap_amount: true,
        },
    });

    const map = new Map<number, number>();
    for (const inv of invoices) {
        if (inv.customer_id == null) {
            continue;
        }
        const custCurrency = inv.customer_currency?.trim().toUpperCase();
        const hasAccountOutstanding =
            inv.outstanding_debt != null && inv.outstanding_debt !== 0;
        let converted: number | null | undefined;
        if (
            !hasAccountOutstanding &&
            custCurrency &&
            custCurrency !== accountCur
        ) {
            const custOutstanding =
                inv.customer_outstanding_debt != null
                    ? Number(inv.customer_outstanding_debt)
                    : 0;
            const amount = inv.amount != null ? Number(inv.amount) : 0;
            const val = custOutstanding !== 0 ? custOutstanding : amount;
            converted = await convertAmountToCurrencyLatestRate(
                custCurrency,
                accountCur,
                val
            );
        }
        let line = computeInvoiceLineOpenArInAccountCurrency(
            inv,
            accountCur,
            converted
        );
        if (netOfGap) {
            const gap = Math.max(0, Number(inv.capacity_gap_amount ?? 0));
            line = Math.max(0, line - gap);
        }
        map.set(inv.customer_id, (map.get(inv.customer_id) ?? 0) + line);
    }
    return map;
}

/**
 * Terms-breach outstanding grouped by customer.
 * When {@link excludeCapacityGapInvoices} is true, each line is outstanding
 * minus capacity gap so at-risk does not double-count.
 */
async function fetchTermsBreachOutstandingByCustomer(
    accountId: number,
    policyId?: number,
    excludeCapacityGapInvoices?: boolean
): Promise<Map<number, number>> {
    const line = termsBreachOutstandingLineSql(
        excludeCapacityGapInvoices === true
    );
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
          AND i.amount >= 0
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
        WHERE i.account_id = ${accountId}
          AND i.status IN ('Due', 'Overdue')
          AND i.amount >= 0
          AND (
            i.reporting_breach = true
            OR i.ctv_payment_term = true
            OR i.ctv_customer_overdue_mep = true
            OR i.ctv_outdated_dcl = true
            OR i.ctv_invoice_after_policy_end = true
          )
        GROUP BY i.customer_id
      `;
    const m = new Map<number, number>();
    for (const r of rows) {
        m.set(r.customer_id, Number(r.t ?? 0));
    }
    return m;
}

/** Invoice counts per breach flag (one invoice may contribute to multiple categories). */
export type TermsBreachCountByReason = {
    reportingBreach: number;
    paymentTerm: number;
    customerOverdueMep: number;
    outdatedDcl: number;
    invoiceAfterPolicyEnd: number;
};

export type CreditDashboardSummary = {
    healthIndex: number;
    totalReceivables: number;
    /**
     * Sum of per-customer compliant remainder: open AR minus allocated at-risk
     * (see atRiskExposure). Equals totalReceivables − atRiskExposure.
     */
    compliantExposure: number;
    /**
     * Sum of per-customer allocated at-risk: no-policy customers → full AR;
     * with policy → min(AR, capacity gap + terms breach outstanding);
     * plus portfolio limit residual: max(0, Σ policy max(0, policy AR − max cover) − capacity gap total).
     */
    atRiskExposure: number;
    /**
     * Sum of min(AR, gap + terms breach) for customers with a linked policy only.
     * Equals atRiskExposure minus withoutPolicy.totalAmount.
     */
    policyRiskExposure: number;
    /**
     * Insured customers in scope with open AR > 0 (same rows that feed {@link CreditDashboardSummary.policyRiskExposure}).
     */
    policyRiskExposureCustomerCount: number;
    /**
     * Uncapped driver sum: no-policy → full AR; with policy → capacity gap +
     * terms breach net of invoice capacity gap (before min with AR).
     */
    grossRiskExposure: number;
    overdueBlockCustomerCount: number;
    /** Sum of customer total AR (due + overdue) for customers in overdue block. */
    overdueBlockTotalOutstanding: number;
    capacityGap: {
        totalAmount: number;
        customerOverLimitCount: number;
    };
    termsBreach: {
        invoiceCount: number;
        totalAmount: number;
        /** Invoices per breach flag (counts may overlap across categories). */
        countByReason: TermsBreachCountByReason;
    };
    /** Customers with no linked policy: count and total open AR (treated as uninsured in at-risk logic). */
    withoutPolicy: {
        customerCount: number;
        totalAmount: number;
    };
    /** Invoices to report: open, not in breach, target within the next N days. */
    reportingCountdown: {
        invoiceCount: number;
        totalAmount: number;
        windowDays: number;
    };
    /** Unique customers: near limit (below 100% AR) and/or credit score expiring in window. */
    limitWarnings: {
        customerCount: number;
        totalAmount: number;
        thresholdPct: number;
        scoreWarnDays: number;
    };
    zeroLimitWarnings: {
        customerCount: number;
    };
    /** Account default currency for display (ISO code). */
    accountCurrency: string;
    hasTopUpPolicies: boolean;
    topUp: TopUpDashboardBlock | null;
    /**
     * Portfolio policy-limits usage: customer approved-limit categories
     * (combined / Named / DCL/SDL), not insurer policy max-cover caps.
     */
    policyUsage: {
        combined: PolicyLimitUsageCategoryTotals;
        named: PolicyLimitUsageCategoryTotals;
        dclSdl: PolicyLimitUsageCategoryTotals;
        topUpCoverTotal: number;
        topUpCoverUsed: number;
        topUpCoverRemaining: number;
        topUpCoverOverEffective: number;
    };
    policyMaxCoverAlerts: Array<{
        policyId: number;
        policyNumber: string | null;
        totalAr: number;
        maxCover: number;
        exceededAmount: number;
    }>;
    policyExpirationAlerts: Array<{
        policyId: number;
        policyNumber: string | null;
        endDate: string;
    }>;
    topUpExpirationAlerts: TopUpExpiringSoonAlert[];
};

export async function getAccountDisplayCurrency(accountId: number): Promise<string> {
    const a = await prisma.account.findUnique({
        where: { id: accountId },
        select: { currency: true },
    });
    return a?.currency && String(a.currency).trim()
        ? String(a.currency).trim()
        : "USD";
}

/** Approved limit converted to account display currency for portfolio reports. */
export async function convertApprovedLimitToAccountCurrency(
    amount: number | null | undefined,
    limitCurrency: string | null | undefined,
    accountCurrency: string,
    options?: {
        accountId?: number;
        customerId?: number;
        policyId?: number;
    }
): Promise<number | null> {
    if (amount == null || !Number.isFinite(amount)) {
        return null;
    }
    const accountCur = accountCurrency.trim().toUpperCase();
    const limitCcy = limitCurrency?.trim().toUpperCase() || accountCur;
    if (limitCcy === accountCur) {
        return amount;
    }

    if (options?.accountId != null && options.customerId != null) {
        const implicitBasePerLimitUnit =
            await fetchCustomerImplicitBasePerLimitUnit(
                options.accountId,
                options.customerId,
                limitCcy,
                accountCur,
                { policyId: options.policyId }
            );
        if (
            implicitBasePerLimitUnit != null &&
            Number.isFinite(implicitBasePerLimitUnit)
        ) {
            return amount * implicitBasePerLimitUnit;
        }
    }

    const converted = await convertAmountToCurrencyLatestRate(
        limitCcy,
        accountCur,
        amount
    );
    return converted ?? amount;
}

function displayCurrencyForCustomer(
    c: {
        customer_due_currency1: string | null;
        customer_due_currency2: string | null;
        customer_overdue_currency1: string | null;
        customer_overdue_currency2: string | null;
    },
    policyCurrency: string | null | undefined,
    accountCurrency: string
): string {
    return resolveCustomerFirstCurrency({
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

function reportingCountdownOpenWhere(
    accountId: number,
    windowDays: number
): Prisma.InvoiceWhereInput {
    const today = startOfDay(new Date());
    const lastInclusive = addDays(today, Math.max(0, windowDays));
    return {
        account_id: accountId,
        status: { in: [invoice_status.Due, invoice_status.Overdue] },
        target_reporting_date: { gte: today, lte: lastInclusive },
        actual_reporting_date: null,
        reporting_breach: false,
        amount: { gte: 0 },
    };
}

type TermsBreachSummaryAggRow = {
    c: number;
    t: number | null;
    cnt_reporting: number;
    cnt_payment_term: number;
    cnt_overdue_mep: number;
    cnt_outdated_dcl: number;
    cnt_after_policy_end: number;
};

async function aggregateTermsBreachForSummary(
    accountId: number,
    policyId: number | undefined,
    customerScope: Prisma.CustomerWhereInput
): Promise<TermsBreachSummaryAggRow[]> {
    const invoices = await prisma.invoice.findMany({
        where: applyBusinessUnitFilterToInvoiceWhere(
            {
                account_id: accountId,
                status: { in: [invoice_status.Due, invoice_status.Overdue] },
                OR: TERMS_BREACH_OR,
                amount: { gte: 0 },
                ...(policyId != null ? { policy_id: policyId } : {}),
            },
            customerScope
        ),
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
        if (inv.reporting_breach) cntReporting += 1;
        if (inv.ctv_payment_term) cntPaymentTerm += 1;
        if (inv.ctv_customer_overdue_mep) cntOverdueMep += 1;
        if (inv.ctv_outdated_dcl) cntOutdatedDcl += 1;
        if (inv.ctv_invoice_after_policy_end) cntAfterPolicyEnd += 1;
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

export async function getCreditDashboardSummary(
    accountId: number,
    policyId?: number,
    businessUnitFilter?: Prisma.CustomerWhereInput,
    includeNoPolicyExposure: boolean = true,
    options?: {
        asOfDate?: Date;
        /** Preloaded payment-ledger rows for `asOfDate` (avoids N SQL loads per scope). */
        asOfLines?: import("./asOfOpenAr").AsOfOpenInvoiceLine[];
    }
): Promise<CreditDashboardSummary> {
    const whereCust = customersScoped(accountId, policyId, businessUnitFilter);
    const useScopedTermsBreachAgg = hasDashboardBusinessUnitScope(
        businessUnitFilter
    );
    const asOfDate = options?.asOfDate;
    const asOfLines = options?.asOfLines;

    const accountRow = await (prisma.account.findUnique as any)({
        where: { id: accountId },
        select: {
            currency: true,
            customer_limit_expiration_warning_days: true,
            reporting_date_warning_days: true,
            credit_limit_warning_threshold_pct: true,
            credit_score_validity_warning_days: true,
        },
    }) as {
        currency: string | null;
        customer_limit_expiration_warning_days: number | null;
        reporting_date_warning_days: number | null;
        credit_limit_warning_threshold_pct: number | null;
        credit_score_validity_warning_days: number | null;
    } | null;

    const windowDays = Math.max(
        0,
        accountRow?.reporting_date_warning_days ??
            DEFAULT_REPORTING_WINDOW_DAYS
    );
    const limitWarnThresholdPct = Math.min(
        100,
        Math.max(
            1,
            accountRow?.credit_limit_warning_threshold_pct ??
                DEFAULT_LIMIT_WARN_THRESHOLD_PCT
        )
    );
    const scoreValidityWarnDays = Math.max(
        0,
        accountRow?.credit_score_validity_warning_days ??
            DEFAULT_SCORE_VALIDITY_WARN_DAYS
    );
    const limitExpirationWarnDays = Math.max(
        0,
        accountRow?.customer_limit_expiration_warning_days ?? 0
    );
    const accountCurrency =
        accountRow?.currency && String(accountRow.currency).trim()
            ? String(accountRow.currency).trim().toUpperCase()
            : "USD";

    const [
        customersRaw,
        scopedPolicies,
        _overdueCount,
        invAgg,
        rcInvoices,
    ] = await Promise.all([
        (prisma.customer.findMany as any)({
            where: whereCust,
            select: {
                id: true,
                collection_status: true,
                total_due_amount: true,
                total_overdue_amount: true,
                overdue_block: true,
            },
        }) as Promise<
            Array<{
                id: number;
                collection_status: string | null;
                total_due_amount: number | null;
                total_overdue_amount: number | null;
                overdue_block: boolean | null;
            }>
        >,
        prisma.insurancePolicy.findMany({
            where:
                policyId != null
                    ? { account_id: accountId, id: policyId }
                    : { account_id: accountId },
            select: {
                id: true,
                policy_number: true,
                end_date: true,
            },
        }),
        prisma.customer.count({
            where: { ...whereCust, overdue_block: true },
        }),
        useScopedTermsBreachAgg
            ? aggregateTermsBreachForSummary(
                  accountId,
                  policyId,
                  whereCust
              )
            : policyId != null
              ? prisma.$queryRaw<
                    {
                        c: number;
                        t: number | null;
                        cnt_reporting: number;
                        cnt_payment_term: number;
                        cnt_overdue_mep: number;
                        cnt_outdated_dcl: number;
                        cnt_after_policy_end: number;
                    }[]
                >`SELECT COUNT(*)::int AS c,
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
      AND i.amount >= 0
      AND (
        i.reporting_breach = true
        OR i.ctv_payment_term = true
        OR i.ctv_customer_overdue_mep = true
        OR i.ctv_outdated_dcl = true
        OR i.ctv_invoice_after_policy_end = true
      )`
              : prisma.$queryRaw<
                    {
                        c: number;
                        t: number | null;
                        cnt_reporting: number;
                        cnt_payment_term: number;
                        cnt_overdue_mep: number;
                        cnt_outdated_dcl: number;
                        cnt_after_policy_end: number;
                    }[]
                >`SELECT COUNT(*)::int AS c,
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
      AND i.amount >= 0
      AND (
        i.reporting_breach = true
        OR i.ctv_payment_term = true
        OR i.ctv_customer_overdue_mep = true
        OR i.ctv_outdated_dcl = true
        OR i.ctv_invoice_after_policy_end = true
      )`,
        prisma.invoice.findMany({
            where: applyBusinessUnitFilterToInvoiceWhere(
                withInvoiceCustomerPolicyFilter(
                    reportingCountdownOpenWhere(accountId, windowDays),
                    policyId
                ),
                businessUnitFilter
            ),
            select: {
                customer_id: true,
                outstanding_debt: true,
                customer_outstanding_debt: true,
                amount: true,
            },
        }),
    ]);

    const { enrichCustomersWithPolicyScope, fetchCustomerIdsWithActiveLinkedPolicy } =
        await import("./enrichCustomersWithActivePolicy");
    const customers = await enrichCustomersWithPolicyScope(
        customersRaw,
        policyId
    );

    const customerIds = customers.map((c) => c.id);
    const activeLinkedPolicyCustomerIds =
        await fetchCustomerIdsWithActiveLinkedPolicy(customerIds);
    const customerHasActiveLinkedPolicy = (customerId: number): boolean =>
        activeLinkedPolicyCustomerIds.has(customerId);
    const [openArByCustomer, termsOutstandingByCustomer, termsBreachForAtRiskByCustomer] =
        asOfDate != null
            ? await (async () => {
                  const asOf = await import("./asOfOpenAr");
                  const lines =
                      asOfLines ??
                      (await asOf.loadAsOfOpenInvoiceCandidates(
                          accountId,
                          asOfDate,
                          { customerIds, policyId }
                      ));
                  return Promise.all([
                      asOf.buildAsOfOpenReceivableByCustomerMapInAccountCurrencyFromLines(
                          lines,
                          accountCurrency,
                          asOfDate,
                          { customerIds, policyId }
                      ),
                      asOf.buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines(
                          lines,
                          accountCurrency,
                          asOfDate,
                          {
                              policyId,
                              excludeCapacityGapInvoices: false,
                              customerIds,
                          }
                      ),
                      asOf.buildAsOfTermsBreachOutstandingByCustomerInAccountCurrencyFromLines(
                          lines,
                          accountCurrency,
                          asOfDate,
                          {
                              policyId,
                              excludeCapacityGapInvoices: true,
                              customerIds,
                          }
                      ),
                  ]);
              })()
            : await Promise.all([
                  fetchOpenReceivableByCustomerMapInAccountCurrency(
                      accountId,
                      accountCurrency,
                      { customerIds, policyId }
                  ),
                  fetchTermsBreachOutstandingByCustomerInAccountCurrency(
                      accountId,
                      accountCurrency,
                      policyId,
                      false,
                      businessUnitFilter
                  ),
                  fetchTermsBreachOutstandingByCustomerInAccountCurrency(
                      accountId,
                      accountCurrency,
                      policyId,
                      true,
                      businessUnitFilter
                  ),
              ]);

    const openArForCustomer = (c: (typeof customers)[number]): number => {
        const fromInv = openArByCustomer.get(c.id);
        if (fromInv !== undefined) {
            return fromInv;
        }
        return 0;
    };
    const isNoPolicyExposureCohortCustomer = (
        c: (typeof customers)[number]
    ): boolean =>
        isNoPolicyExposureCardCustomer({
            hasLinkedPolicy: customerHasActiveLinkedPolicy(c.id),
            exclusionReason: c.policy_exclusion_reason,
            openAr: openArForCustomer(c),
        });
    const isUncoveredExposureCohortCustomer = (
        c: (typeof customers)[number]
    ): boolean =>
        isUncoveredExposureCustomer({
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

    const convertPolicyLimitToAccount = async (
        policyCurrency: string,
        amount: number
    ): Promise<number> => {
        if (!Number.isFinite(amount) || amount <= 0) {
            return 0;
        }
        if (policyCurrency === accountCurrency) {
            return amount;
        }
        const converted = await convertAmountToCurrencyLatestRate(
            policyCurrency,
            accountCurrency,
            amount
        );
        return converted ?? amount;
    };

    const policyArUsage = new Map<
        number,
        {
            policyNumber: string | null;
            maxCover: number;
            policyCurrency: string;
            totalAr: number;
        }
    >();
    for (const c of dashboardCustomers) {
        const pol = c.InsurancePolicy;
        if (!pol) {
            continue;
        }
        const ar = openArForCustomer(c);
        const policyCurrency =
            pol.currency?.trim()
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

    const policyMaxCoverInAccount = new Map(
        await Promise.all(
            Array.from(policyArUsage.entries()).map(async ([pid, row]) => {
                const maxInAccount = await convertPolicyLimitToAccount(
                    row.policyCurrency,
                    row.maxCover
                );
                return [pid, maxInAccount] as const;
            })
        )
    );

    const policyMaxCoverAlerts = Array.from(policyArUsage.entries())
        .map(([alertPolicyId, row]) => {
            const maxCoverAccount =
                policyMaxCoverInAccount.get(alertPolicyId) ?? row.maxCover;
            return {
                policyId: alertPolicyId,
                policyNumber: row.policyNumber,
                totalAr: row.totalAr,
                /** Max total cover expressed in {@link accountCurrency} for comparison with total AR. */
                maxCover: maxCoverAccount,
                exceededAmount: Math.max(0, row.totalAr - maxCoverAccount),
            };
        })
        .filter((r) => r.exceededAmount > 0)
        .sort((a, b) => b.exceededAmount - a.exceededAmount);
    const today = startOfDay(new Date());
    const policyExpirationAlerts = scopedPolicies
        .map((policy) => {
            if (policy.end_date == null) {
                return null;
            }
            const endDate = startOfDay(new Date(policy.end_date));
            if (Number.isNaN(endDate.getTime()) || endDate >= today) {
                return null;
            }
            return {
                policyId: policy.id,
                policyNumber: policy.policy_number ?? null,
                endDate: endDate.toISOString().slice(0, 10),
            };
        })
        .filter((row): row is NonNullable<typeof row> => row != null)
        .sort((a, b) => a.endDate.localeCompare(b.endDate));

    const accountHasTopUp = await hasTopUpPolicies(accountId);

    let topUpBlock: TopUpDashboardBlock | null = null;
    let topUpExpirationAlerts: TopUpExpiringSoonAlert[] = [];
    let topUpCoverTotal = 0;
    let topUpCoverUsed = 0;
    let topUpCoverRemaining = 0;
    let topUpCoverOverEffective = 0;

    if (accountHasTopUp) {
        const topUpMetrics = await computeTopUpDashboardMetrics({
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
        const { getTopUpExpiringSoonAlerts } = await import(
            "./creditInsuranceTopUpDashboardService"
        );
        topUpExpirationAlerts = await getTopUpExpiringSoonAlerts(
            accountId,
            7,
            policyId,
            businessUnitFilter
        );
        topUpCoverTotal = topUpMetrics.policyUsageTopUp.topUpCoverTotal;
        topUpCoverUsed = topUpMetrics.policyUsageTopUp.topUpCoverUsed;
        topUpCoverRemaining = topUpMetrics.policyUsageTopUp.topUpCoverRemaining;
        topUpCoverOverEffective =
            topUpMetrics.policyUsageTopUp.topUpCoverOverEffective;
    }

    const policyLimitUsageRows: PolicyLimitUsageRowInput[] = [];
    for (const c of dashboardCustomers) {
        const approvedLimitRaw =
            c.approved_limit != null
                ? new Prisma.Decimal(c.approved_limit).toNumber()
                : 0;
        const limitCurrency =
            c.approved_limit_currency?.trim().toUpperCase() || accountCurrency;
        const approvedLimitAccount = Math.max(
            0,
            (await convertApprovedLimitToAccountCurrency(
                approvedLimitRaw,
                limitCurrency,
                accountCurrency,
                {
                    accountId,
                    customerId: c.id,
                    policyId: c.policy_id ?? undefined,
                }
            )) ?? 0
        );

        let topUpTotalAccount = 0;
        if (
            accountHasTopUp &&
            c.approved_limit != null &&
            c.outdated_dcl !== true &&
            c.excluded_from_policy !== true
        ) {
            const resolved = await resolveEffectiveApprovedLimit(c.id, {
                baseApprovedLimit: c.approved_limit,
                baseApprovedLimitCurrency: limitCurrency,
                outdatedDcl: c.outdated_dcl ?? false,
                excludedFromPolicy: c.excluded_from_policy ?? false,
                parentPrimaryPolicyId: policyId,
                asOfDate: today,
            });
            const topUpInLimitCurrency = Math.max(
                0,
                resolved.topUpTotalInLimitCurrency
            );
            if (topUpInLimitCurrency > 0) {
                topUpTotalAccount = await convertPolicyLimitToAccount(
                    resolved.limitCurrency ?? limitCurrency,
                    topUpInLimitCurrency
                );
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
            approvedLimitExpirationDate:
                c.approved_limit_expiration_date ?? null,
        });
    }
    const portfolioPolicyLimitUsage = aggregatePortfolioPolicyLimitUsage(
        policyLimitUsageRows,
        today
    );

    const policyGapRollup = await sumCustomerPolicyCapacityGapForAccount(
        accountId,
        { policyId, businessUnitFilter }
    );
    const capacityTotal = policyGapRollup.gapBaseTotal;
    const customerOverLimit = policyGapRollup.customerOverLimitCount;
    const policyCapacityGapById = policyGapRollup.gapByPolicyId;
    const invoiceGapByCustomerPolicy = policyGapRollup.gapByCustomerPolicy;
    const useInvoiceSnapshotsForAtRisk = false;

    const invRow = invAgg[0];
    let termsCount = invRow?.c ?? 0;
    let termsTotal = useScopedTermsBreachAgg
        ? Number(invRow?.t ?? 0)
        : Array.from(termsOutstandingByCustomer.values()).reduce(
              (sum, amount) => sum + Math.max(0, amount),
              0
          );
    let countByReason: TermsBreachCountByReason = {
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
    } else if (
        insuredCustomerIdsForTermsBreach.length < dashboardCustomers.length ||
        !includeNoPolicyExposure
    ) {
        const filteredTermInvoices = await prisma.invoice.findMany({
            where: applyBusinessUnitFilterToInvoiceWhere(
                {
                    account_id: accountId,
                    customer_id: { in: insuredCustomerIdsForTermsBreach },
                    status: { in: [invoice_status.Due, invoice_status.Overdue] },
                    OR: TERMS_BREACH_OR,
                    amount: { gte: 0 },
                    ...(policyId != null ? { policy_id: policyId } : {}),
                },
                businessUnitFilter
            ),
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
        const agg = aggregatePortfolioTermsBreachFromInvoices(filteredTermInvoices);
        termsCount = agg.invoiceCount;
        termsTotal = agg.totalAmount;
        countByReason = agg.countByReason;
    } else if (!useScopedTermsBreachAgg) {
        termsTotal = insuredCustomerIdsForTermsBreach.reduce(
            (sum, customerId) =>
                sum + Math.max(0, termsOutstandingByCustomer.get(customerId) ?? 0),
            0
        );
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
        ? await buildEffectiveLimitByCustomerIdInAccountCurrency(
              accountCurrency,
              dashboardCustomers,
              openArByCustomer
          )
        : new Map<number, number>();

    /**
     * Portfolio at-risk / compliant: per customer, no policy → all AR at-risk;
     * with policy → min(AR, capacity gap + terms breach), terms breach excluding
     * gap invoices so one invoice is not double-counted.
     */
    let atRiskExposure = 0;
    let policyRiskExposure = 0;
    let policyRiskExposureCustomerCount = 0;
    let grossRiskExposure = 0;
    const allocatedRiskByPolicyId = new Map<number, number>();
    let withoutPolicyAtRisk = 0;
    for (const c of dashboardCustomers) {
        const ar = openArForCustomer(c);
        if (ar <= 0) {
            continue;
        }
        let allocated: number;
        if (isUncoveredExposureCohortCustomer(c)) {
            allocated = ar;
            if (isNoPolicyExposureCohortCustomer(c)) {
                withoutPolicyAtRisk += ar;
            }
            grossRiskExposure += ar;
        } else {
            const gap = capacityGapForCustomerAtRisk(
                c,
                useInvoiceSnapshotsForAtRisk,
                invoiceGapByCustomerPolicy
            );
            const tb = termsBreachForAtRiskByCustomer.get(c.id) ?? 0;
            grossRiskExposure += gap + tb;
            allocated = computeCustomerRiskExposure({
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
    const residualAtRiskByPolicyId = new Map<number, number>();
    for (const [pid, row] of Array.from(policyArUsage.entries())) {
        const maxCoverAccount =
            policyMaxCoverInAccount.get(pid) ?? row.maxCover;
        const exceededForPolicy = Math.max(0, row.totalAr - maxCoverAccount);
        const capacityGapForPolicy = policyCapacityGapById.get(pid) ?? 0;
        residualAtRiskByPolicyId.set(
            pid,
            Math.max(0, exceededForPolicy - capacityGapForPolicy)
        );
    }

    // Recompute at-risk exposure with per-policy caps so one policy cannot wipe out another's compliant remainder.
    let insuredAtRisk = 0;
    for (const [pid, row] of Array.from(policyArUsage.entries())) {
        const allocated = allocatedRiskByPolicyId.get(pid) ?? 0;
        const residual = residualAtRiskByPolicyId.get(pid) ?? 0;
        insuredAtRisk += Math.min(row.totalAr, allocated + residual);
    }
    atRiskExposure = withoutPolicyAtRisk + insuredAtRisk;
    /** At-risk is an allocation over open receivables and must not exceed portfolio AR. */
    atRiskExposure = Math.min(totalReceivables, atRiskExposure);
    const compliantExposure = Math.max(0, totalReceivables - atRiskExposure);
    /** (compliant exposure ÷ total receivables) × 100; same as (1 − at-risk/total) × 100 when compliant = total − at-risk. */
    const healthIndex =
        totalReceivables > 0
            ? Math.max(
                  0,
                  Math.min(
                      100,
                      (100 * compliantExposure) / totalReceivables
                  )
              )
            : 100;

    let overdueBlockTotalOutstanding = 0;
    let overdueCountFiltered = 0;
    for (const c of dashboardCustomers) {
        if (c.overdue_block) {
            overdueCountFiltered += 1;
            overdueBlockTotalOutstanding += openArForCustomer(c);
        }
    }

    const limitWarningIds = new Set<number>();
    for (const c of dashboardCustomers) {
        const ar = openArForCustomer(c);
        if (
            isNearLimitForWarning(c, limitWarnThresholdPct, ar, {
                useEffectiveLimit: accountHasTopUp,
                effectiveLimitInAccountCurrency:
                    effectiveLimitByCustomerId.get(c.id),
            }) ||
            isCreditScoreExpiringInWindow(c as any, scoreValidityWarnDays) ||
            isLimitExpiringInWindow(c as any, limitExpirationWarnDays)
        ) {
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
        if (
            inv.customer_id != null &&
            !dashboardCustomerIds.has(inv.customer_id)
        ) {
            continue;
        }
        reportingCount += 1;
        reportingTotal += invoiceOutstandingInAccountCurrency(inv);
    }

    const zeroLimitWarningsCount = await prisma.customerPolicy.count({
        where: {
            is_active: true,
            approved_limit: 0,
            insurance_policy_id: policyId != null ? policyId : { not: null },
            Customer: mergeDashboardBusinessUnitIntoCustomerScope(
                {
                    account_id: accountId,
                    collection_status: { in: COLLECTION_LIVE },
                },
                businessUnitFilter
            ),
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

export type OverdueBlockRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    outstandingAmount: number;
    maxDaysOverdue: number;
    openInvoices: number;
    /** Customer-first resolved ISO currency for the row (display). */
    currency: string;
};

export async function getOverdueBlockReport(
    accountId: number,
    take: number,
    skip: number,
    options: CreditReportListOptions = {}
): Promise<{ total: number; rows: OverdueBlockRow[] }> {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const searchWhere = buildCustomerTextSearchWhere(options.query);
    const whereCust: Prisma.CustomerWhereInput = {
        AND: [
            customersScoped(accountId, options.policyId, options.businessUnitFilter),
            { overdue_block: true },
            ...(options.customerId != null ? [{ id: options.customerId }] : []),
            ...(searchWhere ? [searchWhere] : []),
        ],
    };

    const ob = overdueOrderBy(
        options.sortField,
        options.sortDirection
    );
    const orderByClause: Prisma.CustomerOrderByWithRelationInput[] =
        Array.isArray(ob) ? [...ob, { id: "asc" }] : [ob, { id: "asc" }];

    const [total, pageRaw, openArByCustomer] = await Promise.all([
        prisma.customer.count({ where: whereCust }),
        prisma.customer.findMany({
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
    const { enrichCustomersWithPolicyScope } = await import(
        "./enrichCustomersWithActivePolicy"
    );
    const page = await enrichCustomersWithPolicyScope(
        pageRaw,
        options.policyId
    );

    if (page.length === 0) {
        return { total, rows: [] };
    }

    const ids = page.map((c) => c.id);
    const today = startOfDay(new Date());

    const invoiceScope = scopedInvoiceWhere(accountId, options.policyId);
    const [openCounts, overdueInv] = await Promise.all([
        prisma.invoice.groupBy({
            by: ["customer_id"],
            where: {
                ...invoiceScope,
                customer_id: { in: ids },
                status: { notIn: CLOSED_INVOICE_STATUS },
            },
            _count: { _all: true },
        }),
        prisma.invoice.findMany({
            where: {
                ...invoiceScope,
                customer_id: { in: ids },
                status: "Overdue",
                due_date: { not: null },
            },
            select: { customer_id: true, due_date: true },
        }),
    ]);

    const openMap = new Map<number, number>();
    for (const g of openCounts) {
        if (g.customer_id != null) {
            openMap.set(g.customer_id, g._count._all);
        }
    }
    const maxDays = new Map<number, number>();
    for (const inv of overdueInv) {
        if (!inv.due_date) {
            continue;
        }
        const days = Math.max(0, differenceInCalendarDays(today, new Date(inv.due_date)));
        const prev = maxDays.get(inv.customer_id as number) ?? 0;
        if (days > prev) {
            maxDays.set(inv.customer_id as number, days);
        }
    }

    const rows: OverdueBlockRow[] = page.map((c) => ({
        customerId: c.id,
        policyNumber: c.InsurancePolicy?.policy_number ?? null,
        customerName: customerNameFromRow(c as any),
        outstandingAmount: openArByCustomer.get(c.id) ?? 0,
        maxDaysOverdue: maxDays.get(c.id) ?? 0,
        openInvoices: openMap.get(c.id) ?? 0,
        currency: displayCurrencyForCustomer(
            c as any,
            c.InsurancePolicy?.currency,
            accountCur
        ),
    }));

    return { total, rows };
}

export type CapacityGapRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    approvedLimit: number | null;
    approvedLimitCurrency: string | null;
    limitType: string | null;
    totalAR: number;
    openInvoices: number;
    uninsuredGap: number;
    currency: string;
};

type CapacityGapCandidate = {
    id: number;
    customer_number: string | null;
    Person: { full_name: string | null } | null;
    Company: { name: string | null } | null;
    InsurancePolicy: { policy_number: string | null } | null;
    approved_limit: Prisma.Decimal | number | null;
    approved_limit_currency: string | null;
    limit_type: string | null;
    capacity_gap_amount1: number | null;
    gapAmount: number;
    openAr: number;
};

async function buildCapacityGapCandidates(
    accountId: number,
    options: Pick<
        CreditReportListOptions,
        "policyId" | "customerId" | "businessUnitFilter"
    > = {}
): Promise<CapacityGapCandidate[]> {
    const whereAll: Prisma.CustomerWhereInput = {
        ...customersScoped(accountId, options.policyId, options.businessUnitFilter),
        ...(options.customerId != null ? { id: options.customerId } : {}),
    };

    const [allRaw, openArByCustomer] = await Promise.all([
        prisma.customer.findMany({
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
    const { enrichCustomersWithPolicyScope } = await import(
        "./enrichCustomersWithActivePolicy"
    );
    const all = await enrichCustomersWithPolicyScope(allRaw, options.policyId);

    const withGap: CapacityGapCandidate[] = [];
    for (const c of all) {
        const ar = openArByCustomer.get(c.id) ?? 0;
        if (ar <= 0) {
            continue;
        }
        // The "over limit customers" card sums active CustomerPolicy rows only.
        // enrichCustomersWithPolicyScope falls back to the latest inactive row
        // when a customer has no active one for the scoped policy, which pulled
        // stale gaps into this list and made the grid disagree with the card.
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

    // Fallback for accounts where per-customer stored gap is not populated yet:
    // derive row-level capacity gaps directly from open invoice snapshots.
    if (withGap.length === 0 && all.length > 0) {
        const accountCur = await getAccountDisplayCurrency(accountId);
        const scopedCustomerIds = all.map((c) => c.id);
        const invoiceRows = await (prisma.invoice.findMany as any)({
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
        }) as Array<{
            customer_id: number | null;
            outstanding_debt: number | null;
            customer_outstanding_debt: number | null;
            amount: number | null;
            limit_assessed_amount: number | null;
            InsurancePolicy: { currency: string | null } | null;
        }>;

        const gapByCustomer = new Map<number, number>();
        for (const inv of invoiceRows) {
            if (inv.customer_id == null) {
                continue;
            }
            const contribution = computeInvoiceCapacityGapContribution({
                outstandingLeft: lineOutstanding(inv),
                limitAssessedAmount: Number(inv.limit_assessed_amount ?? 0),
            });
            if (contribution <= 0) {
                continue;
            }
            const policyCurrency =
                inv.InsurancePolicy?.currency?.trim()
                    ? String(inv.InsurancePolicy.currency).trim().toUpperCase()
                    : accountCur;
            const contributionInAccount = await convertAmountToCurrencyLatestRate(
                policyCurrency,
                accountCur,
                contribution
            );
            const normalizedContribution = Number(contributionInAccount ?? 0);
            if (normalizedContribution <= 0) {
                continue;
            }
            gapByCustomer.set(
                inv.customer_id,
                (gapByCustomer.get(inv.customer_id) ?? 0) +
                    normalizedContribution
            );
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

/** Same capacity-gap basis as the credit dashboard capacity report table. */
export async function getCustomerCapacityGapForReport(
    accountId: number,
    customerId: number,
    policyId?: number
): Promise<{ amount: number; amountSecondary: number | null }> {
    const candidates = await buildCapacityGapCandidates(accountId, {
        customerId,
        policyId,
    });
    const amount = candidates.reduce((sum, row) => sum + row.gapAmount, 0);
    let amountSecondary: number | null = null;
    for (const row of candidates) {
        if (
            row.capacity_gap_amount1 != null &&
            Number(row.capacity_gap_amount1) > 0
        ) {
            amountSecondary =
                (amountSecondary ?? 0) + Math.max(0, Number(row.capacity_gap_amount1));
        }
    }
    return { amount, amountSecondary };
}

export async function getCapacityGapReport(
    accountId: number,
    take: number,
    skip: number,
    options: CreditReportListOptions = {}
): Promise<{ total: number; rows: CapacityGapRow[] }> {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const withGap = await buildCapacityGapCandidates(accountId, {
        policyId: options.policyId,
        customerId: options.customerId,
    });

    let filtered: CapacityGapCandidate[] = withGap;
    const q = options.query?.trim();
    if (q) {
        filtered = withGap.filter((c) => customerRowMatchesQuery(c, q));
    }

    const sortField = options.sortField || "uninsuredGap";
    const sortDirection = options.sortDirection || "desc";
    const sign = sortDirection === "asc" ? 1 : -1;

    const withAccountLimits = await Promise.all(
        filtered.map(async (c) => {
            const rawLimit =
                c.approved_limit != null
                    ? new Prisma.Decimal(c.approved_limit as any).toNumber()
                    : null;
            const approvedLimitInAccount = await convertApprovedLimitToAccountCurrency(
                rawLimit,
                c.approved_limit_currency,
                accountCur,
                {
                    accountId,
                    customerId: c.id,
                    policyId: options.policyId,
                }
            );
            const uninsuredGap = Math.max(0, c.gapAmount);
            return { ...c, approvedLimitInAccount, uninsuredGap };
        })
    );

    const overLimit = withAccountLimits.filter((c) => c.uninsuredGap > 0);

    const sorted = [...overLimit].sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
            case "policyNumber":
                cmp = (a.InsurancePolicy?.policy_number || "").localeCompare(
                    b.InsurancePolicy?.policy_number || ""
                );
                break;
            case "customerName":
                cmp = customerNameFromRow(a as any).localeCompare(
                    customerNameFromRow(b as any),
                    undefined,
                    { sensitivity: "base" }
                );
                break;
            case "approvedLimit": {
                const av = a.approvedLimitInAccount ?? 0;
                const bv = b.approvedLimitInAccount ?? 0;
                cmp = av - bv;
                break;
            }
            case "limitType":
                cmp = String(a.limit_type || "").localeCompare(
                    String(b.limit_type || "")
                );
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
    const openCounts = await prisma.invoice.groupBy({
        by: ["customer_id"],
        where: {
            ...invoiceScope,
            customer_id: { in: ids },
            status: { notIn: CLOSED_INVOICE_STATUS },
        },
        _count: { _all: true },
    });
    const openMap = new Map<number, number>();
    for (const g of openCounts) {
        if (g.customer_id != null) {
            openMap.set(g.customer_id, g._count._all);
        }
    }

    const rows: CapacityGapRow[] = page.map((c) => ({
        customerId: c.id,
        policyNumber: c.InsurancePolicy?.policy_number ?? null,
        customerName: customerNameFromRow(c as any),
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

export type PolicyRiskExposureReportRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    openAR: number;
    capacityGap: number;
    termsBreachOutstanding: number;
    /** min(open AR, capacity gap + terms breach outstanding) — same as dashboard policy risk per row. */
    policyRiskAllocated: number;
    currency: string;
};

export type NoPolicyExposureReportRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    customerNumber: string | null;
    openAR: number;
    exclusionReason: string | null;
    currency: string;
};

function sortPolicyRiskExposureRows(
    rows: PolicyRiskExposureReportRow[],
    sortField: string,
    sortDirection: "asc" | "desc"
): PolicyRiskExposureReportRow[] {
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

/**
 * Insured customers only: open AR, capacity gap, terms-breach outstanding, and allocated policy risk
 * (same rules as credit dashboard {@link CreditDashboardSummary.policyRiskExposure}).
 */
export async function getPolicyRiskExposureReport(
    accountId: number,
    take: number,
    skip: number,
    options: CreditReportListOptions = {}
): Promise<{ total: number; rows: PolicyRiskExposureReportRow[] }> {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const whereAll: Prisma.CustomerWhereInput = customersScoped(
        accountId,
        options.policyId,
        options.businessUnitFilter
    );

    const [allRaw, openArByCustomer, termsOutstandingByCustomer, termsBreachForAtRiskByCustomer] =
        await Promise.all([
            prisma.customer.findMany({
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
            fetchTermsBreachOutstandingByCustomer(
                accountId,
                options.policyId,
                false
            ),
            fetchTermsBreachOutstandingByCustomer(
                accountId,
                options.policyId,
                true
            ),
        ]);

    const { enrichCustomersWithPolicyScope } = await import(
        "./enrichCustomersWithActivePolicy"
    );
    const all = await enrichCustomersWithPolicyScope(allRaw, options.policyId);

    const openArFor = (c: (typeof all)[number]): number => {
        return openArByCustomer.get(c.id) ?? 0;
    };

    let list = all;
    const q = options.query?.trim();
    if (q) {
        list = all.filter((c) => customerRowMatchesQuery(c as any, q));
    }

    const built: PolicyRiskExposureReportRow[] = [];
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
        const allocated = computeCustomerRiskExposure({
            totalAr: ar,
            capacityGapAmount: gap,
            termsBreachOutstanding: tbForAtRisk,
        });
        built.push({
            customerId: c.id,
            policyNumber: c.InsurancePolicy.policy_number ?? null,
            customerName: customerNameFromRow(c as any),
            openAR: ar,
            capacityGap: gap,
            termsBreachOutstanding: tb,
            policyRiskAllocated: allocated,
            currency: displayCurrencyForCustomer(
                c as any,
                c.InsurancePolicy?.currency,
                accountCur
            ),
        });
    }

    const sortField = options.sortField || "policyRiskAllocated";
    const sortDirection = options.sortDirection || "desc";
    const sorted = sortPolicyRiskExposureRows(
        built,
        sortField,
        sortDirection
    );
    const total = sorted.length;
    const page = sorted.slice(skip, skip + take);
    return { total, rows: page };
}

export async function getNoPolicyExposureReport(
    accountId: number,
    take: number,
    skip: number,
    options: CreditReportListOptions = {}
): Promise<{ total: number; rows: NoPolicyExposureReportRow[] }> {
    if (options.includeNoPolicyExposure === false) {
        return { total: 0, rows: [] };
    }
    const accountCur = await getAccountDisplayCurrency(accountId);
    const whereAll: Prisma.CustomerWhereInput = customersScoped(
        accountId,
        options.policyId,
        options.businessUnitFilter
    );

    const [allRaw, openArByCustomer] = await Promise.all([
        prisma.customer.findMany({
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

    const { enrichCustomersWithPolicyScope, fetchCustomerIdsWithActiveLinkedPolicy } =
        await import("./enrichCustomersWithActivePolicy");
    const all = await enrichCustomersWithPolicyScope(allRaw, options.policyId);

    const customerIds = all.map((c) => c.id);
    const activeLinkedPolicyCustomerIds =
        await fetchCustomerIdsWithActiveLinkedPolicy(customerIds);

    let list = all.filter((c) => {
        const ar = openArByCustomer.get(c.id) ?? 0;
        return isNoPolicyExposureCardCustomer({
            hasLinkedPolicy: activeLinkedPolicyCustomerIds.has(c.id),
            exclusionReason: c.policy_exclusion_reason,
            openAr: ar,
        });
    });
    const q = options.query?.trim();
    if (q) {
        list = list.filter((c) => customerRowMatchesQuery(c as any, q));
    }

    const sortField = options.sortField || "openAR";
    const sortDirection = options.sortDirection || "desc";
    const sign = sortDirection === "asc" ? 1 : -1;
    const sorted = [...list].sort((a, b) => {
        let cmp = 0;
        switch (sortField) {
            case "customerName":
                cmp = customerNameFromRow(a as any).localeCompare(
                    customerNameFromRow(b as any),
                    undefined,
                    { sensitivity: "base" }
                );
                break;
            case "customerNumber":
                cmp = String(a.customer_number ?? "").localeCompare(
                    String(b.customer_number ?? ""),
                    undefined,
                    { sensitivity: "base" }
                );
                break;
            case "policyNumber":
                cmp = String(a.InsurancePolicy?.policy_number ?? "").localeCompare(
                    String(b.InsurancePolicy?.policy_number ?? ""),
                    undefined,
                    { sensitivity: "base" }
                );
                break;
            case "exclusionReason":
                cmp = String(a.policy_exclusion_reason ?? "").localeCompare(
                    String(b.policy_exclusion_reason ?? ""),
                    undefined,
                    { sensitivity: "base" }
                );
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
    const rows: NoPolicyExposureReportRow[] = page.map((c) => ({
        customerId: c.id,
        policyNumber: c.InsurancePolicy?.policy_number ?? null,
        customerName: customerNameFromRow(c as any),
        customerNumber: c.customer_number ?? null,
        openAR: openArByCustomer.get(c.id) ?? 0,
        exclusionReason: c.policy_exclusion_reason ?? null,
        currency: displayCurrencyForCustomer(
            c as any,
            c.InsurancePolicy?.currency,
            accountCur
        ),
    }));
    return { total, rows };
}

export type TermsBreachRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    invoiceId: number;
    invoiceNumber: string | null;
    termsBreachReasonCodes: string[];
    invoiceAmount: number;
    /** Same line in account base currency (FX when invoice currency differs). */
    invoiceAmountAccount: number;
    currency: string;
};

function termsBreachReasonCodesForInvoice(inv: {
    reporting_breach: boolean;
    ctv_payment_term: boolean;
    ctv_customer_overdue_mep: boolean;
    ctv_outdated_dcl: boolean;
    ctv_invoice_after_policy_end: boolean;
}): string[] {
    const codes: string[] = [];
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

function termsBreachReportWhere(
    accountId: number,
    q: string | undefined,
    scope?: Pick<
        CreditReportListOptions,
        "termsBreachReason" | "termsOverdueOnly"
    >
): Prisma.InvoiceWhereInput {
    const statusFilter = scope?.termsOverdueOnly
        ? { status: invoice_status.Overdue }
        : { status: { in: [invoice_status.Due, invoice_status.Overdue] } };
    const breachFilter = scope?.termsBreachReason
        ? { [scope.termsBreachReason]: true }
        : { OR: TERMS_BREACH_OR };
    const base: Prisma.InvoiceWhereInput = {
        account_id: accountId,
        ...statusFilter,
        ...breachFilter,
        amount: { gte: 0 },
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
                    invoiceLinkedPolicyTextSearchOr(t),
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

function termsOrderBy(
    sortField: string | undefined,
    sortDirection: "asc" | "desc" | undefined
): Prisma.Enumerable<Prisma.InvoiceOrderByWithRelationInput> {
    const d: Prisma.SortOrder = sortDirection === "desc" ? "desc" : "asc";
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

function displayCurrencyForInvoiceRow(
    inv: { customer_currency: string | null },
    customer: {
        customer_due_currency1: string | null;
        customer_due_currency2: string | null;
        customer_overdue_currency1: string | null;
        customer_overdue_currency2: string | null;
    },
    policyCurrency: string | null | undefined,
    accountCurrency: string
): string {
    return resolveCustomerFirstCurrency({
        customerCurrencyPrimary: inv.customer_currency,
        collectionCurrencyPrimary: customer.customer_due_currency1,
        collectionCurrencySecondary: customer.customer_overdue_currency1,
        accountCurrency,
        fallbackCurrency: policyCurrency && String(policyCurrency).trim()
            ? String(policyCurrency).trim()
            : null,
    });
}

export async function getTermsBreachReport(
    accountId: number,
    take: number,
    skip: number,
    options: CreditReportListOptions = {}
): Promise<{ total: number; rows: TermsBreachRow[] }> {
    const accountCur = await getAccountDisplayCurrency(accountId);
    let where: Prisma.InvoiceWhereInput = applyBusinessUnitFilterToInvoiceWhere(
        withInvoiceCustomerPolicyFilter(
            termsBreachReportWhere(accountId, options.query, {
                termsBreachReason: options.termsBreachReason,
                termsOverdueOnly: options.termsOverdueOnly,
            }),
            options.policyId
        ),
        options.businessUnitFilter
    );
    if (options.customerId != null) {
        where = { ...where, customer_id: options.customerId };
    }
    const obT = termsOrderBy(
        options.sortField,
        options.sortDirection
    );
    const orderByClauseTerms: Prisma.InvoiceOrderByWithRelationInput[] =
        Array.isArray(obT) ? [...obT, { id: "asc" }] : [obT, { id: "asc" }];
    const [total, list] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({
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
                        CustomerPolicy: ACTIVE_CUSTOMER_POLICY_NESTED_SELECT,
                    },
                },
            },
        }),
    ]);

    const rows: TermsBreachRow[] = (
        await Promise.all(
            list.map(async (inv) => {
                const c = inv.Customer;
                if (!c) {
                    return null;
                }
                const codes = termsBreachReasonCodesForInvoice(inv);
                const policyDisplay = policyDisplayFromInvoiceRow(inv, c);
                const invoiceAmountAccount =
                    await resolveInvoiceLineOutstandingInAccountCurrency(
                        inv,
                        accountCur
                    );
                return {
                    customerId: c.id,
                    policyNumber: policyDisplay.policy_number,
                    customerName: customerNameFromRow(c as any),
                    invoiceId: inv.id,
                    invoiceNumber: inv.invoice_number ?? null,
                    termsBreachReasonCodes: codes,
                    invoiceAmount: lineOutstanding(inv),
                    invoiceAmountAccount,
                    currency: displayCurrencyForInvoiceRow(
                        inv,
                        c as any,
                        policyDisplay.currency,
                        accountCur
                    ),
                } as TermsBreachRow;
            })
        )
    ).filter((r): r is TermsBreachRow => r != null);

    return { total, rows };
}

export type ReportingCountdownRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    invoiceId: number;
    invoiceNumber: string | null;
    invoiceAmount: number;
    currency: string;
    daysOverdue: number;
    daysLeftForReporting: number;
};

function invoiceDaysOverdueFromRow(inv: {
    status: string;
    due_date: Date | null;
}): number {
    if (inv.status !== "Overdue" || !inv.due_date) {
        return 0;
    }
    return Math.max(
        0,
        differenceInCalendarDays(
            startOfDay(new Date()),
            startOfDay(new Date(inv.due_date))
        )
    );
}

function daysLeftUntilCalendar(target: Date | null | undefined): number {
    if (!target) {
        return 0;
    }
    return Math.max(
        0,
        differenceInCalendarDays(
            startOfDay(new Date(target)),
            startOfDay(new Date())
        )
    );
}

function reportingCountdownOpenSearchWhere(
    accountId: number,
    windowDays: number,
    q: string | undefined
): Prisma.InvoiceWhereInput {
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
                    invoiceLinkedPolicyTextSearchOr(t),
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

function reportingOrderBy(
    sortField: string | undefined,
    sortDirection: "asc" | "desc" | undefined
): Prisma.Enumerable<Prisma.InvoiceOrderByWithRelationInput> {
    const d: Prisma.SortOrder = sortDirection === "desc" ? "desc" : "asc";
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

export async function getReportingCountdownOpenReport(
    accountId: number,
    take: number,
    skip: number,
    windowDays: number,
    options: CreditReportListOptions = {}
): Promise<{ total: number; rows: ReportingCountdownRow[] }> {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const w = Math.max(0, windowDays);
    let where: Prisma.InvoiceWhereInput = applyBusinessUnitFilterToInvoiceWhere(
        withInvoiceCustomerPolicyFilter(
            reportingCountdownOpenSearchWhere(accountId, w, options.query),
            options.policyId
        ),
        options.businessUnitFilter
    );
    if (options.customerId != null) {
        where = { ...where, customer_id: options.customerId };
    }
    const ob = reportingOrderBy(options.sortField, options.sortDirection);
    const orderByClause: Prisma.InvoiceOrderByWithRelationInput[] =
        Array.isArray(ob) ? [...ob, { id: "asc" }] : [ob, { id: "asc" }];
    const [total, list] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({
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
                        CustomerPolicy: ACTIVE_CUSTOMER_POLICY_NESTED_SELECT,
                    },
                },
            },
        }),
    ]);

    const rows: ReportingCountdownRow[] = list
        .map((inv) => {
            const c = inv.Customer;
            if (!c) {
                return null;
            }
            const policyDisplay = policyDisplayFromInvoiceRow(inv, c);
            return {
                customerId: c.id,
                policyNumber: policyDisplay.policy_number,
                customerName: customerNameFromRow(c as any),
                invoiceId: inv.id,
                invoiceNumber: inv.invoice_number ?? null,
                invoiceAmount: lineOutstanding(inv),
                currency: displayCurrencyForInvoiceRow(
                    inv,
                    c as any,
                    policyDisplay.currency,
                    accountCur
                ),
                daysOverdue: invoiceDaysOverdueFromRow(inv as any),
                daysLeftForReporting: inv.target_reporting_date
                    ? daysLeftUntilCalendar(inv.target_reporting_date)
                    : 0,
            } as ReportingCountdownRow;
        })
        .filter((r): r is ReportingCountdownRow => r != null);

    return { total, rows };
}

export type ReportedInvoicesRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    invoiceId: number;
    invoiceNumber: string | null;
    invoiceAmount: number;
    currency: string;
    actualReportingDate: string | null;
    reportingCapturedAt: string | null;
    /** Single DB field: reference / comment */
    reportingRefComment: string | null;
};

function reportedInvoicesSearchWhere(
    accountId: number,
    q: string | undefined
): Prisma.InvoiceWhereInput {
    const base: Prisma.InvoiceWhereInput = {
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
                    invoiceLinkedPolicyTextSearchOr(t),
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

function reportedListOrderBy(
    sortField: string | undefined,
    sortDirection: "asc" | "desc" | undefined
): Prisma.InvoiceOrderByWithRelationInput[] {
    const d: Prisma.SortOrder = sortDirection === "asc" ? "asc" : "desc";
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

export async function getReportedInvoicesReport(
    accountId: number,
    take: number,
    skip: number,
    options: CreditReportListOptions = {}
): Promise<{ total: number; rows: ReportedInvoicesRow[] }> {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const where = applyBusinessUnitFilterToInvoiceWhere(
        withInvoiceCustomerPolicyFilter(
            reportedInvoicesSearchWhere(accountId, options.query),
            options.policyId
        ),
        options.businessUnitFilter
    );
    const orderBy = reportedListOrderBy(
        options.sortField,
        options.sortDirection
    );
    const [total, list] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({
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
                        CustomerPolicy: ACTIVE_CUSTOMER_POLICY_NESTED_SELECT,
                    },
                },
            },
        }),
    ]);

    const rows: ReportedInvoicesRow[] = list
        .map((inv) => {
            const c = inv.Customer;
            if (!c) {
                return null;
            }
            const ad = inv.actual_reporting_date;
            const cap = inv.reporting_captured_at;
            const policyDisplay = policyDisplayFromInvoiceRow(inv, c);
            return {
                customerId: c.id,
                policyNumber: policyDisplay.policy_number,
                customerName: customerNameFromRow(c as any),
                invoiceId: inv.id,
                invoiceNumber: inv.invoice_number ?? null,
                invoiceAmount: lineOutstanding(inv),
                currency: displayCurrencyForInvoiceRow(
                    inv,
                    c as any,
                    policyDisplay.currency,
                    accountCur
                ),
                actualReportingDate: ad
                    ? new Date(ad).toISOString().slice(0, 10)
                    : null,
                reportingCapturedAt: cap ? new Date(cap).toISOString() : null,
                reportingRefComment: inv.reporting_comment
                    ? String(inv.reporting_comment)
                    : null,
            } as ReportedInvoicesRow;
        })
        .filter((r): r is ReportedInvoicesRow => r != null);

    return { total, rows };
}

export type LimitWarningRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    nearLimit: boolean;
    nearLimitUtilizationPct: number | null;
    scoreExpiring: boolean;
    scoreExpiresInDays: number | null;
    creditScoreInputDate: string | null;
    approvedLimit: number | null;
    limitType: string | null;
    totalAR: number;
    currency: string;
    limitExpiring: boolean;
    limitExpiresInDays: number | null;
    approvedLimitExpirationDate: string | null;
};

type CustomerForLimitWarning = {
    id: number;
    customer_number: string | null;
    customer_number_policy: string | null;
    total_due_amount: number | null;
    total_overdue_amount: number | null;
    customer_due_currency1: string | null;
    customer_due_currency2: string | null;
    customer_overdue_currency1: string | null;
    customer_overdue_currency2: string | null;
    policy_id?: number | null;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency?: string | null;
    approved_limit_expiration_date: Date | null;
    limit_type: string | null;
    credit_score_input_date: Date | null;
    outdated_dcl?: boolean | null;
    excluded_from_policy?: boolean | null;
    Person: { full_name: string | null } | null;
    Company: { name: string | null } | null;
    InsurancePolicy: { policy_number: string | null; currency: string | null; score_validity_period_months: number | null } | null;
};

function buildLimitWarningRow(
    c: CustomerForLimitWarning,
    accountCur: string,
    thresholdPct: number,
    scoreWarnDays: number,
    limitExpirationWarnDays: number,
    openArOverride?: number,
    limitWarningOptions?: {
        useEffectiveLimit?: boolean;
        effectiveLimitInAccountCurrency?: number | null;
    }
): LimitWarningRow | null {
    const ar =
        openArOverride !== undefined ? openArOverride : totalArFromCustomerRow(c);
    const near = isNearLimitForWarning(c, thresholdPct, ar, limitWarningOptions);
    const scoreEx = isCreditScoreExpiringInWindow(c, scoreWarnDays);
    const limitEx = isLimitExpiringInWindow(c, limitExpirationWarnDays);
    if (!near && !scoreEx && !limitEx) {
        return null;
    }
    let nearPct: number | null = null;
    if (near) {
        const useEffective =
            limitWarningOptions?.useEffectiveLimit === true &&
            limitWarningOptions.effectiveLimitInAccountCurrency != null &&
            limitWarningOptions.effectiveLimitInAccountCurrency > 0;
        const lim = useEffective
            ? limitWarningOptions!.effectiveLimitInAccountCurrency!
            : c.approved_limit != null
              ? new Prisma.Decimal(c.approved_limit as any).toNumber()
              : null;
        if (lim != null && lim > 0) {
            nearPct = Math.min(100, Math.round((100 * ar) / lim));
        }
    }
    const expiry = creditScoreExpiryOnCalendar(
        c.credit_score_input_date,
        c.InsurancePolicy?.score_validity_period_months
    );
    let daysToScore: number | null = null;
    if (scoreEx && expiry) {
        daysToScore = Math.max(
            0,
            differenceInCalendarDays(expiry, startOfDay(new Date()))
        );
    }
    let daysToLimitExpiry: number | null = null;
    if (limitEx && c.approved_limit_expiration_date) {
        daysToLimitExpiry = Math.max(
            0,
            differenceInCalendarDays(
                startOfDay(new Date(c.approved_limit_expiration_date)),
                startOfDay(new Date())
            )
        );
    }
    return {
        customerId: c.id,
        policyNumber: c.InsurancePolicy?.policy_number ?? null,
        customerName: customerNameFromRow(c as any),
        nearLimit: near,
        nearLimitUtilizationPct: nearPct,
        scoreExpiring: scoreEx,
        scoreExpiresInDays: daysToScore,
        creditScoreInputDate: c.credit_score_input_date
            ? new Date(c.credit_score_input_date).toISOString().slice(0, 10)
            : null,
        approvedLimit: c.approved_limit != null
            ? new Prisma.Decimal(c.approved_limit as any).toNumber()
            : null,
        limitType: c.limit_type != null ? String(c.limit_type) : null,
        totalAR: ar,
        currency: displayCurrencyForCustomer(
            c,
            c.InsurancePolicy?.currency,
            accountCur
        ),
        limitExpiring: limitEx,
        limitExpiresInDays: daysToLimitExpiry,
        approvedLimitExpirationDate: c.approved_limit_expiration_date
            ? new Date(c.approved_limit_expiration_date).toISOString().slice(0, 10)
            : null,
    };
}

function sortLimitWarningRows(
    rows: LimitWarningRow[],
    sortField: string,
    sortDirection: "asc" | "desc"
): LimitWarningRow[] {
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

export async function getLimitWarningReport(
    accountId: number,
    take: number,
    skip: number,
    options: CreditReportListOptions = {}
): Promise<{ total: number; rows: LimitWarningRow[] }> {
    const [accountCur, accountSettings] = await Promise.all([
        getAccountDisplayCurrency(accountId),
        (prisma.account.findUnique as any)({
            where: { id: accountId },
            select: {
                customer_limit_expiration_warning_days: true,
                credit_limit_warning_threshold_pct: true,
                credit_score_validity_warning_days: true,
            },
        }) as Promise<{
            customer_limit_expiration_warning_days: number | null;
            credit_limit_warning_threshold_pct: number | null;
            credit_score_validity_warning_days: number | null;
        } | null>,
    ]);
    const thresholdPct = Math.min(
        100,
        Math.max(
            1,
            accountSettings?.credit_limit_warning_threshold_pct ??
                DEFAULT_LIMIT_WARN_THRESHOLD_PCT
        )
    );
    const scoreWarnDays = Math.max(
        0,
        accountSettings?.credit_score_validity_warning_days ??
            DEFAULT_SCORE_VALIDITY_WARN_DAYS
    );
    const limitExpirationWarnDays = Math.max(
        0,
        accountSettings?.customer_limit_expiration_warning_days ?? 0
    );

    const [allRaw, openArByCustomer] = await Promise.all([
        prisma.customer.findMany({
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
    const { enrichCustomersWithPolicyScope } = await import(
        "./enrichCustomersWithActivePolicy"
    );
    const all = (await enrichCustomersWithPolicyScope(
        allRaw,
        options.policyId
    )) as CustomerForLimitWarning[];

    const accountHasTopUp = await hasTopUpPolicies(accountId);
    const effectiveLimitByCustomerId = accountHasTopUp
        ? await buildEffectiveLimitByCustomerIdInAccountCurrency(
              accountCur,
              all,
              openArByCustomer
          )
        : new Map<number, number>();

    const built: LimitWarningRow[] = [];
    for (const c of all) {
        const row = buildLimitWarningRow(
            c,
            accountCur,
            thresholdPct,
            scoreWarnDays,
            limitExpirationWarnDays,
            openArByCustomer.get(c.id) ?? 0,
            {
                useEffectiveLimit: accountHasTopUp,
                effectiveLimitInAccountCurrency:
                    effectiveLimitByCustomerId.get(c.id),
            }
        );
        if (row) {
            built.push(row);
        }
    }

    const q = options.query?.trim();
    let filtered = built;
    if (q) {
        filtered = built.filter((r) => {
            const tq = q.toLowerCase();
            return (
                r.customerName.toLowerCase().includes(tq) ||
                (r.policyNumber || "").toLowerCase().includes(tq)
            );
        });
    }

    const sortField = options.sortField || "totalAR";
    const sortDirection = options.sortDirection || "desc";
    const sorted = sortLimitWarningRows(filtered, sortField, sortDirection);
    const total = sorted.length;
    const page = sorted.slice(skip, skip + take);
    return { total, rows: page };
}

export type ZeroLimitWarningRow = {
    customerId: number;
    policyNumber: string | null;
    customerName: string;
    zeroLimitDate: string | null;
    totalAR: number;
    openInvoices: number;
    currency: string;
};

export async function getZeroLimitWarningReport(
    accountId: number,
    take: number,
    skip: number,
    options: CreditReportListOptions = {}
): Promise<{ total: number; rows: ZeroLimitWarningRow[] }> {
    const accountCur = await getAccountDisplayCurrency(accountId);
    const searchWhere = buildCustomerTextSearchWhere(options.query);
    const whereCust: Prisma.CustomerWhereInput = {
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
        prisma.customer.findMany({
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

    const { enrichCustomersWithPolicyScope } = await import(
        "./enrichCustomersWithActivePolicy"
    );
    const enriched = await enrichCustomersWithPolicyScope(
        allRaw,
        options.policyId
    );

    if (enriched.length === 0) {
        return { total: 0, rows: [] };
    }

    const ids = enriched.map((c) => c.id);
    const invoiceScope = scopedInvoiceWhere(accountId, options.policyId);

    // Group invoices by customer to get open invoices count
    const openCounts = await prisma.invoice.groupBy({
        by: ["customer_id"],
        where: {
            ...invoiceScope,
            customer_id: { in: ids },
            status: { notIn: CLOSED_INVOICE_STATUS },
        },
        _count: { _all: true },
    });

    const openMap = new Map<number, number>();
    for (const g of openCounts) {
        if (g.customer_id != null) {
            openMap.set(g.customer_id, g._count._all);
        }
    }

    const built: ZeroLimitWarningRow[] = enriched.map((c) => {
        return {
            customerId: c.id,
            policyNumber: c.InsurancePolicy?.policy_number ?? null,
            customerName: customerNameFromRow(c),
            zeroLimitDate: c.zero_limit_date
                ? new Date(c.zero_limit_date).toISOString().slice(0, 10)
                : null,
            totalAR: openArByCustomer.get(c.id) ?? 0,
            openInvoices: openMap.get(c.id) ?? 0,
            currency: displayCurrencyForCustomer(
                c,
                c.InsurancePolicy?.currency,
                accountCur
            ),
        };
    });

    const sortField = options.sortField || "totalAR";
    const sortDirection = options.sortDirection || "desc";
    const sorted = sortZeroLimitWarningRows(built, sortField, sortDirection);
    const total = sorted.length;
    const page = sorted.slice(skip, skip + take);
    return { total, rows: page };
}

function sortZeroLimitWarningRows(
    rows: ZeroLimitWarningRow[],
    sortField: string,
    sortDirection: "asc" | "desc"
): ZeroLimitWarningRow[] {
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
