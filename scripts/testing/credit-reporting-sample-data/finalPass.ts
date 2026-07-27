import { prisma } from "@/lib/prisma";
import { CustomerService } from "@/server/services/CustomerService";
import { syncCreditInsuranceGapPipelineForCustomer } from "@/server/services/creditInsurance/syncCreditInsuranceGapPipeline";

import { ACCOUNT_CURRENCY } from "./constants";
import { replayChronologicalOverdueState } from "./dailyOverdueSync";
import { restampLimitAssessmentForAccount } from "./limitAssessment";
import type { HistoryWindow } from "./types";

export type FinalPassResult = {
    customersSynced: number;
    missingRateCount: number;
    limitAssessment: {
        customersProcessed: number;
        invoicesUpdated: number;
    };
    overdueReplay?: {
        daysProcessed: number;
        totalRestamps: number;
    };
};

export async function runFinalPass(args: {
    accountId: number;
    rateDate: Date;
    window?: HistoryWindow;
}): Promise<FinalPassResult> {
    const overdueReplay = args.window
        ? await replayChronologicalOverdueState({
              accountId: args.accountId,
              window: args.window,
          })
        : undefined;

    const limitAssessment = await restampLimitAssessmentForAccount(
        args.accountId,
        ACCOUNT_CURRENCY
    );

    const customers = await prisma.customer.findMany({
        where: {
            account_id: args.accountId,
        },
        select: { id: true },
        orderBy: { id: "asc" },
    });

    let missingRateCount = 0;
    for (const { id } of customers) {
        const result = await syncCreditInsuranceGapPipelineForCustomer(id, {
            rateDate: args.rateDate,
        });
        if (result.missingRate) {
            missingRateCount += 1;
        }
    }

    await CustomerService.recalculateAllAmountsForCustomers(
        customers.map((customer) => customer.id)
    );

    return {
        customersSynced: customers.length,
        missingRateCount,
        limitAssessment,
        overdueReplay: overdueReplay
            ? {
                  daysProcessed: overdueReplay.daysProcessed,
                  totalRestamps: overdueReplay.totalRestamps,
              }
            : undefined,
    };
}
