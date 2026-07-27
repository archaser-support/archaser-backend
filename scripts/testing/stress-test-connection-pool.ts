#!/usr/bin/env tsx

/**
 * Connection Pool Stress Test
 *
 * This script stress tests the database connection pool by:
 * 1. Simulating concurrent database operations
 * 2. Monitoring connection pool usage in real-time
 * 3. Testing different load scenarios
 * 4. Detecting connection pool exhaustion and timeouts
 * 5. (NEW) Running import jobs with multiple users
 *
 * Usage:
 *   npx tsx scripts/testing/stress-test-connection-pool.ts [options]
 *
 * Options (Original Mode):
 *   --concurrent <number>    Number of concurrent operations (default: 50)
 *   --duration <seconds>      Test duration in seconds (default: 60)
 *   --operations <number>     Total number of operations to perform (default: 1000)
 *   --delay <ms>              Delay between operations in ms (default: 100)
 *   --scenario <name>         Test scenario: light, medium, heavy, burst (default: medium)
 *   --monitor-interval <ms>   Monitoring interval in ms (default: 1000)
 *
 * Options (Import Jobs Mode):
 *   --mode <mode>            Test mode: standard (default) or import-jobs
 *   --user-count <number>    Number of users/accounts to create (default: 10)
 *   --import-ratio <0-1>     Ratio of users running imports (default: 0.2)
 *   --records-per-file <n>   Records per import file (default: 500)
 *   --run-activity-workflow  Run activityWorkflowManager in background
 *   --config <path>          Path to import config JSON file
 *   --run-id <id>            Optional run ID (auto-generated if not provided)
 *   --skip-cleanup           Skip cleanup after test (for debugging)
 *   --max-concurrency <n>   Max concurrent operations for setup/cleanup (default: 5)
 *
 * Examples:
 *   # Original mode: Light load test
 *   npx tsx scripts/testing/stress-test-connection-pool.ts --scenario light
 *
 *   # Import jobs mode: 10 users, 20% running imports
 *   npx tsx scripts/testing/stress-test-connection-pool.ts --mode import-jobs --user-count 10 --import-ratio 0.2
 *
 *   # Import jobs mode with activity workflow manager
 *   npx tsx scripts/testing/stress-test-connection-pool.ts --mode import-jobs --user-count 10 --run-activity-workflow
 */

import { prisma } from "../../frontend/lib/prisma";
import {
    setupTestAccounts,
    generateRunId,
    TestUser,
} from "./setup-test-accounts";
import { authenticateUsers, AuthSession } from "./auth-helper";
import {
    generateImportFiles,
    ImportFileDescriptor,
} from "./generate-import-files";
import { DbOpsWorkload } from "./workloads/DbOpsWorkload";
import { RealisticWorkload } from "./workloads/RealisticWorkload";
import { UserWorkload } from "./workloads/index";
import {
    startActivityWorkflowManager,
    stopActivityWorkflowManager,
    WorkflowManagerProcess,
} from "./run-activity-workflow-manager";
import { cleanupTestData } from "./cleanup-import-data";

interface ConnectionPoolStatus {
    total: number;
    active: number;
    idle: number;
    idleInTransaction: number;
    maxConnections: number;
    usagePercent: number;
    available: number;
    waitTime?: number; // Connection acquisition wait time in ms
    waitCount?: number; // Number of connections waiting
}

interface TestResult {
    timestamp: Date;
    status: ConnectionPoolStatus;
    operationsCompleted: number;
    operationsFailed: number;
    averageResponseTime: number;
    errors: Array<{ time: Date; error: string }>;
}

interface StressTestConfig {
    // Original mode options
    concurrent: number;
    duration: number;
    operations: number;
    delay: number;
    scenario: "light" | "medium" | "heavy" | "burst";
    monitorInterval: number;

    // Import jobs mode options
    mode: "standard" | "import-jobs";
    userCount: number;
    importRatio: number;
    recordsPerFile: number;
    runActivityWorkflow: boolean;
    configPath?: string;
    runId?: string;
    skipCleanup: boolean;
    maxConcurrency: number;
    parallelOps?: number; // Number of parallel operations per user
    useExistingAccounts?: boolean; // Use existing accounts instead of creating new ones
}

interface TestMetrics {
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    timeoutErrors: number;
    poolExhaustionErrors: number;
    otherErrors: number;
    maxConnectionsUsed: number;
    maxUsagePercent: number;
    averageResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    connectionPoolExhausted: boolean;
    testDuration: number;
}

// Parse command line arguments
function parseArgs(): StressTestConfig {
    const args = process.argv.slice(2);
    const config: StressTestConfig = {
        // Original mode defaults
        concurrent: 50,
        duration: 60,
        operations: 1000,
        delay: 25, // Reduced from 100ms to 25ms for better throughput
        scenario: "medium",
        monitorInterval: 1000,

        // Import jobs mode defaults
        mode: "standard",
        userCount: 10,
        importRatio: 0.2,
        recordsPerFile: 500,
        runActivityWorkflow: false,
        skipCleanup: false,
        maxConcurrency: 2, // Reduced from 5 to 2 for production safety
        parallelOps: 1, // Default: 1 operation at a time per user
        useExistingAccounts: false, // Default: create new accounts
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        const next = args[i + 1];

        switch (arg) {
            // Original mode options
            case "--concurrent":
                if (next) config.concurrent = parseInt(next, 10);
                break;
            case "--duration":
                if (next) config.duration = parseInt(next, 10);
                break;
            case "--operations":
                if (next) config.operations = parseInt(next, 10);
                break;
            case "--delay":
                if (next) config.delay = parseInt(next, 10);
                break;
            case "--scenario":
                if (
                    next &&
                    ["light", "medium", "heavy", "burst"].includes(next)
                ) {
                    config.scenario = next as any;
                }
                break;
            case "--monitor-interval":
                if (next) config.monitorInterval = parseInt(next, 10);
                break;

            // Import jobs mode options
            case "--mode":
                if (next && ["standard", "import-jobs"].includes(next)) {
                    config.mode = next as "standard" | "import-jobs";
                }
                break;
            case "--user-count":
                if (next) config.userCount = parseInt(next, 10);
                break;
            case "--import-ratio":
                if (next) config.importRatio = parseFloat(next);
                break;
            case "--records-per-file":
                if (next) config.recordsPerFile = parseInt(next, 10);
                break;
            case "--run-activity-workflow":
                config.runActivityWorkflow = true;
                break;
            case "--config":
                if (next) config.configPath = next;
                break;
            case "--run-id":
                if (next) config.runId = next;
                break;
            case "--skip-cleanup":
                config.skipCleanup = true;
                break;
            case "--max-concurrency":
                if (next) config.maxConcurrency = parseInt(next, 10);
                break;
            case "--parallel-ops":
                if (next) config.parallelOps = parseInt(next, 10);
                break;
            case "--use-existing-accounts":
                config.useExistingAccounts = true;
                break;
        }
    }

    // Apply scenario presets (only if not explicitly set)
    if (!args.includes("--delay")) {
        switch (config.scenario) {
            case "light":
                config.concurrent = 10;
                config.duration = 30;
                config.operations = 500;
                config.delay = 50; // Updated from 200ms
                break;
            case "medium":
                config.concurrent = 50;
                config.duration = 60;
                config.operations = 1000;
                config.delay = 25; // Updated from 100ms
                break;
            case "heavy":
                config.concurrent = 100;
                config.duration = 120;
                config.operations = 2000;
                config.delay = 10; // Updated from 50ms
                break;
            case "burst":
                config.concurrent = 200;
                config.duration = 20;
                config.operations = 1000;
                config.delay = 5; // Updated from 10ms
                break;
        }
    } else {
        // Apply other scenario presets even if delay is set
        switch (config.scenario) {
            case "light":
                if (!args.includes("--concurrent")) config.concurrent = 10;
                if (!args.includes("--duration")) config.duration = 30;
                if (!args.includes("--operations")) config.operations = 500;
                break;
            case "medium":
                if (!args.includes("--concurrent")) config.concurrent = 50;
                if (!args.includes("--duration")) config.duration = 60;
                if (!args.includes("--operations")) config.operations = 1000;
                break;
            case "heavy":
                if (!args.includes("--concurrent")) config.concurrent = 100;
                if (!args.includes("--duration")) config.duration = 120;
                if (!args.includes("--operations")) config.operations = 2000;
                break;
            case "burst":
                if (!args.includes("--concurrent")) config.concurrent = 200;
                if (!args.includes("--duration")) config.duration = 20;
                if (!args.includes("--operations")) config.operations = 1000;
                break;
        }
    }

    return config;
}

async function getConnectionPoolStatus(): Promise<ConnectionPoolStatus | null> {
    try {
        const startTime = Date.now();

        const summary = await prisma.$queryRaw<
            Array<{
                total: number;
                active: number;
                idle: number;
                idleInTransaction: number;
                maxConnections: number;
                waitCount: number;
            }>
        >`
            SELECT 
                count(*)::int as total,
                count(*) FILTER (WHERE state = 'active')::int as active,
                count(*) FILTER (WHERE state = 'idle')::int as idle,
                count(*) FILTER (WHERE state = 'idle in transaction')::int as "idleInTransaction",
                (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as "maxConnections",
                count(*) FILTER (WHERE wait_event_type = 'Lock')::int as "waitCount"
            FROM pg_stat_activity
            WHERE datname = current_database();
        `;

        const queryTime = Date.now() - startTime;

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
            waitTime: queryTime, // Time to acquire connection for this query
            waitCount: stats.waitCount || 0,
        };
    } catch (error) {
        console.error("Error getting connection status:", error);
        return null;
    }
}

// Simulate different types of database operations
async function simulateDatabaseOperation(
    operationType: "read" | "write" | "complex"
): Promise<{ success: boolean; duration: number; error?: string }> {
    const startTime = Date.now();

    try {
        switch (operationType) {
            case "read":
                // Simple read operation
                await prisma.$queryRaw`SELECT 1`;
                break;
            case "write":
                // Simple write operation (using a safe query that won't modify data)
                await prisma.$queryRaw`SELECT NOW()`;
                break;
            case "complex":
                // More complex operation with joins
                await prisma.$queryRaw`
                    SELECT 
                        count(*)::int as total
                    FROM pg_stat_activity
                    WHERE datname = current_database()
                `;
                break;
        }

        const duration = Date.now() - startTime;
        return { success: true, duration };
    } catch (error: any) {
        const duration = Date.now() - startTime;
        const errorMessage = error.message || String(error);

        // Categorize errors
        if (
            errorMessage.includes("timeout") ||
            errorMessage.includes("pool") ||
            errorMessage.includes("connection")
        ) {
            return {
                success: false,
                duration,
                error: "connection_pool",
            };
        }

        return {
            success: false,
            duration,
            error: `other: ${errorMessage}`,
        };
    }
}

// Worker function that performs operations
async function worker(
    workerId: number,
    config: StressTestConfig,
    results: {
        operations: number;
        successes: number;
        failures: number;
        responseTimes: number[];
        errors: Array<{ time: Date; error: string; workerId: number }>;
    },
    stopSignal: { stop: boolean }
): Promise<void> {
    const operationTypes: Array<"read" | "write" | "complex"> = [
        "read",
        "write",
        "complex",
    ];

    while (!stopSignal.stop && results.operations < config.operations) {
        const operationType =
            operationTypes[Math.floor(Math.random() * operationTypes.length)];

        const result = await simulateDatabaseOperation(operationType);

        results.operations++;
        results.responseTimes.push(result.duration);

        if (result.success) {
            results.successes++;
        } else {
            results.failures++;
            results.errors.push({
                time: new Date(),
                error: result.error || "unknown",
                workerId,
            });
        }

        // Delay between operations
        if (config.delay > 0) {
            await new Promise((resolve) => setTimeout(resolve, config.delay));
        }
    }
}

// Monitor connection pool during test
async function monitorConnectionPool(
    config: StressTestConfig,
    results: TestResult[],
    stopSignal: { stop: boolean },
    metrics: {
        operationsCompleted: number;
        operationsFailed: number;
        averageResponseTime: number;
    }
): Promise<void> {
    while (!stopSignal.stop) {
        const status = await getConnectionPoolStatus();
        if (status) {
            const result: TestResult = {
                timestamp: new Date(),
                status,
                operationsCompleted: metrics.operationsCompleted,
                operationsFailed: metrics.operationsFailed,
                averageResponseTime: metrics.averageResponseTime,
                errors: [],
            };
            results.push(result);

            // Print status update
            const statusIcon =
                status.usagePercent > 90
                    ? "🔴"
                    : status.usagePercent > 70
                        ? "🟡"
                        : "🟢";

            const waitInfo =
                status.waitTime !== undefined
                    ? ` | Wait: ${status.waitTime}ms`
                    : "";
            const waitCountInfo =
                status.waitCount !== undefined && status.waitCount > 0
                    ? ` | Waiting: ${status.waitCount}`
                    : "";

            console.log(
                `${statusIcon} [${new Date().toLocaleTimeString()}] Connections: ${status.total}/${status.maxConnections} (${status.usagePercent.toFixed(1)}%) | Active: ${status.active} | Idle: ${status.idle}${waitInfo}${waitCountInfo} | Ops: ${metrics.operationsCompleted} | Failed: ${metrics.operationsFailed}`
            );

            // Warn if approaching limits
            if (status.usagePercent > 90) {
                console.log(`⚠️  WARNING: Connection pool usage is above 90%!`);
            }
            if (status.available < 5) {
                console.log(
                    `⚠️  WARNING: Only ${status.available} connections available!`
                );
            }
        }

        await new Promise((resolve) =>
            setTimeout(resolve, config.monitorInterval)
        );
    }
}

// Calculate test metrics
function calculateMetrics(
    results: TestResult[],
    workerResults: {
        operations: number;
        successes: number;
        failures: number;
        responseTimes: number[];
        errors: Array<{ time: Date; error: string; workerId: number }>;
    },
    testDuration: number
): TestMetrics {
    const responseTimes = workerResults.responseTimes.sort((a, b) => a - b);
    const totalOperations = workerResults.operations;
    const successfulOperations = workerResults.successes;
    const failedOperations = workerResults.failures;

    const timeoutErrors = workerResults.errors.filter(
        (e) => e.error === "connection_pool"
    ).length;
    const poolExhaustionErrors = timeoutErrors;
    const otherErrors = failedOperations - poolExhaustionErrors;

    const maxConnectionsUsed = Math.max(...results.map((r) => r.status.total));
    const maxUsagePercent = Math.max(
        ...results.map((r) => r.status.usagePercent)
    );

    const averageResponseTime =
        responseTimes.length > 0
            ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
            : 0;

    const p95Index = Math.floor(responseTimes.length * 0.95);
    const p99Index = Math.floor(responseTimes.length * 0.99);
    const p95ResponseTime =
        responseTimes.length > 0 ? responseTimes[p95Index] || 0 : 0;
    const p99ResponseTime =
        responseTimes.length > 0 ? responseTimes[p99Index] || 0 : 0;

    const connectionPoolExhausted = maxUsagePercent >= 95;

    return {
        totalOperations,
        successfulOperations,
        failedOperations,
        timeoutErrors,
        poolExhaustionErrors,
        otherErrors,
        maxConnectionsUsed,
        maxUsagePercent,
        averageResponseTime,
        p95ResponseTime,
        p99ResponseTime,
        connectionPoolExhausted,
        testDuration,
    };
}

// Print test results
function printResults(config: StressTestConfig, metrics: TestMetrics): void {
    console.log(`\n${"=".repeat(80)}`);
    console.log("📊 STRESS TEST RESULTS");
    console.log("=".repeat(80));
    console.log();

    console.log("⚙️  TEST CONFIGURATION:");
    console.log("─".repeat(80));
    console.log(`  Scenario:           ${config.scenario}`);
    console.log(`  Concurrent Workers:  ${config.concurrent}`);
    console.log(`  Test Duration:       ${metrics.testDuration.toFixed(1)}s`);
    console.log(`  Total Operations:    ${metrics.totalOperations}`);
    console.log("─".repeat(80));
    console.log();

    console.log("📈 OPERATION METRICS:");
    console.log("─".repeat(80));
    console.log(
        `  Successful:          ${metrics.successfulOperations} (${((metrics.successfulOperations / metrics.totalOperations) * 100).toFixed(1)}%)`
    );
    console.log(
        `  Failed:              ${metrics.failedOperations} (${((metrics.failedOperations / metrics.totalOperations) * 100).toFixed(1)}%)`
    );
    console.log(`  Timeout Errors:      ${metrics.timeoutErrors}`);
    console.log(`  Pool Exhaustion:     ${metrics.poolExhaustionErrors}`);
    console.log(`  Other Errors:        ${metrics.otherErrors}`);
    console.log("─".repeat(80));
    console.log();

    console.log("⏱️  PERFORMANCE METRICS:");
    console.log("─".repeat(80));
    console.log(
        `  Avg Response Time:   ${metrics.averageResponseTime.toFixed(2)}ms`
    );
    console.log(
        `  P95 Response Time:   ${metrics.p95ResponseTime.toFixed(2)}ms`
    );
    console.log(
        `  P99 Response Time:   ${metrics.p99ResponseTime.toFixed(2)}ms`
    );
    console.log(
        `  Ops/Second:         ${(metrics.totalOperations / metrics.testDuration).toFixed(1)}`
    );
    console.log("─".repeat(80));
    console.log();

    console.log("🔌 CONNECTION POOL METRICS:");
    console.log("─".repeat(80));
    console.log(`  Max Connections:    ${metrics.maxConnectionsUsed}`);
    console.log(
        `  Peak Usage:          ${metrics.maxUsagePercent.toFixed(1)}%`
    );
    console.log(
        `  Pool Exhausted:      ${metrics.connectionPoolExhausted ? "❌ YES" : "✅ NO"}`
    );
    console.log("─".repeat(80));
    console.log();

    // Analysis and recommendations
    console.log("📋 ANALYSIS:");
    console.log("─".repeat(80));

    if (metrics.connectionPoolExhausted) {
        console.log(
            "❌ CRITICAL: Connection pool was exhausted during the test!"
        );
        console.log(
            "   Recommendation: Increase connection_limit or reduce concurrent operations"
        );
    } else if (metrics.maxUsagePercent > 80) {
        console.log("⚠️  WARNING: Connection pool usage exceeded 80%");
        console.log(
            "   Recommendation: Monitor closely and consider increasing connection_limit"
        );
    } else {
        console.log("✅ Connection pool usage is within safe limits");
    }

    if (metrics.timeoutErrors > 0) {
        console.log(
            `⚠️  WARNING: ${metrics.timeoutErrors} timeout errors occurred`
        );
        console.log(
            "   Recommendation: Increase pool_timeout or connection_limit"
        );
    }

    const failureRate =
        (metrics.failedOperations / metrics.totalOperations) * 100;
    if (failureRate > 5) {
        console.log(
            `⚠️  WARNING: High failure rate (${failureRate.toFixed(1)}%)`
        );
    } else if (failureRate > 0) {
        console.log(`✅ Low failure rate (${failureRate.toFixed(1)}%)`);
    } else {
        console.log("✅ No failures detected");
    }

    if (metrics.averageResponseTime > 1000) {
        console.log(
            `⚠️  WARNING: High average response time (${metrics.averageResponseTime.toFixed(0)}ms)`
        );
        console.log(
            "   Recommendation: Check database performance and query optimization"
        );
    } else {
        console.log(
            `✅ Response times are acceptable (avg: ${metrics.averageResponseTime.toFixed(0)}ms)`
        );
    }

    console.log("─".repeat(80));
    console.log();
}

/**
 * Run import jobs mode stress test
 */
async function runImportJobsMode(config: StressTestConfig): Promise<void> {
    const runId = config.runId || generateRunId();
    let workflowProcess: WorkflowManagerProcess | null = null;
    const workloads: UserWorkload[] = [];

    try {
        console.log(`[${runId}] Starting import jobs mode stress test`);
        console.log(`[${runId}] Configuration:`);
        console.log(`  User Count:        ${config.userCount}`);
        console.log(`  Import Ratio:      ${config.importRatio * 100}%`);
        console.log(`  Records per File:  ${config.recordsPerFile}`);
        console.log(`  Duration:          ${config.duration}s`);
        console.log(`  Run Activity Workflow: ${config.runActivityWorkflow}`);
        console.log();

        // Step 1: Setup accounts and users
        if (config.useExistingAccounts) {
            console.log(
                `[${runId}] Step 1: Using existing accounts (${config.userCount} users)...`
            );
        } else {
            console.log(
                `[${runId}] Step 1: Creating ${config.userCount} test accounts and users...`
            );
        }
        const setupResult = await setupTestAccounts(
            config.userCount,
            runId,
            config.maxConcurrency
        );
        console.log(`[${runId}] Setup ${setupResult.users.length} users\n`);

        // Step 2: Authenticate all users
        console.log(`[${runId}] Step 2: Authenticating users...`);

        // Validate users were actually created
        const validUsers = setupResult.users.filter((u) => {
            const isValid = u.email && u.password && u.userId;
            if (!isValid) {
                console.warn(
                    `[${runId}] Skipping invalid user: email=${!!u.email}, password=${!!u.password}, userId=${!!u.userId}`
                );
            }
            return isValid;
        });

        if (validUsers.length === 0) {
            throw new Error(
                `No valid users to authenticate. Created ${setupResult.users.length} users but none have valid credentials. ` +
                `This usually means user creation failed due to database connection issues.`
            );
        }

        if (validUsers.length < setupResult.users.length) {
            console.warn(
                `[${runId}] ⚠️  Only ${validUsers.length}/${setupResult.users.length} users are valid. ` +
                `Some users may have failed to create.`
            );
        }

        console.log(
            `[${runId}] Starting authentication for ${validUsers.length} valid users...`
        );
        const authStartTime = Date.now();
        const authSessions = await authenticateUsers(
            validUsers.map((u) => ({
                email: u.email!,
                password: u.password!,
                userId: u.userId!,
            })),
            runId,
            config.maxConcurrency
        );
        const authDuration = Date.now() - authStartTime;
        console.log(
            `[${runId}] ✅ Authentication completed in ${authDuration}ms`
        );
        console.log(`[${runId}] Authenticated ${authSessions.size} users\n`);

        // Step 3: Generate import files for import users
        const importUserCount = Math.ceil(
            config.userCount * config.importRatio
        );
        const importUsers = setupResult.users.slice(0, importUserCount);
        const dbOpsUsers = setupResult.users.slice(importUserCount);

        console.log(
            `[${runId}] Step 3: Generating import files for ${importUsers.length} users...`
        );
        console.log(
            `[${runId}] Import users: ${importUsers.length}, DB ops users: ${dbOpsUsers.length}`
        );
        const fileGenStartTime = Date.now();
        const fileDescriptorsMap = new Map<string, ImportFileDescriptor[]>();

        // Generate all files in parallel
        console.log(`[${runId}] Starting parallel file generation...`);
        const fileGenerationPromises = importUsers.map(async (user, index) => {
            console.log(
                `[${runId}] Generating files for user ${index + 1}/${importUsers.length} (${user.userId})...`
            );
            const userFileStart = Date.now();
            try {
                const descriptors = await generateImportFiles(
                    runId,
                    user.userId,
                    setupResult.users.indexOf(user),
                    config.recordsPerFile
                );
                const userFileDuration = Date.now() - userFileStart;
                console.log(
                    `[${runId}] ✅ Generated ${descriptors.length} files for user ${user.userId} in ${userFileDuration}ms`
                );
                return { userId: user.userId, descriptors };
            } catch (error: any) {
                console.error(
                    `[${runId}] ❌ Failed to generate files for user ${user.userId}:`,
                    error.message
                );
                throw error;
            }
        });

        const fileResults = await Promise.all(fileGenerationPromises);
        for (const { userId, descriptors } of fileResults) {
            fileDescriptorsMap.set(userId, descriptors);
        }
        const fileGenDuration = Date.now() - fileGenStartTime;
        console.log(
            `[${runId}] ✅ Generated all import files in ${fileGenDuration}ms\n`
        );

        // Step 4: Start activity workflow manager if requested
        if (config.runActivityWorkflow) {
            console.log(
                `[${runId}] Step 4: Starting activity workflow manager...`
            );
            const workflowStartTime = Date.now();
            workflowProcess = await startActivityWorkflowManager(runId);
            const workflowDuration = Date.now() - workflowStartTime;
            console.log(
                `[${runId}] ✅ Activity workflow manager started in ${workflowDuration}ms\n`
            );
        }

        // Step 5: Start workloads
        console.log(`[${runId}] Step 5: Starting workloads...`);
        console.log(
            `[${runId}] Starting ${importUsers.length} import workloads and ${dbOpsUsers.length} DB ops workloads...`
        );
        const stopSignal = { stop: false };

        // Handle SIGINT to print results on Ctrl+C
        process.once("SIGINT", () => {
            console.log(`\n[${runId}] ⚠️  Caught SIGINT, stopping workloads and printing results...`);
            stopSignal.stop = true;
        });

        const startTime = Date.now();
        console.log(
            `[${runId}] Test start time: ${new Date(startTime).toISOString()}`
        );

        // Start import workloads (using RealisticWorkload as replacement)
        console.log(
            `[${runId}] Initializing ${importUsers.length} import workloads...`
        );
        const importWorkloads: RealisticWorkload[] = [];
        const importWorkloadPromises = importUsers.map((user, index) => {
            console.log(
                `[${runId}] Setting up import workload ${index + 1}/${importUsers.length} for user ${user.userId}...`
            );
            const session = authSessions.get(user.userId);
            if (!session) {
                throw new Error(`Session not found for user ${user.userId}`);
            }
            const descriptors = fileDescriptorsMap.get(user.userId) || [];
            console.log(
                `[${runId}] User ${user.userId} has ${descriptors.length} file descriptors`
            );
            // Note: ImportWorkload was removed, using RealisticWorkload as replacement
            const workload = new RealisticWorkload(session, user.accountId, {
                duration: config.duration,
            });
            importWorkloads.push(workload);
            workloads.push(workload);
            console.log(
                `[${runId}] Starting import workload for user ${user.userId}...`
            );
            return workload
                .start(stopSignal)
                .then(() => {
                    console.log(
                        `[${runId}] ✅ Import workload completed for user ${user.userId}`
                    );
                })
                .catch((error: any) => {
                    console.error(
                        `[${runId}] ❌ Import workload failed for user ${user.userId}:`,
                        error.message
                    );
                    throw error;
                });
        });
        console.log(`[${runId}] All import workloads started`);

        // Start DB ops workloads (mix of DbOps and Realistic workloads)
        console.log(
            `[${runId}] Initializing ${dbOpsUsers.length} DB ops workloads...`
        );
        const dbOpsWorkloads: (DbOpsWorkload | RealisticWorkload)[] = [];
        const dbOpsWorkloadPromises = dbOpsUsers.map((user, index) => {
            console.log(
                `[${runId}] Setting up DB ops workload ${index + 1}/${dbOpsUsers.length} for user ${user.userId}...`
            );
            const session = authSessions.get(user.userId);
            if (!session) {
                throw new Error(`Session not found for user ${user.userId}`);
            }

            // Alternate between DbOps and Realistic workloads for variety
            const useRealistic = index % 2 === 0;
            const workloadType = useRealistic ? "Realistic" : "DbOps";
            console.log(
                `[${runId}] User ${user.userId} will use ${workloadType} workload`
            );

            let workload: DbOpsWorkload | RealisticWorkload;
            if (useRealistic) {
                workload = new RealisticWorkload(session, user.accountId, {
                    duration: config.duration,
                    maxOperations: config.operations,
                    delay: config.delay,
                    parallelOps: (config as any).parallelOps || 1,
                });
            } else {
                workload = new DbOpsWorkload(user.accountId, {
                    duration: config.duration,
                    maxOperations: config.operations,
                    delay: config.delay,
                    parallelOps: (config as any).parallelOps || 1,
                });
            }

            dbOpsWorkloads.push(workload);
            workloads.push(workload);
            console.log(
                `[${runId}] Starting ${workloadType} workload for user ${user.userId}...`
            );
            return workload
                .start(stopSignal)
                .then(() => {
                    console.log(
                        `[${runId}] ✅ ${workloadType} workload completed for user ${user.userId}`
                    );
                })
                .catch((error) => {
                    console.error(
                        `[${runId}] ❌ ${workloadType} workload failed for user ${user.userId}:`,
                        error.message
                    );
                    throw error;
                });
        });
        console.log(`[${runId}] All DB ops workloads started`);

        // Start monitoring
        console.log(`[${runId}] Starting connection pool monitoring...`);
        const testResults: TestResult[] = [];
        const monitorPromise = monitorConnectionPool(
            config,
            testResults,
            stopSignal,
            {
                get operationsCompleted() {
                    return workloads.reduce(
                        (sum, w) => sum + w.getMetrics().operationsCompleted,
                        0
                    );
                },
                get operationsFailed() {
                    return workloads.reduce(
                        (sum, w) => sum + w.getMetrics().operationsFailed,
                        0
                    );
                },
                get averageResponseTime() {
                    const allResponseTimes = workloads.flatMap(
                        (w) => w.getMetrics().responseTimes
                    );
                    if (allResponseTimes.length === 0) return 0;
                    return (
                        allResponseTimes.reduce((a, b) => a + b, 0) /
                        allResponseTimes.length
                    );
                },
            }
        );
        console.log(`[${runId}] ✅ Monitoring started`);

        // Set timeout
        console.log(`[${runId}] Test will run for ${config.duration} seconds`);
        const timeoutId = setTimeout(() => {
            console.log(
                `[${runId}] ⏰ Test duration timeout reached, stopping workloads...`
            );
            stopSignal.stop = true;
        }, config.duration * 1000);

        // Wait for all workloads
        console.log(`[${runId}] Waiting for all workloads to complete...`);
        const workloadStartTime = Date.now();
        try {
            await Promise.all([
                ...importWorkloadPromises,
                ...dbOpsWorkloadPromises,
            ]);
            const workloadDuration = Date.now() - workloadStartTime;
            console.log(
                `[${runId}] ✅ All workloads completed in ${workloadDuration}ms`
            );
        } catch (error: any) {
            console.error(`[${runId}] ❌ Workload error:`, error.message);
            throw error;
        }
        clearTimeout(timeoutId);
        stopSignal.stop = true;
        console.log(
            `[${runId}] Stop signal set, waiting for monitor to finish...`
        );

        // Wait for monitor
        await monitorPromise;
        console.log(`[${runId}] ✅ Monitoring completed`);

        const testDuration = (Date.now() - startTime) / 1000;

        // Aggregate metrics
        const allMetrics = workloads.map((w) => w.getMetrics());
        const totalOperations = allMetrics.reduce(
            (sum, m) => sum + m.operationsCompleted + m.operationsFailed,
            0
        );
        const successfulOperations = allMetrics.reduce(
            (sum, m) => sum + m.operationsCompleted,
            0
        );
        const failedOperations = allMetrics.reduce(
            (sum, m) => sum + m.operationsFailed,
            0
        );
        const totalRecordsProcessed = allMetrics.reduce(
            (sum, m) => sum + (m.recordsProcessed || 0),
            0
        );
        const allResponseTimes = allMetrics.flatMap((m) => m.responseTimes);

        // Calculate connection pool wait times
        const waitTimes = testResults
            .map((r) => r.status.waitTime)
            .filter((w): w is number => w !== undefined);
        const avgWaitTime =
            waitTimes.length > 0
                ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
                : 0;
        const maxWaitTime = waitTimes.length > 0 ? Math.max(...waitTimes) : 0;

        // Calculate connection pool metrics
        const maxConnectionsUsed = Math.max(
            ...testResults.map((r) => r.status.total)
        );
        const maxUsagePercent = Math.max(
            ...testResults.map((r) => r.status.usagePercent)
        );

        // Print results
        console.log(`\n[${runId}] 📊 STRESS TEST RESULTS`);
        console.log("=".repeat(80));
        console.log(`  Test Duration:       ${testDuration.toFixed(1)}s`);
        console.log(`  Total Operations:    ${totalOperations}`);
        console.log(`  Successful:          ${successfulOperations}`);
        console.log(`  Failed:              ${failedOperations}`);
        if (totalRecordsProcessed > 0) {
            console.log(`  Records Processed:   ${totalRecordsProcessed}`);
        }
        console.log(`  Max Connections:     ${maxConnectionsUsed}`);
        console.log(`  Peak Usage:          ${maxUsagePercent.toFixed(1)}%`);
        if (avgWaitTime > 0) {
            console.log(`  Avg Wait Time:       ${avgWaitTime.toFixed(1)}ms`);
            console.log(`  Max Wait Time:       ${maxWaitTime.toFixed(1)}ms`);
        }
        console.log("=".repeat(80));

        // ERROR ANALYSIS
        console.log("\n🚨 TOP ERRORS:");
        console.log("-".repeat(80));

        // Group and count errors from all workloads
        const allErrors = allMetrics.flatMap((m) => m.errors);
        const errorCounts = allErrors.reduce((acc, curr) => {
            const msg = curr.error.substring(0, 100); // Limit length
            acc[msg] = (acc[msg] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const sortedErrors = Object.entries(errorCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 5);

        if (sortedErrors.length > 0) {
            sortedErrors.forEach(([message, count]) => {
                console.log(`  [${count}x] ${message}`);
            });
        } else {
            console.log("  (No errors detected)");
        }
        console.log("=".repeat(80));

        // Step 6: Cleanup
        if (!config.skipCleanup) {
            console.log(`\n[${runId}] Step 6: Cleaning up test data...`);
            if (workflowProcess) {
                await stopActivityWorkflowManager(workflowProcess, runId);
            }
            await cleanupTestData(runId, config.maxConcurrency);
        } else {
            console.log(
                `\n[${runId}] ⚠️  Skipping cleanup (--skip-cleanup flag set)`
            );
            console.log(
                `[${runId}] Run ID: ${runId} (use this to cleanup manually)`
            );
        }

        console.log(`\n[${runId}] ✅ Import jobs mode stress test completed!`);
    } catch (error: any) {
        console.error(`[${runId}] ❌ Fatal error:`, error);

        // Cleanup on error
        if (!config.skipCleanup) {
            try {
                if (workflowProcess) {
                    await stopActivityWorkflowManager(workflowProcess, runId);
                }
                await cleanupTestData(runId, config.maxConcurrency);
            } catch (cleanupError: any) {
                console.error(
                    `[${runId}] Cleanup error:`,
                    cleanupError.message
                );
            }
        }

        throw error;
    }
}

async function main() {
    const config = parseArgs();

    // Route to appropriate mode
    if (config.mode === "import-jobs") {
        return await runImportJobsMode(config);
    }

    // Original standard mode
    console.log("🚀 Connection Pool Stress Test (Standard Mode)");
    console.log("=".repeat(80));
    console.log();
    console.log("⚙️  Configuration:");
    console.log(`  Scenario:           ${config.scenario}`);
    console.log(`  Concurrent Workers: ${config.concurrent}`);
    console.log(`  Test Duration:      ${config.duration}s`);
    console.log(`  Max Operations:     ${config.operations}`);
    console.log(`  Operation Delay:    ${config.delay}ms`);
    console.log(`  Monitor Interval:   ${config.monitorInterval}ms`);
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

    const startTime = Date.now();
    const stopSignal = { stop: false };
    const testResults: TestResult[] = [];
    const workerResults = {
        operations: 0,
        successes: 0,
        failures: 0,
        responseTimes: [] as number[],
        errors: [] as Array<{ time: Date; error: string; workerId: number }>,
    };

    // Start monitoring
    const monitorPromise = monitorConnectionPool(
        config,
        testResults,
        stopSignal,
        {
            get operationsCompleted() {
                return workerResults.operations;
            },
            get operationsFailed() {
                return workerResults.failures;
            },
            get averageResponseTime() {
                if (workerResults.responseTimes.length === 0) return 0;
                return (
                    workerResults.responseTimes.reduce((a, b) => a + b, 0) /
                    workerResults.responseTimes.length
                );
            },
        }
    );

    // Start workers
    console.log(`🚀 Starting ${config.concurrent} concurrent workers...`);
    console.log();

    const workerPromises = Array.from({ length: config.concurrent }, (_, i) =>
        worker(i + 1, config, workerResults, stopSignal)
    );

    // Set timeout to stop test
    const timeoutId = setTimeout(() => {
        stopSignal.stop = true;
    }, config.duration * 1000);

    try {
        // Wait for all workers to complete or timeout
        await Promise.all(workerPromises);
    } catch (error) {
        console.error("Error during test execution:", error);
    } finally {
        clearTimeout(timeoutId);
        stopSignal.stop = true;
    }

    // Wait for monitor to finish
    await monitorPromise;

    const testDuration = (Date.now() - startTime) / 1000;

    // Calculate metrics
    const metrics = calculateMetrics(testResults, workerResults, testDuration);

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

    console.log("✅ Stress test completed!");
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
