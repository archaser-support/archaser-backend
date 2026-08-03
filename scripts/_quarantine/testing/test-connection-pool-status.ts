#!/usr/bin/env ts-node

/**
 * Connection Pool Status Test Script
 *
 * This script tests connection pool status using Prisma (no psql required)
 * Run with: npx ts-node scripts/testing/test-connection-pool-status.ts
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
    idleInTransaction: number;
    maxConnections: number;
}

async function checkConnectionPoolStatus() {
    try {
        console.log("🔍 Checking connection pool status...\n");

        // Get connection pool status by application_name and state
        const statusByApp = await prisma.$queryRaw<ConnectionStatus[]>`
            SELECT 
                application_name,
                state,
                count(*)::int as count
            FROM pg_stat_activity
            WHERE datname = current_database()
            GROUP BY application_name, state
            ORDER BY count DESC;
        `;

        console.log("📊 Connections by Application and State:");
        console.log("─".repeat(80));
        if (statusByApp.length > 0) {
            statusByApp.forEach((row) => {
                const app = row.application_name || "(no application_name)";
                console.log(
                    `  ${app.padEnd(30)} | ${row.state.padEnd(20)} | ${row.count}`
                );
            });
        } else {
            console.log("  No active connections found");
        }
        console.log("─".repeat(80));
        console.log();

        // Get summary statistics
        const summary = await prisma.$queryRaw<PoolSummary[]>`
            SELECT 
                count(*)::int as total,
                count(*) FILTER (WHERE state = 'active')::int as active,
                count(*) FILTER (WHERE state = 'idle')::int as idle,
                count(*) FILTER (WHERE state = 'idle in transaction')::int as "idleInTransaction",
                (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as "maxConnections"
            FROM pg_stat_activity
            WHERE datname = current_database();
        `;

        if (summary.length > 0) {
            const stats = summary[0];
            console.log("📈 Connection Pool Summary:");
            console.log("─".repeat(80));
            console.log(`  Total Connections:      ${stats.total}`);
            console.log(`  Active Connections:      ${stats.active}`);
            console.log(`  Idle Connections:        ${stats.idle}`);
            console.log(
                `  Idle in Transaction:     ${stats.idleInTransaction}`
            );
            console.log(`  Max Connections:         ${stats.maxConnections}`);
            console.log(
                `  Available Connections:   ${stats.maxConnections - stats.total}`
            );
            console.log(
                `  Usage Percentage:        ${((stats.total / stats.maxConnections) * 100).toFixed(1)}%`
            );
            console.log("─".repeat(80));
            console.log();

            // Check for high usage
            const usagePercent = (stats.total / stats.maxConnections) * 100;
            if (usagePercent > 80) {
                console.log("⚠️  WARNING: Connection pool usage is above 80%!");
            } else if (usagePercent > 60) {
                console.log("⚠️  CAUTION: Connection pool usage is above 60%");
            } else {
                console.log("✅ Connection pool usage is healthy");
            }
        }

        // Check for long-running connections (potential leaks)
        const longRunning = await prisma.$queryRaw<
            Array<{
                pid: number;
                application_name: string | null;
                state: string;
                age: string;
                query_preview: string;
            }>
        >`
            SELECT 
                pid,
                application_name,
                state,
                (now() - state_change)::text as age,
                LEFT(query, 50) as query_preview
            FROM pg_stat_activity
            WHERE datname = current_database()
                AND state = 'active'
                AND now() - state_change > interval '5 minutes'
            ORDER BY state_change ASC;
        `;

        if (longRunning.length > 0) {
            console.log("\n⚠️  Long-Running Connections (>5 minutes):");
            console.log("─".repeat(80));
            longRunning.forEach((conn) => {
                console.log(
                    `  PID: ${conn.pid} | App: ${conn.application_name || "N/A"} | Age: ${conn.age} | Query: ${conn.query_preview}...`
                );
            });
            console.log("─".repeat(80));
        } else {
            console.log("\n✅ No long-running connections detected");
        }
    } catch (error: any) {
        console.error(
            "❌ Error checking connection pool status:",
            error.message
        );
        if (
            error.message.includes("relation") ||
            error.message.includes("permission")
        ) {
            console.error(
                "\n💡 Tip: Make sure you have permissions to query pg_stat_activity"
            );
        }
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Run the check
checkConnectionPoolStatus()
    .then(() => {
        console.log("\n✅ Connection pool check completed");
        process.exit(0);
    })
    .catch((error) => {
        console.error("❌ Fatal error:", error);
        process.exit(1);
    });
