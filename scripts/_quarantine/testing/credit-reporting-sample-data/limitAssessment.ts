import { prisma } from "@/lib/prisma";
import { restampCustomerOpenInvoiceLimitAssessment } from "@/server/services/creditInsurance/restampCustomerLimitAssessment";

import { ACCOUNT_CURRENCY } from "./constants";

export type LimitAssessmentRestampResult = {
    customersProcessed: number;
    invoicesUpdated: number;
};

export async function restampLimitAssessmentForCustomers(
    customerIds: Iterable<number>,
    accountCurrency: string = ACCOUNT_CURRENCY
): Promise<LimitAssessmentRestampResult> {
    const uniqueIds = Array.from(new Set(customerIds));
    let invoicesUpdated = 0;

    for (const customerId of uniqueIds) {
        invoicesUpdated += await restampCustomerOpenInvoiceLimitAssessment(
            customerId,
            { accountCurrency }
        );
    }

    return {
        customersProcessed: uniqueIds.length,
        invoicesUpdated,
    };
}

export async function restampLimitAssessmentForAccount(
    accountId: number,
    accountCurrency: string = ACCOUNT_CURRENCY
): Promise<LimitAssessmentRestampResult> {
    const customers = await prisma.customer.findMany({
        where: { account_id: accountId },
        select: { id: true },
        orderBy: { id: "asc" },
    });

    return restampLimitAssessmentForCustomers(
        customers.map((customer) => customer.id),
        accountCurrency
    );
}
