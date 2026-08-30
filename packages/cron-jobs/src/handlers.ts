import type { PrismaClient } from "@prisma/client";
import { syncDueBillingConnectors } from "@archaser/billing-connector";
import {
    bindCreditInsurancePrisma,
    drainAsOfRewriteQueue,
    syncAllCustomerPolicyGapAmounts,
    takeCreditDashboardDailySnapshots,
    takeCustomerPolicyTrendSnapshots,
    takeInsurancePolicyTrendSnapshots,
} from "@archaser/credit-insurance-domain";
import { drainArPostIngestRetryQueue } from "./credit/arPostIngestRetryQueue";
import { fetchAndStoreCurrencyRates } from "./currencyRateService";
import { computeCustomerOverdueMetrics } from "./computeCustomerOverdueMetrics";
import { closeZeroOutstandingDebtInvoices } from "./closeZeroOutstandingDebtInvoices";
import { fixClosedCollectionData } from "./fixClosedCollectionData";
import { checkInforuSmsStatus } from "./inforuSmsStatusCheck";
import { moveCollectionToNextCategory } from "./moveCollectionToNextCategory";
import { handleOverdueInvoices } from "./handleOverdueInvoices";
import { executeScheduledReports } from "./executeScheduledReports";
import { processNotificationRules } from "./processNotificationRules";
import { processDueNotifications } from "./processDueNotifications";
import { processAutomatedCollectionPeriods } from "./processAutomatedCollectionPeriods";
import { activityWorkflowManager } from "./activityWorkflowManager";

export type CronJobResult = {
    success: boolean;
    message: string;
    stub?: boolean;
    reason?: string;
    summary?: unknown;
    durationMs: number;
};

export type CronJobContext = {
    lastRunAt?: Date | null;
};

type Handler = (
    prisma: PrismaClient,
    ctx?: CronJobContext
) => Promise<CronJobResult>;

function timed(
    name: string,
    run: () => Promise<{ message: string; summary?: unknown }>
): Promise<CronJobResult> {
    const start = Date.now();
    return run()
        .then((out) => ({
            success: true,
            message: out.message,
            summary: out.summary,
            durationMs: Date.now() - start,
        }))
        .catch((error: unknown) => {
            const message =
                error instanceof Error
                    ? error.message
                    : `${name} failed`;
            throw Object.assign(
                error instanceof Error ? error : new Error(message),
                { durationMs: Date.now() - start }
            );
        });
}

function notPorted(name: string): CronJobResult {
    return {
        success: false,
        stub: true,
        reason: "not_ported",
        message: `CronJob "${name}" is not yet ported to the Nest worker`,
        durationMs: 0,
    };
}

const fetchCurrencyRates: Handler = (prisma) =>
    timed("Fetch Currency Rates", async () => {
        const result = await fetchAndStoreCurrencyRates(prisma);
        return {
            message: `Fetched currency rates: ${result.ratesStored} stored`,
            summary: result,
        };
    });

const computeGapInBaseCurrency: Handler = (prisma) =>
    timed("Compute Gap In Base Currency", async () => {
        bindCreditInsurancePrisma(prisma);
        const fxResult = await fetchAndStoreCurrencyRates(prisma);
        const gapResult = await syncAllCustomerPolicyGapAmounts();
        return {
            message: `FX ${fxResult.ratesStored} rates; base-currency gaps: ${gapResult.customersUpdated} customers updated (missing rates: ${gapResult.missingRates})`,
            summary: { fxResult, gapResult },
        };
    });

const creditDashboardDailySnapshot: Handler = (prisma) =>
    timed("Credit Dashboard Daily Snapshot", async () => {
        bindCreditInsurancePrisma(prisma);
        const result = await takeCreditDashboardDailySnapshots();
        return {
            message: `Credit dashboard daily snapshots completed: ${result.scopesProcessed} scopes`,
            summary: result,
        };
    });

const insurancePolicyTrendDailySnapshot: Handler = (prisma) =>
    timed("Insurance Policy Trend Daily Snapshot", async () => {
        bindCreditInsurancePrisma(prisma);
        const result = await takeInsurancePolicyTrendSnapshots();
        return {
            message: `Insurance policy trend snapshots: ${result.policyRowsUpserted} policies, ${result.countryRowsUpserted} countries, ${result.namedRowsUpserted} named rows across ${result.accountsProcessed} accounts`,
            summary: result,
        };
    });

const customerPolicyTrendDailySnapshot: Handler = (prisma) =>
    timed("Customer Policy Trend Daily Snapshot", async () => {
        bindCreditInsurancePrisma(prisma);

        let todayResult:
            | Awaited<ReturnType<typeof takeCustomerPolicyTrendSnapshots>>
            | undefined;
        let todayError: Error | undefined;

        try {
            todayResult = await takeCustomerPolicyTrendSnapshots();
        } catch (error: unknown) {
            todayError =
                error instanceof Error
                    ? error
                    : new Error("Customer policy trend snapshot cron failed");
        }

        let drainError: Error | undefined;
        try {
            const drain = await drainAsOfRewriteQueue();
            if (drain.failures > 0) {
                drainError = new Error(
                    `As-of rewrite drain: ${drain.itemsProcessed} items, ${drain.daysRewritten} days, ${drain.failures} failures, ${drain.skippedForBackfill} skipped for admin backfill`
                );
            }
        } catch (error: unknown) {
            drainError =
                error instanceof Error
                    ? error
                    : new Error("As-of rewrite drain failed");
        }

        // Customers whose post-ingest refresh failed mid-import keep stale
        // capacity gaps until this runs, so retry before reporting.
        let retryError: Error | undefined;
        let retryResult:
            | Awaited<ReturnType<typeof drainArPostIngestRetryQueue>>
            | undefined;
        try {
            retryResult = await drainArPostIngestRetryQueue();
            if (retryResult.failures > 0) {
                retryError = new Error(
                    `AR post-ingest retry drain: ${retryResult.itemsProcessed} retried, ${retryResult.failures} failures, ${retryResult.givenUp} given up`
                );
            }
        } catch (error: unknown) {
            retryError =
                error instanceof Error
                    ? error
                    : new Error("AR post-ingest retry drain failed");
        }

        if (todayError) {
            throw todayError;
        }
        if (drainError) {
            throw drainError;
        }
        if (retryError) {
            throw retryError;
        }

        return {
            message: `Customer policy trend snapshots: ${todayResult!.rowsUpserted} rows across ${todayResult!.accountsProcessed} accounts; AR post-ingest retries: ${retryResult?.itemsProcessed ?? 0}`,
            summary: todayResult,
        };
    });

/** Requires `MONGODB_URI` so scheduled sync history can persist (shared syncHistory). */
const syncBillingConnectors: Handler = async (prisma) => {
    const start = Date.now();
    const result = await syncDueBillingConnectors(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result,
        durationMs: Date.now() - start,
    };
};

const computeOverdueMetrics: Handler = async (prisma) => {
    const result = await computeCustomerOverdueMetrics(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};

const closeZeroDebt: Handler = async (prisma) => {
    const result = await closeZeroOutstandingDebtInvoices(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};

const fixClosedCollection: Handler = async (prisma, ctx) => {
    const lastRunAt = ctx?.lastRunAt ?? new Date(0);
    const result = await fixClosedCollectionData(prisma, lastRunAt);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};

const inforuSmsStatus: Handler = async (prisma) => {
    return checkInforuSmsStatus(prisma);
};

const moveCollectionCategory: Handler = async (prisma) => {
    return moveCollectionToNextCategory(prisma);
};

const processOverdueInvoices: Handler = async (prisma) => {
    const result = await handleOverdueInvoices(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};

const reportScheduler: Handler = async (prisma) => {
    const result = await executeScheduledReports(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};

const notificationRules: Handler = async (prisma) => {
    const result = await processNotificationRules(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};

const dueNotifications: Handler = async (prisma) => {
    const result = await processDueNotifications(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};

const processAutomatedPeriods: Handler = async (prisma) => {
    return processAutomatedCollectionPeriods(prisma);
};

const activityWorkflow: Handler = async (prisma) => {
    return activityWorkflowManager(prisma);
};

const HANDLERS: Record<string, Handler> = {
    "Fetch Currency Rates": fetchCurrencyRates,
    "Compute Gap In Base Currency": computeGapInBaseCurrency,
    "Credit Dashboard Daily Snapshot": creditDashboardDailySnapshot,
    "Customer Policy Trend Daily Snapshot": customerPolicyTrendDailySnapshot,
    "Insurance Policy Trend Daily Snapshot":
        insurancePolicyTrendDailySnapshot,
    "Sync Billing Connectors": syncBillingConnectors,
    "Compute Customer Overdue Metrics": computeOverdueMetrics,
    "Close Zero Outstanding Debt Invoices": closeZeroDebt,
    "Fix Closed Collection Data": fixClosedCollection,
    "Inforu SMS Status Check": inforuSmsStatus,
    "Move Collection To Next Category": moveCollectionCategory,
    "Process Overdue Invoices": processOverdueInvoices,
    "Over Due Invoice": processOverdueInvoices,
    "Report Scheduler": reportScheduler,
    "Process Notification Rules": notificationRules,
    "Process Due Notifications": dueNotifications,
    "Process Automated Collection Periods": processAutomatedPeriods,
    "Activity Workflow Manager": activityWorkflow,
};

/** CronJob names still owned by the Next cron path / pending Nest port. */
export const NOT_PORTED_CRON_JOB_NAMES = [] as const;

export async function executeNamedCronJob(
    prisma: PrismaClient,
    name: string,
    ctx?: CronJobContext
): Promise<CronJobResult> {
    const handler = HANDLERS[name];
    if (!handler) {
        return notPorted(name);
    }
    return handler(prisma, ctx);
}

export function isCronJobPorted(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(HANDLERS, name);
}
