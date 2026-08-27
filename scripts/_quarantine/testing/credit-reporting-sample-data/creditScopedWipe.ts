import { prisma } from "@/lib/prisma";
import type { DbClient } from "@/lib/prisma";

import type { WipeStats } from "./types";

async function deleteCustomerSubtree(
    tx: DbClient,
    customerId: number
): Promise<void> {
    await tx.activityAttachment.deleteMany({
        where: { Activity: { customer_id: customerId } },
    });
    await tx.activityContact.deleteMany({
        where: { Activity: { customer_id: customerId } },
    });
    await tx.communicationChannelPreference.deleteMany({
        where: { customer_id: customerId },
    });
    await tx.communicationLearningData.deleteMany({
        where: { customer_id: customerId },
    });
    await tx.activity.deleteMany({ where: { customer_id: customerId } });
    await tx.disputeInvoice.deleteMany({
        where: { CustomerDispute: { customer_id: customerId } },
    });
    await tx.customerDispute.deleteMany({
        where: { customer_id: customerId },
    });
    await tx.invoicePayment.deleteMany({ where: { customer_id: customerId } });
    await tx.invoice.deleteMany({ where: { customer_id: customerId } });
    await tx.customerCollectionPeriod.deleteMany({
        where: { customer_id: customerId },
    });
    await tx.customerTopUp.deleteMany({ where: { customer_id: customerId } });
    await tx.customerPolicy.deleteMany({ where: { customer_id: customerId } });
    await tx.customerAggregatedData.deleteMany({
        where: { customer_id: customerId },
    });
    await tx.customerBanks.deleteMany({ where: { customer_id: customerId } });
    await tx.contact.deleteMany({ where: { customer_id: customerId } });
}

export async function wipeCreditScopedEntities(
    accountId: number
): Promise<WipeStats> {
    const stats: WipeStats = {
        creditDashboardSnapshots: 0,
        customerPolicyTrends: 0,
        insurancePolicyTrends: 0,
        insurancePolicyCountryTrends: 0,
        namedPolicyTrends: 0,
        customerCheckpoints: 0,
        invoicePayments: 0,
        invoices: 0,
        customers: 0,
        companies: 0,
        persons: 0,
    };

    const policyIds = (
        await prisma.insurancePolicy.findMany({
            where: { account_id: accountId },
            select: { id: true },
        })
    ).map((row) => row.id);

    const customers = await prisma.customer.findMany({
        where: { account_id: accountId },
        select: {
            id: true,
            company_id: true,
            person_id: true,
            parent_customer_id: true,
        },
    });

    const companyIds = [
        ...new Set(
            customers
                .map((customer) => customer.company_id)
                .filter((id): id is number => id != null)
        ),
    ];
    const personIds = [
        ...new Set(
            customers
                .map((customer) => customer.person_id)
                .filter((id): id is number => id != null)
        ),
    ];

    await prisma.$transaction(async (tx) => {
        const txClient = tx as DbClient;

        const creditDashboardResult =
            await txClient.creditDashboardDailySnapshot.deleteMany({
                where: { account_id: accountId },
            });
        stats.creditDashboardSnapshots = creditDashboardResult.count;

        const customerPolicyTrendResult =
            await txClient.customerPolicyTrend.deleteMany({
                where: { account_id: accountId },
            });
        stats.customerPolicyTrends = customerPolicyTrendResult.count;

        if (policyIds.length > 0) {
            const countryTrendResult =
                await txClient.insurancePolicyCountryTrend.deleteMany({
                    where: { insurance_policy_id: { in: policyIds } },
                });
            stats.insurancePolicyCountryTrends = countryTrendResult.count;

            const namedTrendResult = await txClient.namedPolicyTrend.deleteMany({
                where: { insurance_policy_id: { in: policyIds } },
            });
            stats.namedPolicyTrends = namedTrendResult.count;
        }

        const insurancePolicyTrendResult =
            await txClient.insurancePolicyTrend.deleteMany({
                where: { account_id: accountId },
            });
        stats.insurancePolicyTrends = insurancePolicyTrendResult.count;

        const checkpointResult = await txClient.customerCheckpoint.deleteMany({
            where: { account_id: accountId },
        });
        stats.customerCheckpoints = checkpointResult.count;

        if (customers.length > 0) {
            await txClient.customer.updateMany({
                where: { account_id: accountId },
                data: { parent_customer_id: null },
            });

            for (const customer of customers) {
                await deleteCustomerSubtree(txClient, customer.id);
            }

            const invoicePaymentResult = await txClient.invoicePayment.deleteMany(
                {
                    where: { account_id: accountId },
                }
            );
            stats.invoicePayments = invoicePaymentResult.count;

            const invoiceResult = await txClient.invoice.deleteMany({
                where: { account_id: accountId },
            });
            stats.invoices = invoiceResult.count;

            const customerResult = await txClient.customer.deleteMany({
                where: { account_id: accountId },
            });
            stats.customers = customerResult.count;
        }

        if (companyIds.length > 0) {
            const companyResult = await txClient.company.deleteMany({
                where: { id: { in: companyIds } },
            });
            stats.companies = companyResult.count;
        }

        if (personIds.length > 0) {
            const personResult = await txClient.person.deleteMany({
                where: { id: { in: personIds } },
            });
            stats.persons = personResult.count;
        }
    });

    return stats;
}

export function printWipeStats(stats: WipeStats): void {
    console.log("Credit-scoped wipe complete:");
    console.log(
        `  snapshots/trends removed: dashboard=${stats.creditDashboardSnapshots}, customerPolicyTrend=${stats.customerPolicyTrends}, insurancePolicyTrend=${stats.insurancePolicyTrends}`
    );
    console.log(
        `  entities removed: customers=${stats.customers}, invoices=${stats.invoices}, invoicePayments=${stats.invoicePayments}, companies=${stats.companies}, persons=${stats.persons}`
    );
}
