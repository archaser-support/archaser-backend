import { cost_calculation_method, Prisma, type customer_limit_type } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";

import { termsBreachByReasonSnapshotToJson } from "./customerPolicyTrendTermsBreachByReason";
import type { TermsBreachByReasonSnapshot } from "./customerPolicyTrendTermsBreachByReason";

/** Tunable chunk size for multi-row CustomerPolicyTrend upserts. */
export const CUSTOMER_POLICY_TREND_BATCH_UPSERT_CHUNK_SIZE = 200;

export type CustomerPolicyTrendUpsertRow = {
    accountId: number;
    customerId: number;
    insurancePolicyId: number | null;
    customerPolicyId: number;
    snapshotDate: Date;
    approvedLimit: Prisma.Decimal | null;
    usageAmount: number;
    topUpTotal: Prisma.Decimal | null;
    activeTopUpCount: number | null;
    effectiveApprovedLimit: Prisma.Decimal | null;
    customerNumberPolicy: string | null;
    approvedLimitCurrency: string | null;
    approvedLimitExpirationDate: Date | null;
    limitType: customer_limit_type | null;
    maxPaymentTerm: number | null;
    maxAllowedMep: number | null;
    reportingDays: number | null;
    mepCutoffDayOfMonth: number | null;
    mepSubstituteDayOfMonth: number | null;
    reportingCutoffDayOfMonth: number | null;
    reportingSubstituteDayOfMonth: number | null;
    paymentTermCutoffDayOfMonth: number | null;
    paymentTermSubstituteDayOfMonth: number | null;
    excludedFromPolicy: boolean;
    policyExclusionReason: string | null;
    creditScore: Prisma.Decimal | null;
    creditScoreInputDate: Date | null;
    activeCustomerSince: Date | null;
    outdatedDcl: boolean;
    policyDailyCost: Prisma.Decimal | null;
    policyCostCurrency: string | null;
    topUpDailyCost: Prisma.Decimal | null;
    topUpCostCurrency: string | null;
    totalDailyCost: Prisma.Decimal | null;
    costCalculationMethod: cost_calculation_method | null;
    costPercent: Prisma.Decimal | null;
    registrationFeePercent: Prisma.Decimal | null;
    financialCurrency: string | null;
    totalReceivables: number;
    healthIndex: number;
    atRiskExposure: number;
    compliantExposure: number;
    termsBreachAmount: number;
    capacityGapAmount: number;
    termsBreachCount: number;
    termsBreachByReason: TermsBreachByReasonSnapshot;
    policyUsagePct: number | null;
    topUpUsagePct: number | null;
    effectiveUsagePct: number | null;
};

const ON_CONFLICT_UPDATE = Prisma.sql`
    DO UPDATE SET
        account_id = EXCLUDED.account_id,
        insurance_policy_id = EXCLUDED.insurance_policy_id,
        approved_limit = EXCLUDED.approved_limit,
        usage_amount = EXCLUDED.usage_amount,
        top_up_total = EXCLUDED.top_up_total,
        active_top_up_count = EXCLUDED.active_top_up_count,
        effective_approved_limit = EXCLUDED.effective_approved_limit,
        customer_number_policy = EXCLUDED.customer_number_policy,
        approved_limit_currency = EXCLUDED.approved_limit_currency,
        approved_limit_expiration_date = EXCLUDED.approved_limit_expiration_date,
        limit_type = EXCLUDED.limit_type,
        max_payment_term = EXCLUDED.max_payment_term,
        max_allowed_mep = EXCLUDED.max_allowed_mep,
        reporting_days = EXCLUDED.reporting_days,
        mep_cutoff_day_of_month = EXCLUDED.mep_cutoff_day_of_month,
        mep_substitute_day_of_month = EXCLUDED.mep_substitute_day_of_month,
        reporting_cutoff_day_of_month = EXCLUDED.reporting_cutoff_day_of_month,
        reporting_substitute_day_of_month = EXCLUDED.reporting_substitute_day_of_month,
        payment_term_cutoff_day_of_month = EXCLUDED.payment_term_cutoff_day_of_month,
        payment_term_substitute_day_of_month = EXCLUDED.payment_term_substitute_day_of_month,
        excluded_from_policy = EXCLUDED.excluded_from_policy,
        policy_exclusion_reason = EXCLUDED.policy_exclusion_reason,
        credit_score = EXCLUDED.credit_score,
        credit_score_input_date = EXCLUDED.credit_score_input_date,
        active_customer_since = EXCLUDED.active_customer_since,
        outdated_dcl = EXCLUDED.outdated_dcl,
        policy_daily_cost = EXCLUDED.policy_daily_cost,
        policy_cost_currency = EXCLUDED.policy_cost_currency,
        top_up_daily_cost = EXCLUDED.top_up_daily_cost,
        top_up_cost_currency = EXCLUDED.top_up_cost_currency,
        total_daily_cost = EXCLUDED.total_daily_cost,
        cost_calculation_method = EXCLUDED.cost_calculation_method,
        cost_percent = EXCLUDED.cost_percent,
        registration_fee_percent = EXCLUDED.registration_fee_percent,
        financial_currency = EXCLUDED.financial_currency,
        total_receivables = EXCLUDED.total_receivables,
        health_index = EXCLUDED.health_index,
        at_risk_exposure = EXCLUDED.at_risk_exposure,
        compliant_exposure = EXCLUDED.compliant_exposure,
        terms_breach_amount = EXCLUDED.terms_breach_amount,
        capacity_gap_amount = EXCLUDED.capacity_gap_amount,
        terms_breach_count = EXCLUDED.terms_breach_count,
        terms_breach_by_reason = EXCLUDED.terms_breach_by_reason,
        policy_usage_pct = EXCLUDED.policy_usage_pct,
        top_up_usage_pct = EXCLUDED.top_up_usage_pct,
        effective_usage_pct = EXCLUDED.effective_usage_pct,
        modified_at = NOW()
`;

function rowToValuesSql(row: CustomerPolicyTrendUpsertRow): Prisma.Sql {
    return Prisma.sql`(
        ${row.accountId},
        ${row.customerId},
        ${row.insurancePolicyId},
        ${row.customerPolicyId},
        ${row.snapshotDate}::date,
        ${row.approvedLimit},
        ${row.usageAmount},
        ${row.topUpTotal},
        ${row.activeTopUpCount},
        ${row.effectiveApprovedLimit},
        ${row.customerNumberPolicy},
        ${row.approvedLimitCurrency},
        ${row.approvedLimitExpirationDate},
        ${row.limitType}::"customer_limit_type",
        ${row.maxPaymentTerm},
        ${row.maxAllowedMep},
        ${row.reportingDays},
        ${row.mepCutoffDayOfMonth},
        ${row.mepSubstituteDayOfMonth},
        ${row.reportingCutoffDayOfMonth},
        ${row.reportingSubstituteDayOfMonth},
        ${row.paymentTermCutoffDayOfMonth},
        ${row.paymentTermSubstituteDayOfMonth},
        ${row.excludedFromPolicy},
        ${row.policyExclusionReason},
        ${row.creditScore},
        ${row.creditScoreInputDate},
        ${row.activeCustomerSince},
        ${row.outdatedDcl},
        ${row.policyDailyCost},
        ${row.policyCostCurrency},
        ${row.topUpDailyCost},
        ${row.topUpCostCurrency},
        ${row.totalDailyCost},
        ${row.costCalculationMethod}::"cost_calculation_method",
        ${row.costPercent},
        ${row.registrationFeePercent},
        ${row.financialCurrency},
        ${row.totalReceivables},
        ${row.healthIndex},
        ${row.atRiskExposure},
        ${row.compliantExposure},
        ${row.termsBreachAmount},
        ${row.capacityGapAmount},
        ${row.termsBreachCount},
        ${termsBreachByReasonSnapshotToJson(row.termsBreachByReason)}::jsonb,
        ${row.policyUsagePct},
        ${row.topUpUsagePct},
        ${row.effectiveUsagePct}
    )`;
}

export async function batchUpsertCustomerPolicyTrendRows(
    rows: CustomerPolicyTrendUpsertRow[],
    options?: {
        dbClient?: DbClient;
        chunkSize?: number;
    }
): Promise<number> {
    if (rows.length === 0) {
        return 0;
    }
    const db = options?.dbClient ?? defaultPrisma;
    const chunkSize =
        options?.chunkSize ?? CUSTOMER_POLICY_TREND_BATCH_UPSERT_CHUNK_SIZE;
    let upserted = 0;

    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const values = chunk.map(rowToValuesSql);
        await db.$executeRaw`
            INSERT INTO "CustomerPolicyTrend" (
                account_id,
                customer_id,
                insurance_policy_id,
                customer_policy_id,
                snapshot_date,
                approved_limit,
                usage_amount,
                top_up_total,
                active_top_up_count,
                effective_approved_limit,
                customer_number_policy,
                approved_limit_currency,
                approved_limit_expiration_date,
                limit_type,
                max_payment_term,
                max_allowed_mep,
                reporting_days,
                mep_cutoff_day_of_month,
                mep_substitute_day_of_month,
                reporting_cutoff_day_of_month,
                reporting_substitute_day_of_month,
                payment_term_cutoff_day_of_month,
                payment_term_substitute_day_of_month,
                excluded_from_policy,
                policy_exclusion_reason,
                credit_score,
                credit_score_input_date,
                active_customer_since,
                outdated_dcl,
                policy_daily_cost,
                policy_cost_currency,
                top_up_daily_cost,
                top_up_cost_currency,
                total_daily_cost,
                cost_calculation_method,
                cost_percent,
                registration_fee_percent,
                financial_currency,
                total_receivables,
                health_index,
                at_risk_exposure,
                compliant_exposure,
                terms_breach_amount,
                capacity_gap_amount,
                terms_breach_count,
                terms_breach_by_reason,
                policy_usage_pct,
                top_up_usage_pct,
                effective_usage_pct
            ) VALUES ${Prisma.join(values)}
            ON CONFLICT (customer_id, customer_policy_id, snapshot_date)
            ${ON_CONFLICT_UPDATE}
        `;
        upserted += chunk.length;
    }

    return upserted;
}
