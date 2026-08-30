/**
 * Inspect the terms-breach invoice set for one customer (read-only).
 *
 * Mirrors getCustomerTermsBreachCountByReason: open Due/Overdue invoices with
 * amount >= 0 and at least one breach flag.
 *
 * Usage:
 *   npx tsx scripts/inspect-terms-breach-invoices.ts --customer 4039
 *   npx tsx scripts/inspect-terms-breach-invoices.ts --customer 4039 --limit 3
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

function parseArgs(argv: string[]): { customerId: number; limit: number } {
    const index = argv.indexOf("--customer");
    const customerId = Number(index === -1 ? NaN : argv[index + 1]);
    if (!Number.isInteger(customerId) || customerId <= 0) {
        throw new Error("--customer <id> is required");
    }
    const limitIndex = argv.indexOf("--limit");
    const limit = Number(limitIndex === -1 ? 1 : argv[limitIndex + 1]);
    return { customerId, limit: Number.isInteger(limit) && limit > 0 ? limit : 1 };
}

async function main(): Promise<void> {
    const { customerId, limit } = parseArgs(process.argv.slice(2));
    const prisma = new PrismaClient();

    try {
        const customer = await prisma.customer.findUnique({
            where: { id: customerId },
            select: { id: true, account_id: true, customer_number: true },
        });
        if (!customer) {
            throw new Error(`customer ${customerId} not found`);
        }

        const where = {
            account_id: customer.account_id,
            customer_id: customerId,
            status: { in: ["Due", "Overdue"] },
            amount: { gte: 0 },
            OR: [
                { reporting_breach: true },
                { ctv_payment_term: true },
                { ctv_customer_overdue_mep: true },
                { ctv_outdated_dcl: true },
                { ctv_invoice_after_policy_end: true },
            ],
        } as const;

        const total = await prisma.invoice.count({ where });
        console.log("[terms-breach] customer:", {
            customerId: customer.id,
            accountId: customer.account_id,
            customerNumber: customer.customer_number,
            breachInvoiceCount: total,
        });

        if (total === 0) {
            const openCount = await prisma.invoice.count({
                where: {
                    account_id: customer.account_id,
                    customer_id: customerId,
                    status: { in: ["Due", "Overdue"] },
                },
            });
            const policies = await prisma.customerPolicy.findMany({
                where: { customer_id: customerId },
                select: {
                    insurance_policy_id: true,
                    is_active: true,
                    excluded_from_policy: true,
                    policy_exclusion_reason: true,
                    outdated_dcl: true,
                },
            });
            console.log("[terms-breach] no flagged invoices:", {
                openDueOverdueCount: openCount,
                policyRows: JSON.stringify(policies),
            });
        }

        const invoices = await prisma.invoice.findMany({
            where,
            orderBy: { invoice_date: "asc" },
            take: limit,
            select: {
                id: true,
                invoice_number: true,
                status: true,
                invoice_date: true,
                due_date: true,
                amount: true,
                outstanding_debt: true,
                customer_outstanding_debt: true,
                customer_currency: true,
                policy_id: true,
                payment_term: true,
                in_capacity_gap: true,
                capacity_gap_amount: true,
                reported_status: true,
                actual_reporting_date: true,
                reporting_breach: true,
                target_reporting_date: true,
                target_mep_date: true,
                ctv_payment_term: true,
                ctv_customer_overdue_mep: true,
                ctv_outdated_dcl: true,
                ctv_invoice_after_policy_end: true,
            },
        });

        for (const invoice of invoices) {
            console.log("[terms-breach] sample invoice:", {
                invoiceId: invoice.id,
                invoiceNumber: invoice.invoice_number,
                status: invoice.status,
                invoiceDate: invoice.invoice_date?.toISOString() ?? null,
                dueDate: invoice.due_date?.toISOString() ?? null,
                amount: String(invoice.amount),
                outstandingDebt: String(invoice.outstanding_debt),
                customerOutstandingDebt: String(invoice.customer_outstanding_debt),
                customerCurrency: invoice.customer_currency,
                policyId: invoice.policy_id,
                paymentTerm: invoice.payment_term,
                inCapacityGap: invoice.in_capacity_gap,
                capacityGapAmount: String(invoice.capacity_gap_amount),
                reportedStatus: invoice.reported_status,
                actualReportingDate:
                    invoice.actual_reporting_date?.toISOString() ?? null,
                reportingBreach: invoice.reporting_breach,
                targetReportingDate:
                    invoice.target_reporting_date?.toISOString() ?? null,
                targetMepDate: invoice.target_mep_date?.toISOString() ?? null,
                ctvPaymentTerm: invoice.ctv_payment_term,
                ctvCustomerOverdueMep: invoice.ctv_customer_overdue_mep,
                ctvOutdatedDcl: invoice.ctv_outdated_dcl,
                ctvInvoiceAfterPolicyEnd: invoice.ctv_invoice_after_policy_end,
            });
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((error) => {
    console.error("[terms-breach] failed:", error);
    process.exit(1);
});
