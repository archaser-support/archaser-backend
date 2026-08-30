"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOT_PORTED_CRON_JOB_NAMES = void 0;
exports.executeNamedCronJob = executeNamedCronJob;
exports.isCronJobPorted = isCronJobPorted;
const billing_connector_1 = require("@archaser/billing-connector");
const credit_insurance_domain_1 = require("@archaser/credit-insurance-domain");
const arPostIngestRetryQueue_1 = require("./credit/arPostIngestRetryQueue");
const currencyRateService_1 = require("./currencyRateService");
const computeCustomerOverdueMetrics_1 = require("./computeCustomerOverdueMetrics");
const closeZeroOutstandingDebtInvoices_1 = require("./closeZeroOutstandingDebtInvoices");
const fixClosedCollectionData_1 = require("./fixClosedCollectionData");
const inforuSmsStatusCheck_1 = require("./inforuSmsStatusCheck");
const moveCollectionToNextCategory_1 = require("./moveCollectionToNextCategory");
const handleOverdueInvoices_1 = require("./handleOverdueInvoices");
const executeScheduledReports_1 = require("./executeScheduledReports");
const processNotificationRules_1 = require("./processNotificationRules");
const processDueNotifications_1 = require("./processDueNotifications");
const processAutomatedCollectionPeriods_1 = require("./processAutomatedCollectionPeriods");
const activityWorkflowManager_1 = require("./activityWorkflowManager");
function timed(name, run) {
    const start = Date.now();
    return run()
        .then((out) => ({
        success: true,
        message: out.message,
        summary: out.summary,
        durationMs: Date.now() - start,
    }))
        .catch((error) => {
        const message = error instanceof Error
            ? error.message
            : `${name} failed`;
        throw Object.assign(error instanceof Error ? error : new Error(message), { durationMs: Date.now() - start });
    });
}
function notPorted(name) {
    return {
        success: false,
        stub: true,
        reason: "not_ported",
        message: `CronJob "${name}" is not yet ported to the Nest worker`,
        durationMs: 0,
    };
}
const fetchCurrencyRates = (prisma) => timed("Fetch Currency Rates", async () => {
    const result = await (0, currencyRateService_1.fetchAndStoreCurrencyRates)(prisma);
    return {
        message: `Fetched currency rates: ${result.ratesStored} stored`,
        summary: result,
    };
});
const computeGapInBaseCurrency = (prisma) => timed("Compute Gap In Base Currency", async () => {
    (0, credit_insurance_domain_1.bindCreditInsurancePrisma)(prisma);
    const fxResult = await (0, currencyRateService_1.fetchAndStoreCurrencyRates)(prisma);
    const gapResult = await (0, credit_insurance_domain_1.syncAllCustomerPolicyGapAmounts)();
    return {
        message: `FX ${fxResult.ratesStored} rates; base-currency gaps: ${gapResult.customersUpdated} customers updated (missing rates: ${gapResult.missingRates})`,
        summary: { fxResult, gapResult },
    };
});
const creditDashboardDailySnapshot = (prisma) => timed("Credit Dashboard Daily Snapshot", async () => {
    (0, credit_insurance_domain_1.bindCreditInsurancePrisma)(prisma);
    const result = await (0, credit_insurance_domain_1.takeCreditDashboardDailySnapshots)();
    return {
        message: `Credit dashboard daily snapshots completed: ${result.scopesProcessed} scopes`,
        summary: result,
    };
});
const insurancePolicyTrendDailySnapshot = (prisma) => timed("Insurance Policy Trend Daily Snapshot", async () => {
    (0, credit_insurance_domain_1.bindCreditInsurancePrisma)(prisma);
    const result = await (0, credit_insurance_domain_1.takeInsurancePolicyTrendSnapshots)();
    return {
        message: `Insurance policy trend snapshots: ${result.policyRowsUpserted} policies, ${result.countryRowsUpserted} countries, ${result.namedRowsUpserted} named rows across ${result.accountsProcessed} accounts`,
        summary: result,
    };
});
const customerPolicyTrendDailySnapshot = (prisma) => timed("Customer Policy Trend Daily Snapshot", async () => {
    (0, credit_insurance_domain_1.bindCreditInsurancePrisma)(prisma);
    let todayResult;
    let todayError;
    try {
        todayResult = await (0, credit_insurance_domain_1.takeCustomerPolicyTrendSnapshots)();
    }
    catch (error) {
        todayError =
            error instanceof Error
                ? error
                : new Error("Customer policy trend snapshot cron failed");
    }
    let drainError;
    try {
        const drain = await (0, credit_insurance_domain_1.drainAsOfRewriteQueue)();
        if (drain.failures > 0) {
            drainError = new Error(`As-of rewrite drain: ${drain.itemsProcessed} items, ${drain.daysRewritten} days, ${drain.failures} failures, ${drain.skippedForBackfill} skipped for admin backfill`);
        }
    }
    catch (error) {
        drainError =
            error instanceof Error
                ? error
                : new Error("As-of rewrite drain failed");
    }
    // Customers whose post-ingest refresh failed mid-import keep stale
    // capacity gaps until this runs, so retry before reporting.
    let retryError;
    let retryResult;
    try {
        retryResult = await (0, arPostIngestRetryQueue_1.drainArPostIngestRetryQueue)();
        if (retryResult.failures > 0) {
            retryError = new Error(`AR post-ingest retry drain: ${retryResult.itemsProcessed} retried, ${retryResult.failures} failures, ${retryResult.givenUp} given up`);
        }
    }
    catch (error) {
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
        message: `Customer policy trend snapshots: ${todayResult.rowsUpserted} rows across ${todayResult.accountsProcessed} accounts; AR post-ingest retries: ${retryResult?.itemsProcessed ?? 0}`,
        summary: todayResult,
    };
});
/** Requires `MONGODB_URI` so scheduled sync history can persist (shared syncHistory). */
const syncBillingConnectors = async (prisma) => {
    const start = Date.now();
    const result = await (0, billing_connector_1.syncDueBillingConnectors)(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result,
        durationMs: Date.now() - start,
    };
};
const computeOverdueMetrics = async (prisma) => {
    const result = await (0, computeCustomerOverdueMetrics_1.computeCustomerOverdueMetrics)(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};
const closeZeroDebt = async (prisma) => {
    const result = await (0, closeZeroOutstandingDebtInvoices_1.closeZeroOutstandingDebtInvoices)(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};
const fixClosedCollection = async (prisma, ctx) => {
    const lastRunAt = ctx?.lastRunAt ?? new Date(0);
    const result = await (0, fixClosedCollectionData_1.fixClosedCollectionData)(prisma, lastRunAt);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};
const inforuSmsStatus = async (prisma) => {
    return (0, inforuSmsStatusCheck_1.checkInforuSmsStatus)(prisma);
};
const moveCollectionCategory = async (prisma) => {
    return (0, moveCollectionToNextCategory_1.moveCollectionToNextCategory)(prisma);
};
const processOverdueInvoices = async (prisma) => {
    const result = await (0, handleOverdueInvoices_1.handleOverdueInvoices)(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};
const reportScheduler = async (prisma) => {
    const result = await (0, executeScheduledReports_1.executeScheduledReports)(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};
const notificationRules = async (prisma) => {
    const result = await (0, processNotificationRules_1.processNotificationRules)(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};
const dueNotifications = async (prisma) => {
    const result = await (0, processDueNotifications_1.processDueNotifications)(prisma);
    return {
        success: result.success,
        message: result.message,
        summary: result.summary,
        durationMs: result.durationMs,
    };
};
const processAutomatedPeriods = async (prisma) => {
    return (0, processAutomatedCollectionPeriods_1.processAutomatedCollectionPeriods)(prisma);
};
const activityWorkflow = async (prisma) => {
    return (0, activityWorkflowManager_1.activityWorkflowManager)(prisma);
};
const HANDLERS = {
    "Fetch Currency Rates": fetchCurrencyRates,
    "Compute Gap In Base Currency": computeGapInBaseCurrency,
    "Credit Dashboard Daily Snapshot": creditDashboardDailySnapshot,
    "Customer Policy Trend Daily Snapshot": customerPolicyTrendDailySnapshot,
    "Insurance Policy Trend Daily Snapshot": insurancePolicyTrendDailySnapshot,
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
exports.NOT_PORTED_CRON_JOB_NAMES = [];
async function executeNamedCronJob(prisma, name, ctx) {
    const handler = HANDLERS[name];
    if (!handler) {
        return notPorted(name);
    }
    return handler(prisma, ctx);
}
function isCronJobPorted(name) {
    return Object.prototype.hasOwnProperty.call(HANDLERS, name);
}
