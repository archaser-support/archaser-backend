/**
 * Reconcile invoice SUM vs CustomerPolicy cached gap per account.
 *
 * Usage:
 *   npx tsx scripts/reconcile-invoice-policy-gap-amounts.ts
 *   npx tsx scripts/reconcile-invoice-policy-gap-amounts.ts --account-id=123
 */
import { prisma } from "../frontend/lib/prisma";
import { sumInvoiceCapacityGapForCustomerPolicy } from "../frontend/server/services/creditInsurance/invoiceCapacityGapAmounts";

const accountArg = process.argv.find((a) => a.startsWith("--account-id="));
const accountIdFilter = accountArg
    ? Number(accountArg.split("=")[1])
    : undefined;

async function main() {
    const accounts = await prisma.account.findMany({
        where: {
            has_credit_insurance: true,
            ...(accountIdFilter != null ? { id: accountIdFilter } : {}),
        },
        select: { id: true, name: true },
    });

    let mismatchCount = 0;

    for (const account of accounts) {
        const policies = await prisma.customerPolicy.findMany({
            where: {
                is_active: true,
                Customer: { account_id: account.id },
            },
            select: {
                customer_id: true,
                insurance_policy_id: true,
                capacity_gap_amount: true,
                capacity_gap_amount1: true,
            },
        });

        for (const row of policies) {
            const pid = row.insurance_policy_id;
            if (pid == null) {
                continue;
            }
            const summed = await sumInvoiceCapacityGapForCustomerPolicy(
                account.id,
                row.customer_id,
                pid
            );
            if (summed.hasMissingSnapshots) {
                continue;
            }
            const policyBase = Number(row.capacity_gap_amount ?? 0);
            const policyLimit = Number(row.capacity_gap_amount1 ?? 0);
            const baseDelta = Math.abs(policyBase - summed.gapBase);
            const limitDelta = Math.abs(policyLimit - summed.gapLimit);
            if (baseDelta > 0.01 || limitDelta > 0.01) {
                mismatchCount += 1;
                console.log(
                    JSON.stringify({
                        accountId: account.id,
                        accountName: account.name,
                        customerId: row.customer_id,
                        policyId: pid,
                        policyBase,
                        invoiceSumBase: summed.gapBase,
                        policyLimit,
                        invoiceSumLimit: summed.gapLimit,
                    })
                );
            }
        }
    }

    console.log(
        mismatchCount === 0
            ? "All reconciled policy rows match invoice SUMs."
            : `${mismatchCount} customer+policy row(s) differ from invoice SUMs.`
    );
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
