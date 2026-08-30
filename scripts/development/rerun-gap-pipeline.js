/**
 * Re-runs the credit-insurance gap pipeline for one customer, for real.
 * Use after a swallowed AR post-ingest failure left stale capacity gaps.
 *
 * Usage: node scripts/development/rerun-gap-pipeline.js <customerId>
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function readPolicy(customerId) {
    const policy = await prisma.customerPolicy.findFirst({
        where: { customer_id: customerId, is_active: true },
        select: {
            capacity_gap_amount: true,
            capacity_gap_amount1: true,
            uninsured_amount: true,
            retained_capacity_gap: true,
            capacity_gap_amount_date: true,
        },
    });
    return {
        capacityGapAmount: policy?.capacity_gap_amount ?? null,
        capacityGapAmount1: policy?.capacity_gap_amount1 ?? null,
        uninsuredAmount: policy?.uninsured_amount ?? null,
        retainedCapacityGap: policy?.retained_capacity_gap ?? null,
        capacityGapAmountDate: policy?.capacity_gap_amount_date ?? null,
    };
}

async function main() {
    const customerId = Number(process.argv[2]);
    if (!Number.isFinite(customerId)) {
        console.error('[rerun] Usage: node scripts/development/rerun-gap-pipeline.js <customerId>');
        process.exitCode = 1;
        return;
    }

    const domain = require('./../../packages/credit-insurance-domain/dist/index');
    const pipeline = require('./../../packages/credit-insurance-domain/dist/credit-insurance/domain/syncCreditInsuranceGapPipeline');
    domain.bindCreditInsurancePrisma(prisma);

    console.log('[rerun] Before:', await readPolicy(customerId));

    const result = await pipeline.syncCreditInsuranceGapPipelineForCustomer(customerId);
    console.log('[rerun] Pipeline result:', result);

    console.log('[rerun] After:', await readPolicy(customerId));

    const invoices = await prisma.invoice.findMany({
        where: { customer_id: customerId, status: { in: ['Due', 'Overdue'] } },
        select: { capacity_gap_amount_limit: true, in_capacity_gap: true },
    });
    console.log('[rerun] Open invoices:', {
        openCount: invoices.length,
        withPositiveGap: invoices.filter((i) => Number(i.capacity_gap_amount_limit ?? 0) > 0).length,
        inCapacityGapFlagged: invoices.filter((i) => i.in_capacity_gap).length,
        sumGapLimit: invoices.reduce((s, i) => s + Number(i.capacity_gap_amount_limit ?? 0), 0),
    });
}

main()
    .catch((error) => {
        console.error('[rerun] Failed:', {
            errorMessage: error?.message,
            errorStack: error?.stack,
        });
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
