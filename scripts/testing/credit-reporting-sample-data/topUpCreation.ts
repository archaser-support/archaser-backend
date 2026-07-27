import { Prisma } from "@prisma/client";

import { CustomerTopUpService } from "@/server/services/creditInsurance/CustomerTopUpService";
import { syncCreditInsuranceGapPipelineForCustomer } from "@/server/services/creditInsurance/syncCreditInsuranceGapPipeline";

import type { AccountBootstrapResult, ScheduledTopUp } from "./types";
import { resolveTopUpEndDate } from "./topUpPlan";
import type { HistoryWindow } from "./window";

export type TopUpCreationResult = {
    customerId: number;
    topUpId: number;
    scheduled: ScheduledTopUp;
};

export async function createScheduledTopUpsForDay(args: {
    scheduledTopUps: ScheduledTopUp[];
    customerIdByIndex: Map<number, number>;
    bootstrap: AccountBootstrapResult;
    window: HistoryWindow;
    day: Date;
    actorUserId: string;
}): Promise<TopUpCreationResult[]> {
    const results: TopUpCreationResult[] = [];

    for (const scheduled of args.scheduledTopUps) {
        const customerId = args.customerIdByIndex.get(scheduled.customerIndex);
        if (customerId == null) {
            throw new Error(
                `Missing customer id for top-up index ${scheduled.customerIndex}`
            );
        }

        const startDate = args.day;
        const endDate = resolveTopUpEndDate({
            startDate,
            windowKind: scheduled.windowKind,
            window: args.window,
        });

        const created = await CustomerTopUpService.create({
            customerId,
            insurancePolicyId: args.bootstrap.topUpPolicyId,
            topUpType: scheduled.topUpType,
            topUpValue: new Prisma.Decimal(scheduled.topUpValue),
            currency: scheduled.currency,
            startDate,
            endDate,
            notes: scheduled.isCapBuster
                ? "credit-reporting-sample cap-buster"
                : "credit-reporting-sample top-up",
            userId: args.actorUserId,
        });

        await syncCreditInsuranceGapPipelineForCustomer(customerId, {
            rateDate: args.day,
        });

        results.push({
            customerId,
            topUpId: created.id,
            scheduled,
        });
    }

    return results;
}

export function summarizeCapBusterCover(
    results: TopUpCreationResult[]
): number {
    return results
        .filter((result) => result.scheduled.isCapBuster)
        .reduce((sum, result) => sum + result.scheduled.topUpValue, 0);
}
