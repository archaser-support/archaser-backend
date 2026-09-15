/**
 * Post-query enrichment for credit dashboard ViewBased customer reports.
 * Supplies legacy CreditInsuranceReportGrid metrics (open AR, policy risk, etc.).
 */

import { Prisma, invoice_status as InvoiceStatus } from "@prisma/client";
import type { invoice_status } from "@prisma/client";

import { prisma } from "../domain-db";
import { resolveAccountDisplayLanguage } from "./reportExecutionVirtualFields-stub";
import { getCustomerPolicyRow } from "./reportCustomerPolicyFields-stub";
import { computeCustomerRiskExposure } from "./invoiceInsuranceFields";
import {
    isFullOpenArAtRiskCustomer,
    uncoveredExposureFieldsFromPolicyLink,
} from "./shared/policyExclusion";

import {
    fetchAtRiskInvoiceInputsByCustomerMap,
    fetchOpenReceivableByCustomerMap,
    type LimitWarningRow,
} from "./creditInsuranceDashboardService";
import { getTopUpExpiringReport } from "./creditInsuranceTopUpDashboardService";
import { fetchExposureReconciliationPeriodCustomers } from "./exposureReconciliationPeriod";
import { fetchNegativeCostPeriodCustomers } from "./negativeCostPeriod";
import { fetchOvershootLimitCappedPeriodCustomers } from "./overshootLimitCappedPeriod";
import { fetchStaleSlopeVolatilityPeriodCustomers } from "./staleSlopeVolatilityPeriod";
import { fetchAsOfUtilizationByCustomerIds } from "./utilizationBinReport";
import { fetchPolicyConcentrationRankingRows } from "./policyConcentrationPeriod";
import { fetchLimitBreachForecastPeriodCustomers } from "./limitBreachForecastPeriod";
import {
    breachEpisodeReportFields,
    fetchBreachDilutionStreakPeriodCustomers,
} from "./breachDilutionStreakPeriod";
import type { CustomerBreachDilutionStreakRow } from "./shared/ctpBreachDilutionStreakMetrics";

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
    "at_risk_exposure",
    "limit_warning_summary",
    "top_up_type",
    "top_up_value",
    "top_up_resolved_amount",
    "top_up_end_date",
    "top_up_days_left",
    "as_of_utilization_pct",
    "as_of_usage_amount",
    "period_days_available",
    "period_ar_volatility_sigma_pct",
    "period_ar_extreme_move_count",
    "period_ar_worst_extreme_pct",
    "period_ar_worst_extreme_date",
    "period_stale_day_count",
    "period_health_slope",
    "period_health_momentum",
    "period_avg_overshoot_pts",
    "period_max_overshoot_pts",
    "period_max_overshoot_date",
    "period_avg_usage_pct",
    "period_peak_usage_pct",
    "period_peak_usage_date",
    "period_overshoot_days_with_limit",
    "period_days_above_limit",
    "period_longest_above_limit_days",
    "period_limit_capped",
    "period_limit_capped_ar_growth_pct",
    "period_limit_capped_compliant_growth_pct",
    "period_limit_capped_compliant_cv",
    "period_limit_capped_ar_cv",
    "period_negative_cost_entry_count",
    "period_negative_cost_sum",
    "period_worst_negative_cost_amount",
    "period_worst_negative_cost_date",
    "period_recon_fail_count",
    "period_recon_max_abs_delta",
    "period_recon_worst_delta_date",
    "period_at_risk_exceeds_total_count",
    "period_at_risk_exceeds_total_max",
    "period_policy_ar_share_pct",
    "period_policy_open_ar",
    "period_policy_top1_share_pct",
    "period_policy_top3_share_pct",
    "period_concentration_alert",
    "period_concentration_as_of_date",
    "period_forecast_status",
    "period_projected_threshold_pct",
    "period_projected_date",
    "period_projected_days_to_threshold",
    "period_projected_current_usage_pct",
    "period_projected_r_squared",
    "period_breach_dilution_classification",
    "period_breach_dilution_ar_growth_pct",
    "period_breach_dilution_breach_first",
    "period_breach_dilution_breach_last",
    "period_breach_dilution_breach_change_pct",
    "period_breach_dilution_health_rise_pts",
    "period_breach_status",
    "period_breach_streak_days",
    "period_breach_episode_count",
    "period_breach_episodes_summary",
    "period_breach_last_episode_start",
    "period_breach_last_episode_end",
    "period_breach_last_episode_ongoing",
    "period_breach_last_episode_days",
    "period_breach_last_episode_peak",
    "period_longest_breach_streak_days",
]);

const PERIOD_SLOPE_VOL_FIELDS = [
    "period_ar_volatility_sigma_pct",
    "period_ar_extreme_move_count",
    "period_ar_worst_extreme_pct",
    "period_ar_worst_extreme_date",
    "period_stale_day_count",
    "period_health_slope",
    "period_health_momentum",
] as const;

const PERIOD_OVERSHOOT_FIELDS = [
    "period_avg_overshoot_pts",
    "period_max_overshoot_pts",
    "period_max_overshoot_date",
    "period_avg_usage_pct",
    "period_peak_usage_pct",
    "period_peak_usage_date",
    "period_overshoot_days_with_limit",
    "period_days_above_limit",
    "period_longest_above_limit_days",
    "period_days_available",
    "period_limit_capped",
    "period_limit_capped_ar_growth_pct",
    "period_limit_capped_compliant_growth_pct",
    "period_limit_capped_compliant_cv",
    "period_limit_capped_ar_cv",
] as const;

const PERIOD_NEGATIVE_COST_FIELDS = [
    "period_negative_cost_entry_count",
    "period_negative_cost_sum",
    "period_worst_negative_cost_amount",
    "period_worst_negative_cost_date",
] as const;

const PERIOD_RECONCILIATION_FIELDS = [
    "period_recon_fail_count",
    "period_recon_max_abs_delta",
    "period_recon_worst_delta_date",
    "period_at_risk_exceeds_total_count",
    "period_at_risk_exceeds_total_max",
] as const;

const PERIOD_CONCENTRATION_FIELDS = [
    "period_policy_ar_share_pct",
    "period_policy_open_ar",
    "period_policy_top1_share_pct",
    "period_policy_top3_share_pct",
    "period_concentration_alert",
    "period_concentration_as_of_date",
] as const;

const PERIOD_FORECAST_FIELDS = [
    "period_forecast_status",
    "period_projected_threshold_pct",
    "period_projected_date",
    "period_projected_days_to_threshold",
    "period_projected_current_usage_pct",
    "period_projected_r_squared",
] as const;

const PERIOD_BREACH_DILUTION_FIELDS = [
    "period_breach_dilution_classification",
    "period_breach_dilution_ar_growth_pct",
    "period_breach_dilution_breach_first",
    "period_breach_dilution_breach_last",
    "period_breach_dilution_breach_change_pct",
    "period_breach_dilution_health_rise_pts",
] as const;

const PERIOD_BREACH_EPISODE_FIELDS = [
    "period_breach_status",
    "period_breach_streak_days",
    "period_breach_episode_count",
    "period_breach_episodes_summary",
    "period_breach_last_episode_start",
    "period_breach_last_episode_end",
    "period_breach_last_episode_ongoing",
    "period_breach_last_episode_days",
    "period_breach_last_episode_peak",
    "period_longest_breach_streak_days",
] as const;

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
        INNER JOIN "Customer" c ON c.id = i.customer_id
        WHERE i.account_id = ${accountId}
          AND c.account_id = ${accountId}
          AND c.collection_status IN ('Active', 'Inactive')
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
        projected: (threshold: number, date: string) =>
            `Projected: reach ${threshold}% by ${date}`,
    },
    he: {
        nearLimit: (pct: number) => `${pct}% ממסגרת מאושרת`,
        scoreExp: (days: number) => `תוקף ציון אשראי בעוד ${days} ימים`,
        limitExp: (days: number) => `תוקף המסגרת יפוג בעוד ${days} ימים`,
        projected: (threshold: number, date: string) =>
            `תחזית: להגיע ל־${threshold}% עד ${date}`,
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
        | "projected"
        | "projectedThresholdPct"
        | "projectedDate"
    >,
    accountLanguage?: string | null
): string {
    const language = resolveAccountDisplayLanguage(accountLanguage) as
        keyof typeof LIMIT_WARNING_LABELS;
    const labels =
        LIMIT_WARNING_LABELS[language] ?? LIMIT_WARNING_LABELS.en;
    const parts: string[] = [];
    if (
        row.projected &&
        row.projectedThresholdPct != null &&
        row.projectedDate
    ) {
        parts.push(
            labels.projected(row.projectedThresholdPct, row.projectedDate)
        );
    }
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
    /** YYYY-MM-DD; required when as_of_* fields are requested (single-day or range end). */
    asOfDate?: string;
    /** When set with toDate (or asOfDate), averages utilization over the range. */
    fromDate?: string;
    toDate?: string;
    /** Align period gap/over-limit series with membership toggle; default true. */
    includeNoPolicyExposure?: boolean;
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
        fields.has("policy_risk_allocated") ||
        fields.has("at_risk_exposure");
    const needsOpenInvoices = fields.has("open_invoice_count");
    const needsTermsBreach = fields.has("terms_breach_outstanding");
    const needsPolicyRisk =
        fields.has("policy_risk_allocated") || fields.has("at_risk_exposure");
    const needsWarningSummary = fields.has("limit_warning_summary");
    const needsAsOfUtilization =
        fields.has("as_of_utilization_pct") || fields.has("as_of_usage_amount");
    const needsPeriodSlopeVol = PERIOD_SLOPE_VOL_FIELDS.some((f) =>
        fields.has(f)
    );
    const needsPeriodOvershoot = PERIOD_OVERSHOOT_FIELDS.some((f) =>
        fields.has(f)
    );
    const needsPeriodNegativeCost = PERIOD_NEGATIVE_COST_FIELDS.some((f) =>
        fields.has(f)
    );
    const needsPeriodReconciliation = PERIOD_RECONCILIATION_FIELDS.some((f) =>
        fields.has(f)
    );
    const needsPeriodConcentration = PERIOD_CONCENTRATION_FIELDS.some((f) =>
        fields.has(f)
    );
    const needsPeriodForecast = PERIOD_FORECAST_FIELDS.some((f) =>
        fields.has(f)
    );
    const needsPeriodBreachDilution = PERIOD_BREACH_DILUTION_FIELDS.some((f) =>
        fields.has(f)
    );
    const needsPeriodBreachEpisodes = PERIOD_BREACH_EPISODE_FIELDS.some((f) =>
        fields.has(f)
    );
    const needsPeriodBreachDilutionStreak =
        needsPeriodBreachDilution || needsPeriodBreachEpisodes;

    const [
        openArByCustomer,
        openInvoiceByCustomer,
        termsOutstandingByCustomer,
        atRiskInvoicesByCustomer,
        asOfByCustomer,
        periodSlopeVolByCustomer,
        periodOvershootByCustomer,
        periodNegativeCostByCustomer,
        periodReconByCustomer,
        periodConcentrationByCustomer,
        periodForecastByCustomer,
        periodBreachDilutionStreakByCustomer,
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
            ? fetchAtRiskInvoiceInputsByCustomerMap(options.accountId, {
                  policyId: options.policyId,
                  customerIds,
              })
            : Promise.resolve(new Map()),
        needsAsOfUtilization && (options.fromDate || options.asOfDate)
            ? fetchAsOfUtilizationByCustomerIds({
                  accountId: options.accountId,
                  asOfDate: options.asOfDate || options.toDate || options.fromDate!,
                  fromDate: options.fromDate,
                  toDate: options.toDate || options.asOfDate,
                  customerIds,
                  policyId: options.policyId,
              }).catch(() => {
                  // As-of CPT is optional; never blank Open AR / other metrics.
                  return new Map<
                      number,
                      { utilizationPct: number; usageAmount: number }
                  >();
              })
            : Promise.resolve(
                  new Map<
                      number,
                      { utilizationPct: number; usageAmount: number }
                  >()
              ),
        needsPeriodSlopeVol && (options.fromDate || options.asOfDate)
            ? fetchStaleSlopeVolatilityPeriodCustomers({
                  accountId: options.accountId,
                  fromDate:
                      options.fromDate ||
                      options.asOfDate ||
                      options.toDate ||
                      "",
                  toDate:
                      options.toDate ||
                      options.asOfDate ||
                      options.fromDate ||
                      "",
                  policyId: options.policyId,
                  scopedCustomerIds: customerIds,
                  includeNoPolicyExposure:
                      options.includeNoPolicyExposure !== false,
              })
                  .then((periodRows) => {
                      const map = new Map(
                          periodRows.map((r) => [r.customerId, r] as const)
                      );
                      return map;
                  })
                  .catch(() => new Map())
            : Promise.resolve(new Map()),
        needsPeriodOvershoot && (options.fromDate || options.asOfDate)
            ? fetchOvershootLimitCappedPeriodCustomers({
                  accountId: options.accountId,
                  fromDate:
                      options.fromDate ||
                      options.asOfDate ||
                      options.toDate ||
                      "",
                  toDate:
                      options.toDate ||
                      options.asOfDate ||
                      options.fromDate ||
                      "",
                  policyId: options.policyId,
                  scopedCustomerIds: customerIds,
                  includeNoPolicyExposure:
                      options.includeNoPolicyExposure !== false,
              })
                  .then((periodRows) => {
                      const map = new Map(
                          periodRows.map((r) => [r.customerId, r] as const)
                      );
                      return map;
                  })
                  .catch(() => new Map())
            : Promise.resolve(new Map()),
        needsPeriodNegativeCost && (options.fromDate || options.asOfDate)
            ? fetchNegativeCostPeriodCustomers({
                  accountId: options.accountId,
                  fromDate:
                      options.fromDate ||
                      options.asOfDate ||
                      options.toDate ||
                      "",
                  toDate:
                      options.toDate ||
                      options.asOfDate ||
                      options.fromDate ||
                      "",
                  policyId: options.policyId,
                  scopedCustomerIds: customerIds,
                  includeNoPolicyExposure:
                      options.includeNoPolicyExposure !== false,
              })
                  .then((periodRows) => {
                      const map = new Map(
                          periodRows.map((r) => [r.customerId, r] as const)
                      );
                      return map;
                  })
                  .catch(() => new Map())
            : Promise.resolve(new Map()),
        needsPeriodReconciliation && (options.fromDate || options.asOfDate)
            ? fetchExposureReconciliationPeriodCustomers({
                  accountId: options.accountId,
                  fromDate:
                      options.fromDate ||
                      options.asOfDate ||
                      options.toDate ||
                      "",
                  toDate:
                      options.toDate ||
                      options.asOfDate ||
                      options.fromDate ||
                      "",
                  policyId: options.policyId,
                  scopedCustomerIds: customerIds,
                  includeNoPolicyExposure:
                      options.includeNoPolicyExposure !== false,
              })
                  .then((periodRows) => {
                      const map = new Map(
                          periodRows.map((r) => [r.customerId, r] as const)
                      );
                      return map;
                  })
                  .catch(() => new Map())
            : Promise.resolve(new Map()),
        needsPeriodConcentration && (options.fromDate || options.asOfDate)
            ? fetchPolicyConcentrationRankingRows({
                  accountId: options.accountId,
                  fromDate:
                      options.fromDate ||
                      options.asOfDate ||
                      options.toDate ||
                      "",
                  toDate:
                      options.toDate ||
                      options.asOfDate ||
                      options.fromDate ||
                      "",
                  policyId: options.policyId,
                  scopedCustomerIds: customerIds,
                  includeNoPolicyExposure:
                      options.includeNoPolicyExposure !== false,
              })
                  .then((periodRows) => {
                      // One row per customer — if multi-policy, keep highest share.
                      const map = new Map<number, (typeof periodRows)[number]>();
                      for (const r of periodRows) {
                          const prev = map.get(r.customerId);
                          if (
                              prev == null ||
                              r.sharePct > prev.sharePct
                          ) {
                              map.set(r.customerId, r);
                          }
                      }
                      return map;
                  })
                  .catch(() => new Map())
            : Promise.resolve(new Map()),
        needsPeriodForecast
            ? fetchLimitBreachForecastPeriodCustomers({
                  accountId: options.accountId,
                  toDate:
                      options.toDate ||
                      options.asOfDate ||
                      undefined,
                  policyId: options.policyId,
                  scopedCustomerIds: customerIds,
                  includeNoPolicyExposure:
                      options.includeNoPolicyExposure !== false,
              })
                  .then((periodRows) => {
                      const map = new Map(
                          periodRows.map((r) => [r.customerId, r] as const)
                      );
                      return map;
                  })
                  .catch(() => new Map())
            : Promise.resolve(new Map()),
        needsPeriodBreachDilutionStreak && (options.fromDate || options.asOfDate)
            ? fetchBreachDilutionStreakPeriodCustomers({
                  accountId: options.accountId,
                  fromDate:
                      options.fromDate ||
                      options.asOfDate ||
                      options.toDate ||
                      "",
                  toDate:
                      options.toDate ||
                      options.asOfDate ||
                      options.fromDate ||
                      "",
                  policyId: options.policyId,
                  scopedCustomerIds: customerIds,
                  includeNoPolicyExposure:
                      options.includeNoPolicyExposure !== false,
              })
                  .then((periodRows) => {
                      const map = new Map(
                          periodRows.map((r) => [r.customerId, r] as const)
                      );
                      return map;
                  })
                  .catch(() => new Map<number, CustomerBreachDilutionStreakRow>())
            : Promise.resolve(new Map<number, CustomerBreachDilutionStreakRow>()),
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
        if (needsPolicyRisk) {
            const ar = openArByCustomer.get(customerId) ?? 0;
            const policy = getCustomerPolicyRow(row);
            const uncovered = isFullOpenArAtRiskCustomer(
                uncoveredExposureFieldsFromPolicyLink({
                    insurancePolicyId:
                        policy?.insurance_policy_id as number | null | undefined,
                    exclusionReason: policy?.policy_exclusion_reason ?? null,
                })
            );
            const gapCard = Math.max(
                0,
                Number(
                    (policy as { capacity_gap_amount?: number | null } | null)
                        ?.capacity_gap_amount ?? 0
                )
            );
            const invoiceAllocated = computeCustomerRiskExposure({
                uncovered: false,
                totalAr: ar,
                invoices: atRiskInvoicesByCustomer.get(customerId) ?? [],
                capacityGapAmount: gapCard,
            });
            if (fields.has("policy_risk_allocated")) {
                enriched.policy_risk_allocated = invoiceAllocated;
            }
            if (fields.has("at_risk_exposure")) {
                enriched.at_risk_exposure = uncovered ? ar : invoiceAllocated;
            }
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
        if (needsAsOfUtilization) {
            const asOf = asOfByCustomer.get(customerId);
            if (fields.has("as_of_utilization_pct")) {
                enriched.as_of_utilization_pct = asOf?.utilizationPct ?? null;
            }
            if (fields.has("as_of_usage_amount")) {
                enriched.as_of_usage_amount = asOf?.usageAmount ?? null;
            }
        }
        if (needsPeriodSlopeVol) {
            const period = periodSlopeVolByCustomer.get(customerId);
            if (fields.has("period_ar_volatility_sigma_pct")) {
                enriched.period_ar_volatility_sigma_pct =
                    period?.arVolatility.sigmaPct != null
                        ? period.arVolatility.sigmaPct * 100
                        : null;
            }
            if (fields.has("period_ar_extreme_move_count")) {
                enriched.period_ar_extreme_move_count =
                    period?.extremeMoveCount ?? 0;
            }
            if (fields.has("period_ar_worst_extreme_pct")) {
                enriched.period_ar_worst_extreme_pct =
                    period?.worstExtremePctChange != null
                        ? period.worstExtremePctChange * 100
                        : null;
            }
            if (fields.has("period_ar_worst_extreme_date")) {
                enriched.period_ar_worst_extreme_date =
                    period?.worstExtremeDate ?? null;
            }
            if (fields.has("period_stale_day_count")) {
                enriched.period_stale_day_count = period?.staleDayCount ?? 0;
            }
            if (fields.has("period_health_slope")) {
                enriched.period_health_slope =
                    period?.healthMomentum.slope ?? null;
            }
            if (fields.has("period_health_momentum")) {
                enriched.period_health_momentum =
                    period?.healthMomentum.classification ?? null;
            }
        }
        if (needsPeriodOvershoot) {
            const period = periodOvershootByCustomer.get(customerId);
            if (fields.has("period_avg_overshoot_pts")) {
                enriched.period_avg_overshoot_pts =
                    period?.avgOvershootPts ?? null;
            }
            if (fields.has("period_max_overshoot_pts")) {
                enriched.period_max_overshoot_pts =
                    period?.maxOvershootPts ?? null;
            }
            if (fields.has("period_max_overshoot_date")) {
                enriched.period_max_overshoot_date =
                    period?.maxOvershootDate ?? null;
            }
            if (fields.has("period_avg_usage_pct")) {
                enriched.period_avg_usage_pct = period?.avgUsagePct ?? null;
            }
            if (fields.has("period_peak_usage_pct")) {
                enriched.period_peak_usage_pct = period?.peakUsagePct ?? null;
            }
            if (fields.has("period_peak_usage_date")) {
                enriched.period_peak_usage_date = period?.peakUsageDate ?? null;
            }
            if (fields.has("period_overshoot_days_with_limit")) {
                enriched.period_overshoot_days_with_limit =
                    period?.daysWithLimit ?? 0;
            }
            if (fields.has("period_days_above_limit")) {
                enriched.period_days_above_limit =
                    period?.daysAboveLimit ?? 0;
            }
            if (fields.has("period_longest_above_limit_days")) {
                enriched.period_longest_above_limit_days =
                    period?.longestAboveLimitStreak.days ?? 0;
            }
            if (fields.has("period_days_available")) {
                enriched.period_days_available = period?.daysAvailable ?? 0;
            }
            if (fields.has("period_limit_capped")) {
                enriched.period_limit_capped =
                    period?.limitCapped.limitCapped ?? false;
            }
            if (fields.has("period_limit_capped_ar_growth_pct")) {
                enriched.period_limit_capped_ar_growth_pct =
                    period?.limitCapped.totalArGrowthPct != null
                        ? period.limitCapped.totalArGrowthPct * 100
                        : null;
            }
            if (fields.has("period_limit_capped_compliant_growth_pct")) {
                enriched.period_limit_capped_compliant_growth_pct =
                    period?.limitCapped.compliantGrowthPct != null
                        ? period.limitCapped.compliantGrowthPct * 100
                        : null;
            }
            if (fields.has("period_limit_capped_compliant_cv")) {
                enriched.period_limit_capped_compliant_cv =
                    period?.limitCapped.compliantCv != null
                        ? period.limitCapped.compliantCv * 100
                        : null;
            }
            if (fields.has("period_limit_capped_ar_cv")) {
                enriched.period_limit_capped_ar_cv =
                    period?.limitCapped.totalArCv != null
                        ? period.limitCapped.totalArCv * 100
                        : null;
            }
        }
        if (needsPeriodNegativeCost) {
            const period = periodNegativeCostByCustomer.get(customerId);
            if (fields.has("period_negative_cost_entry_count")) {
                enriched.period_negative_cost_entry_count =
                    period?.negativeEntryCount ?? 0;
            }
            if (fields.has("period_negative_cost_sum")) {
                enriched.period_negative_cost_sum =
                    period?.negativeEntrySum ?? 0;
            }
            if (fields.has("period_worst_negative_cost_amount")) {
                enriched.period_worst_negative_cost_amount =
                    period?.worstNegativeAmount ?? null;
            }
            if (fields.has("period_worst_negative_cost_date")) {
                enriched.period_worst_negative_cost_date =
                    period?.worstNegativeDate ?? null;
            }
        }
        if (needsPeriodReconciliation) {
            const period = periodReconByCustomer.get(customerId);
            if (fields.has("period_recon_fail_count")) {
                enriched.period_recon_fail_count =
                    period?.failingRowCount ?? 0;
            }
            if (fields.has("period_recon_max_abs_delta")) {
                enriched.period_recon_max_abs_delta =
                    period?.maxAbsDelta ?? null;
            }
            if (fields.has("period_recon_worst_delta_date")) {
                enriched.period_recon_worst_delta_date =
                    period?.worstDeltaDate ?? null;
            }
            if (fields.has("period_at_risk_exceeds_total_count")) {
                enriched.period_at_risk_exceeds_total_count =
                    period?.atRiskExceedsTotalRowCount ?? 0;
            }
            if (fields.has("period_at_risk_exceeds_total_max")) {
                enriched.period_at_risk_exceeds_total_max =
                    period?.maxAtRiskExcess ?? null;
            }
        }
        if (needsPeriodConcentration) {
            const period = periodConcentrationByCustomer.get(customerId);
            if (fields.has("period_policy_ar_share_pct")) {
                enriched.period_policy_ar_share_pct =
                    period?.sharePct ?? null;
            }
            if (fields.has("period_policy_open_ar")) {
                enriched.period_policy_open_ar = period?.openAr ?? null;
            }
            if (fields.has("period_policy_top1_share_pct")) {
                enriched.period_policy_top1_share_pct =
                    period?.top1SharePct ?? null;
            }
            if (fields.has("period_policy_top3_share_pct")) {
                enriched.period_policy_top3_share_pct =
                    period?.top3SharePct ?? null;
            }
            if (fields.has("period_concentration_alert")) {
                enriched.period_concentration_alert =
                    period?.concentrationAlert ?? false;
            }
            if (fields.has("period_concentration_as_of_date")) {
                enriched.period_concentration_as_of_date =
                    period?.asOfDate ?? null;
            }
        }
        if (needsPeriodForecast) {
            const period = periodForecastByCustomer.get(customerId);
            const primary = period?.primary;
            if (fields.has("period_forecast_status")) {
                enriched.period_forecast_status =
                    primary?.status ??
                    period?.thresholds.find(
                        (t: { status: string }) => t.status === "trending_away"
                    )?.status ??
                    (period?.suppressed ? "suppressed" : null);
            }
            if (fields.has("period_projected_threshold_pct")) {
                enriched.period_projected_threshold_pct =
                    primary?.thresholdPct ?? null;
            }
            if (fields.has("period_projected_date")) {
                enriched.period_projected_date =
                    primary?.projectedDate ?? null;
            }
            if (fields.has("period_projected_days_to_threshold")) {
                enriched.period_projected_days_to_threshold =
                    primary?.daysToThreshold ?? null;
            }
            if (fields.has("period_projected_current_usage_pct")) {
                enriched.period_projected_current_usage_pct =
                    period?.currentUsagePct ?? null;
            }
            if (fields.has("period_projected_r_squared")) {
                enriched.period_projected_r_squared =
                    period?.rSquared ?? null;
            }
        }
        if (needsPeriodBreachDilutionStreak) {
            const period = periodBreachDilutionStreakByCustomer.get(customerId);
            if (needsPeriodBreachDilution) {
                if (fields.has("period_breach_dilution_classification")) {
                    enriched.period_breach_dilution_classification =
                        period?.classification ?? null;
                }
                if (fields.has("period_breach_dilution_ar_growth_pct")) {
                    enriched.period_breach_dilution_ar_growth_pct =
                        period?.arGrowthPct != null
                            ? period.arGrowthPct * 100
                            : null;
                }
                if (fields.has("period_breach_dilution_breach_first")) {
                    enriched.period_breach_dilution_breach_first =
                        period?.breachFirst ?? null;
                }
                if (fields.has("period_breach_dilution_breach_last")) {
                    enriched.period_breach_dilution_breach_last =
                        period?.breachLast ?? null;
                }
                if (fields.has("period_breach_dilution_breach_change_pct")) {
                    enriched.period_breach_dilution_breach_change_pct =
                        period?.breachChangePct != null
                            ? period.breachChangePct * 100
                            : null;
                }
                if (fields.has("period_breach_dilution_health_rise_pts")) {
                    enriched.period_breach_dilution_health_rise_pts =
                        period?.healthRisePts ?? null;
                }
            }
            if (needsPeriodBreachEpisodes && period != null) {
                const episodeFields = breachEpisodeReportFields(period);
                if (fields.has("period_breach_status")) {
                    enriched.period_breach_status =
                        episodeFields.period_breach_status;
                }
                if (fields.has("period_breach_streak_days")) {
                    enriched.period_breach_streak_days =
                        episodeFields.period_breach_streak_days;
                }
                if (fields.has("period_breach_episode_count")) {
                    enriched.period_breach_episode_count =
                        episodeFields.period_breach_episode_count;
                }
                if (fields.has("period_breach_episodes_summary")) {
                    enriched.period_breach_episodes_summary =
                        episodeFields.period_breach_episodes_summary;
                }
                if (fields.has("period_breach_last_episode_start")) {
                    enriched.period_breach_last_episode_start =
                        episodeFields.period_breach_last_episode_start;
                }
                if (fields.has("period_breach_last_episode_end")) {
                    enriched.period_breach_last_episode_end =
                        episodeFields.period_breach_last_episode_end;
                }
                if (fields.has("period_breach_last_episode_ongoing")) {
                    enriched.period_breach_last_episode_ongoing =
                        episodeFields.period_breach_last_episode_ongoing;
                }
                if (fields.has("period_breach_last_episode_days")) {
                    enriched.period_breach_last_episode_days =
                        episodeFields.period_breach_last_episode_days;
                }
                if (fields.has("period_breach_last_episode_peak")) {
                    enriched.period_breach_last_episode_peak =
                        episodeFields.period_breach_last_episode_peak;
                }
                if (fields.has("period_longest_breach_streak_days")) {
                    enriched.period_longest_breach_streak_days =
                        episodeFields.period_longest_breach_streak_days;
                }
            } else if (needsPeriodBreachEpisodes) {
                if (fields.has("period_breach_status")) {
                    enriched.period_breach_status = "none";
                }
                if (fields.has("period_breach_streak_days")) {
                    enriched.period_breach_streak_days = 0;
                }
                if (fields.has("period_breach_episode_count")) {
                    enriched.period_breach_episode_count = 0;
                }
                if (fields.has("period_breach_episodes_summary")) {
                    enriched.period_breach_episodes_summary = "";
                }
                if (fields.has("period_breach_last_episode_start")) {
                    enriched.period_breach_last_episode_start = null;
                }
                if (fields.has("period_breach_last_episode_end")) {
                    enriched.period_breach_last_episode_end = null;
                }
                if (fields.has("period_breach_last_episode_ongoing")) {
                    enriched.period_breach_last_episode_ongoing = false;
                }
                if (fields.has("period_breach_last_episode_days")) {
                    enriched.period_breach_last_episode_days = null;
                }
                if (fields.has("period_breach_last_episode_peak")) {
                    enriched.period_breach_last_episode_peak = null;
                }
                if (fields.has("period_longest_breach_streak_days")) {
                    enriched.period_longest_breach_streak_days = 0;
                }
            }
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
    "at_risk_exposure",
    "top_up_days_left",
    "top_up_value",
    "top_up_resolved_amount",
    "as_of_utilization_pct",
    "as_of_usage_amount",
    "period_days_available",
]);

export function isCreditDashboardEnrichedSortField(
    field: string | undefined
): boolean {
    if (field == null) {
        return false;
    }
    const normalized = field.startsWith("Customer.")
        ? field.slice("Customer.".length)
        : field;
    return ENRICHED_IN_MEMORY_SORT_FIELDS.has(normalized);
}

export function sortCreditDashboardEnrichedRows(
    rows: any[],
    sortField: string,
    sortDirection: "asc" | "desc" | "ASC" | "DESC" = "desc"
): any[] {
    const leaf = sortField.startsWith("Customer.")
        ? sortField.slice("Customer.".length)
        : sortField;
    const sign = String(sortDirection).toLowerCase() === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = a[leaf];
        const bv = b[leaf];
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
