"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasTopUpPolicies = hasTopUpPolicies;
const domain_db_1 = require("../domain-db");
async function hasTopUpPolicies(accountId) {
    const count = await domain_db_1.prisma.insurancePolicy.count({
        where: { account_id: accountId, policy_kind: "TopUp" },
        take: 1,
    });
    return count > 0;
}
