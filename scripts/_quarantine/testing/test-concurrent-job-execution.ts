#!/usr/bin/env tsx

/**
 * Test Concurrent Job Execution
 *
 * This script tests that the cron manager prevents simultaneous job execution
 * by attempting to run multiple jobs concurrently and verifying only one runs at a time
 */

// Load environment variables from .env file
import { resolve } from "path";

import dotenv from "dotenv";

// Load .env.local first (higher priority), then .env
dotenv.config({ path: resolve(process.cwd(), "backend/.env.local") });
dotenv.config({ path: resolve(process.cwd(), "backend/.env") });

import { prisma } from "../../frontend/lib/prisma";
import { runCronJobs } from "../../frontend/server/services/cronManager";

interface TestResult {
    attempt: number;
    timestamp: Date;
    message: string;
    jobId?: number;
    jobName?: string;
    active?: boolean;
    error?: string;
}

async function checkActiveJobs(): Promise<
    Array<{ id: number; name: string; active: boolean }>
> {
    const activeJobs = await prisma.$queryRaw<
        Array<{ id: number; name: string; active: boolean }>
    >`
        SELECT id, name, active 
        FROM "CronJob" 
        WHERE active = true
        ORDER BY id
    `;
    return activeJobs || [];
}

async function runConcurrentTest() {
    console.log("🧪 Testing Concurrent Job Execution Prevention");
    console.log("=".repeat(80));
    console.log();

    try {
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL\n");

        // Ensure no jobs are currently active
        console.log("📋 Step 1: Checking for active jobs...");
        const initialActiveJobs = await checkActiveJobs();
        if (initialActiveJobs.length > 0) {
            console.log(`⚠️  Found ${initialActiveJobs.length} active job(s):`);
            initialActiveJobs.forEach((job) => {
                console.log(`   - Job ID ${job.id}: ${job.name}`);
            });
            console.log("\n   Resetting active flags...");
            await prisma.$executeRaw`
                UPDATE "CronJob" 
                SET active = false, modified_at = NOW()
                WHERE active = true
            `;
            console.log("✅ All jobs reset to inactive\n");
        } else {
            console.log("✅ No active jobs found\n");
        }

        // Step 2: Run multiple concurrent attempts
        console.log(
            "📋 Step 2: Running 5 concurrent job execution attempts..."
        );
        console.log(
            "   This should result in only 1 job running, others should be skipped\n"
        );

        const concurrentAttempts = 5;
        const promises: Promise<TestResult>[] = [];

        for (let i = 1; i <= concurrentAttempts; i++) {
            const attemptNumber = i;
            const promise = (async (): Promise<TestResult> => {
                const startTime = new Date();
                try {
                    const result = await runCronJobs();
                    return {
                        attempt: attemptNumber,
                        timestamp: startTime,
                        message: result.message || "Unknown",
                        jobId: result.job?.id,
                        jobName: result.job?.name,
                        active: result.job?.active ?? undefined,
                    };
                } catch (error: any) {
                    return {
                        attempt: attemptNumber,
                        timestamp: startTime,
                        message: "ERROR",
                        error: error.message,
                    };
                }
            })();
            promises.push(promise);
        }

        // Wait for all attempts to complete
        const results = await Promise.all(promises);

        // Step 3: Analyze results
        console.log("📋 Step 3: Analyzing results...\n");
        console.log("=".repeat(80));
        console.log("RESULTS:");
        console.log("=".repeat(80));

        const executedJobs: TestResult[] = [];
        const skippedJobs: TestResult[] = [];
        const noJobsAvailable: TestResult[] = [];
        const errors: TestResult[] = [];

        results.forEach((result) => {
            if (result.error) {
                errors.push(result);
            } else if (result.message.includes("Job is already running")) {
                skippedJobs.push(result);
            } else if (result.message.includes("No jobs scheduled")) {
                noJobsAvailable.push(result);
            } else if (
                result.message.includes("completed") ||
                result.message.includes("Job completed")
            ) {
                executedJobs.push(result);
            } else {
                skippedJobs.push(result);
            }
        });

        console.log(`\n✅ Jobs Executed: ${executedJobs.length}`);
        executedJobs.forEach((result) => {
            console.log(
                `   Attempt ${result.attempt}: ${result.jobName} (ID: ${result.jobId}) - ${result.message}`
            );
        });

        console.log(
            `\n⏭️  Jobs Skipped (already running): ${skippedJobs.length}`
        );
        skippedJobs.forEach((result) => {
            console.log(`   Attempt ${result.attempt}: ${result.message}`);
        });

        console.log(`\n📭 No Jobs Available: ${noJobsAvailable.length}`);
        noJobsAvailable.forEach((result) => {
            console.log(`   Attempt ${result.attempt}: ${result.message}`);
        });

        if (errors.length > 0) {
            console.log(`\n❌ Errors: ${errors.length}`);
            errors.forEach((result) => {
                console.log(`   Attempt ${result.attempt}: ${result.error}`);
            });
        }

        // Step 4: Verify only one job was active at a time
        console.log(`\n${"=".repeat(80)}`);
        console.log("VERIFICATION:");
        console.log("=".repeat(80));

        const finalActiveJobs = await checkActiveJobs();
        console.log(
            `\n📊 Active jobs after all attempts: ${finalActiveJobs.length}`
        );
        if (finalActiveJobs.length > 0) {
            finalActiveJobs.forEach((job) => {
                console.log(`   - Job ID ${job.id}: ${job.name}`);
            });
        }

        // Test results
        console.log(`\n${"=".repeat(80)}`);
        console.log("TEST RESULTS:");
        console.log("=".repeat(80));

        const testPassed =
            executedJobs.length === 1 &&
            skippedJobs.length === concurrentAttempts - 1 &&
            finalActiveJobs.length === 0;

        if (testPassed) {
            console.log("\n✅ TEST PASSED!");
            console.log("   ✓ Only 1 job executed");
            console.log(
                `   ✓ ${skippedJobs.length} attempts were properly skipped`
            );
            console.log("   ✓ No jobs remain active after completion");
            console.log(
                "\n   The concurrent execution prevention is working correctly!"
            );
        } else {
            console.log("\n❌ TEST FAILED!");
            if (executedJobs.length !== 1) {
                console.log(
                    `   ✗ Expected 1 job to execute, but ${executedJobs.length} executed`
                );
            }
            if (skippedJobs.length !== concurrentAttempts - 1) {
                console.log(
                    `   ✗ Expected ${concurrentAttempts - 1} jobs to be skipped, but ${skippedJobs.length} were skipped`
                );
            }
            if (finalActiveJobs.length > 0) {
                console.log(
                    `   ✗ Expected 0 active jobs after completion, but ${finalActiveJobs.length} remain active`
                );
            }
        }

        // Step 5: Check timing
        if (results.length > 1) {
            console.log(`\n${"=".repeat(80)}`);
            console.log("TIMING ANALYSIS:");
            console.log("=".repeat(80));

            const timestamps = results.map((r) => r.timestamp.getTime()).sort();
            const intervals: number[] = [];
            for (let i = 1; i < timestamps.length; i++) {
                intervals.push(timestamps[i] - timestamps[i - 1]);
            }

            const avgInterval =
                intervals.reduce((a, b) => a + b, 0) / intervals.length;
            const minInterval = Math.min(...intervals);
            const maxInterval = Math.max(...intervals);

            console.log(
                `\n  Average interval between attempts: ${avgInterval.toFixed(2)}ms`
            );
            console.log(`  Minimum interval: ${minInterval}ms`);
            console.log(`  Maximum interval: ${maxInterval}ms`);

            if (minInterval < 10) {
                console.log(
                    `\n  ✅ Attempts were truly concurrent (< 10ms apart)`
                );
            } else {
                console.log(
                    `\n  ⚠️  Attempts were not fully concurrent (${minInterval}ms apart)`
                );
            }
        }

        console.log(`\n${"=".repeat(80)}`);
        return testPassed;
    } catch (error: any) {
        console.error("\n❌ Test Error:", error.message);
        console.error(error.stack);
        return false;
    } finally {
        await prisma.$disconnect();
    }
}

// Run the test
runConcurrentTest()
    .then((passed) => {
        process.exit(passed ? 0 : 1);
    })
    .catch((error) => {
        console.error("Fatal error:", error);
        process.exit(1);
    });
