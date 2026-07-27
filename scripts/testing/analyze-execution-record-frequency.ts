#!/usr/bin/env tsx

/**
 * Analyze Execution Record Frequency
 *
 * This script analyzes CronJobExecution records to identify why many records
 * are being created. Run this in production where MongoDB is available.
 */

// Load environment variables from .env file
import { resolve } from "path";

import dotenv from "dotenv";

// Load .env.local first (higher priority), then .env
dotenv.config({ path: resolve(process.cwd(), "backend/.env.local") });
dotenv.config({ path: resolve(process.cwd(), "backend/.env") });

import { ensureMongoConnection } from "../../frontend/lib/mongoose";
import { prisma } from "../../frontend/lib/prisma";
import CronJobExecution from "../../frontend/models/CronJobExecution";

async function analyzeFrequency() {
    console.log("🔍 Analyzing Execution Record Frequency");
    console.log("=".repeat(80));
    console.log();

    // Show which MongoDB URI is being used (masked for security)
    const mongoUri = process.env.MONGODB_URI;
    if (mongoUri) {
        const maskedUri = mongoUri.replace(
            /(mongodb\+srv?:\/\/)([^:]+):([^@]+)@/,
            "$1***:***@"
        );
        console.log(`📋 MongoDB URI: ${maskedUri}`);
    } else {
        console.log("⚠️  MONGODB_URI not found in environment variables");
        console.log("   Using default: mongodb://localhost:27017/archaser");
    }
    console.log();

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
            if (mongoError.message.includes("ECONNREFUSED")) {
                console.log(
                    "   This usually means MongoDB is not running locally"
                );
                console.log(
                    "   Or MONGODB_URI in .env file points to a remote server that's not accessible"
                );
            }
            console.log("   Will show analysis based on code flow only\n");
        }

        // Connect to PostgreSQL
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL\n");

        if (mongoConnected) {
            // Analyze execution records from last 24 hours
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const recentRecords = await CronJobExecution.find({
                started_at: { $gte: oneDayAgo },
            })
                .sort({ started_at: 1 })
                .lean();

            console.log("=".repeat(80));
            console.log("📊 EXECUTION RECORDS ANALYSIS (Last 24 Hours)");
            console.log("=".repeat(80));

            console.log(`\nTotal Records: ${recentRecords.length}`);

            if (recentRecords.length === 0) {
                console.log(
                    "\n✅ No execution records found in the last 24 hours"
                );
                console.log("   This is normal if jobs haven't run recently");
            } else {
                // Group by job_id
                const byJobId: Record<number, any[]> = {};
                recentRecords.forEach((record: any) => {
                    const jobId = record.job_id;
                    if (!byJobId[jobId]) {
                        byJobId[jobId] = [];
                    }
                    byJobId[jobId].push(record);
                });

                console.log(`\n📈 Breakdown by Job ID:`);
                Object.entries(byJobId)
                    .sort(([, a], [, b]) => b.length - a.length)
                    .forEach(([jobId, records]) => {
                        const withoutDuration = records.filter(
                            (r: any) =>
                                !r.duration_seconds ||
                                r.duration_seconds === null
                        ).length;
                        const withDuration = records.length - withoutDuration;

                        console.log(
                            `\n  Job ID ${jobId}: ${records.length} records`
                        );
                        console.log(`    ✅ With Duration: ${withDuration}`);
                        console.log(
                            `    ❌ Without Duration: ${withoutDuration}`
                        );

                        // Analyze timing
                        if (records.length > 1) {
                            const timestamps = records
                                .map((r: any) =>
                                    new Date(r.started_at).getTime()
                                )
                                .sort((a, b) => a - b);
                            const intervals: number[] = [];
                            for (let i = 1; i < timestamps.length; i++) {
                                intervals.push(
                                    timestamps[i] - timestamps[i - 1]
                                );
                            }

                            const avgInterval =
                                intervals.reduce((a, b) => a + b, 0) /
                                intervals.length;
                            const minInterval = Math.min(...intervals);
                            const maxInterval = Math.max(...intervals);

                            console.log(`    ⏱️  Timing:`);
                            console.log(
                                `      Average interval: ${(avgInterval / 1000).toFixed(2)}s`
                            );
                            console.log(
                                `      Minimum interval: ${(minInterval / 1000).toFixed(2)}s`
                            );
                            console.log(
                                `      Maximum interval: ${(maxInterval / 1000).toFixed(2)}s`
                            );

                            if (minInterval < 2000) {
                                console.log(
                                    `      ⚠️  WARNING: Records created very frequently (< 2s apart)`
                                );
                                console.log(
                                    `         This suggests the API is being called too often!`
                                );
                            } else if (minInterval < 60000) {
                                console.log(
                                    `      ⚠️  Records created every ${(minInterval / 1000).toFixed(0)}s`
                                );
                                console.log(
                                    `         Recommended: Call API every 1-5 minutes, not every second`
                                );
                            }
                        }
                    });

                // Check for patterns
                console.log(`\n${"=".repeat(80)}`);
                console.log("🔍 PATTERN ANALYSIS");
                console.log("=".repeat(80));

                // Check if records are created in bursts
                const timestamps = recentRecords
                    .map((r: any) => new Date(r.started_at).getTime())
                    .sort((a, b) => a - b);

                let burstCount = 0;
                let currentBurst = 1;
                for (let i = 1; i < timestamps.length; i++) {
                    const interval = timestamps[i] - timestamps[i - 1];
                    if (interval < 5000) {
                        // Less than 5 seconds apart
                        currentBurst++;
                    } else {
                        if (currentBurst > 1) {
                            burstCount++;
                        }
                        currentBurst = 1;
                    }
                }
                if (currentBurst > 1) {
                    burstCount++;
                }

                if (burstCount > 0) {
                    console.log(
                        `\n⚠️  Found ${burstCount} burst(s) of rapid record creation`
                    );
                    console.log(
                        `   This indicates the API is being called too frequently`
                    );
                }

                // Check status distribution
                const byStatus: Record<string, number> = {};
                recentRecords.forEach((record: any) => {
                    const status = record.status || "UNKNOWN";
                    byStatus[status] = (byStatus[status] || 0) + 1;
                });

                console.log(`\n📊 Status Distribution:`);
                Object.entries(byStatus)
                    .sort(([, a], [, b]) => b - a)
                    .forEach(([status, count]) => {
                        const percentage = (
                            (count / recentRecords.length) *
                            100
                        ).toFixed(1);
                        console.log(`  ${status}: ${count} (${percentage}%)`);
                    });

                // Show sample of recent records
                console.log(`\n${"=".repeat(80)}`);
                console.log("📋 SAMPLE RECORDS (Last 20)");
                console.log("=".repeat(80));

                const recent = recentRecords.slice(-20).reverse();
                recent.forEach((record: any, idx: number) => {
                    const age = Math.round(
                        (Date.now() - new Date(record.started_at).getTime()) /
                            1000
                    );
                    console.log(`\n${idx + 1}. Job ID: ${record.job_id}`);
                    console.log(
                        `   Started: ${new Date(record.started_at).toISOString()} (${age}s ago)`
                    );
                    console.log(`   Status: ${record.status}`);
                    console.log(
                        `   Duration: ${
                            record.duration_seconds != null
                                ? `${record.duration_seconds}s`
                                : "N/A"
                        }`
                    );
                    console.log(
                        `   Correlation ID: ${record.correlation_id || "N/A"}`
                    );
                });
            }
        } else {
            console.log("=".repeat(80));
            console.log("📊 ANALYSIS (MongoDB Not Available)");
            console.log("=".repeat(80));
            console.log(
                "\n⚠️  Cannot analyze execution records without MongoDB connection"
            );
            console.log(
                "   Run this script in production where MongoDB is available"
            );
        }

        // Check cron job configuration
        console.log(`\n${"=".repeat(80)}`);
        console.log("📋 CRON JOB CONFIGURATION CHECK");
        console.log("=".repeat(80));

        const jobs = await prisma.cronJob.findMany({
            orderBy: { id: "asc" },
        });

        console.log(`\nTotal Jobs: ${jobs.length}`);
        const overdueJobs = jobs.filter(
            (job) =>
                job.next_run_at && job.next_run_at < new Date() && !job.active
        );

        if (overdueJobs.length > 0) {
            console.log(
                `\n⚠️  ${overdueJobs.length} job(s) are overdue (next_run_at in the past)`
            );
            console.log(
                "   This suggests the external trigger is not calling the API regularly"
            );
        } else {
            console.log("\n✅ No overdue jobs found");
        }

        // Recommendations
        console.log(`\n${"=".repeat(80)}`);
        console.log("💡 RECOMMENDATIONS");
        console.log("=".repeat(80));

        console.log("\n1. Check External Trigger Configuration:");
        console.log("   - System cron: crontab -l (on server)");
        console.log("   - AWS Lambda: Check CloudWatch Events rules");
        console.log("   - Vercel: Check vercel.json crons configuration");
        console.log("   - Other schedulers: Check their configuration");

        console.log("\n2. Verify Trigger Frequency:");
        console.log("   - Should be: Every 1-5 minutes");
        console.log("   - Should NOT be: Every second");

        console.log("\n3. Check for Multiple Instances:");
        console.log(
            "   - Verify only one instance/container is calling the API"
        );
        console.log("   - Check load balancer configuration");

        console.log("\n4. Monitor in Production:");
        console.log(
            "   - Run: npx tsx scripts/testing/debug-cron-execution.ts"
        );
        console.log("   - Check MongoDB execution records for patterns");

        console.log(`\n${"=".repeat(80)}`);
    } catch (error: any) {
        console.error("\n❌ Error:", error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        if (mongoConnected) {
            const mongoose = await import("mongoose");
            await mongoose.default.disconnect();
        }
        await prisma.$disconnect();
    }
}

analyzeFrequency();
