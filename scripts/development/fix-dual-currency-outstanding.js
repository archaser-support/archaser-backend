/**
 * One-shot: restore account-currency net/outstanding on open dual-currency
 * invoices where import incorrectly copied customer_amount into net_amount /
 * outstanding_debt, then recalculate customer rollups and live-refresh KPIs.
 *
 * Usage:
 *   node scripts/development/fix-dual-currency-outstanding.js [accountId]
 * Default accountId: 10149
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const ACCOUNT_ID = Number(process.argv[2] || 10149);

async function main() {
    if (!Number.isFinite(ACCOUNT_ID)) {
        console.error(
            "[fix] Usage: node scripts/development/fix-dual-currency-outstanding.js [accountId]"
        );
        process.exitCode = 1;
        return;
    }

    const account = await prisma.account.findUnique({
        where: { id: ACCOUNT_ID },
        select: { id: true, currency: true },
    });
    if (!account?.currency) {
        console.error("[fix] Account not found or missing currency", ACCOUNT_ID);
        process.exitCode = 1;
        return;
    }
    const accountCurrency = account.currency.trim().toUpperCase();
    console.log("[fix] Account", ACCOUNT_ID, "currency", accountCurrency);

    const before = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS bad_open,
               COUNT(DISTINCT i.customer_id)::int AS customers
        FROM "Invoice" i
        WHERE i.account_id = ${ACCOUNT_ID}
          AND i.status IN ('Due', 'Overdue')
          AND i.customer_currency IS NOT NULL
          AND UPPER(TRIM(i.customer_currency)) <> ${accountCurrency}
          AND i.amount IS DISTINCT FROM i.customer_amount
          AND i.outstanding_debt IS NOT DISTINCT FROM i.customer_outstanding_debt
          AND COALESCE(i.customer_outstanding_debt, 0) != 0
    `;
    console.log("[fix] Before:", before[0]);

    const affected = await prisma.$queryRaw`
        SELECT DISTINCT i.customer_id::int AS customer_id
        FROM "Invoice" i
        WHERE i.account_id = ${ACCOUNT_ID}
          AND i.status IN ('Due', 'Overdue')
          AND i.customer_currency IS NOT NULL
          AND UPPER(TRIM(i.customer_currency)) <> ${accountCurrency}
          AND i.amount IS DISTINCT FROM i.customer_amount
          AND i.outstanding_debt IS NOT DISTINCT FROM i.customer_outstanding_debt
          AND COALESCE(i.customer_outstanding_debt, 0) != 0
        ORDER BY 1
    `;
    const customerIds = affected.map((r) => r.customer_id);
    console.log("[fix] Customers:", customerIds);

    const updated = await prisma.$executeRaw`
        UPDATE "Invoice" i
        SET
          net_amount = i.amount,
          customer_net_amount = COALESCE(i.customer_amount, i.customer_net_amount),
          outstanding_debt = CASE
            WHEN COALESCE(i.customer_amount, 0) != 0
              THEN i.amount * (COALESCE(i.customer_outstanding_debt, 0) / i.customer_amount)
            ELSE i.amount - COALESCE(i.total_paid, 0)
          END,
          modified_at = NOW()
        WHERE i.account_id = ${ACCOUNT_ID}
          AND i.status IN ('Due', 'Overdue')
          AND i.customer_currency IS NOT NULL
          AND UPPER(TRIM(i.customer_currency)) <> ${accountCurrency}
          AND i.amount IS DISTINCT FROM i.customer_amount
          AND i.outstanding_debt IS NOT DISTINCT FROM i.customer_outstanding_debt
          AND COALESCE(i.customer_outstanding_debt, 0) != 0
    `;
    console.log("[fix] Invoices updated:", updated);

    if (customerIds.length === 0) {
        console.log("[fix] Nothing to recalculate");
        return;
    }

    const {
        recalculateCustomerAmounts,
    } = require("../../api/dist/customers/domain/recalculateCustomerAmounts.js");
    await recalculateCustomerAmounts(customerIds, prisma);
    console.log("[fix] Customer rollups recalculated");

    const { bindCreditInsurancePrisma } = require(
        "../../packages/credit-insurance-domain/dist/index.js"
    );
    const { runArPostIngestForCustomers } = require(
        "../../packages/cron-jobs/dist/credit/arPostIngestOrchestrator.js"
    );
    bindCreditInsurancePrisma(prisma);

    console.log("[fix] Live refresh for", customerIds.length, "customers…");
    const started = Date.now();
    const result = await runArPostIngestForCustomers({
        accountId: ACCOUNT_ID,
        customerIds,
        runReplay: false,
        runProcessOverdue: false,
        runLiveRefresh: true,
        runMaturity: false,
        enqueueAsOfRewrite: false,
        onProgress: (p) => {
            console.log(
                "[progress]",
                p.step,
                p.completed + "/" + p.total,
                "customer",
                p.customerId
            );
        },
    });
    console.log(
        "[fix] Live refresh finished in",
        Date.now() - started,
        "ms",
        JSON.stringify(result)
    );

    const after = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS bad_open
        FROM "Invoice" i
        WHERE i.account_id = ${ACCOUNT_ID}
          AND i.status IN ('Due', 'Overdue')
          AND i.customer_currency IS NOT NULL
          AND UPPER(TRIM(i.customer_currency)) <> ${accountCurrency}
          AND i.amount IS DISTINCT FROM i.customer_amount
          AND i.outstanding_debt IS NOT DISTINCT FROM i.customer_outstanding_debt
          AND COALESCE(i.customer_outstanding_debt, 0) != 0
    `;
    console.log("[fix] Remaining bad open:", after[0]);
}

main()
    .catch((e) => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
