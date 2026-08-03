"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fixClosedCollectionData = fixClosedCollectionData;
const creditDomain_1 = require("./creditDomain");
const customersDomain_1 = require("./customersDomain");
/**
 * Safety net: for collection periods closed since last_run_at, mark zero-debt
 * Overdue invoices as Paid and refresh customer rollups / insurance fields.
 */
async function fixClosedCollectionData(prisma, lastRunAt) {
    const start = Date.now();
    const collectionPeriodsCount = await prisma.customerCollectionPeriod.count({
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
    const affectedCustomerIds = Array.from(new Set(affectedInvoices
        .map((invoice) => invoice.customer_id)
        .filter((value) => value !== null && value !== undefined)));
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
    (0, creditDomain_1.bindCreditDomain)(prisma);
    const syncMod = (0, creditDomain_1.requireCreditDomainModule)("domain/syncCustomerInsuranceFields.js");
    for (const affectedCustomerId of affectedCustomerIds) {
        await syncMod.syncCustomerInsuranceFields(affectedCustomerId);
    }
    await (0, customersDomain_1.recalculateCustomerAmountsViaApi)(affectedCustomerIds, prisma);
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
