import { prisma } from "../domain-db";

import { startOfTodayUtc } from "./shared/insurancePolicyLifecycle";
/**
 * Daily insurance policy status maintenance:
 * - Deactivate expired Primary policies
 * - Deactivate Active Primary policies before start_date
 * - Activate scheduled Inactive Primary policies (auto_activate_on_term_start)
 * - Sync TopUp policy status with parent effective status
 */
export async function runInsurancePolicyStatusMaintenance(): Promise<{
    policiesDeactivated: number;
    policiesPrematureDeactivated: number;
    policiesActivated: number;
    topUpsDeactivated: number;
    topUpsActivated: number;
}> {
    const todayUtc = startOfTodayUtc();

    const deactivated = await prisma.insurancePolicy.updateMany({
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

    const prematureDeactivated = await prisma.insurancePolicy.updateMany({
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

    const activated = await prisma.insurancePolicy.updateMany({
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

    const topUpsDeactivated = await prisma.insurancePolicy.updateMany({
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

    const topUpsActivated = await prisma.insurancePolicy.updateMany({
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
export async function deactivateExpiredInsurancePolicies(): Promise<{
    policiesDeactivated: number;
}> {
    const result = await runInsurancePolicyStatusMaintenance();
    return { policiesDeactivated: result.policiesDeactivated };
}
