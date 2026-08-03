import { getSystemUserId } from "@/server/services/UserService";

import { writeCheckpointAfterDay } from "./checkpoint";
import { onboardCustomersForDay } from "./customerOnboarding";
import { runDailySnapshotsForAccount } from "./dailySnapshots";
import { runDailyOverdueSyncForAccount } from "./dailyOverdueSync";
import {
    listCustomersWithOpenCapacityGapInvoices,
    syncGapForCustomers,
} from "./dailyGapSync";
import {
    createScheduledInvoicesForDay,
    createScheduledPaymentsForDay,
    loadInvoiceIdByNumber,
} from "./invoiceCreation";
import { upsertFxRateForDay } from "./fxRates";
import { loadCustomerIdByIndex } from "./resume";
import { formatScenarioBreakdown } from "./scheduler";
import { formatInvoiceBreakdown } from "./invoiceSchedule";
import {
    createScheduledTopUpsForDay,
    summarizeCapBusterCover,
} from "./topUpCreation";
import { formatTopUpBreakdown } from "./topUpPlan";
import type {
    AccountBootstrapResult,
    DayInsertCounts,
    DayLoopSummary,
    EventSchedule,
    ScriptConfig,
} from "./types";
import {
    addUtcDaysTo,
    formatDuration,
    formatUtcDate,
    type HistoryWindow,
} from "./window";

export async function runDayLoop(args: {
    config: ScriptConfig;
    window: HistoryWindow;
    bootstrap: AccountBootstrapResult;
    schedule: EventSchedule;
    startDayOffset?: number;
}): Promise<DayLoopSummary> {
    const startDayOffset = args.startDayOffset ?? 0;
    const actorUserId = getSystemUserId(args.bootstrap.accountId);
    const loopStartMs = Date.now();

    let customersCreated = 0;
    let topUpsCreated = 0;
    let invoicesCreated = 0;
    let paymentsCreated = 0;
    let gapSyncRuns = 0;
    let missingRateGapSyncs = 0;
    let customerPolicyTrendRows = 0;
    let insurancePolicyTrendRows = 0;
    let dashboardSnapshotScopes = 0;
    const capBusterCoverByDay: Array<{ dayKey: string; coverIls: number }> =
        [];

    const customerIdByIndex =
        startDayOffset > 0
            ? await loadCustomerIdByIndex(args.bootstrap.accountId)
            : new Map<number, number>();
    const invoiceIdByNumber =
        startDayOffset > 0
            ? await loadInvoiceIdByNumber(args.bootstrap.accountId)
            : new Map<string, number>();

    const customersByIndex = new Map(
        args.schedule.customers.map((customer) => [customer.index, customer])
    );

    if (startDayOffset > 0) {
        console.log(
            `Resuming day loop at offset ${startDayOffset + 1}/${args.window.windowDays} (${formatUtcDate(addUtcDaysTo(args.window.windowStart, startDayOffset))})`
        );
        console.log(
            `  loaded ${customerIdByIndex.size} existing customers from database`
        );
        console.log(
            `  loaded ${invoiceIdByNumber.size} existing invoices from database`
        );
    }

    if (startDayOffset >= args.window.windowDays) {
        console.log("Day loop already complete for this window.");
        return {
            daysProcessed: 0,
            daysSkipped: args.window.windowDays,
            customersCreated: 0,
            topUpsCreated: 0,
            invoicesCreated: 0,
            paymentsCreated: 0,
            gapSyncRuns: 0,
            missingRateGapSyncs: 0,
            customerPolicyTrendRows: 0,
            insurancePolicyTrendRows: 0,
            dashboardSnapshotScopes: 0,
            breakdown: args.schedule.breakdown,
            topUpBreakdown: args.schedule.topUpBreakdown,
            finalPassCustomersSynced: 0,
            finalPassMissingRateCount: 0,
        };
    }

    for (
        let dayOffset = startDayOffset;
        dayOffset < args.window.windowDays;
        dayOffset++
    ) {
        const day = addUtcDaysTo(args.window.windowStart, dayOffset);
        const dayKey = formatUtcDate(day);
        const dayNumber = dayOffset + 1;
        const inserts: DayInsertCounts = {
            customers: 0,
            invoices: 0,
            payments: 0,
            topUps: 0,
        };
        const affectedCustomerIds = new Set<number>(
            await listCustomersWithOpenCapacityGapInvoices(
                args.bootstrap.accountId
            )
        );

        await runDailyOverdueSyncForAccount({
            accountId: args.bootstrap.accountId,
            asOfDay: day,
            recalculateAmounts: false,
        });

        await upsertFxRateForDay({
            rateDate: day,
            dayOffset,
        });

        const scheduledCustomers =
            args.schedule.customersByDay.get(dayKey) ?? [];
        if (scheduledCustomers.length > 0) {
            const created = await onboardCustomersForDay({
                scheduledCustomers,
                bootstrap: args.bootstrap,
                actorUserId,
            });
            inserts.customers = created.length;
            customersCreated += created.length;
            for (const result of created) {
                customerIdByIndex.set(result.scheduled.index, result.customerId);
                affectedCustomerIds.add(result.customerId);
            }
        }

        const scheduledTopUps = args.schedule.topUpsByDay.get(dayKey) ?? [];
        if (scheduledTopUps.length > 0) {
            const createdTopUps = await createScheduledTopUpsForDay({
                scheduledTopUps,
                customerIdByIndex,
                bootstrap: args.bootstrap,
                window: args.window,
                day,
                actorUserId,
            });
            inserts.topUps = createdTopUps.length;
            topUpsCreated += createdTopUps.length;
            for (const result of createdTopUps) {
                affectedCustomerIds.add(result.customerId);
            }
            const capBusterCover = summarizeCapBusterCover(createdTopUps);
            if (capBusterCover > 0) {
                capBusterCoverByDay.push({ dayKey, coverIls: capBusterCover });
            }
        }

        const scheduledInvoices = args.schedule.invoicesByDay.get(dayKey) ?? [];
        if (scheduledInvoices.length > 0) {
            const createdInvoices = await createScheduledInvoicesForDay({
                scheduledInvoices,
                customerIdByIndex,
                customersByIndex,
                bootstrap: args.bootstrap,
                window: args.window,
                day,
                dayOffset,
                actorUserId,
            });
            inserts.invoices = createdInvoices.length;
            invoicesCreated += createdInvoices.length;
            for (const result of createdInvoices) {
                affectedCustomerIds.add(result.customerId);
                invoiceIdByNumber.set(result.invoiceNumber, result.invoiceId);
            }
        }

        const scheduledPayments = args.schedule.paymentsByDay.get(dayKey) ?? [];
        if (scheduledPayments.length > 0) {
            const createdPayments = await createScheduledPaymentsForDay({
                scheduledPayments,
                customerIdByIndex,
                invoiceIdByNumber,
                bootstrap: args.bootstrap,
                window: args.window,
                day,
                dayOffset,
                actorUserId,
            });
            inserts.payments = createdPayments.length;
            paymentsCreated += createdPayments.length;
            for (const result of createdPayments) {
                affectedCustomerIds.add(result.customerId);
            }
        }

        const gapSyncResult = await syncGapForCustomers({
            customerIds: affectedCustomerIds,
            rateDate: day,
        });
        gapSyncRuns += gapSyncResult.customersSynced;
        missingRateGapSyncs += gapSyncResult.missingRateCount;

        const snapshotResult = await runDailySnapshotsForAccount({
            accountId: args.bootstrap.accountId,
            snapshotDate: day,
        });
        customerPolicyTrendRows += snapshotResult.customerPolicyTrendRows;
        insurancePolicyTrendRows += snapshotResult.insurancePolicyTrendRows;
        dashboardSnapshotScopes += snapshotResult.dashboardSnapshotScopes;

        writeCheckpointAfterDay(
            args.bootstrap.accountId,
            args.bootstrap.subdomain,
            args.window,
            dayKey
        );

        const daysCompletedInRun = dayOffset - startDayOffset + 1;
        const elapsedMs = Date.now() - loopStartMs;
        const msPerDay = elapsedMs / daysCompletedInRun;
        const daysRemaining = args.window.windowDays - dayNumber;
        const etaMs = msPerDay * daysRemaining;

        console.log(
            `day ${dayNumber}/${args.window.windowDays} | ${dayKey} | inserts: customers=${inserts.customers} invoices=${inserts.invoices} payments=${inserts.payments} topUps=${inserts.topUps} | gapSync=${gapSyncResult.customersSynced} | snapshots=${snapshotResult.dashboardSnapshotScopes} | ETA ${formatDuration(etaMs)}`
        );
    }

    console.log("");
    console.log("Customer onboarding summary:");
    console.log(`  customers created: ${customersCreated}`);
    for (const line of formatScenarioBreakdown(args.schedule.breakdown)) {
        console.log(line);
    }

    console.log("");
    console.log("Top-up summary:");
    console.log(`  top-ups created: ${topUpsCreated}`);
    for (const line of formatTopUpBreakdown(args.schedule.topUpBreakdown)) {
        console.log(line);
    }
    if (capBusterCoverByDay.length > 0) {
        const peak = capBusterCoverByDay.reduce((best, current) =>
            current.coverIls > best.coverIls ? current : best
        );
        console.log(
            `  peak cap-buster Fixed cover: ${peak.coverIls.toLocaleString()} ILS on ${peak.dayKey}`
        );
    }

    console.log("");
    console.log("Invoice summary:");
    console.log(`  invoices created: ${invoicesCreated}`);
    console.log(`  invoice payments created: ${paymentsCreated}`);
    for (const line of formatInvoiceBreakdown(args.schedule.invoiceBreakdown)) {
        console.log(line);
    }

    console.log("");
    console.log("Snapshot summary:");
    console.log(`  customer policy trend rows upserted: ${customerPolicyTrendRows}`);
    console.log(`  insurance policy trend rows upserted: ${insurancePolicyTrendRows}`);
    console.log(`  dashboard snapshot scopes processed: ${dashboardSnapshotScopes}`);
    console.log(
        `  inline gap sync runs: ${gapSyncRuns} (missingRate customers: ${missingRateGapSyncs})`
    );

    return {
        daysProcessed: args.window.windowDays - startDayOffset,
        daysSkipped: startDayOffset,
        customersCreated,
        topUpsCreated,
        invoicesCreated,
        paymentsCreated,
        gapSyncRuns,
        missingRateGapSyncs,
        customerPolicyTrendRows,
        insurancePolicyTrendRows,
        dashboardSnapshotScopes,
        breakdown: args.schedule.breakdown,
        topUpBreakdown: args.schedule.topUpBreakdown,
        finalPassCustomersSynced: 0,
        finalPassMissingRateCount: 0,
    };
}

/** @deprecated Use {@link runDayLoop} */
export const runDayLoopStub = runDayLoop;
