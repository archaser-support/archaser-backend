/**
 * Script to fix invoice statuses and recalculate customer amounts
 * 
 * This script will:
 * 1. Find invoices that are past due date but still in "Due" status (13)
 * 2. Update them to "Overdue" status (3)
 * 3. Recalculate all customer amounts (Due and Overdue) and sync to Customer table
 * 
 * Usage: npx tsx scripts/fix-invoice-statuses-and-recalculate.ts
 */

import { prisma } from "../frontend/lib/prisma.js";
import { CustomerService } from "../frontend/server/services/CustomerService.js";

async function fixInvoiceStatusesAndRecalculate() {
    console.log("Starting invoice status fix and recalculation...");

    try {
        const today = new Date();

        // 1. Find and update past-due invoices
        console.log("Updating past-due invoices to 'Overdue' status...");

        const updateResult = await prisma.invoice.updateMany({
            where: {
                status_id: 13, // Due status
                due_date: {
                    lt: today // Less than today
                },
                outstanding_debt: {
                    gt: 0 // Has outstanding debt
                }
            },
            data: {
                status_id: 3 // Set to Overdue status
            }
        });

        console.log(`✅ Updated ${updateResult.count} invoices to Overdue status.`);

        // 2. Get all customer IDs
        const customers = await prisma.customer.findMany({
            select: { id: true },
        });

        const customerIds = customers.map((c) => c.id);
        console.log(`Found ${customerIds.length} customers to recalculate`);

        // 3. Recalculate amounts in batches
        const batchSize = 50;
        let processed = 0;

        for (let i = 0; i < customerIds.length; i += batchSize) {
            const batch = customerIds.slice(i, i + batchSize);
            console.log(
                `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(customerIds.length / batchSize)}...`
            );

            // Recalculate amounts for this batch
            await CustomerService.recalculateAllAmountsForCustomers(batch);

            processed += batch.length;
            console.log(`Processed ${processed}/${customerIds.length} customers`);
        }

        console.log("✅ Successfully fixed statuses and recalculated amounts!");
    } catch (error) {
        console.error("❌ Error:", error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
fixInvoiceStatusesAndRecalculate()
    .then(() => {
        console.log("Script completed successfully");
        process.exit(0);
    })
    .catch((error) => {
        console.error("Script failed:", error);
        process.exit(1);
    });
