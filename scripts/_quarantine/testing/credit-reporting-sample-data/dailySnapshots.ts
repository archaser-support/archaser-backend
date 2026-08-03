import { syncCustomerPolicyTrendSnapshotForAccount } from "@/server/services/creditInsurance/customerPolicyTrendService";
import { takeCreditDashboardDailySnapshotsForAccount } from "@/server/services/creditInsurance/creditDashboardSnapshotService";
import { syncInsurancePolicyTrendSnapshotForAccount } from "@/server/services/creditInsurance/insurancePolicyTrendService";

export type DailySnapshotResult = {
    customerPolicyTrendRows: number;
    insurancePolicyTrendRows: number;
    dashboardSnapshotScopes: number;
};

export async function runDailySnapshotsForAccount(args: {
    accountId: number;
    snapshotDate: Date;
}): Promise<DailySnapshotResult> {
    const customerPolicyTrendRows =
        await syncCustomerPolicyTrendSnapshotForAccount(args.accountId, {
            snapshotDate: args.snapshotDate,
        });

    const insurancePolicyTrendResult =
        await syncInsurancePolicyTrendSnapshotForAccount(args.accountId, {
            snapshotDate: args.snapshotDate,
        });

    const dashboardSnapshotResult =
        await takeCreditDashboardDailySnapshotsForAccount(args.accountId, {
            snapshotDate: args.snapshotDate,
        });

    return {
        customerPolicyTrendRows,
        insurancePolicyTrendRows:
            insurancePolicyTrendResult.policyRowsUpserted,
        dashboardSnapshotScopes: dashboardSnapshotResult.scopesProcessed,
    };
}
