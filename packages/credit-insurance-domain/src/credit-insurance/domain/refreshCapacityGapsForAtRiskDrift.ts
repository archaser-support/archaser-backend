import { Prisma } from "@prisma/client";

import { prisma } from "../domain-db";

import { ensureCustomerCapacityGapStored } from "./syncCreditInsuranceGapPipeline";

const GAP_DRIFT_EPSILON = 0.5;
const REFRESH_CONCURRENCY = 8;

/**
 * Find insured customers whose Σ open-invoice capacity_gap_amount (same invoice
 * set as At Risk) disagrees with scoped CustomerPolicy.capacity_gap_amount
 * (Cap Gap card), then re-run the live gap pipeline.
 *
 * When policyId is omitted, invoice sum includes every open Due/Overdue line
 * (including older policy tags). Sync zeros gaps on lines outside the active
 * waterfall so Cap Gap and the At Risk gap leg stay aligned.
 */
export async function refreshCapacityGapsForAtRiskDrift(args: {
    accountId: number;
    customerIds: number[];
    policyId?: number;
}): Promise<number> {
    const customerIds = args.customerIds.filter((id) => Number.isFinite(id));
    if (customerIds.length === 0) {
        return 0;
    }

    const policyWhere =
        args.policyId != null
            ? Prisma.sql`AND insurance_policy_id = ${args.policyId}`
            : Prisma.sql`AND is_active = true AND insurance_policy_id IS NOT NULL`;
    // Same invoice membership as portfolio At Risk (all open lines, optional policy filter).
    const invoicePolicyFilter =
        args.policyId != null
            ? Prisma.sql`AND i.policy_id = ${args.policyId}`
            : Prisma.empty;

    const drifted = await prisma.$queryRaw<Array<{ customer_id: number }>>`
        WITH policy_gap AS (
            SELECT
                customer_id,
                COALESCE(SUM(COALESCE(capacity_gap_amount, 0)), 0)::float8 AS policy_gap
            FROM "CustomerPolicy"
            WHERE customer_id IN (${Prisma.join(customerIds)})
              ${policyWhere}
            GROUP BY customer_id
        ),
        inv_gap AS (
            SELECT
                i.customer_id,
                COALESCE(SUM(COALESCE(i.capacity_gap_amount, 0)), 0)::float8 AS inv_gap
            FROM "Invoice" i
            WHERE i.account_id = ${args.accountId}
              AND i.customer_id IN (${Prisma.join(customerIds)})
              AND i.status IN ('Due', 'Overdue')
              AND i.amount >= 0
              ${invoicePolicyFilter}
            GROUP BY i.customer_id
        )
        SELECT COALESCE(p.customer_id, i.customer_id) AS customer_id
        FROM policy_gap p
        FULL OUTER JOIN inv_gap i ON i.customer_id = p.customer_id
        WHERE ABS(
            COALESCE(p.policy_gap, 0) - COALESCE(i.inv_gap, 0)
        ) > ${GAP_DRIFT_EPSILON}
    `;

    const uniqueIds = [
        ...new Set(
            drifted
                .map((row) => Number(row.customer_id))
                .filter((id) => Number.isFinite(id) && customerIds.includes(id))
        ),
    ];
    if (uniqueIds.length === 0) {
        return 0;
    }

    for (let i = 0; i < uniqueIds.length; i += REFRESH_CONCURRENCY) {
        const batch = uniqueIds.slice(i, i + REFRESH_CONCURRENCY);
        await Promise.all(
            batch.map((customerId) => ensureCustomerCapacityGapStored(customerId))
        );
    }
    return uniqueIds.length;
}
