/**
 * Database Operations Workload
 *
 * Performs read/write/complex database operations similar to the original
 * stress test, but scoped to a specific account. Supports parallel operations.
 */

import { prisma } from "@/lib/prisma";
import { BaseWorkload, WorkloadConfig } from "./index";

export class DbOpsWorkload extends BaseWorkload {
    private accountId: number;
    private parallelOps: number;

    constructor(accountId: number, config: WorkloadConfig = {}) {
        super({
            ...config,
            delay: config.delay || 25, // Reduced default delay from 100ms to 25ms
        });
        this.accountId = accountId;
        this.parallelOps = (config as any).parallelOps || 1;
    }

    async start(stopSignal: { stop: boolean }): Promise<void> {
        const startTime = Date.now();
        const endTime = startTime + this.config.duration! * 1000;
        const operationTypes: Array<
            "read" | "write" | "complex" | "realistic"
        > = ["read", "write", "complex", "realistic"];

        while (
            !stopSignal.stop &&
            !this.stopped &&
            Date.now() < endTime &&
            this.metrics.operationsCompleted < this.config.maxOperations!
        ) {
            // Run parallel operations if configured
            if (this.parallelOps > 1) {
                await this.runParallelOperations(
                    this.parallelOps,
                    operationTypes
                );
            } else {
                const operationType =
                    operationTypes[
                    Math.floor(Math.random() * operationTypes.length)
                    ];

                const result =
                    await this.simulateDatabaseOperation(operationType);

                if (result.success) {
                    this.recordSuccess(result.duration);
                } else {
                    this.recordFailure(
                        result.error || "unknown",
                        result.duration
                    );
                }
            }

            // Delay between operation batches
            if (this.config.delay! > 0) {
                await new Promise((resolve) =>
                    setTimeout(resolve, this.config.delay!)
                );
            }
        }
    }

    private async runParallelOperations(
        count: number,
        operationTypes: Array<"read" | "write" | "complex" | "realistic">
    ): Promise<void> {
        const operations = Array(count)
            .fill(null)
            .map(() =>
                this.simulateDatabaseOperation(
                    operationTypes[
                    Math.floor(Math.random() * operationTypes.length)
                    ]
                )
            );

        const results = await Promise.all(operations);
        results.forEach((result) => {
            if (result.success) {
                this.recordSuccess(result.duration);
            } else {
                this.recordFailure(result.error || "unknown", result.duration);
            }
        });
    }

    private async simulateDatabaseOperation(
        operationType: "read" | "write" | "complex" | "realistic"
    ): Promise<{ success: boolean; duration: number; error?: string }> {
        const startTime = Date.now();

        try {
            switch (operationType) {
                case "read":
                    // Simple read operation scoped to account
                    await prisma.account.findUnique({
                        where: { id: this.accountId },
                        select: { id: true, name: true },
                    });
                    break;
                case "write":
                    // Simple write operation (using a safe query)
                    await prisma.$queryRaw`SELECT NOW()`;
                    break;
                case "complex":
                    // More complex operation with account context
                    await prisma.$queryRaw`
                        SELECT 
                            count(*)::int as total
                        FROM pg_stat_activity
                        WHERE datname = current_database()
                    `;
                    break;
                case "realistic":
                    // Realistic account-scoped query simulating dashboard/customer list
                    await prisma.customer.findMany({
                        where: {
                            account_id: this.accountId,
                        },
                        select: {
                            id: true,
                            customer_number: true,
                            Company: {
                                select: {
                                    name: true,
                                },
                            },
                        },
                        take: 10,
                    });
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
}
