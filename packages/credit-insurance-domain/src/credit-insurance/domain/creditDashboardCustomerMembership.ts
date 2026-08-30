/**
 * Credit dashboard customer-grain membership IDs / where fragments for
 * ViewBased report execute (exact KPI parity with get*Report).
 *
 * BU is intentionally omitted — report execute applies businessUnitFilter.
 */

import type { Prisma } from "@prisma/client";

import {
    getCapacityGapReport,
    getLimitWarningReport,
    getNoPolicyExposureReport,
    getPolicyRiskExposureReport,
} from "./creditInsuranceDashboardService";
import {
    getTopUpCoverReport,
    getTopUpExpiringReport,
} from "./creditInsuranceTopUpDashboardService";

/** Cap for ID materialization; credit cohorts are customer-scoped, not unbounded. */
const MEMBERSHIP_TAKE = 100_000;

export type CreditCustomerMembershipType =
    | "capacity"
    | "policy_risk"
    | "limit_warning"
    | "zero_limit_warning"
    | "no_policy_exposure"
    | "top_up"
    | "top_up_expiring";

export interface CreditCustomerMembershipOptions {
    policyId?: number;
    customerId?: number;
    /** Only for no_policy_exposure; default true. */
    includeNoPolicyExposure?: boolean;
    /** Only for top_up_expiring; default 30. */
    withinDays?: number;
}


/**
 * Prisma fragment for zero-limit warning (active CustomerPolicy with approved_limit=0).
 * Combined with credit customer scope in the execute expander.
 */
export function zeroLimitWarningMembershipWhere(
    options: Pick<CreditCustomerMembershipOptions, "policyId"> = {}
): Prisma.CustomerWhereInput {
    return {
        CustomerPolicy: {
            some: {
                is_active: true,
                approved_limit: 0,
                insurance_policy_id:
                    options.policyId != null
                        ? options.policyId
                        : { not: null },
            },
        },
    };
}

/**
 * Resolve customer IDs for capacity / policy_risk / limit_warning / no_policy_exposure.
 * Returns null for types that use a where fragment instead (zero_limit_warning).
 */
export async function resolveCreditCustomerMembershipIds(
    type: CreditCustomerMembershipType,
    accountId: number,
    options: CreditCustomerMembershipOptions = {}
): Promise<number[] | null> {
    if (type === "zero_limit_warning") {
        return null;
    }

    const listOptions = {
        policyId: options.policyId,
        customerId: options.customerId,
        includeNoPolicyExposure: options.includeNoPolicyExposure,
    };

    switch (type) {
        case "capacity": {
            const { rows } = await getCapacityGapReport(
                accountId,
                MEMBERSHIP_TAKE,
                0,
                listOptions
            );
            return rows.map((r) => r.customerId);
        }
        case "policy_risk": {
            const { rows } = await getPolicyRiskExposureReport(
                accountId,
                MEMBERSHIP_TAKE,
                0,
                listOptions
            );
            return rows.map((r) => r.customerId);
        }
        case "limit_warning": {
            const { rows } = await getLimitWarningReport(
                accountId,
                MEMBERSHIP_TAKE,
                0,
                listOptions
            );
            return rows.map((r) => r.customerId);
        }
        case "no_policy_exposure": {
            const { rows } = await getNoPolicyExposureReport(
                accountId,
                MEMBERSHIP_TAKE,
                0,
                {
                    ...listOptions,
                    includeNoPolicyExposure:
                        options.includeNoPolicyExposure !== false,
                }
            );
            return rows.map((r) => r.customerId);
        }
        case "top_up": {
            const { rows } = await getTopUpCoverReport(
                accountId,
                MEMBERSHIP_TAKE,
                0,
                listOptions
            );
            return rows.map((r) => r.customerId);
        }
        case "top_up_expiring": {
            const { rows } = await getTopUpExpiringReport(
                accountId,
                MEMBERSHIP_TAKE,
                0,
                {
                    ...listOptions,
                    withinDays: options.withinDays ?? 30,
                }
            );
            return rows.map((r) => r.customerId);
        }
        default:
            return [];
    }
}
