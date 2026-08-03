/**
 * One-off fix for open invoices stamped before the top-up waterfall fix.
 * Re-stamps limit_assessed_amount using top-up active on each invoice_date,
 * then re-syncs capacity gap aggregates.
 *
 * Only use when top-up existed **before** the invoice(s) were opened.
 * Do not use to retroactively forgive gap after a late top-up.
 *
 * Usage:
 *   npx tsx scripts/restamp-customer-limit-assessment.ts --customer-id=1652
 *   npx tsx scripts/restamp-customer-limit-assessment.ts --customer-id=1652 --dry-run
 */
import { prisma } from "../frontend/lib/prisma";
import { restampCustomerOpenInvoiceLimitAssessment } from "../frontend/server/services/creditInsurance/restampCustomerLimitAssessment";
import { syncCreditInsuranceGapPipelineForCustomer } from "../frontend/server/services/creditInsurance/syncCreditInsuranceGapPipeline";

const dryRun = process.argv.includes("--dry-run");
const customerIdArg = process.argv.find((a) => a.startsWith("--customer-id="));
const customerId = customerIdArg
    ? Number.parseInt(customerIdArg.split("=")[1] ?? "", 10)
    : NaN;

async function main() {
    if (!Number.isFinite(customerId)) {
        console.error("Pass --customer-id=<id>");
        process.exit(1);
    }

    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            account_id: true,
            Account: { select: { currency: true } },
        },
    });
    if (!customer) {
        console.error(`Customer ${customerId} not found`);
        process.exit(1);
    }

    const updated = await restampCustomerOpenInvoiceLimitAssessment(
        customerId,
        {
            accountCurrency: customer.Account?.currency ?? null,
            dryRun,
        }
    );
    console.log(
        dryRun
            ? `[dry-run] Would update ${updated} invoice(s)`
            : `Updated limit_assessed_amount on ${updated} invoice(s)`
    );

    if (!dryRun && updated > 0) {
        await syncCreditInsuranceGapPipelineForCustomer(customerId);
        console.log("Synced capacity gap pipeline");
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
