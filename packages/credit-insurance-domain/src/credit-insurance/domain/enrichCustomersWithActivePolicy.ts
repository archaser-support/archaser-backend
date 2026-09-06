import { prisma } from "../domain-db";
import type { Prisma } from "@prisma/client";

import { mapCustomerPolicyRow } from "./customerPolicyTypes";

type InsurancePolicySummary = {
    id: number;
    policy_number: string | null;
    end_date: Date;
    score_validity_period_months: number | null;
    currency: string | null;
    max_total_cover: Prisma.Decimal | null;
    max_total_dcl_sdl_cover: Prisma.Decimal | null;
};

const INSURANCE_POLICY_SELECT = {
    id: true,
    policy_number: true,
    end_date: true,
    score_validity_period_months: true,
    currency: true,
    max_total_cover: true,
    max_total_dcl_sdl_cover: true,
} as const;

export type EnrichedCustomerPolicyFields = {
    policy_id: number | null;
    /** Active CustomerPolicy row overlay; false when no matching row. */
    is_active: boolean;
    limit_type: string | null;
    outdated_dcl: boolean | null;
    approved_limit: Prisma.Decimal | null;
    approved_limit_currency: string | null;
    approved_limit_expiration_date: Date | null;
    zero_limit_date: Date | null;
    credit_score_input_date: Date | null;
    max_payment_term: number | null;
    max_allowed_mep: number | null;
    reporting_days: number | null;
    excluded_from_policy: boolean;
    policy_exclusion_reason: string | null;
    credit_score: Prisma.Decimal | null;
    active_customer_since: Date | null;
    customer_number_policy: string | null;
    capacity_gap_amount: number | null;
    capacity_gap_amount_date: Date | null;
    uninsured_amount: number | null;
    capacity_gap_amount1: number | null;
    capacity_gap_currency1: string | null;
    capacity_gap_amount2: number | null;
    capacity_gap_currency2: string | null;
    uninsured_amount1: number | null;
    uninsured_currency1: string | null;
    uninsured_amount2: number | null;
    uninsured_currency2: string | null;
};

/**
 * Overlay CustomerPolicy fields onto customer rows for dashboard/KPI reads.
 * Customers without a matching policy row are returned unchanged (no policy fields).
 */
export type CustomerWithEnrichedPolicy<T extends { id: number }> = T &
    EnrichedCustomerPolicyFields & {
        InsurancePolicy?: InsurancePolicySummary | null;
    };

function overlayPolicyRow<
    T extends { id: number } & Partial<EnrichedCustomerPolicyFields> & {
        InsurancePolicy?: InsurancePolicySummary | null;
    },
>(
    row: T,
    policyRow: {
        customer_id: number;
        InsurancePolicy: InsurancePolicySummary | null;
    } & Parameters<typeof mapCustomerPolicyRow>[0]
): CustomerWithEnrichedPolicy<T> {
    const fields = mapCustomerPolicyRow(policyRow);
    return {
        ...row,
        policy_id: fields.insurance_policy_id,
        is_active: Boolean(
            (policyRow as { is_active?: boolean }).is_active ?? false
        ),
        limit_type: fields.limit_type,
        outdated_dcl: fields.outdated_dcl,
        approved_limit: fields.approved_limit,
        approved_limit_currency: fields.approved_limit_currency,
        approved_limit_expiration_date: fields.approved_limit_expiration_date,
        zero_limit_date: fields.zero_limit_date,
        credit_score_input_date: fields.credit_score_input_date,
        max_payment_term: fields.max_payment_term,
        max_allowed_mep: fields.max_allowed_mep,
        reporting_days: fields.reporting_days,
        excluded_from_policy: fields.excluded_from_policy,
        policy_exclusion_reason: fields.policy_exclusion_reason,
        credit_score: fields.credit_score,
        active_customer_since: fields.active_customer_since,
        customer_number_policy: fields.customer_number_policy,
        capacity_gap_amount: fields.capacity_gap_amount,
        capacity_gap_amount_date: fields.capacity_gap_amount_date,
        uninsured_amount: fields.uninsured_amount,
        capacity_gap_amount1: fields.capacity_gap_amount1,
        capacity_gap_currency1: fields.capacity_gap_currency1,
        capacity_gap_amount2: fields.capacity_gap_amount2,
        capacity_gap_currency2: fields.capacity_gap_currency2,
        uninsured_amount1: fields.uninsured_amount1,
        uninsured_currency1: fields.uninsured_currency1,
        uninsured_amount2: fields.uninsured_amount2,
        uninsured_currency2: fields.uninsured_currency2,
        InsurancePolicy:
            policyRow.InsurancePolicy ?? row.InsurancePolicy ?? null,
    };
}

/**
 * Overlay CustomerPolicy fields for dashboard policy scope.
 * When policyId is set, uses the matching insurance_policy_id row (active first, else latest inactive).
 * When policyId is null, uses the active CustomerPolicy row only.
 */
export async function enrichCustomersWithPolicyScope<
    T extends { id: number } & Partial<EnrichedCustomerPolicyFields> & {
        InsurancePolicy?: InsurancePolicySummary | null;
    },
>(rows: T[], policyId?: number): Promise<CustomerWithEnrichedPolicy<T>[]> {
    if (rows.length === 0) {
        return rows as CustomerWithEnrichedPolicy<T>[];
    }
    const customerIds = rows.map((r) => r.id);

    if (policyId == null) {
        const scopedRows = await prisma.customerPolicy.findMany({
            where: { customer_id: { in: customerIds }, is_active: true },
            include: { InsurancePolicy: { select: INSURANCE_POLICY_SELECT } },
        });
        const scopedByCustomerId = new Map(
            scopedRows.map((row) => [row.customer_id, row])
        );

        // Fallback for "All Policies": if a customer is included via invoice policy scope
        // but has no active CustomerPolicy row, use the latest policy row so gap/limit
        // cards align with policy-scoped card totals.
        const missingCustomerIds = customerIds.filter(
            (id) => !scopedByCustomerId.has(id)
        );
        if (missingCustomerIds.length > 0) {
            const latestRows = await prisma.customerPolicy.findMany({
                where: {
                    customer_id: { in: missingCustomerIds },
                    insurance_policy_id: { not: null },
                },
                include: { InsurancePolicy: { select: INSURANCE_POLICY_SELECT } },
                orderBy: [
                    { is_active: "desc" },
                    { modified_at: "desc" },
                    { id: "desc" },
                ],
            });
            for (const row of latestRows) {
                if (!scopedByCustomerId.has(row.customer_id)) {
                    scopedByCustomerId.set(row.customer_id, row);
                }
            }
        }

        return rows.map((row): CustomerWithEnrichedPolicy<T> => {
            const scoped = scopedByCustomerId.get(row.id);
            if (!scoped) {
                return {
                    ...row,
                    is_active: row.is_active ?? false,
                } as CustomerWithEnrichedPolicy<T>;
            }
            return overlayPolicyRow(row, scoped);
        }) as CustomerWithEnrichedPolicy<T>[];
    }

    const policyRows = await prisma.customerPolicy.findMany({
        where: {
            customer_id: { in: customerIds },
            insurance_policy_id: policyId,
        },
        include: { InsurancePolicy: { select: INSURANCE_POLICY_SELECT } },
        orderBy: [{ is_active: "desc" }, { modified_at: "desc" }, { id: "desc" }],
    });
    const policyByCustomerId = new Map<number, (typeof policyRows)[number]>();
    for (const row of policyRows) {
        if (!policyByCustomerId.has(row.customer_id)) {
            policyByCustomerId.set(row.customer_id, row);
        }
    }

    return rows.map((row): CustomerWithEnrichedPolicy<T> => {
        const policyRow = policyByCustomerId.get(row.id);
        if (!policyRow) {
            return {
                ...row,
                is_active: row.is_active ?? false,
            } as CustomerWithEnrichedPolicy<T>;
        }
        return overlayPolicyRow(row, policyRow);
    }) as CustomerWithEnrichedPolicy<T>[];
}

/** Customer ids with an active CustomerPolicy row linked to an insurance policy. */
export async function fetchCustomerIdsWithActiveLinkedPolicy(
    customerIds: number[]
): Promise<Set<number>> {
    if (customerIds.length === 0) {
        return new Set();
    }
    const rows = await prisma.customerPolicy.findMany({
        where: {
            customer_id: { in: customerIds },
            is_active: true,
            insurance_policy_id: { not: null },
        },
        select: { customer_id: true },
        distinct: ["customer_id"],
    });
    return new Set(rows.map((row) => row.customer_id));
}

/** @deprecated Prefer {@link enrichCustomersWithPolicyScope} with explicit policyId for dashboard reads. */
export async function enrichCustomersWithActivePolicy<
    T extends { id: number } & Partial<EnrichedCustomerPolicyFields> & {
        InsurancePolicy?: InsurancePolicySummary | null;
    },
>(rows: T[]): Promise<CustomerWithEnrichedPolicy<T>[]> {
    return enrichCustomersWithPolicyScope(rows);
}
