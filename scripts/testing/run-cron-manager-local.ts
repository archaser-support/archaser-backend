#!/usr/bin/env tsx

/**
 * Run Cron Manager Locally
 *
 * This script allows you to run the cron manager locally for testing and debugging.
 * It directly calls the runCronJobs() function from cronManager.ts
 *
 * Usage:
 *   npx tsx scripts/testing/run-cron-manager-local.ts
 *
 * Environment Variables:
 *   - ENABLE_CRON_JOBS: Set to "true" to enable (optional, not required for this script)
 *   - LOG_CONNECTION_POOL_STATUS: Set to "true" to log connection pool status
 *   - MONGODB_URI: MongoDB connection string (loaded from .env file)
 */

// Load environment variables from .env file
import { resolve } from "path";

import dotenv from "dotenv";

// Load .env.local first (higher priority), then .env
dotenv.config({ path: resolve(process.cwd(), "backend/.env.local") });
dotenv.config({ path: resolve(process.cwd(), "backend/.env") });

import { prisma } from "../../frontend/lib/prisma";
import { runCronJobs } from "../../frontend/server/services/cronManager";

async function main() {
    console.log("🚀 Running Cron Manager Locally");
    console.log("=".repeat(80));
    console.log();

    try {
        // Check database connection
        console.log("📡 Checking database connection...");
        await prisma.$queryRaw`SELECT 1`;
        console.log("✅ Database connection successful\n");

        // Run cron jobs
        console.log("⏰ Executing cron jobs...");
        console.log("─".repeat(80));
        const startTime = Date.now();

        const result = await runCronJobs();

        const duration = Date.now() - startTime;
        const durationSeconds = (duration / 1000).toFixed(2);

        console.log("─".repeat(80));
        console.log(
            `✅ Cron execution completed in ${durationSeconds} seconds\n`
        );

        // Display results
        console.log("📊 Execution Results:");
        console.log("─".repeat(80));
        console.log(`Message: ${result.message}`);

        if (result.job) {
            console.log(`\nJob Details:`);
            console.log(`  ID: ${result.job.id}`);
            console.log(`  Name: ${result.job.name}`);
            console.log(`  Active: ${result.job.active}`);
            console.log(
                `  Last Run: ${result.job.last_run_at?.toISOString() || "N/A"}`
            );
            console.log(
                `  Next Run: ${result.job.next_run_at?.toISOString() || "N/A"}`
            );
        }

        if (result.executionResult) {
            console.log(`\nExecution Statistics:`);
            console.log(
                `  Records Processed: ${result.executionResult.recordsProcessed || 0}`
            );
            console.log(
                `  Records Created: ${result.executionResult.recordsCreated || 0}`
            );
            console.log(
                `  Records Updated: ${result.executionResult.recordsUpdated || 0}`
            );
            console.log(
                `  Records Deleted: ${result.executionResult.recordsDeleted || 0}`
            );

            if (result.executionResult.performanceMetrics) {
                console.log(`\nPerformance Metrics:`);
                Object.entries(
                    result.executionResult.performanceMetrics
                ).forEach(([key, value]) => {
                    console.log(`  ${key}: ${value}ms`);
                });
            }

            if (
                result.executionResult.steps &&
                result.executionResult.steps.length > 0
            ) {
                console.log(
                    `\nExecution Steps: ${result.executionResult.steps.length}`
                );
                // Show last 5 steps
                const recentSteps = result.executionResult.steps.slice(-5);
                recentSteps.forEach((step) => {
                    const levelIcon =
                        step.level === "ERROR"
                            ? "❌"
                            : step.level === "WARNING"
                              ? "⚠️"
                              : "✅";
                    console.log(
                        `  ${levelIcon} [${step.step}] ${step.message}`
                    );
                });
                if (result.executionResult.steps.length > 5) {
                    console.log(
                        `  ... and ${result.executionResult.steps.length - 5} more steps`
                    );
                }
            }
        }

        console.log("─".repeat(80));
        console.log("\n✅ Script completed successfully!");
    } catch (error: any) {
        console.error("\n❌ Error running cron manager:");
        console.error("─".repeat(80));
        console.error(`Error: ${error.message}`);
        if (error.stack) {
            console.error(`\nStack trace:`);
            console.error(error.stack);
        }
        console.error("─".repeat(80));
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Handle Ctrl+C gracefully
process.on("SIGINT", async () => {
    console.log("\n\n⚠️  Script interrupted by user");
    await prisma.$disconnect();
    process.exit(0);
});

// Run the script
main()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
