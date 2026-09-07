import { Prisma } from "@prisma/client";

import { type DbClient, prisma as defaultPrisma } from "../domain-db";

import type { CreditDashboardSummary } from "./creditInsuranceDashboardService";

/** Tunable chunk size for multi-row CreditDashboardDailySnapshot upserts. */
export const CREDIT_DASHBOARD_SNAPSHOT_BATCH_UPSERT_CHUNK_SIZE = 12;

export type CreditDashboardDailySnapshotUpsertRow = {
    accountId: number;
    policyId: number | null;
    businessUnitId: number | null;
    snapshotDate: Date;
    summary: CreditDashboardSummary;
    topUpCoverTotalAmount: number;
    customersWithActiveTopUpCount: number;
    topUpExpiringCustomerCount: number;
};

const ON_CONFLICT_UPDATE = Prisma.sql`
    DO UPDATE SET
        health_index = EXCLUDED.health_index,
        total_receivables = EXCLUDED.total_receivables,
        compliant_exposure = EXCLUDED.compliant_exposure,
        at_risk_exposure = EXCLUDED.at_risk_exposure,
        policy_risk_exposure = EXCLUDED.policy_risk_exposure,
        policy_risk_exposure_customer_count = EXCLUDED.policy_risk_exposure_customer_count,
        gross_risk_exposure = EXCLUDED.gross_risk_exposure,
        overdue_block_customer_count = EXCLUDED.overdue_block_customer_count,
        overdue_block_total_outstanding = EXCLUDED.overdue_block_total_outstanding,
        capacity_gap_total_amount = EXCLUDED.capacity_gap_total_amount,
        capacity_gap_customer_over_limit_count = EXCLUDED.capacity_gap_customer_over_limit_count,
        terms_breach_invoice_count = EXCLUDED.terms_breach_invoice_count,
        terms_breach_total_amount = EXCLUDED.terms_breach_total_amount,
        terms_breach_count_by_reason = EXCLUDED.terms_breach_count_by_reason,
        without_policy_customer_count = EXCLUDED.without_policy_customer_count,
        without_policy_total_amount = EXCLUDED.without_policy_total_amount,
        reporting_countdown_invoice_count = EXCLUDED.reporting_countdown_invoice_count,
        reporting_countdown_total_amount = EXCLUDED.reporting_countdown_total_amount,
        reporting_countdown_window_days = EXCLUDED.reporting_countdown_window_days,
        limit_warnings_customer_count = EXCLUDED.limit_warnings_customer_count,
        limit_warnings_total_amount = EXCLUDED.limit_warnings_total_amount,
        limit_warnings_threshold_pct = EXCLUDED.limit_warnings_threshold_pct,
        limit_warnings_score_warn_days = EXCLUDED.limit_warnings_score_warn_days,
        account_currency = EXCLUDED.account_currency,
        top_up_cover_total_amount = EXCLUDED.top_up_cover_total_amount,
        customers_with_active_top_up_count = EXCLUDED.customers_with_active_top_up_count,
        top_up_expiring_customer_count = EXCLUDED.top_up_expiring_customer_count,
        modified_at = NOW()
`;

function rowToValuesSql(row: CreditDashboardDailySnapshotUpsertRow): Prisma.Sql {
    const { summary } = row;
    return Prisma.sql`(
        ${row.accountId},
        ${row.policyId},
        ${row.businessUnitId},
        ${row.snapshotDate},
        ${summary.healthIndex},
        ${summary.totalReceivables},
        ${summary.compliantExposure},
        ${summary.atRiskExposure},
        ${summary.policyRiskExposure},
        ${summary.policyRiskExposureCustomerCount},
        ${summary.grossRiskExposure},
        ${summary.overdueBlockCustomerCount},
        ${summary.overdueBlockTotalOutstanding},
        ${summary.capacityGap.totalAmount},
        ${summary.capacityGap.customerOverLimitCount},
        ${summary.termsBreach.invoiceCount},
        ${summary.termsBreach.totalAmount},
        ${JSON.stringify(summary.termsBreach.countByReason)}::jsonb,
        ${summary.withoutPolicy.customerCount},
        ${summary.withoutPolicy.totalAmount},
        ${summary.reportingCountdown.invoiceCount},
        ${summary.reportingCountdown.totalAmount},
        ${summary.reportingCountdown.windowDays},
        ${summary.limitWarnings.customerCount},
        ${summary.limitWarnings.totalAmount},
        ${summary.limitWarnings.thresholdPct},
        ${summary.limitWarnings.scoreWarnDays},
        ${summary.accountCurrency},
        ${row.topUpCoverTotalAmount},
        ${row.customersWithActiveTopUpCount},
        ${row.topUpExpiringCustomerCount}
    )`;
}

export async function batchUpsertCreditDashboardDailySnapshotRows(
    rows: CreditDashboardDailySnapshotUpsertRow[],
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
        options?.chunkSize ?? CREDIT_DASHBOARD_SNAPSHOT_BATCH_UPSERT_CHUNK_SIZE;
    let upserted = 0;

    for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const values = chunk.map(rowToValuesSql);
        await db.$executeRaw`
            INSERT INTO "CreditDashboardDailySnapshot" (
                account_id,
                policy_id,
                business_unit_id,
                snapshot_date,
                health_index,
                total_receivables,
                compliant_exposure,
                at_risk_exposure,
                policy_risk_exposure,
                policy_risk_exposure_customer_count,
                gross_risk_exposure,
                overdue_block_customer_count,
                overdue_block_total_outstanding,
                capacity_gap_total_amount,
                capacity_gap_customer_over_limit_count,
                terms_breach_invoice_count,
                terms_breach_total_amount,
                terms_breach_count_by_reason,
                without_policy_customer_count,
                without_policy_total_amount,
                reporting_countdown_invoice_count,
                reporting_countdown_total_amount,
                reporting_countdown_window_days,
                limit_warnings_customer_count,
                limit_warnings_total_amount,
                limit_warnings_threshold_pct,
                limit_warnings_score_warn_days,
                account_currency,
                top_up_cover_total_amount,
                customers_with_active_top_up_count,
                top_up_expiring_customer_count
            ) VALUES ${Prisma.join(values)}
            ON CONFLICT (
                account_id,
                (COALESCE(policy_id, 0)),
                (COALESCE(business_unit_id, 0)),
                snapshot_date
            )
            ${ON_CONFLICT_UPDATE}
        `;
        upserted += chunk.length;
    }

    return upserted;
}
