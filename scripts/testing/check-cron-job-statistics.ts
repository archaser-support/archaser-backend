#!/usr/bin/env tsx

/**
 * Check CronJob Statistics Fields
 *
 * Verifies that the new statistics fields are being updated correctly
 */

// Load environment variables from .env file
import { resolve } from "path";

import dotenv from "dotenv";

// Load .env.local first (higher priority), then .env
dotenv.config({ path: resolve(process.cwd(), "backend/.env.local") });
dotenv.config({ path: resolve(process.cwd(), "backend/.env") });

import { prisma } from "../../frontend/lib/prisma";

async function checkStatistics() {
    try {
        await prisma.$connect();
        console.log("✅ Connected to PostgreSQL\n");

        // Get all cron jobs with their statistics
        const jobs = await prisma.$queryRaw<
            Array<{
                id: number;
                name: string;
                last_execution_duration_seconds: number | null;
                success_count_30d: number | null;
                failure_count_30d: number | null;
                timeout_count_30d: number | null;
                last_success_at: Date | null;
                last_failure_at: Date | null;
                last_timeout_at: Date | null;
                average_execution_duration_seconds: number | null;
                min_execution_duration_seconds: number | null;
                max_execution_duration_seconds: number | null;
                last_run_at: Date | null;
            }>
        >`
            SELECT 
                id,
                name,
                last_execution_duration_seconds,
                success_count_30d,
                failure_count_30d,
                timeout_count_30d,
                last_success_at,
                last_failure_at,
                last_timeout_at,
                average_execution_duration_seconds,
                min_execution_duration_seconds,
                max_execution_duration_seconds,
                last_run_at
            FROM "CronJob"
            ORDER BY id
        `;

        console.log("=".repeat(80));
        console.log("📊 CRON JOB STATISTICS");
        console.log("=".repeat(80));
        console.log();

        jobs.forEach((job) => {
            console.log(`Job ID ${job.id}: ${job.name}`);
            console.log(
                `  Last Run: ${job.last_run_at?.toISOString() || "Never"}`
            );
            console.log(
                `  Last Duration: ${job.last_execution_duration_seconds ?? "N/A"}s`
            );
            console.log(
                `  Success Count (30d): ${job.success_count_30d ?? "N/A"}`
            );
            console.log(
                `  Failure Count (30d): ${job.failure_count_30d ?? "N/A"}`
            );
            console.log(
                `  Timeout Count (30d): ${job.timeout_count_30d ?? "N/A"}`
            );
            console.log(
                `  Last Success: ${job.last_success_at?.toISOString() || "N/A"}`
            );
            console.log(
                `  Last Failure: ${job.last_failure_at?.toISOString() || "N/A"}`
            );
            console.log(
                `  Last Timeout: ${job.last_timeout_at?.toISOString() || "N/A"}`
            );
            console.log(
                `  Avg Duration: ${job.average_execution_duration_seconds ?? "N/A"}s`
            );
            console.log(
                `  Min Duration: ${job.min_execution_duration_seconds ?? "N/A"}s`
            );
            console.log(
                `  Max Duration: ${job.max_execution_duration_seconds ?? "N/A"}s`
            );
            console.log();
        });

        // Check which fields are NULL (not updated yet)
        const jobsWithNullFields = jobs.filter(
            (job) =>
                job.success_count_30d === null ||
                job.failure_count_30d === null ||
                job.timeout_count_30d === null
        );

        if (jobsWithNullFields.length > 0) {
            console.log("⚠️  Jobs with NULL statistics fields:");
            jobsWithNullFields.forEach((job) => {
                const nullFields: string[] = [];
                if (job.success_count_30d === null)
                    nullFields.push("success_count_30d");
                if (job.failure_count_30d === null)
                    nullFields.push("failure_count_30d");
                if (job.timeout_count_30d === null)
                    nullFields.push("timeout_count_30d");
                console.log(
                    `  Job ${job.id} (${job.name}): ${nullFields.join(", ")}`
                );
            });
        } else {
            console.log("✅ All jobs have statistics fields populated!");
        }

        console.log("=".repeat(80));
    } catch (error: any) {
        console.error("❌ Error:", error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

checkStatistics();
