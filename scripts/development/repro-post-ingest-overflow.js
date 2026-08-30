/**
 * Reproduces the "Maximum call stack size exceeded" seen in AR post-ingest and
 * prints the full stack. Runs inside a transaction that is always rolled back,
 * so no data is changed.
 *
 * Usage: node scripts/development/repro-post-ingest-overflow.js <customerId>
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

Error.stackTraceLimit = 60;

const prisma = new PrismaClient();
const ROLLBACK = 'INTENTIONAL_ROLLBACK';

async function run(label, fn) {
    try {
        await prisma.$transaction(
            async (tx) => {
                await fn(tx);
                throw new Error(ROLLBACK);
            },
            { timeout: 120000 }
        );
    } catch (error) {
        if (error?.message === ROLLBACK) {
            console.log(`[repro] ${label}: completed without error (rolled back)`);
            return;
        }
        console.log(`[repro] ${label}: FAILED`, {
            errorName: error?.name,
            errorMessage: error?.message,
        });
        console.log(error?.stack);
    }
}

async function main() {
    const customerId = Number(process.argv[2] || 4036);

    const { handleOverdueInvoices } = require('./../../packages/cron-jobs/dist/handleOverdueInvoices');
    const domain = require('./../../packages/credit-insurance-domain/dist/index');
    const pipeline = require('./../../packages/credit-insurance-domain/dist/credit-insurance/domain/syncCreditInsuranceGapPipeline');

    await run('handleOverdueInvoices', (tx) => handleOverdueInvoices(tx, customerId));

    if (typeof domain.bindCreditInsurancePrisma === 'function') {
        domain.bindCreditInsurancePrisma(prisma);
    }

    await run('gapPipeline', async (tx) => {
        const result = await pipeline.syncCreditInsuranceGapPipelineForCustomer(customerId, {
            dbClient: tx,
        });
        console.log('[repro] gapPipeline result:', result);

        const policy = await tx.customerPolicy.findFirst({
            where: { customer_id: customerId, is_active: true },
            select: { capacity_gap_amount: true, uninsured_amount: true, retained_capacity_gap: true },
        });
        console.log('[repro] recomputed policy gap:', {
            capacityGapAmount: policy?.capacity_gap_amount,
            uninsuredAmount: policy?.uninsured_amount,
            retainedCapacityGap: policy?.retained_capacity_gap,
        });
    });
}

main()
    .catch((error) => {
        console.error('[repro] Harness failed:', {
            errorMessage: error?.message,
            errorStack: error?.stack,
        });
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
