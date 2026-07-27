#!/usr/bin/env tsx

/**
 * Simulate Concurrent Users Stress Test
 *
 * This script simulates multiple users logging in and browsing different pages
 * to stress test the connection pool under realistic user load.
 *
 * Usage:
 *   npx tsx scripts/testing/simulate-concurrent-users.ts [options]
 *
 * Options:
 *   --users <number>          Number of concurrent users (default: 5)
 *   --duration <seconds>      Test duration in seconds (default: 60)
 *   --user-ids <ids>          Comma-separated user IDs to use (optional)
 *   --user-emails <emails>    Comma-separated user emails to use (optional)
 *   --pages-per-user <number> Number of different pages each user visits (default: 5)
 *   --delay-between-pages <ms> Delay between page visits in ms (default: 2000)
 *   --monitor-interval <ms>   Monitoring interval in ms (default: 1000)
 *
 * Examples:
 *   # Simulate 5 users for 60 seconds
 *   npx tsx scripts/testing/simulate-concurrent-users.ts
 *
 *   # Simulate 10 users for 120 seconds
 *   npx tsx scripts/testing/simulate-concurrent-users.ts --users 10 --duration 120
 *
 *   # Use specific user IDs
 *   npx tsx scripts/testing/simulate-concurrent-users.ts --user-ids "1,2,3,4,5"
 *
 *   # Use specific user emails
 *   npx tsx scripts/testing/simulate-concurrent-users.ts --user-emails "user1@example.com,user2@example.com"
 */

import { prisma } from "../../frontend/lib/prisma";
import { AccessControlService } from "../../frontend/server/services/AccessControlService";
import { DashboardCacheService } from "../../frontend/server/services/DashboardCacheService";

interface ConnectionPoolStatus {
    total: number;
    active: number;
    idle: number;
    idleInTransaction: number;
    maxConnections: number;
    usagePercent: number;
    available: number;
}

interface UserSimulationResult {
    userId: string;
    email: string;
    accountId: number | null;
    pagesVisited: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    errors: Array<{ page: string; error: string; timestamp: Date }>;
}

interface TestMetrics {
    totalUsers: number;
    testDuration: number;
    totalPageVisits: number;
    successfulPageVisits: number;
    failedPageVisits: number;
    maxConnectionsUsed: number;
    maxUsagePercent: number;
    averageResponseTime: number;
    connectionPoolExhausted: boolean;
    userResults: UserSimulationResult[];
}

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        users: 5,
        duration: 60,
        userIds: null as string[] | null,
        userEmails: null as string[] | null,
        pagesPerUser: 5,
        delayBetweenPages: 2000,
        monitorInterval: 1000,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        switch (arg) {
            case "--users":
                if (next) config.users = parseInt(next, 10);
                break;
            case "--duration":
                if (next) config.duration = parseInt(next, 10);
                break;
            case "--user-ids":
                if (next)
                    config.userIds = next.split(",").map((id) => id.trim());
                break;
            case "--user-emails":
                if (next)
                    config.userEmails = next
                        .split(",")
                        .map((email) => email.trim());
                break;
            case "--pages-per-user":
                if (next) config.pagesPerUser = parseInt(next, 10);
                break;
            case "--delay-between-pages":
                if (next) config.delayBetweenPages = parseInt(next, 10);
                break;
            case "--monitor-interval":
                if (next) config.monitorInterval = parseInt(next, 10);
                break;
        }
    }

    return config;
}

async function getConnectionPoolStatus(): Promise<ConnectionPoolStatus | null> {
    try {
        const summary = await prisma.$queryRaw<
            Array<{
                total: number;
                active: number;
                idle: number;
                idleInTransaction: number;
                maxConnections: number;
            }>
        >`
            SELECT 
                count(*)::int as total,
                count(*) FILTER (WHERE state = 'active')::int as active,
                count(*) FILTER (WHERE state = 'idle')::int as idle,
                count(*) FILTER (WHERE state = 'idle in transaction')::int as "idleInTransaction",
                (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as "maxConnections"
            FROM pg_stat_activity
            WHERE datname = current_database();
        `;

        if (summary.length === 0) {
            return null;
        }

        const stats = summary[0];
        const usagePercent = (stats.total / stats.maxConnections) * 100;

        return {
            total: stats.total,
            active: stats.active,
            idle: stats.idle,
            idleInTransaction: stats.idleInTransaction,
            maxConnections: stats.maxConnections,
            usagePercent,
            available: stats.maxConnections - stats.total,
        };
    } catch (error) {
        console.error("Error getting connection status:", error);
        return null;
    }
}

// Get users from database
async function getTestUsers(
    count: number,
    userIds?: string[] | null,
    userEmails?: string[] | null
) {
    try {
        if (userEmails && userEmails.length > 0) {
            // Use specified user emails
            const users = await prisma.user.findMany({
                where: {
                    email: { in: userEmails },
                    deactivated_at: null,
                },
                select: {
                    id: true,
                    email: true,
                    account_id: true,
                    role: true,
                },
            });

            if (users.length === 0) {
                throw new Error(
                    `No active users found with emails: ${userEmails.join(", ")}`
                );
            }

            if (users.length < userEmails.length) {
                const foundEmails = users.map((u) => u.email).filter(Boolean);
                const missingEmails = userEmails.filter(
                    (email) => !foundEmails.includes(email)
                );
                console.warn(
                    `⚠️  Warning: Some users not found: ${missingEmails.join(", ")}`
                );
            }

            return users;
        } else if (userIds && userIds.length > 0) {
            // Use specified user IDs
            const users = await prisma.user.findMany({
                where: {
                    id: { in: userIds },
                    deactivated_at: null,
                },
                select: {
                    id: true,
                    email: true,
                    account_id: true,
                    role: true,
                },
                take: count,
            });

            if (users.length === 0) {
                throw new Error(
                    `No active users found with IDs: ${userIds.join(", ")}`
                );
            }

            return users;
        } else {
            // Get random active users
            const users = await prisma.user.findMany({
                where: {
                    deactivated_at: null,
                },
                select: {
                    id: true,
                    email: true,
                    account_id: true,
                    role: true,
                },
                take: count,
            });

            if (users.length === 0) {
                throw new Error("No active users found in database");
            }

            return users.slice(0, count);
        }
    } catch (error: any) {
        throw new Error(`Failed to get test users: ${error.message}`);
    }
}

// Simulate different page visits by making the same database queries those pages would make
type PageType =
    | "dashboard"
    | "customers-list"
    | "customer-details"
    | "control-center"
    | "disputes"
    | "agents";

interface PageSimulation {
    name: string;
    type: PageType;
    simulate: (userId: string, accountId: number | null) => Promise<void>;
}

const pageSimulations: PageSimulation[] = [
    {
        name: "Dashboard",
        type: "dashboard",
        simulate: async (userId: string, accountId: number | null) => {
            // Simulate dashboard page load - get dashboard data
            if (accountId) {
                // Get active customers with collection periods (main dashboard query)
                await prisma.customer.findMany({
                    where: {
                        account_id: accountId,
                        CustomerCollectionPeriod: {
                            some: {
                                period_end_date: null, // Active collection period
                            },
                        },
                    },
                    take: 50,
                    include: {
                        Person: {
                            select: {
                                first_name: true,
                                last_name: true,
                                full_name: true,
                            },
                        },
                        Company: {
                            select: {
                                name: true,
                            },
                        },
                        CustomerCollectionPeriod: {
                            where: {
                                period_end_date: null,
                            },
                            select: {
                                total_outstanding_amount: true,
                                currency: true,
                                current_category: true,
                                no_of_overdue_invoices: true,
                            },
                            take: 1,
                        },
                    },
                });

                // Get overdue amount aggregate
                await prisma.customerCollectionPeriod.aggregate({
                    where: {
                        Customer: {
                            account_id: accountId,
                        },
                        period_end_date: null,
                        total_outstanding_amount: {
                            gt: 0,
                        },
                    },
                    _sum: {
                        total_outstanding_amount: true,
                    },
                    _count: {
                        customer_id: true,
                    },
                });

                // Get overdue invoices count (simplified - just count invoices with due dates in the past)
                await prisma.invoice.count({
                    where: {
                        account_id: accountId,
                        due_date: {
                            lt: new Date(),
                        },
                    },
                });

                // Get collection efforts phase data (simplified)
                await prisma.customerCollectionPeriod.findMany({
                    where: {
                        Customer: {
                            account_id: accountId,
                        },
                        period_end_date: null,
                    },
                    select: {
                        current_category: true,
                        customer_id: true,
                    },
                    take: 100,
                });

                // Get total due amount (simplified - sum all invoices)
                await prisma.invoice.aggregate({
                    where: {
                        account_id: accountId,
                    },
                    _sum: {
                        amount: true,
                        outstanding_debt: true,
                    },
                    _count: {
                        id: true,
                    },
                });
            }
        },
    },
    {
        name: "Customers List",
        type: "customers-list",
        simulate: async (userId: string, accountId: number | null) => {
            // Simulate customers list page - get customers
            if (accountId) {
                await prisma.customer.findMany({
                    where: { account_id: accountId },
                    take: 20,
                    select: {
                        id: true,
                        customer_number: true,
                        email: true,
                        type: true,
                        collection_status: true,
                        customer_uuid: true,
                    },
                });
            }
        },
    },
    {
        name: "Customer Details",
        type: "customer-details",
        simulate: async (userId: string, accountId: number | null) => {
            // Simulate customer details page - get a customer with related data
            if (accountId) {
                const customer = await prisma.customer.findFirst({
                    where: { account_id: accountId },
                    select: { id: true },
                });

                if (customer) {
                    await prisma.invoice.findMany({
                        where: { customer_id: customer.id },
                        take: 10,
                    });
                    await prisma.activity.findMany({
                        where: { customer_id: customer.id },
                        take: 10,
                    });
                }
            }
        },
    },
    {
        name: "Control Center",
        type: "control-center",
        simulate: async (userId: string, accountId: number | null) => {
            // Simulate control center - get system stats
            await prisma.cronJob.findMany({
                take: 10,
                orderBy: { created_at: "desc" },
            });
            await prisma.log.findMany({
                take: 20,
                orderBy: { timestamp: "desc" },
            });
        },
    },
    {
        name: "Disputes",
        type: "disputes",
        simulate: async (userId: string, accountId: number | null) => {
            // Simulate disputes page
            if (accountId) {
                await prisma.customerDispute.findMany({
                    where: {
                        Customer: {
                            account_id: accountId,
                        },
                    },
                    take: 20,
                });
            }
        },
    },
    {
        name: "Agents",
        type: "agents",
        simulate: async (userId: string, accountId: number | null) => {
            // Simulate agents page - get users
            if (accountId) {
                await prisma.user.findMany({
                    where: { account_id: accountId },
                    take: 20,
                });
            }
        },
    },
];

// Simulate a user browsing pages
async function simulateUser(
    user: {
        id: string;
        email: string;
        account_id: number | null;
        role: string | null;
    },
    pagesPerUser: number,
    delayBetweenPages: number,
    stopSignal: { stop: boolean },
    result: UserSimulationResult
): Promise<void> {
    const pages = pageSimulations.slice(0, pagesPerUser);
    const responseTimes: number[] = [];

    while (!stopSignal.stop) {
        for (const page of pages) {
            if (stopSignal.stop) break;

            const startTime = Date.now();
            try {
                await page.simulate(user.id, user.account_id);
                const duration = Date.now() - startTime;
                responseTimes.push(duration);

                result.successfulRequests++;
                result.pagesVisited++;

                // Update average response time
                result.averageResponseTime =
                    responseTimes.reduce((a, b) => a + b, 0) /
                    responseTimes.length;
            } catch (error: any) {
                const duration = Date.now() - startTime;
                responseTimes.push(duration);

                result.failedRequests++;
                result.errors.push({
                    page: page.name,
                    error: error.message || String(error),
                    timestamp: new Date(),
                });

                console.error(
                    `❌ User ${user.email} failed on ${page.name}: ${error.message}`
                );
            }

            // Delay between pages
            if (delayBetweenPages > 0) {
                await new Promise((resolve) =>
                    setTimeout(resolve, delayBetweenPages)
                );
            }
        }
    }
}

// Monitor connection pool during test
async function monitorConnectionPool(
    monitorInterval: number,
    results: Array<{ timestamp: Date; status: ConnectionPoolStatus }>,
    stopSignal: { stop: boolean }
): Promise<void> {
    while (!stopSignal.stop) {
        const status = await getConnectionPoolStatus();
        if (status) {
            results.push({
                timestamp: new Date(),
                status,
            });

            const statusIcon =
                status.usagePercent > 90
                    ? "🔴"
                    : status.usagePercent > 70
                      ? "🟡"
                      : "🟢";

            console.log(
                `${statusIcon} [${new Date().toLocaleTimeString()}] Connections: ${status.total}/${status.maxConnections} (${status.usagePercent.toFixed(1)}%) | Active: ${status.active} | Idle: ${status.idle}`
            );

            if (status.usagePercent > 90) {
                console.log(`⚠️  WARNING: Connection pool usage is above 90%!`);
            }
        }

        await new Promise((resolve) => setTimeout(resolve, monitorInterval));
    }
}

// Print test results
function printResults(config: any, metrics: TestMetrics): void {
    console.log(`\n${"=".repeat(80)}`);
    console.log("📊 CONCURRENT USERS SIMULATION RESULTS");
    console.log("=".repeat(80));
    console.log();

    console.log("⚙️  TEST CONFIGURATION:");
    console.log("─".repeat(80));
    console.log(`  Concurrent Users:    ${config.users}`);
    console.log(`  Test Duration:       ${metrics.testDuration.toFixed(1)}s`);
    console.log(`  Pages per User:      ${config.pagesPerUser}`);
    console.log(`  Delay Between Pages: ${config.delayBetweenPages}ms`);
    console.log("─".repeat(80));
    console.log();

    console.log("📈 OVERALL METRICS:");
    console.log("─".repeat(80));
    console.log(`  Total Page Visits:   ${metrics.totalPageVisits}`);
    console.log(
        `  Successful:           ${metrics.successfulPageVisits} (${((metrics.successfulPageVisits / metrics.totalPageVisits) * 100).toFixed(1)}%)`
    );
    console.log(
        `  Failed:               ${metrics.failedPageVisits} (${((metrics.failedPageVisits / metrics.totalPageVisits) * 100).toFixed(1)}%)`
    );
    console.log(
        `  Avg Response Time:    ${metrics.averageResponseTime.toFixed(2)}ms`
    );
    console.log("─".repeat(80));
    console.log();

    console.log("🔌 CONNECTION POOL METRICS:");
    console.log("─".repeat(80));
    console.log(`  Max Connections:     ${metrics.maxConnectionsUsed}`);
    console.log(
        `  Peak Usage:          ${metrics.maxUsagePercent.toFixed(1)}%`
    );
    console.log(
        `  Pool Exhausted:       ${metrics.connectionPoolExhausted ? "❌ YES" : "✅ NO"}`
    );
    console.log("─".repeat(80));
    console.log();

    console.log("👥 USER RESULTS:");
    console.log("─".repeat(80));
    metrics.userResults.forEach((userResult, index) => {
        const successRate =
            userResult.pagesVisited > 0
                ? (
                      (userResult.successfulRequests /
                          userResult.pagesVisited) *
                      100
                  ).toFixed(1)
                : "0.0";

        console.log(`\n  User ${index + 1}: ${userResult.email}`);
        console.log(`    Account ID:        ${userResult.accountId || "N/A"}`);
        console.log(`    Pages Visited:    ${userResult.pagesVisited}`);
        console.log(
            `    Success Rate:      ${successRate}% (${userResult.successfulRequests}/${userResult.pagesVisited})`
        );
        console.log(
            `    Avg Response:     ${userResult.averageResponseTime.toFixed(2)}ms`
        );
        if (userResult.errors.length > 0) {
            console.log(`    Errors:           ${userResult.errors.length}`);
            userResult.errors.slice(0, 3).forEach((error) => {
                console.log(
                    `      - ${error.page}: ${error.error.substring(0, 50)}...`
                );
            });
        }
    });
    console.log("─".repeat(80));
    console.log();

    // Analysis
    console.log("📋 ANALYSIS:");
    console.log("─".repeat(80));

    if (metrics.connectionPoolExhausted) {
        console.log(
            "❌ CRITICAL: Connection pool was exhausted during the test!"
        );
        console.log(
            "   Recommendation: Increase connection_limit or reduce concurrent users"
        );
    } else if (metrics.maxUsagePercent > 80) {
        console.log("⚠️  WARNING: Connection pool usage exceeded 80%");
        console.log(
            "   Recommendation: Monitor closely and consider increasing connection_limit"
        );
    } else {
        console.log("✅ Connection pool usage is within safe limits");
    }

    const failureRate =
        (metrics.failedPageVisits / metrics.totalPageVisits) * 100;
    if (failureRate > 5) {
        console.log(
            `⚠️  WARNING: High failure rate (${failureRate.toFixed(1)}%)`
        );
    } else if (failureRate > 0) {
        console.log(`✅ Low failure rate (${failureRate.toFixed(1)}%)`);
    } else {
        console.log("✅ No failures detected");
    }

    console.log("─".repeat(80));
    console.log();
}

async function main() {
    const config = parseArgs();

    console.log("🚀 Concurrent Users Simulation Test");
    console.log("=".repeat(80));
    console.log();
    console.log("⚙️  Configuration:");
    console.log(`  Concurrent Users:    ${config.users}`);
    console.log(`  Test Duration:       ${config.duration}s`);
    console.log(`  Pages per User:     ${config.pagesPerUser}`);
    console.log(`  Delay Between Pages: ${config.delayBetweenPages}ms`);
    if (config.userEmails) {
        console.log(`  User Emails:        ${config.userEmails.join(", ")}`);
    } else if (config.userIds) {
        console.log(`  User IDs:           ${config.userIds.join(", ")}`);
    }
    console.log();

    // Get baseline connection status
    console.log("📊 Getting baseline connection status...");
    const baseline = await getConnectionPoolStatus();
    if (baseline) {
        console.log(
            `  Baseline: ${baseline.total}/${baseline.maxConnections} connections (${baseline.usagePercent.toFixed(1)}%)`
        );
    }
    console.log();

    // Get test users
    const expectedUserCount = config.userEmails
        ? config.userEmails.length
        : config.users;
    console.log(`👥 Getting ${expectedUserCount} test users...`);
    const users = await getTestUsers(
        config.users,
        config.userIds,
        config.userEmails
    );
    console.log(
        `  Found ${users.length} users: ${users.map((u) => u.email).join(", ")}`
    );
    console.log();

    const startTime = Date.now();
    const stopSignal = { stop: false };
    const userResults: UserSimulationResult[] = users.map((user) => ({
        userId: user.id,
        email: user.email || "unknown",
        accountId: user.account_id,
        pagesVisited: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        errors: [],
    }));

    const monitoringResults: Array<{
        timestamp: Date;
        status: ConnectionPoolStatus;
    }> = [];

    // Start monitoring
    const monitorPromise = monitorConnectionPool(
        config.monitorInterval,
        monitoringResults,
        stopSignal
    );

    // Start user simulations
    console.log(`🚀 Starting ${users.length} concurrent user simulations...`);
    console.log();

    const userPromises = users.map((user, index) =>
        simulateUser(
            {
                id: user.id,
                email: user.email || "unknown",
                account_id: user.account_id,
                role: user.role,
            },
            config.pagesPerUser,
            config.delayBetweenPages,
            stopSignal,
            userResults[index]
        )
    );

    // Set timeout to stop test
    const timeoutId = setTimeout(() => {
        stopSignal.stop = true;
    }, config.duration * 1000);

    try {
        // Wait for all users to complete or timeout
        await Promise.all(userPromises);
    } catch (error) {
        console.error("Error during user simulation:", error);
    } finally {
        clearTimeout(timeoutId);
        stopSignal.stop = true;
    }

    // Wait for monitor to finish
    await monitorPromise;

    const testDuration = (Date.now() - startTime) / 1000;

    // Calculate metrics
    const totalPageVisits = userResults.reduce(
        (sum, r) => sum + r.pagesVisited,
        0
    );
    const successfulPageVisits = userResults.reduce(
        (sum, r) => sum + r.successfulRequests,
        0
    );
    const failedPageVisits = userResults.reduce(
        (sum, r) => sum + r.failedRequests,
        0
    );

    const allResponseTimes = userResults.flatMap((r) => {
        // Estimate response times from average
        return Array(r.successfulRequests).fill(r.averageResponseTime);
    });
    const averageResponseTime =
        allResponseTimes.length > 0
            ? allResponseTimes.reduce((a, b) => a + b, 0) /
              allResponseTimes.length
            : 0;

    const maxConnectionsUsed = Math.max(
        ...monitoringResults.map((r) => r.status.total)
    );
    const maxUsagePercent = Math.max(
        ...monitoringResults.map((r) => r.status.usagePercent)
    );

    const metrics: TestMetrics = {
        totalUsers: users.length,
        testDuration,
        totalPageVisits,
        successfulPageVisits,
        failedPageVisits,
        maxConnectionsUsed,
        maxUsagePercent,
        averageResponseTime,
        connectionPoolExhausted: maxUsagePercent >= 95,
        userResults,
    };

    // Print results
    printResults(config, metrics);

    // Get final connection status
    console.log("📊 Final connection status:");
    const final = await getConnectionPoolStatus();
    if (final) {
        console.log(
            `  Final: ${final.total}/${final.maxConnections} connections (${final.usagePercent.toFixed(1)}%)`
        );
        if (baseline) {
            const diff = final.total - baseline.total;
            console.log(
                `  Change: ${diff > 0 ? "+" : ""}${diff} connections from baseline`
            );
        }
    }
    console.log();

    console.log("✅ Concurrent users simulation completed!");
}

// Handle Ctrl+C gracefully
process.on("SIGINT", async () => {
    console.log("\n\n⚠️  Test interrupted by user");
    await prisma.$disconnect();
    process.exit(0);
});

// Run the test
main()
    .then(async () => {
        await prisma.$disconnect();
        process.exit(0);
    })
    .catch(async (error) => {
        console.error("Fatal error:", error);
        await prisma.$disconnect();
        process.exit(1);
    });
