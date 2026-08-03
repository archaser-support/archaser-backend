import { syncAllCustomerPolicyGapAmounts } from "../../frontend/server/services/creditInsurance/syncCustomerPolicyGapAmounts";
import { prisma } from "../../frontend/lib/prisma";

async function main() {
    console.log("🔄 Starting recalculation of all Customer Policy Gap Amounts...");
    try {
        const stats = await syncAllCustomerPolicyGapAmounts();
        console.log("✅ Recalculation complete!");
        console.log(`📊 Processed: ${stats.customersProcessed} customer(s)`);
        console.log(`📊 Updated: ${stats.customersUpdated} customer(s)`);
        console.log(`📊 Missing Rates: ${stats.missingRates} customer(s)`);
        console.log(`📅 Rate Date: ${stats.rateDate}`);
    } catch (error) {
        console.error("❌ Recalculation failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
