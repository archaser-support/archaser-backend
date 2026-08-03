/**
 * Recalculate denormalized due/overdue amounts for customers by customer_number.
 *
 * Usage:
 *   npx tsx scripts/datafixes/recalculate-customers-by-number.ts 5401 5403
 */
import { prisma } from "../../frontend/lib/prisma";
import { CustomerService } from "../../frontend/server/services/CustomerService";

async function main() {
    const numbers = process.argv.slice(2);
    if (numbers.length === 0) {
        console.error("Usage: npx tsx scripts/datafixes/recalculate-customers-by-number.ts <customer_number> [...]");
        process.exit(1);
    }

    const before = await prisma.customer.findMany({
        where: { customer_number: { in: numbers } },
        select: {
            id: true,
            customer_number: true,
            total_due_amount: true,
            no_of_due_invoices: true,
            total_overdue_amount: true,
            number_of_overdue_invoices: true,
        },
    });

    if (before.length === 0) {
        console.log("No customers found for:", numbers.join(", "));
        return;
    }

    console.log("Before:");
    for (const row of before) {
        console.log(row);
    }

    await CustomerService.recalculateAllAmountsForCustomers(
        before.map((c) => c.id),
        undefined,
        { runPostCommitEffects: false }
    );

    const after = await prisma.customer.findMany({
        where: { id: { in: before.map((c) => c.id) } },
        select: {
            id: true,
            customer_number: true,
            total_due_amount: true,
            no_of_due_invoices: true,
            total_overdue_amount: true,
            number_of_overdue_invoices: true,
        },
    });

    console.log("After:");
    for (const row of after) {
        console.log(row);
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
