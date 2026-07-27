/**
 * Batch recalc CustomerPolicy capacity gap / uninsured for all eligible customers.
 * Run after Migration A; validate before Migration B (drop Customer.gap_*).
 *
 * Usage: npx tsx scripts/recalculate-customer-policy-gap-amounts.ts
 */
import { syncAllCustomerPolicyGapAmounts } from "../frontend/server/services/creditInsurance/syncCustomerPolicyGapAmounts";

async function main() {
    const result = await syncAllCustomerPolicyGapAmounts();
    console.error(
        "[recalculate-customer-policy-gap-amounts]",
        JSON.stringify({
            customersProcessed: result.customersProcessed,
            customersUpdated: result.customersUpdated,
            missingRates: result.missingRates,
            rateDate: result.rateDate.toISOString().slice(0, 10),
        })
    );
}

main().catch((e) => {
    console.error("[recalculate-customer-policy-gap-amounts] failed", e);
    process.exit(1);
});
