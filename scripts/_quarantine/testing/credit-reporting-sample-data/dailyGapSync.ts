import { invoice_status } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { syncCreditInsuranceGapPipelineForCustomer } from "@/server/services/creditInsurance/syncCreditInsuranceGapPipeline";

export type DailyGapSyncResult = {
    customersSynced: number;
    missingRateCount: number;
};

export async function listCustomersWithOpenCapacityGapInvoices(
    accountId: number
): Promise<number[]> {
    const rows = await prisma.invoice.findMany({
        where: {
            Customer: { account_id: accountId },
            status: { in: [invoice_status.Due, invoice_status.Overdue] },
            in_capacity_gap: true,
        },
        select: { customer_id: true },
        distinct: ["customer_id"],
    });

    return rows
        .map((row) => row.customer_id)
        .filter((customerId): customerId is number => customerId != null);
}

export async function syncGapForCustomers(args: {
    customerIds: Iterable<number>;
    rateDate: Date;
}): Promise<DailyGapSyncResult> {
    const uniqueIds = Array.from(new Set(args.customerIds));
    let missingRateCount = 0;

    for (const customerId of uniqueIds) {
        const result = await syncCreditInsuranceGapPipelineForCustomer(
            customerId,
            { rateDate: args.rateDate }
        );
        if (result.missingRate) {
            missingRateCount += 1;
        }
    }

    return {
        customersSynced: uniqueIds.length,
        missingRateCount,
    };
}
