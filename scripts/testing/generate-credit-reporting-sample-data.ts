#!/usr/bin/env tsx

/**
 * Credit reporting sample data generator
 *
 * CLI entrypoint with safety guards, fixed account bootstrap, credit-scoped wipe,
 * chronological day loop, checkpoint/resume, final gap sync, and post-run summary.
 *
 * Usage:
 *   npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --help
 *   npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --dry-run --days 30
 *   npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --confirm --days 7
 *   npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --verify
 *   npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --confirm --days 180
 *   npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --confirm --days 60 --resume-from 2026-03-15
 *
 * Full 180-day run (manual):
 *   1. Ensure NODE_ENV is not production and local DB is available.
 *   2. Run: npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --confirm --days 180
 *      Expect ~30–70 minutes depending on machine; progress logs show day index and ETA.
 *   3. If interrupted, resume: --confirm --days 180 --resume-from YYYY-MM-DD
 *      (date = last completed day from checkpoint or console output).
 *   4. Verify: npx tsx scripts/testing/generate-credit-reporting-sample-data.ts --verify --days 180
 *   5. Log in at https://credit-reporting-dev.archaser.com (or localhost) as
 *      credit-reporting@dev.local / CreditReportingDev123!
 */

import { prisma } from "@/lib/prisma";

import {
    bootstrapAccountShell,
    printBootstrapSummary,
} from "./credit-reporting-sample-data/accountBootstrap";
import {
    assertSafetyGuards,
    parseArgs,
} from "./credit-reporting-sample-data/cli";
import { clearCheckpoint, readCheckpoint } from "./credit-reporting-sample-data/checkpoint";
import {
    printWipeStats,
    wipeCreditScopedEntities,
} from "./credit-reporting-sample-data/creditScopedWipe";
import { runDayLoop } from "./credit-reporting-sample-data/dayLoop";
import { runFinalPass } from "./credit-reporting-sample-data/finalPass";
import {
    computePlannedCounts,
    printDryRunPlan,
} from "./credit-reporting-sample-data/plan";
import {
    buildPostRunSummary,
    printPostRunSummary,
} from "./credit-reporting-sample-data/postRunSummary";
import {
    printRepairKpisResult,
    repairSampleAccountKpis,
} from "./credit-reporting-sample-data/repairKpis";
import {
    assertCheckpointCompatible,
    resolveStartDayOffset,
} from "./credit-reporting-sample-data/resume";
import { buildEventSchedule } from "./credit-reporting-sample-data/scheduler";
import {
    assertDryRunInvariants,
    printVerifyResult,
    runPostRunVerify,
} from "./credit-reporting-sample-data/verify";
import {
    computeHistoryWindow,
    formatWindowSummary,
} from "./credit-reporting-sample-data/window";

async function main(): Promise<void> {
    const config = parseArgs(process.argv.slice(2));
    if (!config) {
        return;
    }

    assertSafetyGuards(config);

    if (config.verify) {
        const result = await runPostRunVerify(config);
        printVerifyResult(result);
        if (!result.passed) {
            throw new Error("Post-run verification failed");
        }
        return;
    }

    if (config.repairKpis) {
        console.log("Repairing KPI fields on existing sample account...");
        const result = await repairSampleAccountKpis({ days: config.days });
        printRepairKpisResult(result);
        if (result.finalPass.missingRateCount > 0) {
            throw new Error(
                `Repair completed with ${result.finalPass.missingRateCount} customer(s) missing FX rates`
            );
        }
        return;
    }

    const window = computeHistoryWindow(config.days);
    const windowSummary = formatWindowSummary(window);
    const plannedCounts = computePlannedCounts(config);
    const schedule = buildEventSchedule(config, window);
    const checkpoint = readCheckpoint();

    if (config.dryRun) {
        printDryRunPlan(config, window, windowSummary, plannedCounts);
        assertDryRunInvariants(config, plannedCounts);
        return;
    }

    if (!config.resumeFrom) {
        clearCheckpoint();

        const existingAccount = await prisma.account.findFirst({
            where: {
                sub_domain: "credit-reporting-dev",
                deleted_at: null,
            },
            select: { id: true },
        });

        if (existingAccount) {
            const wipeStats = await wipeCreditScopedEntities(existingAccount.id);
            printWipeStats(wipeStats);
        } else {
            console.log("Credit-scoped wipe skipped: account does not exist yet.");
        }
    } else {
        console.log("Credit-scoped wipe skipped: --resume-from is set.");
    }

    const bootstrap = await bootstrapAccountShell(window);
    printBootstrapSummary(bootstrap);

    if (config.resumeFrom && checkpoint) {
        assertCheckpointCompatible(checkpoint, bootstrap.accountId, window);
    } else if (config.resumeFrom && !checkpoint) {
        console.warn(
            "[resume] No checkpoint file found; continuing from --resume-from date."
        );
    }

    const startDayOffset = resolveStartDayOffset(
        config,
        window,
        config.resumeFrom ? checkpoint : null
    );

    console.log("");
    console.log(windowSummary);
    console.log("");
    console.log("Running chronological day loop...");
    const dayLoopSummary = await runDayLoop({
        config,
        window,
        bootstrap,
        schedule,
        startDayOffset,
    });

    console.log("");
    console.log("Running final pass (full gap sync + amount recalc)...");
    const finalPass = await runFinalPass({
        accountId: bootstrap.accountId,
        rateDate: window.windowEnd,
        window,
    });
    dayLoopSummary.finalPassCustomersSynced = finalPass.customersSynced;
    dayLoopSummary.finalPassMissingRateCount = finalPass.missingRateCount;

    console.log(
        `  customers synced: ${finalPass.customersSynced}, missingRate: ${finalPass.missingRateCount}, limitAssessment: ${finalPass.limitAssessment.invoicesUpdated} invoice(s)`
    );

    if (finalPass.missingRateCount > 0) {
        throw new Error(
            `Final pass completed with ${finalPass.missingRateCount} customer(s) missing FX rates`
        );
    }

    const summary = await buildPostRunSummary({ bootstrap, window });
    printPostRunSummary(summary);
}

main()
    .catch((error: unknown) => {
        const message =
            error instanceof Error ? error.message : String(error);
        console.error(`[credit-reporting-sample-data] ${message}`);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
