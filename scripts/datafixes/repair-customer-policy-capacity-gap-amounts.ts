/**
 * Repair CustomerPolicy.capacity_gap_* from stored invoice gap SUMs.
 *
 * Runs the full gap pipeline per customer (invoice gaps → policy aggregate → flags),
 * then verifies active policy rows match invoice SUMs.
 *
 * Usage:
 *   npx tsx scripts/datafixes/repair-customer-policy-capacity-gap-amounts.ts --dry-run
 *   npx tsx scripts/datafixes/repair-customer-policy-capacity-gap-amounts.ts --fix
 *   npx tsx scripts/datafixes/repair-customer-policy-capacity-gap-amounts.ts --fix --account-id=10117
 *   npx tsx scripts/datafixes/repair-customer-policy-capacity-gap-amounts.ts --fix --customer-id=1655
 */
import { prisma } from "../../frontend/lib/prisma";
import { sumInvoiceCapacityGapForCustomerPolicy } from "../../frontend/server/services/creditInsurance/invoiceCapacityGapAmounts";
import { syncCreditInsuranceGapPipelineForCustomer } from "../../frontend/server/services/creditInsurance/syncCreditInsuranceGapPipeline";

const TOLERANCE = 0.01;

type MismatchRow = {
    accountId: number;
    customerId: number;
    customerPolicyId: number;
    policyId: number;
    policyBase: number;
    invoiceSumBase: number;
    policyLimit: number;
    invoiceSumLimit: number;
    hasMissingSnapshots: boolean;
    missingRate: boolean;
};

function parseArg(prefix: string): number | undefined {
    const raw = process.argv.find((a) => a.startsWith(`${prefix}=`));
    if (!raw) {
        return undefined;
    }
    const n = Number(raw.split("=")[1]);
    return Number.isFinite(n) ? n : undefined;
}

const dryRun = process.argv.includes("--dry-run");
const doFix = process.argv.includes("--fix");
const accountIdFilter = parseArg("--account-id");
const customerIdFilter = parseArg("--customer-id");

async function findMismatches(): Promise<MismatchRow[]> {
    const mismatches: MismatchRow[] = [];

    const policies = await prisma.customerPolicy.findMany({
        where: {
            is_active: true,
            insurance_policy_id: { not: null },
            Customer: {
                ...(accountIdFilter != null ? { account_id: accountIdFilter } : {}),
                ...(customerIdFilter != null ? { id: customerIdFilter } : {}),
                Account: { has_credit_insurance: true },
            },
        },
        select: {
            id: true,
            customer_id: true,
            insurance_policy_id: true,
            capacity_gap_amount: true,
            capacity_gap_amount1: true,
            Customer: { select: { account_id: true } },
        },
    });

    for (const row of policies) {
        const policyId = row.insurance_policy_id;
        const accountId = row.Customer.account_id;
        if (policyId == null) {
            continue;
        }

        const summed = await sumInvoiceCapacityGapForCustomerPolicy(
            accountId,
            row.customer_id,
            policyId
        );

        const policyBase = Number(row.capacity_gap_amount ?? 0);
        const policyLimit = Number(row.capacity_gap_amount1 ?? 0);
        const baseDelta = Math.abs(policyBase - summed.gapBase);
        const limitDelta = Math.abs(policyLimit - summed.gapLimit);

        const valueMismatch =
            baseDelta > TOLERANCE || limitDelta > TOLERANCE;

        if (valueMismatch || summed.missingRate) {
            mismatches.push({
                accountId,
                customerId: row.customer_id,
                customerPolicyId: row.id,
                policyId,
                policyBase,
                invoiceSumBase: summed.gapBase,
                policyLimit,
                invoiceSumLimit: summed.gapLimit,
                hasMissingSnapshots: summed.hasMissingSnapshots,
                missingRate: summed.missingRate,
            });
        }
    }

    return mismatches;
}

async function forceUpdatePolicyRowFromInvoiceSum(row: MismatchRow): Promise<void> {
    const policyRow = await prisma.customerPolicy.findUnique({
        where: { id: row.customerPolicyId },
        select: {
            approved_limit_currency: true,
            outdated_dcl: true,
        },
    });
    if (!policyRow || policyRow.outdated_dcl === true) {
        return;
    }

    const summed = await sumInvoiceCapacityGapForCustomerPolicy(
        row.accountId,
        row.customerId,
        row.policyId
    );
    const limitCurrency =
        summed.limitCurrency ??
        policyRow.approved_limit_currency?.trim().toUpperCase() ??
        null;

    await prisma.customerPolicy.update({
        where: { id: row.customerPolicyId },
        data: {
            capacity_gap_amount: summed.gapBase,
            capacity_gap_amount1: summed.gapLimit,
            capacity_gap_currency1: limitCurrency,
            capacity_gap_amount2: null,
            capacity_gap_currency2: null,
        },
    });
}

async function main() {
    if (!dryRun && !doFix) {
        console.error(
            "Pass --dry-run to report only, or --fix to run the repair pipeline."
        );
        process.exit(1);
    }

    const before = await findMismatches();
    console.log(
        `${dryRun ? "[dry-run] " : ""}Found ${before.length} active CustomerPolicy row(s) to repair.`
    );
    for (const row of before) {
        console.log(JSON.stringify(row));
    }

    if (dryRun || before.length === 0) {
        return;
    }

    const customerIds = Array.from(
        new Set(before.map((row) => row.customerId))
    );
    let repaired = 0;
    let missingRateCustomers = 0;

    for (const customerId of customerIds) {
        const { missingRate } =
            await syncCreditInsuranceGapPipelineForCustomer(customerId);
        if (missingRate) {
            missingRateCustomers += 1;
        }
        repaired += 1;
        if (repaired % 50 === 0) {
            console.log(`Pipeline processed ${repaired}/${customerIds.length} customers...`);
        }
    }

    let after = await findMismatches();
    if (after.length > 0) {
        console.log(`Force-updating ${after.length} row(s) from invoice SUMs...`);
        for (const row of after) {
            await forceUpdatePolicyRowFromInvoiceSum(row);
        }
        after = await findMismatches();
    }

    console.log(
        JSON.stringify({
            customersProcessed: customerIds.length,
            missingRateCustomers,
            rowsBefore: before.length,
            rowsAfter: after.length,
        })
    );

    if (after.length > 0) {
        console.log("Remaining mismatches:");
        for (const row of after) {
            console.log(JSON.stringify(row));
        }
        process.exitCode = 1;
    } else {
        console.log("All active CustomerPolicy gap rows match invoice SUMs.");
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
