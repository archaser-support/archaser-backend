#!/usr/bin/env tsx

/**
 * Connection Pool Test During Cron Execution
 *
 * This script:
 * 1. Monitors connection pool status
 * 2. Triggers Activity Workflow Manager cron job
 * 3. Watches connection counts during execution
 * 4. Reports if connections stay within limits
 *
 * Usage:
 *   npx tsx scripts/testing/test-connection-pool-during-cron.ts [trigger-mode] [duration]
 *
 * Arguments:
 *   trigger-mode: "direct" or "1" for direct trigger, "manual" or "2" for manual trigger (default: interactive)
 *   duration: Monitoring duration in seconds (default: 300 = 5 minutes)
 *
 * Examples:
 *   npx tsx scripts/testing/test-connection-pool-during-cron.ts direct 300
 *   npx tsx scripts/testing/test-connection-pool-during-cron.ts manual 600
 *   npx tsx scripts/testing/test-connection-pool-during-cron.ts  # Interactive mode
 */

import { prisma } from "../../frontend/lib/prisma";

interface ConnectionStatus {
    application_name: string | null;
    state: string;
    count: number;
}

interface PoolSummary {
    total: number;
    active: number;
    idle: number;
    maxConnections: number;
}

interface MonitoringResult {
    timestamp: Date;
    total: number;
    active: number;
    idle: number;
    usagePercent: number;
}

// Configuration
const MONITORING_INTERVAL_MS = 2000; // Check every 2 seconds
const MAX_EXPECTED_CONNECTIONS = 20; // Expected max connections during cron
const CONNECTION_LIMIT = 10; // From DATABASE_URL connection_limit
const WARNING_THRESHOLD = 80; // Warn if usage > 80%

async function getConnectionPoolStatus(): Promise<PoolSummary | null> {
    try {
        const summary = await prisma.$queryRaw<PoolSummary[]>`
            SELECT 
                count(*)::int as total,
                count(*) FILTER (WHERE state = 'active')::int as active,
                count(*) FILTER (WHERE state = 'idle')::int as idle,
                (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as "maxConnections"
            FROM pg_stat_activity
            WHERE datname = current_database();
        `;

        return summary.length > 0 ? summary[0] : null;
    } catch (error) {
        console.error("Error getting connection status:", error);
        return null;
    }
}

async function printConnectionStatus(
    status: PoolSummary | null,
    label: string
) {
    if (!status) {
        console.log(`❌ ${label}: Unable to get status`);
        return;
    }

    const usagePercent = (status.total / status.maxConnections) * 100;
    const statusIcon = usagePercent > WARNING_THRESHOLD ? "⚠️" : "✅";

    console.log(`${statusIcon} ${label}:`);
    console.log(
        `   Total: ${status.total} | Active: ${status.active} | Idle: ${status.idle} | Usage: ${usagePercent.toFixed(1)}%`
    );
}

async function monitorConnections(
    durationSeconds: number,
    onUpdate?: (status: PoolSummary) => void
): Promise<MonitoringResult[]> {
    const results: MonitoringResult[] = [];
    const endTime = Date.now() + durationSeconds * 1000;
    const interval = MONITORING_INTERVAL_MS;

    console.log(
        `\n📊 Monitoring connections for ${durationSeconds} seconds...\n`
    );

    while (Date.now() < endTime) {
        const status = await getConnectionPoolStatus();
        if (status) {
            const usagePercent = (status.total / status.maxConnections) * 100;
            const result: MonitoringResult = {
                timestamp: new Date(),
                total: status.total,
                active: status.active,
                idle: status.idle,
                usagePercent,
            };
            results.push(result);

            if (onUpdate) {
                onUpdate(status);
            }

            // Print status every 4 seconds (every 2nd update)
            if (results.length % 2 === 0) {
                const elapsed = (
                    (Date.now() - (endTime - durationSeconds * 1000)) /
                    1000
                ).toFixed(0);
                printConnectionStatus(status, `[${elapsed}s]`);
            }
        }

        await new Promise((resolve) => setTimeout(resolve, interval));
    }

    return results;
}

async function triggerCronJob(
    jobName: string,
    directTrigger: boolean = false
): Promise<{
    success: boolean;
    jobId?: number;
    error?: string;
    triggered?: boolean;
}> {
    try {
        // First, get the job ID
        const jobs = await prisma.cronJob.findMany({
            where: { name: jobName },
            select: { id: true, name: true, active: true },
        });

        if (jobs.length === 0) {
            return { success: false, error: `Job "${jobName}" not found` };
        }

        const job = jobs[0];

        if (job.active) {
            return {
                success: false,
                error: `Job "${jobName}" is already running`,
            };
        }

        if (directTrigger) {
            // Direct trigger via cronManager (bypassing API)
            console.log(
                `\n🚀 Directly triggering cron job: ${jobName} (ID: ${job.id})`
            );
            console.log("   Using cronManager.runCronJobs()...");
            console.log(
                "   Note: This will run ALL scheduled cron jobs, not just this one."
            );
            console.log(
                "   The Activity Workflow Manager will execute if it's due.\n"
            );

            try {
                const { runCronJobs } = await import(
                    "../../server/services/cronManager"
                );
                // Run all cron jobs (cronManager handles which ones are due)
                // Note: This runs in the background, so we'll monitor connections
                runCronJobs().catch((error: any) => {
                    console.error(
                        "❌ Error during cron execution:",
                        error.message
                    );
                });
                console.log(
                    "✅ Cron job execution initiated (running in background)"
                );
                return { success: true, jobId: job.id, triggered: true };
            } catch (error: any) {
                return {
                    success: false,
                    error: `Failed to trigger: ${error.message}`,
                };
            }
        } else {
            // Manual trigger via API
            console.log(`\n📋 Job found: ${jobName} (ID: ${job.id})`);
            console.log("   Waiting for manual trigger...\n");
            return { success: true, jobId: job.id, triggered: false };
        }
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

async function analyzeResults(results: MonitoringResult[]): Promise<void> {
    if (results.length === 0) {
        console.log("❌ No monitoring data collected");
        return;
    }

    const maxConnections = Math.max(...results.map((r) => r.total));
    const maxActive = Math.max(...results.map((r) => r.active));
    const avgConnections =
        results.reduce((sum, r) => sum + r.total, 0) / results.length;
    const maxUsagePercent = Math.max(...results.map((r) => r.usagePercent));

    console.log(`\n${"=".repeat(80)}`);
    console.log("📈 MONITORING RESULTS SUMMARY");
    console.log("=".repeat(80));
    console.log(
        `  Monitoring Duration:     ${results.length * (MONITORING_INTERVAL_MS / 1000)} seconds`
    );
    console.log(`  Data Points Collected:   ${results.length}`);
    console.log(`  Max Total Connections:   ${maxConnections}`);
    console.log(`  Max Active Connections:  ${maxActive}`);
    console.log(`  Average Connections:     ${avgConnections.toFixed(1)}`);
    console.log(`  Peak Usage Percentage:   ${maxUsagePercent.toFixed(1)}%`);
    console.log("=".repeat(80));
    console.log();

    // Analysis
    console.log("📊 ANALYSIS:");
    console.log("─".repeat(80));

    if (maxConnections <= MAX_EXPECTED_CONNECTIONS) {
        console.log(
            `✅ PASS: Max connections (${maxConnections}) is within expected limit (${MAX_EXPECTED_CONNECTIONS})`
        );
    } else {
        console.log(
            `⚠️  WARNING: Max connections (${maxConnections}) exceeded expected limit (${MAX_EXPECTED_CONNECTIONS})`
        );
    }

    if (maxConnections <= CONNECTION_LIMIT) {
        console.log(
            `✅ PASS: Max connections (${maxConnections}) is within configured limit (${CONNECTION_LIMIT})`
        );
    } else {
        console.log(
            `❌ FAIL: Max connections (${maxConnections}) exceeded configured limit (${CONNECTION_LIMIT})`
        );
    }

    if (maxUsagePercent < WARNING_THRESHOLD) {
        console.log(
            `✅ PASS: Peak usage (${maxUsagePercent.toFixed(1)}%) is below warning threshold (${WARNING_THRESHOLD}%)`
        );
    } else {
        console.log(
            `⚠️  WARNING: Peak usage (${maxUsagePercent.toFixed(1)}%) exceeded warning threshold (${WARNING_THRESHOLD}%)`
        );
    }

    // Check for connection spikes
    const spikes = results.filter((r, i) => {
        if (i === 0) return false;
        const prev = results[i - 1];
        return r.total - prev.total > 10; // Spike of more than 10 connections
    });

    if (spikes.length === 0) {
        console.log(`✅ PASS: No sudden connection spikes detected`);
    } else {
        console.log(
            `⚠️  WARNING: Detected ${spikes.length} connection spike(s)`
        );
        spikes.forEach((spike, idx) => {
            console.log(
                `   Spike ${idx + 1}: ${spike.total} connections at ${spike.timestamp.toISOString()}`
            );
        });
    }

    console.log("─".repeat(80));
    console.log();
}

async function main() {
    console.log("🔍 Connection Pool Test During Cron Execution");
    console.log("=".repeat(80));
    console.log();

    // Parse command line arguments
    const args = process.argv.slice(2);
    const triggerMode =
        args[0] === "direct" || args[0] === "1"
            ? "direct"
            : args[0] === "manual" || args[0] === "2"
              ? "manual"
              : null;
    const monitoringDuration = args[1] ? parseInt(args[1], 10) : 300; // Default 5 minutes

    try {
        // Step 1: Get baseline connection status
        console.log("Step 1: Getting baseline connection status...");
        const baseline = await getConnectionPoolStatus();
        printConnectionStatus(baseline, "Baseline Status");
        console.log();

        // Step 2: Find the Activity Workflow Manager job
        console.log("Step 2: Finding Activity Workflow Manager cron job...");

        let choice: string;
        if (triggerMode) {
            // Use command line argument
            choice = triggerMode === "direct" ? "1" : "2";
            console.log(
                `\nUsing command line option: ${triggerMode === "direct" ? "Direct trigger" : "Manual trigger"}\n`
            );
        } else {
            // Ask user if they want direct trigger or manual trigger
            console.log("\nTrigger Options:");
            console.log(
                "  1. Direct trigger (runs job immediately via cronManager)"
            );
            console.log(
                "  2. Manual trigger (you trigger via admin UI, script monitors)"
            );
            console.log();
            console.log("Enter choice (1 or 2, default: 2): ");

            choice = await new Promise<string>((resolve) => {
                process.stdin.once("data", (data) => {
                    resolve(data.toString().trim() || "2");
                });
            });
        }

        const useDirectTrigger = choice === "1";
        const jobResult = await triggerCronJob(
            "Activity Workflow Manager",
            useDirectTrigger
        );

        if (!jobResult.success) {
            console.log(`❌ ${jobResult.error}`);
            console.log("\n💡 You can manually trigger the job via:");
            console.log("   - Admin interface: /app/admin/cron-jobs");
            console.log("   - API: POST /api/system/admin/cron-jobs/trigger");
            console.log("\n   Then run this script again to monitor.");
            await prisma.$disconnect();
            process.exit(1);
        }

        if (jobResult.triggered) {
            console.log(`✅ Job triggered directly (ID: ${jobResult.jobId})`);
            console.log("   Monitoring will start immediately...\n");
            // Small delay to let the job start
            await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
            console.log(`✅ Job found (ID: ${jobResult.jobId})`);
            console.log();

            // Step 3: Instructions for manual trigger
            console.log("Step 3: Manual Trigger Required");
            console.log("─".repeat(80));
            console.log("To test the connection pool fixes:");
            console.log();
            console.log(
                "1. Open your admin interface: http://localhost:3000/en/app/admin/cron-jobs"
            );
            console.log("2. Find 'Activity Workflow Manager' job");
            console.log("3. Click 'Trigger' button");
            console.log(
                "4. This script will monitor the connection pool during execution"
            );
            console.log();
            console.log(
                "Press ENTER when you've triggered the job and are ready to start monitoring..."
            );
            console.log("(Or press Ctrl+C to cancel)");
            console.log("─".repeat(80));
            console.log();

            // Wait for user input
            await new Promise<void>((resolve) => {
                process.stdin.once("data", () => {
                    resolve();
                });
            });
        }

        // Step 4: Monitor during cron execution
        console.log(
            `\nMonitoring duration: ${monitoringDuration} seconds (${(monitoringDuration / 60).toFixed(1)} minutes)\n`
        );
        const results = await monitorConnections(
            monitoringDuration,
            (status) => {
                // Real-time check
                if (status.total > MAX_EXPECTED_CONNECTIONS) {
                    console.log(
                        `\n⚠️  WARNING: Connections (${status.total}) exceeded expected limit!`
                    );
                }
            }
        );

        // Step 5: Get final status
        console.log("\nStep 5: Getting final connection status...");
        const final = await getConnectionPoolStatus();
        printConnectionStatus(final, "Final Status");
        console.log();

        // Step 6: Analyze results
        await analyzeResults(results);

        // Step 7: Compare baseline vs final
        if (baseline && final) {
            const diff = final.total - baseline.total;
            console.log("📊 BASELINE vs FINAL:");
            console.log("─".repeat(80));
            console.log(`  Baseline: ${baseline.total} connections`);
            console.log(`  Final:    ${final.total} connections`);
            console.log(
                `  Change:   ${diff > 0 ? "+" : ""}${diff} connections`
            );

            if (Math.abs(diff) <= 5) {
                console.log(
                    `✅ Connections returned to baseline (within 5 connections)`
                );
            } else {
                console.log(`⚠️  Connections did not return to baseline`);
            }
            console.log("─".repeat(80));
        }

        console.log("\n✅ Test completed successfully!");
        console.log("\n💡 Next Steps:");
        console.log("   - Review the monitoring results above");
        console.log(
            "   - Verify application remained responsive during cron execution"
        );
        console.log("   - Check cron job logs for any errors");
    } catch (error: any) {
        console.error("\n❌ Error during test:", error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Handle Ctrl+C gracefully
process.on("SIGINT", async () => {
    console.log("\n\n⚠️  Test interrupted by user");
    await prisma.$disconnect();
    process.exit(0);
});

// Run the test
main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
