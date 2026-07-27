#!/usr/bin/env tsx

/**
 * Activity Workflow Manager Helper for Stress Tests
 *
 * Spawns activityWorkflowManager as a background process with runId-tagged logging.
 */

import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface WorkflowManagerProcess {
    process: ChildProcess;
    logPath: string;
    pid: number;
}

const LOG_DIR = "/tmp/stress-test-imports";

/**
 * Start activity workflow manager in background
 */
export async function startActivityWorkflowManager(
    runId: string
): Promise<WorkflowManagerProcess> {
    // Create log directory
    const logDir = path.join(LOG_DIR, runId);
    await fs.promises.mkdir(logDir, { recursive: true });

    const logPath = path.join(logDir, "activity-workflow-manager.log");
    const logStream = fs.createWriteStream(logPath, { flags: "a" });

    // Resolve absolute path to the module
    const modulePath = path.join(process.cwd(), "server/cron-jobs/activityWorkflowManager");

    // Create a wrapper script that imports and runs the activity workflow manager
    const wrapperScript = `
import { activityWorkflowManager } from "${modulePath}";

console.log("[${runId}] Activity Workflow Manager started");

// Run in a loop to keep it running during the test
const runLoop = async () => {
    while (true) {
        try {
            await activityWorkflowManager();
            // Wait a bit before running again
            await new Promise(resolve => setTimeout(resolve, 60000)); // Run every minute
        } catch (error) {
            console.error("[${runId}] Activity Workflow Manager error:", error);
            await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10s on error
        }
    }
};

runLoop().catch(error => {
    console.error("[${runId}] Fatal error:", error);
    process.exit(1);
});
`;

    const wrapperPath = path.join(logDir, "workflow-wrapper.ts");
    await fs.promises.writeFile(wrapperPath, wrapperScript, "utf-8");

    // Use tsx to run the wrapper script
    const childProcess = spawn("npx", ["tsx", wrapperPath], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
    });

    // Pipe stdout and stderr to log file
    childProcess.stdout?.on("data", (data) => {
        const message = `[${new Date().toISOString()}] ${data.toString()}`;
        logStream.write(message);
        process.stdout.write(`[WorkflowManager] ${message}`);
    });

    childProcess.stderr?.on("data", (data) => {
        const message = `[${new Date().toISOString()}] ERROR: ${data.toString()}`;
        logStream.write(message);
        process.stderr.write(`[WorkflowManager] ${message}`);
    });

    childProcess.on("exit", (code) => {
        logStream.write(
            `[${new Date().toISOString()}] Process exited with code ${code}\n`
        );
        logStream.end();
    });

    // Wait a bit to see if process starts successfully
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (!childProcess.pid) {
        throw new Error("Failed to start activity workflow manager process");
    }

    console.log(
        `[${runId}] Activity Workflow Manager started (PID: ${childProcess.pid}, Log: ${logPath})`
    );

    return {
        process: childProcess,
        logPath,
        pid: childProcess.pid,
    };
}

/**
 * Stop activity workflow manager gracefully
 */
export async function stopActivityWorkflowManager(
    workflowProcess: WorkflowManagerProcess,
    runId: string
): Promise<void> {
    if (!workflowProcess.process.pid) {
        return;
    }

    console.log(
        `[${runId}] Stopping Activity Workflow Manager (PID: ${workflowProcess.pid})...`
    );

    // Try graceful shutdown first
    workflowProcess.process.kill("SIGTERM");

    // Wait up to 5 seconds for graceful shutdown
    await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
            // Force kill if still running
            if (workflowProcess.process.pid) {
                console.log(
                    `[${runId}] Force killing Activity Workflow Manager...`
                );
                workflowProcess.process.kill("SIGKILL");
            }
            resolve();
        }, 5000);

        workflowProcess.process.on("exit", () => {
            clearTimeout(timeout);
            resolve();
        });
    });

    console.log(`[${runId}] Activity Workflow Manager stopped`);
}

/**
 * Check if activity workflow manager is running
 */
export function isWorkflowManagerRunning(
    workflowProcess: WorkflowManagerProcess
): boolean {
    if (!workflowProcess.process.pid) {
        return false;
    }

    try {
        // Check if process exists (Unix/Linux/Mac)
        process.kill(workflowProcess.process.pid, 0);
        return true;
    } catch {
        return false;
    }
}

// Allow running as standalone script for testing
if (require.main === module) {
    const runId = process.argv[2] || `test-${Date.now()}`;

    startActivityWorkflowManager(runId)
        .then((workflowProcess) => {
            console.log("\n✅ Activity Workflow Manager started!");
            console.log(`PID: ${workflowProcess.pid}`);
            console.log(`Log: ${workflowProcess.logPath}`);

            // Keep running until interrupted
            process.on("SIGINT", async () => {
                await stopActivityWorkflowManager(workflowProcess, runId);
                process.exit(0);
            });

            // Monitor process
            const interval = setInterval(() => {
                if (!isWorkflowManagerRunning(workflowProcess)) {
                    console.log(
                        "\n⚠️  Activity Workflow Manager process exited"
                    );
                    clearInterval(interval);
                    process.exit(1);
                }
            }, 5000);
        })
        .catch((error) => {
            console.error(
                "❌ Failed to start Activity Workflow Manager:",
                error
            );
            process.exit(1);
        });
}
