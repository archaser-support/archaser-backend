import { prisma } from "@/lib/prisma";

import {
    CUSTOMER_NUMBER_PREFIX,
    SAMPLE_SCENARIO_TAG_PREFIX,
    TOPUP_MAX_TOTAL_COVER_ILS,
} from "./constants";
import { formatScenarioBreakdown } from "./scheduler";
import { formatTopUpBreakdown } from "./topUpPlan";
import type {
    AccountBootstrapResult,
    CustomerScenario,
    PostRunSummary,
    ScenarioBreakdown,
    TopUpBreakdown,
} from "./types";
import { formatUtcDate, type HistoryWindow } from "./window";

function emptyScenarioBreakdown(): ScenarioBreakdown {
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

function parseScenarioTag(
    genericText1: string | null
): CustomerScenario | null {
    if (!genericText1?.startsWith(SAMPLE_SCENARIO_TAG_PREFIX)) {
        return null;
    }
    return genericText1.slice(SAMPLE_SCENARIO_TAG_PREFIX.length) as CustomerScenario;
}

async function buildScenarioBreakdownFromDb(
    accountId: number
): Promise<ScenarioBreakdown> {
    const breakdown = emptyScenarioBreakdown();
    const customers = await prisma.customer.findMany({
        where: {
            account_id: accountId,
            customer_number: { startsWith: `${CUSTOMER_NUMBER_PREFIX}-` },
        },
        select: {
            generic_text1: true,
            generic_text2: true,
            CustomerPolicy: {
                where: { is_active: true },
                select: { approved_limit_currency: true },
                take: 1,
            },
            business_unit_id: true,
        },
    });

    const businessUnits = await prisma.businessUnit.findMany({
        where: { account_id: accountId, status: "Active" },
        select: { id: true, is_primary: true },
        orderBy: { id: "asc" },
    });
    const primaryBuId =
        businessUnits.find((bu) => bu.is_primary)?.id ?? businessUnits[0]?.id;

    for (const customer of customers) {
        const scenario = parseScenarioTag(customer.generic_text1);
        if (scenario) {
            breakdown[scenario] += 1;
        }

        const limitCurrency =
            customer.CustomerPolicy[0]?.approved_limit_currency?.toUpperCase();
        if (limitCurrency === "USD") {
            breakdown.usdPrimary += 1;
        } else {
            breakdown.ilsPrimary += 1;
        }

        if (
            primaryBuId != null &&
            customer.business_unit_id === primaryBuId
        ) {
            breakdown.primaryBu += 1;
        } else {
            breakdown.secondaryBu += 1;
        }
    }

    return breakdown;
}

async function buildTopUpBreakdownFromDb(
    accountId: number
): Promise<TopUpBreakdown> {
    const topUps = await prisma.customerTopUp.findMany({
        where: {
            Customer: { account_id: accountId },
            cancelled_at: null,
        },
        select: {
            top_up_type: true,
            notes: true,
            start_date: true,
            end_date: true,
        },
    });

    const breakdown: TopUpBreakdown = {
        total: topUps.length,
        fixed: 0,
        percentage: 0,
        capBusters: 0,
        fullHalfYear: 0,
        expiring30d: 0,
        expiring7d: 0,
        waveDays: [],
    };

    for (const topUp of topUps) {
        if (topUp.top_up_type === "Fixed") {
            breakdown.fixed += 1;
        } else {
            breakdown.percentage += 1;
        }
        if (topUp.notes?.includes("cap-buster")) {
            breakdown.capBusters += 1;
        }

        const spanDays = Math.round(
            (topUp.end_date.getTime() - topUp.start_date.getTime()) /
                (24 * 60 * 60 * 1000)
        );
        if (spanDays >= 80) {
            breakdown.fullHalfYear += 1;
        } else if (spanDays <= 7) {
            breakdown.expiring7d += 1;
        } else {
            breakdown.expiring30d += 1;
        }
    }

    return breakdown;
}

async function resolvePeakCapBusterCover(
    accountId: number
): Promise<{ dayKey: string | null; coverIls: number | null }> {
    const capBusters = await prisma.customerTopUp.findMany({
        where: {
            Customer: { account_id: accountId },
            top_up_type: "Fixed",
            notes: { contains: "cap-buster" },
        },
        select: {
            start_date: true,
            top_up_value: true,
            currency: true,
        },
    });

    if (capBusters.length === 0) {
        return { dayKey: null, coverIls: null };
    }

    const coverByDay = new Map<string, number>();
    for (const topUp of capBusters) {
        const dayKey = formatUtcDate(topUp.start_date);
        const value =
            topUp.currency === "USD"
                ? Number(topUp.top_up_value) * 3.65
                : Number(topUp.top_up_value);
        coverByDay.set(dayKey, (coverByDay.get(dayKey) ?? 0) + value);
    }

    let peakDay: string | null = null;
    let peakCover = 0;
    for (const [dayKey, cover] of coverByDay) {
        if (cover > peakCover) {
            peakCover = cover;
            peakDay = dayKey;
        }
    }

    return { dayKey: peakDay, coverIls: peakCover > 0 ? peakCover : null };
}

export async function buildPostRunSummary(args: {
    bootstrap: AccountBootstrapResult;
    window: HistoryWindow;
}): Promise<PostRunSummary> {
    const accountId = args.bootstrap.accountId;
    const [
        customers,
        invoices,
        invoicePayments,
        customerTopUps,
        customerPolicyTrends,
        insurancePolicyTrends,
        creditDashboardSnapshots,
        scenarioBreakdown,
        topUpBreakdown,
        peakCapBuster,
    ] = await Promise.all([
        prisma.customer.count({
            where: {
                account_id: accountId,
                customer_number: { startsWith: `${CUSTOMER_NUMBER_PREFIX}-` },
            },
        }),
        prisma.invoice.count({
            where: { Customer: { account_id: accountId } },
        }),
        prisma.invoicePayment.count({
            where: { Customer: { account_id: accountId } },
        }),
        prisma.customerTopUp.count({
            where: { Customer: { account_id: accountId } },
        }),
        prisma.customerPolicyTrend.count({ where: { account_id: accountId } }),
        prisma.insurancePolicyTrend.count({ where: { account_id: accountId } }),
        prisma.creditDashboardDailySnapshot.count({
            where: { account_id: accountId },
        }),
        buildScenarioBreakdownFromDb(accountId),
        buildTopUpBreakdownFromDb(accountId),
        resolvePeakCapBusterCover(accountId),
    ]);

    return {
        accountId,
        subdomain: args.bootstrap.subdomain,
        adminEmail: args.bootstrap.adminEmail,
        adminPassword: args.bootstrap.adminPassword,
        windowStart: formatUtcDate(args.window.windowStart),
        windowEnd: formatUtcDate(args.window.windowEnd),
        windowDays: args.window.windowDays,
        customers,
        invoices,
        invoicePayments,
        customerTopUps,
        customerPolicyTrends,
        insurancePolicyTrends,
        creditDashboardSnapshots,
        scenarioBreakdown,
        topUpBreakdown,
        peakCapBusterCoverIls: peakCapBuster.coverIls,
        peakCapBusterDay: peakCapBuster.dayKey,
    };
}

export function printPostRunSummary(summary: PostRunSummary): void {
    console.log("");
    console.log("=== Credit reporting sample data — complete ===");
    console.log("");
    console.log("Login:");
    console.log(`  subdomain: ${summary.subdomain}`);
    console.log(`  email: ${summary.adminEmail}`);
    console.log(`  password: ${summary.adminPassword}`);
    console.log("");
    console.log(
        `Window: ${summary.windowStart} → ${summary.windowEnd} (${summary.windowDays} days)`
    );
    console.log("");
    console.log("Entity counts:");
    console.log(`  customers: ${summary.customers}`);
    console.log(`  invoices: ${summary.invoices}`);
    console.log(`  invoice payments: ${summary.invoicePayments}`);
    console.log(`  customer top-ups: ${summary.customerTopUps}`);
    console.log(`  customer policy trends: ${summary.customerPolicyTrends}`);
    console.log(`  insurance policy trends: ${summary.insurancePolicyTrends}`);
    console.log(
        `  credit dashboard snapshots: ${summary.creditDashboardSnapshots}`
    );
    console.log("");
    console.log("Scenario buckets:");
    for (const line of formatScenarioBreakdown(summary.scenarioBreakdown)) {
        console.log(line);
    }
    console.log("");
    console.log("Top-up buckets:");
    for (const line of formatTopUpBreakdown(summary.topUpBreakdown)) {
        console.log(line);
    }
    console.log("");
    console.log("Cap utilization:");
    console.log(
        `  TopUp max_total_cover: ${TOPUP_MAX_TOTAL_COVER_ILS.toLocaleString()} ILS`
    );
    if (summary.peakCapBusterCoverIls != null && summary.peakCapBusterDay) {
        const utilizationPct = (
            (summary.peakCapBusterCoverIls / TOPUP_MAX_TOTAL_COVER_ILS) *
            100
        ).toFixed(1);
        console.log(
            `  peak cap-buster Fixed cover: ${Math.round(summary.peakCapBusterCoverIls).toLocaleString()} ILS on ${summary.peakCapBusterDay} (${utilizationPct}% of cap)`
        );
    } else {
        console.log("  peak cap-buster Fixed cover: n/a");
    }
}
