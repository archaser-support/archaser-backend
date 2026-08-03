import { prisma } from "@/lib/prisma";
import { getCreditDashboardSummary } from "@/server/services/creditInsurance/creditInsuranceDashboardService";

import {
    applyPrimaryPolicyBootstrapFields,
    bootstrapAccountShell,
} from "./accountBootstrap";
import { readCheckpoint } from "./checkpoint";
import { runDailySnapshotsForAccount } from "./dailySnapshots";
import { runFinalPass } from "./finalPass";
import { SAMPLE_ACCOUNT_SUBDOMAIN } from "./constants";
import type { HistoryWindow } from "./types";
import {
    addUtcDaysTo,
    computeHistoryWindow,
    formatUtcDate,
    parseUtcDate,
} from "./window";

export type RepairKpisResult = {
    accountId: number;
    primaryPolicyId: number;
    limitAssessment: {
        customersProcessed: number;
        invoicesUpdated: number;
    };
    finalPass: {
        customersSynced: number;
        missingRateCount: number;
    };
    dashboardSnapshots: {
        daysProcessed: number;
        scopesProcessed: number;
    };
    summary: {
        totalReceivables: number;
        compliantExposure: number;
        atRiskExposure: number;
        capacityGapTotal: number;
        capacityGapCustomersOverLimit: number;
    };
};

function resolveRepairWindow(days: number): HistoryWindow {
    const checkpoint = readCheckpoint();
    if (checkpoint?.windowStart) {
        const windowDays = checkpoint.windowDays;
        const windowStart = parseUtcDate(checkpoint.windowStart);
        const windowEnd = addUtcDaysTo(windowStart, windowDays - 1);
        const full = computeHistoryWindow(windowDays);
        return {
            ...full,
            windowStart,
            windowEnd,
            windowDays,
        };
    }
    return computeHistoryWindow(days);
}

export async function repairSampleAccountKpis(args: {
    days: number;
}): Promise<RepairKpisResult> {
    const window = resolveRepairWindow(args.days);
    const bootstrap = await bootstrapAccountShell(window);

    const account = await prisma.account.findFirst({
        where: {
            id: bootstrap.accountId,
            sub_domain: SAMPLE_ACCOUNT_SUBDOMAIN,
            deleted_at: null,
        },
        select: { id: true },
    });
    if (!account) {
        throw new Error(`Sample account not found: ${SAMPLE_ACCOUNT_SUBDOMAIN}`);
    }

    await applyPrimaryPolicyBootstrapFields(
        bootstrap.primaryPolicyId,
        window,
        bootstrap.accountId
    );

    const finalPass = await runFinalPass({
        accountId: bootstrap.accountId,
        rateDate: window.windowEnd,
        window,
    });

    let dashboardSnapshotScopes = 0;
    for (let dayOffset = 0; dayOffset < window.windowDays; dayOffset++) {
        const snapshotDate = addUtcDaysTo(window.windowStart, dayOffset);
        const snapshotResult = await runDailySnapshotsForAccount({
            accountId: bootstrap.accountId,
            snapshotDate,
        });
        dashboardSnapshotScopes += snapshotResult.dashboardSnapshotScopes;
        if (
            dayOffset === 0 ||
            dayOffset === window.windowDays - 1 ||
            (dayOffset + 1) % 30 === 0
        ) {
            console.log(
                `  snapshot day ${dayOffset + 1}/${window.windowDays} (${formatUtcDate(snapshotDate)}) scopes=${snapshotResult.dashboardSnapshotScopes}`
            );
        }
    }

    const summary = await getCreditDashboardSummary(bootstrap.accountId);

    return {
        accountId: bootstrap.accountId,
        primaryPolicyId: bootstrap.primaryPolicyId,
        limitAssessment: {
            customersProcessed: finalPass.limitAssessment.customersProcessed,
            invoicesUpdated: finalPass.limitAssessment.invoicesUpdated,
        },
        finalPass: {
            customersSynced: finalPass.customersSynced,
            missingRateCount: finalPass.missingRateCount,
        },
        dashboardSnapshots: {
            daysProcessed: window.windowDays,
            scopesProcessed: dashboardSnapshotScopes,
        },
        summary: {
            totalReceivables: summary.totalReceivables,
            compliantExposure: summary.compliantExposure,
            atRiskExposure: summary.atRiskExposure,
            capacityGapTotal: summary.capacityGap.totalAmount,
            capacityGapCustomersOverLimit:
                summary.capacityGap.customerOverLimitCount,
        },
    };
}

export function printRepairKpisResult(result: RepairKpisResult): void {
    console.log("");
    console.log("=== Credit reporting sample data — KPI repair ===");
    console.log("");
    console.log(`  accountId: ${result.accountId}`);
    console.log(`  primaryPolicyId: ${result.primaryPolicyId}`);
    console.log(
        `  limit assessment restamp: ${result.limitAssessment.invoicesUpdated} invoice(s) across ${result.limitAssessment.customersProcessed} customer(s)`
    );
    console.log(
        `  gap sync: ${result.finalPass.customersSynced} customer(s), missingRate=${result.finalPass.missingRateCount}`
    );
    console.log(
        `  dashboard snapshots: ${result.dashboardSnapshots.daysProcessed} day(s), ${result.dashboardSnapshots.scopesProcessed} scope upsert(s)`
    );
    console.log("");
    console.log("  Live dashboard KPIs:");
    console.log(
        `    total receivables: ${result.summary.totalReceivables.toLocaleString()}`
    );
    console.log(
        `    compliant exposure: ${result.summary.compliantExposure.toLocaleString()}`
    );
    console.log(
        `    at-risk exposure: ${result.summary.atRiskExposure.toLocaleString()}`
    );
    console.log(
        `    capacity gap: ${result.summary.capacityGapTotal.toLocaleString()} (${result.summary.capacityGapCustomersOverLimit} customers over limit)`
    );
}
