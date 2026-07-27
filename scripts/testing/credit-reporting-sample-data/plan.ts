import {
    CUSTOMER_ONBOARDING_DAYS,
    DASHBOARD_SNAPSHOT_SCOPES_PER_DAY,
    DEFAULT_INVOICES_TOTAL,
    DEFAULT_WINDOW_DAYS,
} from "./constants";
import {
    buildEventSchedule,
    formatScenarioBreakdown,
    resolveTargetCustomerCount,
} from "./scheduler";
import { formatTopUpBreakdown } from "./topUpPlan";
import { formatInvoiceBreakdown } from "./invoiceSchedule";
import type { PlannedCounts, ScriptConfig } from "./types";
import type { HistoryWindow } from "./types";

export function computePlannedCounts(config: ScriptConfig): PlannedCounts {
    const onboardingDays = Math.min(config.days, CUSTOMER_ONBOARDING_DAYS);
    const customers = resolveTargetCustomerCount(config, onboardingDays);
    const invoiceScale = config.days / DEFAULT_WINDOW_DAYS;
    const invoices = Math.max(
        1,
        Math.round(DEFAULT_INVOICES_TOTAL * invoiceScale)
    );
    const topUps = Math.max(1, Math.round(customers * 0.2));
    const currencyRates = config.days;

    const activeCustomerDays = Math.min(config.days, CUSTOMER_ONBOARDING_DAYS);
    const rampCustomerDays = Math.max(0, config.days - CUSTOMER_ONBOARDING_DAYS);
    const avgCustomersDuringRamp =
        (customers * (CUSTOMER_ONBOARDING_DAYS + 1)) / (2 * CUSTOMER_ONBOARDING_DAYS);
    const customerPolicyTrends = Math.round(
        activeCustomerDays * avgCustomersDuringRamp +
            rampCustomerDays * customers
    );

    const insurancePolicyTrends = config.days * 2;
    const creditDashboardSnapshots =
        config.days * DASHBOARD_SNAPSHOT_SCOPES_PER_DAY;

    return {
        customers,
        invoices,
        topUps,
        currencyRates,
        customerPolicyTrends,
        insurancePolicyTrends,
        creditDashboardSnapshots,
    };
}

export function printDryRunPlan(
    config: ScriptConfig,
    window: HistoryWindow,
    windowSummary: string,
    counts: PlannedCounts
): void {
    const schedule = buildEventSchedule(config, window);

    console.log("Credit reporting sample data — dry run");
    console.log(windowSummary);
    console.log("");
    console.log("Configuration:");
    console.log(`  customers: ${config.customers}`);
    console.log(`  invoices (planned total): ${counts.invoices}`);
    console.log(`  avg open invoices / customer: ${config.invoicesPerCustomer}`);
    console.log(`  USD-primary customer %: ${config.usdCustomerPct}`);
    if (config.resumeFrom) {
        console.log(`  resume-from: ${config.resumeFrom}`);
    }
    console.log("");
    console.log("Planned entity counts:");
    console.log(`  customers: ${schedule.targetCustomerCount} (onboarding days: ${schedule.onboardingDays})`);
    console.log(`  invoices: ${counts.invoices}`);
    console.log(`  customer top-ups: ${counts.topUps}`);
    console.log(`  currency rates (USD→ILS): ${counts.currencyRates}`);
    console.log(`  customer policy trends: ${counts.customerPolicyTrends}`);
    console.log(`  insurance policy trends: ${counts.insurancePolicyTrends}`);
    console.log(
        `  credit dashboard snapshots: ${counts.creditDashboardSnapshots}`
    );
    console.log("");
    console.log("Customer schedule breakdown:");
    for (const line of formatScenarioBreakdown(schedule.breakdown)) {
        console.log(line);
    }
    console.log("");
    console.log("Top-up schedule breakdown:");
    for (const line of formatTopUpBreakdown(schedule.topUpBreakdown)) {
        console.log(line);
    }
    console.log("");
    console.log("Invoice schedule breakdown:");
    for (const line of formatInvoiceBreakdown(schedule.invoiceBreakdown)) {
        console.log(line);
    }
    console.log("");
    console.log("No database writes performed.");
}
