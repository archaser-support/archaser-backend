"use strict";
/**
 * Credit dashboard customer-grain membership IDs / where fragments for
 * ViewBased report execute (exact KPI parity with get*Report).
 *
 * BU is intentionally omitted — report execute applies businessUnitFilter.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.zeroLimitWarningMembershipWhere = zeroLimitWarningMembershipWhere;
exports.resolveCreditCustomerMembershipIds = resolveCreditCustomerMembershipIds;
const creditInsuranceDashboardService_1 = require("./creditInsuranceDashboardService");
const creditInsuranceTopUpDashboardService_1 = require("./creditInsuranceTopUpDashboardService");
/** Cap for ID materialization; credit cohorts are customer-scoped, not unbounded. */
const MEMBERSHIP_TAKE = 100_000;
/**
 * Prisma fragment for zero-limit warning (active CustomerPolicy with approved_limit=0).
 * Combined with credit customer scope in the execute expander.
 */
function zeroLimitWarningMembershipWhere(options = {}) {
    return {
        CustomerPolicy: {
            some: {
                is_active: true,
                approved_limit: 0,
                insurance_policy_id: options.policyId != null
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
async function resolveCreditCustomerMembershipIds(type, accountId, options = {}) {
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
            const { rows } = await (0, creditInsuranceDashboardService_1.getCapacityGapReport)(accountId, MEMBERSHIP_TAKE, 0, listOptions);
            return rows.map((r) => r.customerId);
        }
        case "policy_risk": {
            const { rows } = await (0, creditInsuranceDashboardService_1.getPolicyRiskExposureReport)(accountId, MEMBERSHIP_TAKE, 0, listOptions);
            return rows.map((r) => r.customerId);
        }
        case "limit_warning": {
            const { rows } = await (0, creditInsuranceDashboardService_1.getLimitWarningReport)(accountId, MEMBERSHIP_TAKE, 0, listOptions);
            return rows.map((r) => r.customerId);
        }
        case "no_policy_exposure": {
            const { rows } = await (0, creditInsuranceDashboardService_1.getNoPolicyExposureReport)(accountId, MEMBERSHIP_TAKE, 0, {
                ...listOptions,
                includeNoPolicyExposure: options.includeNoPolicyExposure !== false,
            });
            return rows.map((r) => r.customerId);
        }
        case "top_up": {
            const { rows } = await (0, creditInsuranceTopUpDashboardService_1.getTopUpCoverReport)(accountId, MEMBERSHIP_TAKE, 0, listOptions);
            return rows.map((r) => r.customerId);
        }
        case "top_up_expiring": {
            const { rows } = await (0, creditInsuranceTopUpDashboardService_1.getTopUpExpiringReport)(accountId, MEMBERSHIP_TAKE, 0, {
                ...listOptions,
                withinDays: options.withinDays ?? 30,
            });
            return rows.map((r) => r.customerId);
        }
        default:
            return [];
    }
}
