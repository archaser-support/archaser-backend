"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPolicyCountryDefaultsForCustomer = getPolicyCountryDefaultsForCustomer;
const domain_db_1 = require("../domain-db");
async function getPolicyCountryDefaultsForCustomer(policyId, countryId) {
    if (!countryId) {
        return null;
    }
    const row = await domain_db_1.prisma.insurancePolicyCountry.findFirst({
        where: {
            insurance_policy_id: policyId,
            country_id: countryId,
        },
        select: {
            reporting_days: true,
            payment_term_cap: true,
            country_mep: true,
        },
    });
    if (!row) {
        return null;
    }
    return {
        reporting_days: row.reporting_days,
        max_payment_term: row.payment_term_cap,
        max_allowed_mep: row.country_mep,
    };
}
//# sourceMappingURL=applyPolicyCountryDefaults.js.map