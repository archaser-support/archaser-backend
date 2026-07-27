import { prisma } from "@/lib/prisma";

import { readCheckpoint } from "./checkpoint";
import {
    CUSTOMER_NUMBER_PREFIX,
    SAMPLE_ACCOUNT_SUBDOMAIN,
} from "./constants";
import { runFinalPass } from "./finalPass";
import { computePlannedCounts } from "./plan";
import { buildEventSchedule } from "./scheduler";
import type { ScriptConfig } from "./types";
import { computeHistoryWindow, parseUtcDate } from "./window";

export type VerifyCheckResult = {
    name: string;
    passed: boolean;
    message: string;
};

export type VerifyResult = {
    passed: boolean;
    checks: VerifyCheckResult[];
};

function isWithinTolerance(
    actual: number,
    expected: number,
    toleranceFraction = 0.5
): boolean {
    if (expected <= 0) {
        return actual === 0;
    }
    const min = Math.max(1, Math.floor(expected * (1 - toleranceFraction)));
    const max = Math.ceil(expected * (1 + toleranceFraction));
    return actual >= min && actual <= max;
}

/** Fails when any sample customer has open invoices in more than one currency. */
async function verifySingleCurrencyPerCustomer(
    accountId: number
): Promise<boolean> {
    const rows = await prisma.$queryRaw<
        Array<{ customer_id: number; currency_count: bigint }>
    >`
        SELECT i.customer_id,
          COUNT(DISTINCT UPPER(COALESCE(i.customer_currency, '')))::bigint AS currency_count
        FROM "Invoice" i
        INNER JOIN "Customer" c ON c.id = i.customer_id
        WHERE i.account_id = ${accountId}
          AND c.customer_number LIKE ${`${CUSTOMER_NUMBER_PREFIX}-%`}
          AND i.status IN ('Due', 'Overdue')
          AND COALESCE(i.customer_currency, '') <> ''
        GROUP BY i.customer_id
        HAVING COUNT(DISTINCT UPPER(COALESCE(i.customer_currency, ''))) > 1
    `;
    return rows.length === 0;
}

function resolveVerifyConfig(config: ScriptConfig): ScriptConfig {
    const checkpoint = readCheckpoint();
    const days = checkpoint?.windowDays ?? config.days;

    return {
        ...config,
        days,
    };
}

function resolveVerifyWindow(config: ScriptConfig) {
    const checkpoint = readCheckpoint();
    if (checkpoint?.windowStart) {
        const windowDays = checkpoint.windowDays;
        const windowEnd = parseUtcDate(checkpoint.windowStart);
        windowEnd.setUTCDate(windowEnd.getUTCDate() + windowDays - 1);
        const full = computeHistoryWindow(windowDays);
        return {
            ...full,
            windowStart: parseUtcDate(checkpoint.windowStart),
            windowEnd,
            windowDays,
        };
    }
    return computeHistoryWindow(config.days);
}

export function assertDryRunInvariants(
    config: ScriptConfig,
    counts: ReturnType<typeof computePlannedCounts>
): void {
    const failures: string[] = [];

    if (counts.customers < 1) {
        failures.push("planned customers must be >= 1");
    }
    if (counts.invoices < 1) {
        failures.push("planned invoices must be >= 1");
    }
    if (counts.topUps < 1) {
        failures.push("planned top-ups must be >= 1");
    }
    if (counts.currencyRates !== config.days) {
        failures.push(
            `planned currency rates (${counts.currencyRates}) must equal --days (${config.days})`
        );
    }
    if (counts.insurancePolicyTrends !== config.days * 2) {
        failures.push(
            `planned insurance policy trends (${counts.insurancePolicyTrends}) must equal days × 2 (${config.days * 2})`
        );
    }
    if (
        counts.creditDashboardSnapshots !==
        counts.currencyRates * 9
    ) {
        failures.push(
            "planned dashboard snapshots must equal days × 9 scopes per day"
        );
    }

    const schedule = buildEventSchedule(config, computeHistoryWindow(config.days));
    if (schedule.targetCustomerCount !== counts.customers) {
        failures.push(
            `scheduler customer count (${schedule.targetCustomerCount}) must match planned customers (${counts.customers})`
        );
    }
    if (schedule.topUpBreakdown.total !== counts.topUps) {
        failures.push(
            `scheduler top-up count (${schedule.topUpBreakdown.total}) must match planned top-ups (${counts.topUps})`
        );
    }
    if (schedule.targetInvoiceCount !== counts.invoices) {
        failures.push(
            `scheduler invoice count (${schedule.targetInvoiceCount}) must match planned invoices (${counts.invoices})`
        );
    }
    if (schedule.invoiceBreakdown.total !== schedule.targetInvoiceCount) {
        failures.push(
            `scheduled invoice rows (${schedule.invoiceBreakdown.total}) must match target (${schedule.targetInvoiceCount})`
        );
    }

    if (failures.length > 0) {
        throw new Error(
            `Dry-run invariant check failed:\n  - ${failures.join("\n  - ")}`
        );
    }
}

export async function runPostRunVerify(
    config: ScriptConfig
): Promise<VerifyResult> {
    const verifyConfig = resolveVerifyConfig(config);
    const window = resolveVerifyWindow(verifyConfig);
    const planned = computePlannedCounts(verifyConfig);
    const schedule = buildEventSchedule(verifyConfig, window);
    const checks: VerifyCheckResult[] = [];

    const account = await prisma.account.findFirst({
        where: {
            sub_domain: SAMPLE_ACCOUNT_SUBDOMAIN,
            deleted_at: null,
        },
        select: {
            id: true,
            sub_domain: true,
            has_credit_insurance: true,
        },
    });

    checks.push({
        name: "account_subdomain",
        passed:
            account != null &&
            account.sub_domain === SAMPLE_ACCOUNT_SUBDOMAIN &&
            account.has_credit_insurance === true,
        message:
            account == null
                ? `Account not found for subdomain ${SAMPLE_ACCOUNT_SUBDOMAIN}`
                : `subdomain=${account.sub_domain}, has_credit_insurance=${account.has_credit_insurance}`,
    });

    if (!account) {
        return { passed: false, checks };
    }

    const [
        customers,
        invoices,
        invoicePayments,
        customerPolicyTrends,
        insurancePolicyTrends,
        creditDashboardSnapshots,
        customerTopUps,
        currencyRates,
    ] = await Promise.all([
        prisma.customer.count({
            where: {
                account_id: account.id,
                customer_number: { startsWith: `${CUSTOMER_NUMBER_PREFIX}-` },
            },
        }),
        prisma.invoice.count({
            where: {
                account_id: account.id,
                invoice_number: { startsWith: "CRD-RPT-INV-" },
            },
        }),
        prisma.invoicePayment.count({
            where: {
                account_id: account.id,
                reference: { startsWith: "CRD-RPT-PAY-" },
            },
        }),
        prisma.customerPolicyTrend.count({
            where: { account_id: account.id },
        }),
        prisma.insurancePolicyTrend.count({
            where: { account_id: account.id },
        }),
        prisma.creditDashboardDailySnapshot.count({
            where: { account_id: account.id },
        }),
        prisma.customerTopUp.count({
            where: {
                Customer: { account_id: account.id },
                cancelled_at: null,
            },
        }),
        prisma.currencyRate.count({
            where: {
                base_currency: "ILS",
                other_currency: "USD",
                rate_date: {
                    gte: window.windowStart,
                    lte: window.windowEnd,
                },
            },
        }),
    ]);

    const expectedCustomers = schedule.targetCustomerCount;
    checks.push({
        name: "customer_count",
        passed: isWithinTolerance(customers, expectedCustomers, 0.15),
        message: `expected ~${expectedCustomers}, actual ${customers}`,
    });

    checks.push({
        name: "invoice_count",
        passed: isWithinTolerance(
            invoices,
            schedule.targetInvoiceCount,
            0.05
        ),
        message: `expected ~${schedule.targetInvoiceCount}, actual ${invoices}`,
    });

    checks.push({
        name: "invoice_payment_count",
        passed: invoicePayments >= schedule.invoiceBreakdown.withPartialPayment * 0.8,
        message: `expected >= ${Math.floor(schedule.invoiceBreakdown.withPartialPayment * 0.8)} partial payments, actual ${invoicePayments}`,
    });

    checks.push({
        name: "currency_rates",
        passed: currencyRates >= planned.currencyRates * 0.95,
        message: `expected >= ${planned.currencyRates} USD→ILS rates in window, actual ${currencyRates}`,
    });

    checks.push({
        name: "customer_policy_trends",
        passed: isWithinTolerance(
            customerPolicyTrends,
            planned.customerPolicyTrends
        ),
        message: `expected ~${planned.customerPolicyTrends} (order of magnitude), actual ${customerPolicyTrends}`,
    });

    checks.push({
        name: "insurance_policy_trends",
        passed: insurancePolicyTrends >= planned.insurancePolicyTrends,
        message: `expected >= ${planned.insurancePolicyTrends}, actual ${insurancePolicyTrends}`,
    });

    checks.push({
        name: "dashboard_snapshots",
        passed: isWithinTolerance(
            creditDashboardSnapshots,
            planned.creditDashboardSnapshots
        ),
        message: `expected ~${planned.creditDashboardSnapshots} (order of magnitude), actual ${creditDashboardSnapshots}`,
    });

    checks.push({
        name: "top_up_count",
        passed: isWithinTolerance(
            customerTopUps,
            schedule.topUpBreakdown.total,
            0.2
        ),
        message: `expected ~${schedule.topUpBreakdown.total} active top-ups, actual ${customerTopUps}`,
    });

    checks.push({
        name: "single_currency_per_customer",
        passed: await verifySingleCurrencyPerCustomer(account.id),
        message: "each sample customer must have open invoices in one currency only",
    });

    const noPolicyExposureCount = await prisma.customer.count({
        where: {
            account_id: account.id,
            generic_text1: "sample:no-policy",
            CustomerPolicy: {
                some: {
                    is_active: true,
                    limit_type: "DCL",
                    policy_exclusion_reason: "Pending review",
                },
            },
        },
    });
    checks.push({
        name: "no_policy_exposure_cohort",
        passed: noPolicyExposureCount >= 1,
        message:
            noPolicyExposureCount >= 1
                ? `expected >= 1 DCL Pending review sample:no-policy customer(s) (found ${noPolicyExposureCount})`
                : `expected >= 1 DCL Pending review sample:no-policy customer(s)`,
    });

    const finalPass = await runFinalPass({
        accountId: account.id,
        rateDate: window.windowEnd,
        window,
    });
    checks.push({
        name: "limit_assessed_amount",
        passed:
            (await prisma.invoice.count({
                where: {
                    account_id: account.id,
                    status: { in: ["Due", "Overdue"] },
                    limit_assessed_amount: { not: null },
                },
            })) > 0,
        message: `open invoices with limit_assessed_amount after final pass`,
    });
    checks.push({
        name: "missing_rate",
        passed: finalPass.missingRateCount === 0,
        message:
            finalPass.missingRateCount === 0
                ? `0 customers with missingRate after gap sync (${finalPass.customersSynced} synced)`
                : `${finalPass.missingRateCount} customer(s) with missingRate after gap sync`,
    });

    const passed = checks.every((check) => check.passed);
    return { passed, checks };
}

export function printVerifyResult(result: VerifyResult): void {
    console.log("");
    console.log("=== Credit reporting sample data — verify ===");
    console.log("");

    for (const check of result.checks) {
        const status = check.passed ? "PASS" : "FAIL";
        console.log(`  [${status}] ${check.name}: ${check.message}`);
    }

    console.log("");
    if (result.passed) {
        console.log("All post-run invariants passed.");
    } else {
        const failed = result.checks
            .filter((check) => !check.passed)
            .map((check) => check.name);
        console.log(`Verification failed (${failed.length} check(s)): ${failed.join(", ")}`);
    }
}
