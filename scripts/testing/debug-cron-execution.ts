#!/usr/bin/env tsx

/**
 * Debug CronJobExecution Process
 *
 * Comprehensive debugging tool for analyzing CronJobExecution records
 * and identifying issues with the execution tracking system
 */

// Load environment variables from .env file
import { resolve } from "path";

import dotenv from "dotenv";

// Load .env.local first (higher priority), then .env
dotenv.config({ path: resolve(process.cwd(), "backend/.env.local") });
dotenv.config({ path: resolve(process.cwd(), "backend/.env") });

import mongoose from "mongoose";

import { ensureMongoConnection } from "../../frontend/lib/mongoose";
import { prisma } from "../../frontend/lib/prisma";
import CronJobExecution from "../../frontend/models/CronJobExecution";

interface ExecutionStats {
    total: number;
    withDuration: number;
    withoutDuration: number;
    byStatus: Record<string, number>;
    byJobId: Record<number, number>;
    recentCount: number;
    avgDuration: number;
    minDuration: number;
    maxDuration: number;
}

async function getExecutionStats(): Promise<ExecutionStats> {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Get all records from last hour
    const recentRecords = await CronJobExecution.find({
        started_at: { $gte: oneHourAgo },
    }).lean();

    const total = recentRecords.length;
    const withDuration = recentRecords.filter(
        (r: any) =>
            r.duration_seconds != null && r.duration_seconds !== undefined
    ).length;
    const withoutDuration = total - withDuration;

    // Group by status
    const byStatus: Record<string, number> = {};
    recentRecords.forEach((r: any) => {
        const status = r.status || "UNKNOWN";
        byStatus[status] = (byStatus[status] || 0) + 1;
    });

    // Group by job_id
    const byJobId: Record<number, number> = {};
    recentRecords.forEach((r: any) => {
        const jobId = r.job_id;
        byJobId[jobId] = (byJobId[jobId] || 0) + 1;
    });

    // Recent count (last minute)
    const recentCount = recentRecords.filter(
        (r: any) => new Date(r.started_at) >= oneMinuteAgo
    ).length;

    // Duration stats
    const durations = recentRecords
        .map((r: any) => r.duration_seconds)
        .filter((d: any) => d != null && d !== undefined) as number[];

    const avgDuration =
        durations.length > 0
            ? durations.reduce((a, b) => a + b, 0) / durations.length
            : 0;
    const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
    const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

    return {
        total,
        withDuration,
        withoutDuration,
        byStatus,
        byJobId,
        recentCount,
        avgDuration,
        minDuration,
        maxDuration,
    };
}

async function analyzeTiming(records: any[]): Promise<void> {
    if (records.length < 2) {
        console.log("  Not enough records for timing analysis");
        return;
    }

    const sorted = records
        .map((r) => new Date(r.started_at))
        .sort((a, b) => b.getTime() - a.getTime());

    const intervals: number[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
        intervals.push(sorted[i].getTime() - sorted[i + 1].getTime());
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const minInterval = Math.min(...intervals);
    const maxInterval = Math.max(...intervals);

    console.log(
        `  Average interval: ${(avgInterval / 1000).toFixed(2)} seconds`
    );
    console.log(
        `  Minimum interval: ${(minInterval / 1000).toFixed(2)} seconds`
    );
    console.log(
        `  Maximum interval: ${(maxInterval / 1000).toFixed(2)} seconds`
    );

    if (minInterval < 2000) {
        console.log(
            `  ⚠️  WARNING: Records created very frequently (< 2 seconds apart)`
        );
    }
}

async function checkCronJobConfiguration() {
    console.log(`\n${"=".repeat(80)}`);
    console.log("📋 CRON JOB CONFIGURATION");
    console.log("=".repeat(80));

    const jobs = await prisma.cronJob.findMany({
        orderBy: { id: "asc" },
    });

    console.log(`\nTotal CronJobs: ${jobs.length}\n`);

    jobs.forEach((job) => {
        const isOverdue =
            job.next_run_at && job.next_run_at < new Date() && !job.active;
        const overdueMinutes = job.next_run_at
            ? Math.round(
                  (new Date().getTime() - job.next_run_at.getTime()) / 1000 / 60
              )
            : 0;

        console.log(`Job ID ${job.id}: ${job.name}`);
        console.log(`  Active: ${job.active}`);
        console.log(`  Cron Expression: ${job.cron_expression}`);
        console.log(`  Next Run: ${job.next_run_at?.toISOString() || "N/A"}`);
        if (isOverdue) {
            console.log(
                `  ⚠️  OVERDUE: ${overdueMinutes} minutes (next_run_at in the past)`
            );
        }
        console.log(`  Last Run: ${job.last_run_at?.toISOString() || "Never"}`);
        console.log(`  Timeout: ${job.timeout_period_seconds}s`);
        console.log();
    });
}

async function analyzeExecutionRecords() {
    console.log(`\n${"=".repeat(80)}`);
    console.log("📊 EXECUTION RECORDS ANALYSIS (Last Hour)");
    console.log("=".repeat(80));

    const stats = await getExecutionStats();

    console.log(`\nTotal Records: ${stats.total}`);
    console.log(`  ✅ With Duration: ${stats.withDuration}`);
    console.log(`  ❌ Without Duration: ${stats.withoutDuration}`);
    if (stats.withoutDuration > 0) {
        const percentage = (
            (stats.withoutDuration / stats.total) *
            100
        ).toFixed(1);
        console.log(`  ⚠️  ${percentage}% of records are missing duration!`);
    }

    console.log(`\n📈 Breakdown by Status:`);
    Object.entries(stats.byStatus)
        .sort(([, a], [, b]) => b - a)
        .forEach(([status, count]) => {
            const percentage = ((count / stats.total) * 100).toFixed(1);
            console.log(`  ${status}: ${count} (${percentage}%)`);
        });

    console.log(`\n📈 Breakdown by Job ID:`);
    Object.entries(stats.byJobId)
        .sort(([, a], [, b]) => b - a)
        .forEach(([jobId, count]) => {
            const percentage = ((count / stats.total) * 100).toFixed(1);
            console.log(`  Job ID ${jobId}: ${count} records (${percentage}%)`);
        });

    console.log(`\n⏱️  Duration Statistics:`);
    console.log(`  Average: ${stats.avgDuration.toFixed(2)}s`);
    console.log(`  Minimum: ${stats.minDuration}s`);
    console.log(`  Maximum: ${stats.maxDuration}s`);

    console.log(`\n🕐 Recent Activity:`);
    console.log(`  Records in last minute: ${stats.recentCount}`);
    if (stats.recentCount > 10) {
        console.log(
            `  ⚠️  WARNING: ${stats.recentCount} records in last minute is very high!`
        );
        console.log(
            `     This suggests jobs are being triggered too frequently`
        );
    }

    // Get records without duration for detailed analysis
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recordsWithoutDuration = await CronJobExecution.find({
        started_at: { $gte: oneHourAgo },
        $or: [
            { duration_seconds: { $exists: false } },
            { duration_seconds: null },
        ],
    })
        .sort({ started_at: -1 })
        .limit(20)
        .lean();

    if (recordsWithoutDuration.length > 0) {
        console.log(`\n🔍 Sample Records Without Duration (last 20):`);
        recordsWithoutDuration.forEach((record: any, idx: number) => {
            const age = Math.round(
                (Date.now() - new Date(record.started_at).getTime()) / 1000
            );
            console.log(`\n  ${idx + 1}. Job ID: ${record.job_id}`);
            console.log(
                `     Started: ${new Date(record.started_at).toISOString()} (${age}s ago)`
            );
            console.log(`     Status: ${record.status}`);
            console.log(
                `     Completed: ${
                    record.completed_at
                        ? new Date(record.completed_at).toISOString()
                        : "N/A"
                }`
            );
            console.log(`     Duration: ${record.duration_seconds ?? "N/A"}`);
            console.log(`     Error: ${record.error_message || "None"}`);
            console.log(
                `     Correlation ID: ${record.correlation_id || "N/A"}`
            );
        });

        // Analyze timing of records without duration
        console.log(`\n⏱️  Timing Analysis (Records Without Duration):`);
        await analyzeTiming(recordsWithoutDuration);
    }
}

async function checkForStuckRecords() {
    console.log(`\n${"=".repeat(80)}`);
    console.log("🔍 CHECKING FOR STUCK RECORDS");
    console.log("=".repeat(80));

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    // Records that should have been updated but weren't
    const stuckSuccess = await CronJobExecution.countDocuments({
        started_at: { $lt: fiveMinutesAgo },
        status: "SUCCESS",
        $or: [
            { duration_seconds: { $exists: false } },
            { duration_seconds: null },
        ],
    });

    const stuckFailed = await CronJobExecution.countDocuments({
        started_at: { $lt: fiveMinutesAgo },
        status: "FAILED",
        $or: [
            { duration_seconds: { $exists: false } },
            { duration_seconds: null },
        ],
        completed_at: { $exists: false },
    });

    console.log(
        `\nStuck SUCCESS records (older than 5 min, no duration): ${stuckSuccess}`
    );
    console.log(
        `Stuck FAILED records (older than 5 min, no completion): ${stuckFailed}`
    );

    if (stuckSuccess > 0 || stuckFailed > 0) {
        console.log(
            `\n  ⚠️  WARNING: These records were never properly updated!`
        );
    }
}

async function checkRecentExecutions() {
    console.log(`\n${"=".repeat(80)}`);
    console.log("🕐 RECENT EXECUTIONS (Last 10)");
    console.log("=".repeat(80));

    const recent = await CronJobExecution.find({})
        .sort({ started_at: -1 })
        .limit(10)
        .lean();

    recent.forEach((record: any, idx: number) => {
        const age = Math.round(
            (Date.now() - new Date(record.started_at).getTime()) / 1000
        );
        console.log(`\n${idx + 1}. Job ID: ${record.job_id}`);
        console.log(
            `   Started: ${new Date(record.started_at).toISOString()} (${age}s ago)`
        );
        console.log(`   Status: ${record.status}`);
        console.log(
            `   Completed: ${
                record.completed_at
                    ? new Date(record.completed_at).toISOString()
                    : "N/A"
            }`
        );
        console.log(
            `   Duration: ${
                record.duration_seconds != null
                    ? `${record.duration_seconds}s`
                    : "N/A"
            }`
        );
        console.log(`   Correlation ID: ${record.correlation_id || "N/A"}`);
        if (record.error_message) {
            console.log(`   Error: ${record.error_message}`);
        }
    });
}

async function main() {
    console.log("🔍 CronJobExecution Debug Tool");
    console.log("=".repeat(80));

    let mongoConnected = false;
    try {
        // Connect to MongoDB
        try {
            await ensureMongoConnection();
            console.log("✅ Connected to MongoDB");
            mongoConnected = true;
        } catch (mongoError: any) {
            console.log(
                "⚠️  MongoDB not available (this is OK for local debugging)"
            );
            console.log(`   Error: ${mongoError.message}`);
            console.log("   Will skip execution record analysis\n");
        }

        // Connect to PostgreSQL
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL\n");

        // Run all checks
        await checkCronJobConfiguration();

        if (mongoConnected) {
            await analyzeExecutionRecords();
            await checkForStuckRecords();
            await checkRecentExecutions();
        } else {
            console.log(`\n${"=".repeat(80)}`);
            console.log("📊 EXECUTION RECORDS ANALYSIS");
            console.log("=".repeat(80));
            console.log(
                "\n⚠️  Skipped: MongoDB connection required for execution record analysis"
            );
            console.log(
                "   To analyze execution records, ensure MongoDB is running and MONGODB_URI is set"
            );
        }

        console.log(`\n${"=".repeat(80)}`);
        console.log("✅ Debug analysis complete!");
        console.log("=".repeat(80));
    } catch (error: any) {
        console.error("\n❌ Error:", error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        if (mongoConnected) {
            await mongoose.disconnect();
        }
        await prisma.$disconnect();
    }
}

main();
