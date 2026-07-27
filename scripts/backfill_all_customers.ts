/**
 * Backfill script to recalculate all due and overdue amounts for all customers.
 * This uses CustomerService.recalculateAllAmountsForCustomers to ensure
 * consistent multi-currency breakdowns and parent aggregation sync.
 *
 * Run with: npx ts-node scripts/backfill_all_customers.ts
 */
import { prisma } from "../frontend/lib/prisma";
import { CustomerService } from "../frontend/server/services/CustomerService";

async function backfill() {
    console.log("🚀 Starting backfill for all customers...");

    // 1. Fetch all customer IDs
    const customers = await prisma.customer.findMany({
        select: { id: true }
    });

    const customerIds = customers.map(c => c.id);
    console.log(`📊 Found ${customerIds.length} customers to recalculate.`);

    // 2. Process in batches to handle large databases efficiently
    const batchSize = 50;
    for (let i = 0; i < customerIds.length; i += batchSize) {
        const batch = customerIds.slice(i, i + batchSize);
        console.log(`⏳ Processing batch ${Math.floor(i / batchSize) + 1} (${batch.length} customers)...`);

        try {
            // This calls the comprehensive recalculation logic
            await CustomerService.recalculateAllAmountsForCustomers(batch);
        } catch (error) {
            console.error(`❌ Error processing batch starting at index ${i}:`, error);
        }
    }

    console.log("✅ Backfill completed successfully!");
}

backfill()
    .catch(err => {
        console.error("💥 Fatal error during backfill:", err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
