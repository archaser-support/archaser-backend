import type { PrismaClient } from "@prisma/client";
import { bindCreditDomain, requireCreditDomainModule } from "./creditDomain";
import { recalculateCustomerAmountsViaApi } from "./customersDomain";

/**
 * Safety net: for collection periods closed since last_run_at, mark zero-debt
 * Overdue invoices as Paid and refresh customer rollups / insurance fields.
 */
export async function fixClosedCollectionData(
    prisma: PrismaClient,
    lastRunAt: Date
): Promise<{
    success: boolean;
    message: string;
    summary: {
        totalCollectionPeriods: number;
        invoicesUpdated: number;
        customersRecalculated: number;
    };
    durationMs: number;
}> {
    const start = Date.now();

    const collectionPeriodsCount =
        await prisma.customerCollectionPeriod.count({
            where: {
                period_end_date: {
                    gte: lastRunAt,
                },
            },
        });

    if (collectionPeriodsCount === 0) {
        return {
            success: true,
            message: "No closed collection periods since last run",
            summary: {
                totalCollectionPeriods: 0,
                invoicesUpdated: 0,
                customersRecalculated: 0,
            },
            durationMs: Date.now() - start,
        };
    }

    const affectedInvoices = await prisma.invoice.findMany({
        where: {
            customer_outstanding_debt: 0,
            status: "Overdue",
            CustomerCollectionPeriod: {
                period_end_date: {
                    gte: lastRunAt,
                },
            },
        },
        select: {
            customer_id: true,
        },
    });

    const affectedCustomerIds = Array.from(
        new Set(
            affectedInvoices
                .map((invoice) => invoice.customer_id)
                .filter(
                    (value): value is number =>
                        value !== null && value !== undefined
                )
        )
    );

    const updateResult = await prisma.invoice.updateMany({
        where: {
            customer_outstanding_debt: 0,
            status: "Overdue",
            CustomerCollectionPeriod: {
                period_end_date: {
                    gte: lastRunAt,
                },
            },
        },
        data: {
            status: "Paid",
            zero_limit_alert: false,
        },
    });

    bindCreditDomain(prisma);
    const syncMod = requireCreditDomainModule<{
        syncCustomerInsuranceFields: (customerId: number) => Promise<unknown>;
    }>("domain/syncCustomerInsuranceFields.js");
    for (const affectedCustomerId of affectedCustomerIds) {
        await syncMod.syncCustomerInsuranceFields(affectedCustomerId);
    }

    await recalculateCustomerAmountsViaApi(affectedCustomerIds, prisma);

    return {
        success: true,
        message: `Fix closed collection data: ${updateResult.count} invoices updated across ${affectedCustomerIds.length} customers`,
        summary: {
            totalCollectionPeriods: collectionPeriodsCount,
            invoicesUpdated: updateResult.count,
            customersRecalculated: affectedCustomerIds.length,
        },
        durationMs: Date.now() - start,
    };
}
