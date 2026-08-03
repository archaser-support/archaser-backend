import {
    CUSTOMER_NUMBER_PREFIX,
    CUSTOMER_ONBOARDING_DAYS,
    PRIMARY_BU_CUSTOMER_PCT,
    SCENARIO_BREACH_PCT,
    SCENARIO_COMPLIANT_PCT,
    SCENARIO_EXCLUDED_ZERO_PCT,
    SCENARIO_GAP_PCT,
    SCENARIO_NO_POLICY_PCT,
} from "./constants";
import type {
    CurrencyProfile,
    CustomerScenario,
    EventSchedule,
    ScenarioBreakdown,
    ScheduledCustomer,
    ScriptConfig,
} from "./types";
import {
    addUtcDaysTo,
    dayIndexInWindow,
    formatUtcDate,
    type HistoryWindow,
} from "./window";
import { buildTopUpSchedule } from "./topUpPlan";
import { buildInvoiceSchedule } from "./invoiceSchedule";

const BREACH_SCENARIOS: CustomerScenario[] = [
    "breach-mep",
    "breach-reporting",
    "breach-outdated-dcl",
    "breach-post-policy-end",
];

function emptyBreakdown(): ScenarioBreakdown {
    return {
        compliant: 0,
        gap: 0,
        "breach-mep": 0,
        "breach-reporting": 0,
        "breach-outdated-dcl": 0,
        "breach-post-policy-end": 0,
        excluded: 0,
        "zero-limit": 0,
        "no-policy": 0,
        ilsPrimary: 0,
        usdPrimary: 0,
        primaryBu: 0,
        secondaryBu: 0,
    };
}

function distributeCount(total: number, buckets: number): number[] {
    const base = Math.floor(total / buckets);
    const remainder = total % buckets;
    return Array.from({ length: buckets }, (_, index) =>
        index < remainder ? base + 1 : base
    );
}

export function resolveTargetCustomerCount(
    config: ScriptConfig,
    onboardingDays: number
): number {
    if (onboardingDays >= CUSTOMER_ONBOARDING_DAYS) {
        return config.customers;
    }
    return Math.max(
        1,
        Math.round((config.customers * onboardingDays) / CUSTOMER_ONBOARDING_DAYS)
    );
}

function assignScenarios(totalCustomers: number): CustomerScenario[] {
    const compliant = Math.round((totalCustomers * SCENARIO_COMPLIANT_PCT) / 100);
    const gap = Math.round((totalCustomers * SCENARIO_GAP_PCT) / 100);
    const breach = Math.round((totalCustomers * SCENARIO_BREACH_PCT) / 100);
    const excludedZero = Math.round(
        (totalCustomers * SCENARIO_EXCLUDED_ZERO_PCT) / 100
    );
    const noPolicy = Math.round(
        (totalCustomers * SCENARIO_NO_POLICY_PCT) / 100
    );

    let assigned = compliant + gap + breach + excludedZero + noPolicy;
    const compliantAdjusted = compliant + (totalCustomers - assigned);

    const scenarios: CustomerScenario[] = [
        ...Array.from({ length: compliantAdjusted }, () => "compliant" as const),
        ...Array.from({ length: gap }, () => "gap" as const),
        ...BREACH_SCENARIOS.flatMap((scenario, index) => {
            const breachCounts = distributeCount(breach, BREACH_SCENARIOS.length);
            return Array.from(
                { length: breachCounts[index] ?? 0 },
                () => scenario
            );
        }),
    ];

    const excludedCount = Math.max(1, Math.floor(excludedZero / 2));
    const zeroLimitCount = Math.max(0, excludedZero - excludedCount);
    scenarios.push(
        ...Array.from({ length: excludedCount }, () => "excluded" as const),
        ...Array.from({ length: zeroLimitCount }, () => "zero-limit" as const),
        ...Array.from({ length: noPolicy }, () => "no-policy" as const)
    );

    while (scenarios.length < totalCustomers) {
        scenarios.push("compliant");
    }
    while (scenarios.length > totalCustomers) {
        const compliantIndex = scenarios.lastIndexOf("compliant");
        if (compliantIndex >= 0) {
            scenarios.splice(compliantIndex, 1);
            continue;
        }
        scenarios.pop();
    }

    return scenarios;
}

function assignCurrencyProfiles(
    totalCustomers: number,
    usdCustomerPct: number
): CurrencyProfile[] {
    const usdCount = Math.round((totalCustomers * usdCustomerPct) / 100);
    const ilsCount = totalCustomers - usdCount;
    const profiles: CurrencyProfile[] = [
        ...Array.from({ length: ilsCount }, () => "ILS-primary" as const),
        ...Array.from({ length: usdCount }, () => "USD-primary" as const),
    ];

    while (profiles.length < totalCustomers) {
        profiles.push("ILS-primary");
    }
    while (profiles.length > totalCustomers) {
        const usdIndex = profiles.lastIndexOf("USD-primary");
        if (usdIndex >= 0) {
            profiles.splice(usdIndex, 1);
            continue;
        }
        profiles.pop();
    }

    return profiles;
}

function assignBusinessUnitIndexes(totalCustomers: number): Array<0 | 1> {
    const primaryCount = Math.round(
        (totalCustomers * PRIMARY_BU_CUSTOMER_PCT) / 100
    );
    const indexes: Array<0 | 1> = [
        ...Array.from({ length: primaryCount }, () => 0 as const),
        ...Array.from({ length: totalCustomers - primaryCount }, () => 1 as const),
    ];

    while (indexes.length < totalCustomers) {
        indexes.push(0);
    }
    while (indexes.length > totalCustomers) {
        const secondaryIndex = indexes.lastIndexOf(1);
        if (secondaryIndex >= 0) {
            indexes.splice(secondaryIndex, 1);
            continue;
        }
        indexes.pop();
    }

    return indexes;
}

function resolveApprovedLimit(
    scenario: CustomerScenario,
    currencyProfile: CurrencyProfile,
    index: number
): { approvedLimit: number; approvedLimitCurrency: "ILS" | "USD" } {
    const approvedLimitCurrency =
        currencyProfile === "USD-primary" ? "USD" : "ILS";

    if (scenario === "zero-limit") {
        return { approvedLimit: 0, approvedLimitCurrency };
    }

    if (scenario === "no-policy") {
        const base =
            approvedLimitCurrency === "USD"
                ? 25_000 + (index % 4) * 5_000
                : 100_000 + (index % 4) * 20_000;
        return { approvedLimit: base, approvedLimitCurrency };
    }

    if (scenario === "gap") {
        return {
            approvedLimit: approvedLimitCurrency === "USD" ? 15_000 : 50_000,
            approvedLimitCurrency,
        };
    }

    const base =
        approvedLimitCurrency === "USD"
            ? 50_000 + (index % 5) * 10_000
            : 200_000 + (index % 5) * 25_000;

    return { approvedLimit: base, approvedLimitCurrency };
}

function buildBreakdown(customers: ScheduledCustomer[]): ScenarioBreakdown {
    const breakdown = emptyBreakdown();

    for (const customer of customers) {
        breakdown[customer.scenario] += 1;
        if (customer.currencyProfile === "ILS-primary") {
            breakdown.ilsPrimary += 1;
        } else {
            breakdown.usdPrimary += 1;
        }
        if (customer.businessUnitIndex === 0) {
            breakdown.primaryBu += 1;
        } else {
            breakdown.secondaryBu += 1;
        }
    }

    return breakdown;
}

export function buildEventSchedule(
    config: ScriptConfig,
    window: HistoryWindow
): EventSchedule {
    const onboardingDays = Math.min(CUSTOMER_ONBOARDING_DAYS, window.windowDays);
    const targetCustomerCount = resolveTargetCustomerCount(
        config,
        onboardingDays
    );
    const perDayCounts = distributeCount(targetCustomerCount, onboardingDays);

    const scenarios = assignScenarios(targetCustomerCount);
    const currencyProfiles = assignCurrencyProfiles(
        targetCustomerCount,
        config.usdCustomerPct
    );
    const businessUnitIndexes = assignBusinessUnitIndexes(targetCustomerCount);

    const customers: ScheduledCustomer[] = [];
    const customersByDay = new Map<string, ScheduledCustomer[]>();
    let customerIndex = 0;

    for (let dayOffset = 0; dayOffset < onboardingDays; dayOffset++) {
        const createDate = addUtcDaysTo(window.windowStart, dayOffset);
        const dayKey = formatUtcDate(createDate);
        const dayCustomers: ScheduledCustomer[] = [];

        for (let slot = 0; slot < (perDayCounts[dayOffset] ?? 0); slot++) {
            const scenario = scenarios[customerIndex] ?? "compliant";
            const currencyProfile =
                currencyProfiles[customerIndex] ?? "ILS-primary";
            const { approvedLimit, approvedLimitCurrency } = resolveApprovedLimit(
                scenario,
                currencyProfile,
                customerIndex
            );

            const scheduled: ScheduledCustomer = {
                index: customerIndex,
                customerNumber: `${CUSTOMER_NUMBER_PREFIX}-${String(customerIndex + 1).padStart(3, "0")}`,
                createDate,
                dayIndex: dayIndexInWindow(window.windowStart, createDate),
                clientType: customerIndex % 2 === 0 ? "Company" : "Person",
                scenario,
                currencyProfile,
                businessUnitIndex: businessUnitIndexes[customerIndex] ?? 0,
                approvedLimit,
                approvedLimitCurrency,
            };

            customers.push(scheduled);
            dayCustomers.push(scheduled);
            customerIndex += 1;
        }

        if (dayCustomers.length > 0) {
            customersByDay.set(dayKey, dayCustomers);
        }
    }

    const { topUps, topUpsByDay, breakdown: topUpBreakdown } =
        buildTopUpSchedule({ customers, window });

    const {
        invoices,
        invoicesByDay,
        paymentsByDay,
        breakdown: invoiceBreakdown,
        targetInvoiceCount,
    } = buildInvoiceSchedule({ config, window, customers });

    return {
        customers,
        customersByDay,
        topUps,
        topUpsByDay,
        invoices,
        invoicesByDay,
        paymentsByDay,
        invoiceBreakdown,
        breakdown: buildBreakdown(customers),
        topUpBreakdown,
        onboardingDays,
        targetCustomerCount,
        targetInvoiceCount,
    };
}

export function formatScenarioBreakdown(breakdown: ScenarioBreakdown): string[] {
    return [
        `  scenarios: compliant=${breakdown.compliant}, gap=${breakdown.gap}, breach-mep=${breakdown["breach-mep"]}, breach-reporting=${breakdown["breach-reporting"]}, breach-outdated-dcl=${breakdown["breach-outdated-dcl"]}, breach-post-policy-end=${breakdown["breach-post-policy-end"]}, excluded=${breakdown.excluded}, zero-limit=${breakdown["zero-limit"]}, no-policy=${breakdown["no-policy"]}`,
        `  currency: ILS-primary=${breakdown.ilsPrimary}, USD-primary=${breakdown.usdPrimary}`,
        `  business units: primary=${breakdown.primaryBu}, secondary=${breakdown.secondaryBu}`,
    ];
}
