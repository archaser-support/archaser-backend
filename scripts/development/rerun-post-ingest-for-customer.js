/**
 * Re-run connector steps after deferred payment linking for one customer.
 * Does not pull from ERP or re-import Invoice/Payment rows.
 *
 * Chain (same as sync tail after Link payments):
 *   1. Insurance target dates
 *   2. Process Overdue
 *   3. AR replay (limit_assessed stamps; no deferred-payment link)
 *   4. Live refresh (MEP/gap + CTV restamp)
 *   5. As-of rewrite enqueue
 *   6. Customer due/overdue rollups
 *
 * Usage: node scripts/development/rerun-post-ingest-for-customer.js <customerId>
 */
require("dotenv").config();
const path = require("path");
const { PrismaClient } = require("@prisma/client");

if (!process.env.CUSTOMERS_DOMAIN_ROOT) {
    process.env.CUSTOMERS_DOMAIN_ROOT = path.resolve(
        __dirname,
        "../../api/dist/customers"
    );
}

const prisma = new PrismaClient();
const LOG = "[rerun-post-ingest]";

async function main() {
    const customerId = Number(process.argv[2]);
    if (!Number.isFinite(customerId) || customerId <= 0) {
        console.error(
            `${LOG} Usage: node scripts/development/rerun-post-ingest-for-customer.js <customerId>`
        );
        process.exitCode = 1;
        return;
    }

    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
            id: true,
            account_id: true,
            customer_number: true,
            overdue_block: true,
            oldest_invoice_overdue_date: true,
        },
    });
    if (!customer) {
        console.error(`${LOG} Customer ${customerId} not found`);
        process.exitCode = 1;
        return;
    }

    const connector = await prisma.billingConnector.findFirst({
        where: { account_id: customer.account_id },
        select: { mep_breach_start_date: true },
    });

    const invoices = await prisma.invoice.findMany({
        where: {
            customer_id: customerId,
            account_id: customer.account_id,
        },
        select: {
            id: true,
            invoice_number: true,
            ctv_customer_overdue_mep: true,
            status: true,
        },
    });
    const invoiceIds = invoices.map((row) => row.id);
    const ctvBefore = invoices.filter((row) => row.ctv_customer_overdue_mep).length;

    console.log(`${LOG} Customer:`, {
        id: customer.id,
        accountId: customer.account_id,
        customerNumber: customer.customer_number,
        overdueBlock: customer.overdue_block,
        oldestOverdue: customer.oldest_invoice_overdue_date,
        invoiceCount: invoiceIds.length,
        ctvCustomerOverdueMepBefore: ctvBefore,
        mepBreachStartDate: connector?.mep_breach_start_date ?? null,
    });

    const domain = require("../../packages/credit-insurance-domain/dist/index");
    domain.bindCreditInsurancePrisma(prisma);

    // 1. Insurance target dates (before replay).
    if (invoiceIds.length > 0) {
        console.log(`${LOG} Refreshing insurance target dates…`);
        const updated = await domain.refreshInsuranceTargetDatesForInvoiceIds(
            invoiceIds,
            prisma
        );
        console.log(`${LOG} Insurance target dates refreshed:`, { updated });
    }

    // 2–5. Shared AR post-ingest orchestrator (no maturity / link).
    const {
        runArPostIngestForCustomers,
    } = require("../../packages/cron-jobs/dist/credit/arPostIngestOrchestrator");

    console.log(`${LOG} Running AR post-ingest (overdue → replay → live refresh → as-of)…`);
    const postIngest = await runArPostIngestForCustomers({
        accountId: customer.account_id,
        customerIds: [customerId],
        runReplay: true,
        runMaturity: false,
        runProcessOverdue: true,
        runLiveRefresh: true,
        enqueueAsOfRewrite: true,
        asOfRewrite: { importType: "Invoice", entityIds: invoiceIds },
        affectedInvoiceIds: invoiceIds,
        mepBreachStartDate: connector?.mep_breach_start_date ?? null,
        onProgress: (progress) => {
            console.log(`${LOG} Progress:`, {
                step: progress.step,
                customerId: progress.customerId,
                completed: progress.completed,
                total: progress.total,
                detailProcessed: progress.detail?.processed,
                detailTotal: progress.detail?.total,
            });
        },
    });
    console.log(`${LOG} Post-ingest:`, {
        skipped: postIngest.skipped,
        skipReason: postIngest.skipReason ?? "none",
        errorCount: postIngest.errors?.length ?? 0,
        errors:
            (postIngest.errors ?? [])
                .map((error) => `${error.step}: ${error.message}`)
                .join(" | ") || "none",
    });

    // 6. Customer due/overdue rollups.
    const {
        recalculateCustomerAmountsViaHost,
    } = require("../../packages/billing-connector/dist/customers/recalculateCustomerAmountsHost");
    await recalculateCustomerAmountsViaHost([customerId], prisma);
    console.log(`${LOG} Recalculated customer balances`);

    const afterCustomer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: {
            overdue_block: true,
            oldest_invoice_overdue_date: true,
            total_overdue_amount: true,
            number_of_overdue_invoices: true,
        },
    });
    const afterInvoices = await prisma.invoice.findMany({
        where: { customer_id: customerId, account_id: customer.account_id },
        select: {
            invoice_number: true,
            ctv_customer_overdue_mep: true,
            status: true,
        },
    });
    const ctvAfter = afterInvoices.filter((row) => row.ctv_customer_overdue_mep);
    const sample = afterInvoices.find(
        (row) => row.invoice_number === "SI260013475"
    );

    console.log(`${LOG} After:`, {
        overdueBlock: afterCustomer?.overdue_block,
        oldestOverdue: afterCustomer?.oldest_invoice_overdue_date,
        totalOverdueAmount: afterCustomer?.total_overdue_amount,
        numberOfOverdueInvoices: afterCustomer?.number_of_overdue_invoices,
        ctvCustomerOverdueMepBefore: ctvBefore,
        ctvCustomerOverdueMepAfter: ctvAfter.length,
        si260013475: sample ?? null,
    });
}

main()
    .catch((error) => {
        console.error(`${LOG} Failed:`, {
            errorMessage: error?.message,
            errorStack: error?.stack,
        });
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
