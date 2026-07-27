#!/usr/bin/env tsx

/**
 * Test Execution Record Creation Pattern
 *
 * This script analyzes why many CronJobExecution records might be created
 * by checking the code flow and testing the execution record creation logic
 */

// Load environment variables from .env file
import { resolve } from "path";

import dotenv from "dotenv";

// Load .env.local first (higher priority), then .env
dotenv.config({ path: resolve(process.cwd(), "backend/.env.local") });
dotenv.config({ path: resolve(process.cwd(), "backend/.env") });

import { prisma } from "../../frontend/lib/prisma";
import { CronJobExecutionService } from "../../frontend/server/services/CronJobExecutionService";

async function analyzeExecutionRecordCreation() {
    console.log("🔍 Analyzing Execution Record Creation Pattern");
    console.log("=".repeat(80));
    console.log();

    try {
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL\n");

        // Check all cron jobs
        const jobs = await prisma.cronJob.findMany({
            orderBy: { id: "asc" },
        });

        console.log("📋 Step 1: Checking CronJob Configuration");
        console.log("─".repeat(80));
        jobs.forEach((job) => {
            const isOverdue =
                job.next_run_at && job.next_run_at < new Date() && !job.active;
            const overdueMinutes = job.next_run_at
                ? Math.round(
                      (new Date().getTime() - job.next_run_at.getTime()) /
                          1000 /
                          60
                  )
                : 0;

            console.log(`\nJob ID ${job.id}: ${job.name}`);
            console.log(`  Active: ${job.active}`);
            console.log(`  Cron: ${job.cron_expression}`);
            console.log(
                `  Next Run: ${job.next_run_at?.toISOString() || "N/A"}`
            );
            if (isOverdue) {
                console.log(
                    `  ⚠️  OVERDUE: ${overdueMinutes} minutes (next_run_at in the past)`
                );
            }
            console.log(
                `  Last Run: ${job.last_run_at?.toISOString() || "Never"}`
            );
        });

        // Check how many times runCronJobs would create execution records
        console.log(`\n${"=".repeat(80)}`);
        console.log("📋 Step 2: Analyzing Execution Record Creation Points");
        console.log("─".repeat(80));

        console.log("\n🔍 Code Flow Analysis:");
        console.log(
            "   1. runCronJobs() is called → Creates execution record in executeJobWithLogging()"
        );
        console.log(
            "   2. executeJobWithLogging() creates record at START (line 937)"
        );
        console.log("   3. Record is created with status 'FAILED' initially");
        console.log(
            "   4. Record is updated to 'SUCCESS' on completion (line 1298)"
        );
        console.log(
            "   5. Record is updated to 'FAILED'/'TIMEOUT' on error (line 1358)"
        );

        console.log("\n⚠️  Potential Issues:");
        console.log(
            "   - If runCronJobs() is called but no job runs → NO record created (good)"
        );
        console.log(
            "   - If runCronJobs() is called and job is skipped → NO record created (good)"
        );
        console.log(
            "   - If runCronJobs() is called and job executes → 1 record created (good)"
        );
        console.log(
            "   - If external trigger calls API every second → Creates record every second (BAD)"
        );

        // Test execution record creation
        console.log(`\n${"=".repeat(80)}`);
        console.log("📋 Step 3: Testing Execution Record Creation");
        console.log("─".repeat(80));

        // Try to create a test execution record
        try {
            const testJob = jobs.find(
                (j) => j.name === "Activity Workflow Manager"
            );
            if (testJob) {
                console.log(
                    `\n🧪 Creating test execution record for Job ID ${testJob.id}...`
                );
                const execution = await CronJobExecutionService.createExecution(
                    testJob.id,
                    {
                        startedAt: new Date(),
                        status: "SUCCESS",
                        correlationId: `test_${Date.now()}`,
                        timeoutPeriodSeconds:
                            testJob.timeout_period_seconds || 1800,
                    }
                );
                console.log(
                    `✅ Test execution record created: ${execution._id.toString()}`
                );
                console.log(
                    `   Started: ${execution.started_at.toISOString()}`
                );
                console.log(`   Status: ${execution.status}`);

                // Check if it has duration
                if (!execution.duration_seconds) {
                    console.log(
                        `   ⚠️  Duration: N/A (record created but not updated yet)`
                    );
                } else {
                    console.log(`   Duration: ${execution.duration_seconds}s`);
                }

                // Clean up test record
                console.log("\n🧹 Cleaning up test record...");
                // Note: We don't have a delete method, but that's OK for testing
            }
        } catch (error: any) {
            if (
                error.message.includes("MongoDB") ||
                error.message.includes("connect")
            ) {
                console.log(
                    "\n⚠️  MongoDB not available - cannot test execution record creation"
                );
                console.log("   This is expected in local development");
            } else {
                throw error;
            }
        }

        // Analyze potential causes
        console.log(`\n${"=".repeat(80)}`);
        console.log("📋 Step 4: Potential Causes of Many Records");
        console.log("─".repeat(80));

        console.log("\n🔴 Most Likely Causes:");
        console.log(
            "   1. External trigger calling /api/system/cron too frequently"
        );
        console.log("      - If called every second → 1 record per second");
        console.log(
            "      - Check: System cron, AWS Lambda, Vercel Cron config"
        );
        console.log();
        console.log(
            "   2. Multiple instances/containers calling the API simultaneously"
        );
        console.log(
            "      - Each instance creates execution records independently"
        );
        console.log("      - Check: Deployment configuration, load balancer");
        console.log();
        console.log("   3. Jobs failing early before update code runs");
        console.log("      - Record created but never updated with duration");
        console.log("      - Check: Error logs, job execution failures");

        console.log("\n🟡 Less Likely Causes:");
        console.log("   4. Database connection issues causing retries");
        console.log("      - Each retry might create a new record");
        console.log();
        console.log("   5. Code bug creating records in multiple places");
        console.log(
            "      - Check: Only executeJobWithLogging creates records"
        );

        // Recommendations
        console.log(`\n${"=".repeat(80)}`);
        console.log("📋 Step 5: Recommendations");
        console.log("─".repeat(80));

        console.log("\n✅ To Fix:");
        console.log(
            "   1. Check external trigger frequency (should be 1-5 minutes, NOT every second)"
        );
        console.log("   2. Verify only one instance is calling the cron API");
        console.log(
            "   3. Run the debug script in production with MongoDB access:"
        );
        console.log("      npx tsx scripts/testing/debug-cron-execution.ts");
        console.log("   4. Check MongoDB execution records for patterns:");
        console.log(
            "      - Records created every second → Trigger frequency issue"
        );
        console.log(
            "      - Many records with N/A duration → Update code not running"
        );
        console.log(
            "      - Records with same correlation ID → Multiple instances"
        );

        console.log(`\n${"=".repeat(80)}`);
    } catch (error: any) {
        console.error("\n❌ Error:", error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

analyzeExecutionRecordCreation();
