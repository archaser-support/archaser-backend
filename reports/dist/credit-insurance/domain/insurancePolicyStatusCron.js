"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInsurancePolicyStatusMaintenance = runInsurancePolicyStatusMaintenance;
exports.deactivateExpiredInsurancePolicies = deactivateExpiredInsurancePolicies;
const domain_db_1 = require("../domain-db");
const insurancePolicyLifecycle_1 = require("./shared/insurancePolicyLifecycle");
/**
 * Daily insurance policy status maintenance:
 * - Deactivate expired Primary policies
 * - Deactivate Active Primary policies before start_date
 * - Activate scheduled Inactive Primary policies (auto_activate_on_term_start)
 * - Sync TopUp policy status with parent effective status
 */
async function runInsurancePolicyStatusMaintenance() {
    const todayUtc = (0, insurancePolicyLifecycle_1.startOfTodayUtc)();
    const deactivated = await domain_db_1.prisma.insurancePolicy.updateMany({
        where: {
            policy_kind: "Primary",
            status: "Active",
            end_date: { lt: todayUtc },
            Account: { has_credit_insurance: true },
        },
        data: {
            status: "Inactive",
            auto_activate_on_term_start: false,
            // modified_by is FK to User — omit on system cron updates
        },
    });
    const prematureDeactivated = await domain_db_1.prisma.insurancePolicy.updateMany({
        where: {
            policy_kind: "Primary",
            status: "Active",
            start_date: { gt: todayUtc },
            Account: { has_credit_insurance: true },
        },
        data: {
            status: "Inactive",
            auto_activate_on_term_start: true,
        },
    });
    const activated = await domain_db_1.prisma.insurancePolicy.updateMany({
        where: {
            policy_kind: "Primary",
            status: "Inactive",
            auto_activate_on_term_start: true,
            start_date: { lte: todayUtc },
            end_date: { gte: todayUtc },
            Account: { has_credit_insurance: true },
        },
        data: {
            status: "Active",
            auto_activate_on_term_start: false,
        },
    });
    const topUpsDeactivated = await domain_db_1.prisma.insurancePolicy.updateMany({
        where: {
            policy_kind: "TopUp",
            status: "Active",
            Account: { has_credit_insurance: true },
            OR: [
                {
                    ParentInsurancePolicy: {
                        is: {
                            OR: [
                                { status: { not: "Active" } },
                                { end_date: { lt: todayUtc } },
                                { start_date: { gt: todayUtc } },
                            ],
                        },
                    },
                },
                { parent_insurance_policy_id: null },
            ],
        },
        data: {
            status: "Inactive",
        },
    });
    const topUpsActivated = await domain_db_1.prisma.insurancePolicy.updateMany({
        where: {
            policy_kind: "TopUp",
            status: "Inactive",
            Account: { has_credit_insurance: true },
            ParentInsurancePolicy: {
                is: {
                    status: "Active",
                    start_date: { lte: todayUtc },
                    end_date: { gte: todayUtc },
                },
            },
        },
        data: {
            status: "Active",
        },
    });
    return {
        policiesDeactivated: deactivated.count,
        policiesPrematureDeactivated: prematureDeactivated.count,
        policiesActivated: activated.count,
        topUpsDeactivated: topUpsDeactivated.count,
        topUpsActivated: topUpsActivated.count,
    };
}
/** @deprecated Use runInsurancePolicyStatusMaintenance */
async function deactivateExpiredInsurancePolicies() {
    const result = await runInsurancePolicyStatusMaintenance();
    return { policiesDeactivated: result.policiesDeactivated };
}
